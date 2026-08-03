from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.reaction import ReactionTargetType
from backend.models.status import StatusPost, StatusPrivacy, StatusReply, StatusType, StatusView
from backend.models.user import User, utcnow
from backend.schemas.status import StatusCreate, StatusOut
from backend.services import friend_service, reaction_service
from backend.services.realtime import manager


def _privacy_enum(value: str) -> StatusPrivacy:
    if value == "except":
        return StatusPrivacy.except_
    return StatusPrivacy(value)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


async def can_view_status(db: AsyncSession, post: StatusPost, viewer_id: str) -> bool:
    if post.user_id == viewer_id:
        return True
    if post.deleted_at is not None:
        return False
    if not post.is_highlighted and _as_utc(post.expires_at) < datetime.now(UTC):
        return False
    if await friend_service.is_blocked(db, post.user_id, viewer_id):
        return False

    audience = set(post.audience_ids or [])
    privacy = post.privacy

    if privacy == StatusPrivacy.except_:
        return viewer_id not in audience and await friend_service.are_friends(db, post.user_id, viewer_id)
    if privacy == StatusPrivacy.only_share_with:
        return viewer_id in audience
    if privacy == StatusPrivacy.close_friends:
        # close_friends uses audience_ids as curated subset
        return viewer_id in audience
    # friends (default)
    return await friend_service.are_friends(db, post.user_id, viewer_id)


async def create_status(db: AsyncSession, user: User, data: StatusCreate) -> StatusPost:
    if data.type in ("image", "video") and not data.storage_key:
        raise ValueError("storage_key required for media status")
    post = StatusPost(
        user_id=user.id,
        type=StatusType(data.type),
        storage_key=data.storage_key,
        caption=data.caption,
        background_style=data.background_style,
        privacy=_privacy_enum(data.privacy),
        audience_ids=data.audience_ids,
        expires_at=datetime.now(UTC) + timedelta(hours=24),
    )
    db.add(post)
    await db.flush()

    friends = await friend_service.list_friends(db, user.id)
    payload = status_to_out(post).model_dump(mode="json")
    for friend in friends:
        if await can_view_status(db, post, friend.id):
            await manager.publish(f"user:{friend.id}", "status.new", payload)
    return post


def status_to_out(
    post: StatusPost,
    *,
    reaction_count: int = 0,
    view_count: int = 0,
    my_reaction: str | None = None,
) -> StatusOut:
    privacy = post.privacy.value if post.privacy != StatusPrivacy.except_ else "except"
    return StatusOut(
        id=post.id,
        user_id=post.user_id,
        type=post.type.value,
        storage_key=post.storage_key,
        caption=post.caption,
        background_style=post.background_style,
        privacy=privacy,
        audience_ids=post.audience_ids,
        is_highlighted=post.is_highlighted,
        created_at=post.created_at,
        expires_at=post.expires_at,
        reaction_count=reaction_count,
        view_count=view_count,
        my_reaction=my_reaction,
    )


async def enrich_status(db: AsyncSession, post: StatusPost, viewer_id: str) -> StatusOut:
    reaction_count = await reaction_service.count_reactions(
        db, target_type=ReactionTargetType.status, target_id=post.id
    )
    views = list((await db.scalars(select(StatusView).where(StatusView.status_id == post.id))).all())
    my_reaction = await reaction_service.my_reaction(
        db, target_type=ReactionTargetType.status, target_id=post.id, user_id=viewer_id
    )
    return status_to_out(post, reaction_count=reaction_count, view_count=len(views), my_reaction=my_reaction)


