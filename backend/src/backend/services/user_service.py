from __future__ import annotations

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.device import Device
from backend.models.friend import Block, ContactSync, FriendRequest, Friendship
from backend.models.reaction import Reaction
from backend.models.status import StatusPost, StatusReply, StatusView
from backend.models.user import LastSeenVisibility, User
from backend.schemas.user import UserUpdate
from backend.services import friend_service
from backend.services.realtime import manager


async def get_public_profile(db: AsyncSession, viewer: User, user_id: str) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise LookupError("User not found")
    if await friend_service.is_blocked(db, viewer.id, user_id):
        raise PermissionError("Blocked")

    is_friend = await friend_service.are_friends(db, viewer.id, user_id)
    last_seen = None
    if user.last_seen_visibility == LastSeenVisibility.everyone:
        last_seen = user.last_seen_at
    elif user.last_seen_visibility == LastSeenVisibility.friends and is_friend:
        last_seen = user.last_seen_at

    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "bio": user.bio,
        "status_text": user.status_text,
        "avatar_url": user.avatar_url,
        "avatar_type": user.avatar_type.value if getattr(user, "avatar_type", None) else None,
        "avatar_video_url": user.avatar_video_url,
        "cover_photo_url": user.cover_photo_url,
        "last_seen_at": last_seen,
        "is_friend": is_friend,
        "is_online": await manager.is_online(user.id)
        if is_friend or user.last_seen_visibility == LastSeenVisibility.everyone
        else False,
        "presence_state": await manager.presence_state(user.id)
        if is_friend or user.last_seen_visibility == LastSeenVisibility.everyone
        else None,
        "focus": focus_payload_for(viewer.id, user),
    }


async def update_me(db: AsyncSession, user: User, data: UserUpdate) -> User:
    if data.display_name is not None:
        user.display_name = data.display_name
    if data.bio is not None:
        user.bio = data.bio
    if data.status_text is not None:
        user.status_text = data.status_text
    if data.last_seen_visibility is not None:
        user.last_seen_visibility = LastSeenVisibility(data.last_seen_visibility)
    if data.read_receipts_enabled is not None:
        user.read_receipts_enabled = data.read_receipts_enabled
    if data.typing_indicators_enabled is not None:
        user.typing_indicators_enabled = data.typing_indicators_enabled
    if data.phone_visibility is not None:
        user.phone_visibility = data.phone_visibility
    if data.findable_by_phone is not None:
        user.findable_by_phone = data.findable_by_phone
    await db.flush()
    return user


async def set_focus(db: AsyncSession, user: User, until, message: str | None, share_with: list[str]) -> User:
    import json

    user.focus_until = until
    user.focus_message = message
    user.focus_share_with = json.dumps(share_with)
    await db.flush()
    for uid in share_with:
        await manager.publish(
            f"user:{uid}",
            "focus.updated",
            {
                "userId": user.id,
                "until": until.isoformat() if until else None,
                "message": message,
            },
        )
    return user


def focus_payload_for(viewer_id: str, user: User) -> dict | None:
    import json
    from datetime import UTC, datetime

    if not user.focus_until:
        return None
    until = user.focus_until if user.focus_until.tzinfo else user.focus_until.replace(tzinfo=UTC)
    if until < datetime.now(UTC):
        return None
    try:
        shared = set(json.loads(user.focus_share_with or "[]"))
    except json.JSONDecodeError:
        shared = set()
    if viewer_id != user.id and viewer_id not in shared:
        return None
    return {"until": until.isoformat(), "message": user.focus_message}



async def search_users(db: AsyncSession, viewer: User, q: str, limit: int = 20) -> list[User]:
    pattern = f"%{q.lower()}%"
    users = list(
        (
            await db.scalars(
                select(User)
                .where(
                    User.id != viewer.id,
                    or_(
                        User.username.ilike(pattern),
                        User.phone.ilike(pattern),
                        User.display_name.ilike(pattern),
                    ),
                )
                .limit(limit)
            )
        ).all()
    )
    result = []
    for user in users:
        if await friend_service.is_blocked(db, viewer.id, user.id):
            continue
        result.append(user)
    return result


async def export_account(db: AsyncSession, user: User) -> dict:
    friends = await friend_service.list_friends(db, user.id)
    statuses = list((await db.scalars(select(StatusPost).where(StatusPost.user_id == user.id))).all())
    devices = list((await db.scalars(select(Device).where(Device.user_id == user.id))).all())
    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "phone": user.phone,
            "display_name": user.display_name,
            "bio": user.bio,
            "avatar_url": user.avatar_url,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "friends": [{"id": f.id, "username": f.username, "display_name": f.display_name} for f in friends],
        "statuses": [
            {
                "id": s.id,
                "type": s.type.value,
                "caption": s.caption,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            }
            for s in statuses
        ],
        "devices": [
            {"id": d.id, "device_name": d.device_name, "created_at": d.created_at.isoformat()}
            for d in devices
        ],
    }


async def delete_account(db: AsyncSession, user: User) -> None:
    uid = user.id
    await db.execute(delete(Reaction).where(Reaction.user_id == uid))
    await db.execute(delete(StatusView).where(StatusView.viewer_id == uid))
    await db.execute(delete(StatusReply).where(StatusReply.from_user_id == uid))
    await db.execute(delete(StatusPost).where(StatusPost.user_id == uid))
    await db.execute(delete(ContactSync).where(ContactSync.user_id == uid))
    await db.execute(
        delete(FriendRequest).where((FriendRequest.from_user_id == uid) | (FriendRequest.to_user_id == uid))
    )
    await db.execute(
        delete(Friendship).where((Friendship.user_id_a == uid) | (Friendship.user_id_b == uid))
    )
    await db.execute(delete(Block).where((Block.blocker_id == uid) | (Block.blocked_id == uid)))
    await db.execute(delete(Device).where(Device.user_id == uid))
    await db.delete(user)
    await db.flush()