async def feed(db: AsyncSession, user: User) -> list[dict]:
    friends = await friend_service.list_friends(db, user.id)
    now = datetime.now(UTC)
    result: list[dict] = []

    async def pack_user(owner: User, *, include_all: bool) -> dict | None:
        posts = list(
            (
                await db.scalars(
                    select(StatusPost).where(
                        StatusPost.user_id == owner.id,
                        StatusPost.deleted_at.is_(None),
                        or_(StatusPost.is_highlighted.is_(True), StatusPost.expires_at > now),
                    )
                )
            ).all()
        )
        visible: list[StatusOut] = []
        has_unseen = False
        for post in posts:
            if not include_all and not await can_view_status(db, post, user.id):
                continue
            out = await enrich_status(db, post, user.id)
            visible.append(out)
            if owner.id != user.id:
                viewed_row = await db.scalar(
                    select(StatusView).where(
                        StatusView.status_id == post.id, StatusView.viewer_id == user.id
                    )
                )
                if not viewed_row:
                    has_unseen = True
        if not visible:
            return None
        return {
            "user": {
                "id": owner.id,
                "username": owner.username,
                "display_name": owner.display_name,
                "avatar_url": owner.avatar_url,
                "avatar_icon_id": owner.avatar_icon_id,
                "avatar_type": owner.avatar_type.value if owner.avatar_type else None,
            },
            "statuses": [p.model_dump(mode="json") for p in visible],
            "has_unseen": has_unseen,
        }

    mine = await pack_user(user, include_all=True)
    if mine:
        result.append(mine)

    for friend in friends:
        packed = await pack_user(friend, include_all=False)
        if packed:
            result.append(packed)

    # Own first, then unseen, then name
    result.sort(
        key=lambda x: (
            x["user"]["id"] != user.id,
            not x["has_unseen"],
            x["user"]["display_name"].lower(),
        )
    )
    return result


async def delete_status(db: AsyncSession, post: StatusPost, user_id: str) -> None:
    if post.user_id != user_id:
        raise PermissionError("Not your status")
    post.deleted_at = utcnow()
    await db.flush()


async def record_view(db: AsyncSession, post: StatusPost, viewer_id: str) -> StatusView:
    existing = await db.scalar(
        select(StatusView).where(StatusView.status_id == post.id, StatusView.viewer_id == viewer_id)
    )
    if existing:
        return existing
    view = StatusView(status_id=post.id, viewer_id=viewer_id)
    db.add(view)
    await db.flush()
    await manager.publish(
        f"user:{post.user_id}",
        "status.viewed",
        {"statusId": post.id, "userId": viewer_id},
    )
    return view


async def list_views(db: AsyncSession, post: StatusPost, requester_id: str) -> list[dict]:
    if post.user_id != requester_id:
        raise PermissionError("Poster only")
    views = list((await db.scalars(select(StatusView).where(StatusView.status_id == post.id))).all())
    result = []
    for view in views:
        user = await db.get(User, view.viewer_id)
        result.append(
            {
                "viewer_id": view.viewer_id,
                "viewed_at": view.viewed_at,
                "username": user.username if user else None,
                "display_name": user.display_name if user else None,
            }
        )
    return result


async def react(db: AsyncSession, post: StatusPost, user_id: str, emoji: str):
    reaction = await reaction_service.upsert_reaction(
        db,
        target_type=ReactionTargetType.status,
        target_id=post.id,
        user_id=user_id,
        emoji=emoji,
    )
    await manager.publish(
        f"user:{post.user_id}",
        "status.reaction",
        {"statusId": post.id, "userId": user_id, "emoji": emoji},
    )
    return reaction


async def unreact(db: AsyncSession, post: StatusPost, user_id: str) -> None:
    await reaction_service.remove_reaction(
        db, target_type=ReactionTargetType.status, target_id=post.id, user_id=user_id
    )


async def reply(db: AsyncSession, post: StatusPost, from_user_id: str, message: str) -> StatusReply:
    row = StatusReply(status_id=post.id, from_user_id=from_user_id, message=message)
    db.add(row)
    await db.flush()
    # Full chat Message creation lives in BACKEND.md chat layer; tag context for when wired up.
    await manager.publish(
        f"user:{post.user_id}",
        "status.reply",
        {"statusId": post.id, "fromUserId": from_user_id, "message": message, "context": "status_reply"},
    )
    return row


async def highlight(db: AsyncSession, post: StatusPost, user_id: str) -> StatusPost:
    if post.user_id != user_id:
        raise PermissionError("Not your status")
    post.is_highlighted = True
    await db.flush()
    return post


async def expire_old_statuses(db: AsyncSession) -> int:
    now = datetime.now(UTC)
    posts = list(
        (
            await db.scalars(
                select(StatusPost).where(
                    StatusPost.deleted_at.is_(None),
                    StatusPost.is_highlighted.is_(False),
                    StatusPost.expires_at <= now,
                )
            )
        ).all()
    )
    for post in posts:
        post.deleted_at = now
    await db.flush()
    return len(posts)
