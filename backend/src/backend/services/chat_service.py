from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.chat import Chat, ChatMember, MemberRole
from backend.models.message import DeliveryState, Message, MessageStatus
from backend.models.user import User
from backend.services import friend_service
from backend.services.realtime import manager


async def get_member(db: AsyncSession, chat_id: str, user_id: str) -> ChatMember | None:
    return await db.scalar(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id)
    )


async def require_member(db: AsyncSession, chat_id: str, user_id: str) -> ChatMember:
    member = await get_member(db, chat_id, user_id)
    if not member:
        raise PermissionError("Not a member of this chat")
    return member


def _peer_dict(user: User, *, presence_state: str | None = None) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "avatar_icon_id": user.avatar_icon_id,
        "avatar_type": user.avatar_type.value if user.avatar_type else None,
        "presence_state": presence_state,
        "status_text": user.status_text,
        "focus_until": user.focus_until.isoformat() if user.focus_until else None,
        "focus_message": user.focus_message,
    }


async def last_message_dict(db: AsyncSession, chat_id: str) -> dict | None:
    msg = await db.scalar(
        select(Message)
        .where(Message.chat_id == chat_id, Message.deleted_at.is_(None))
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    if not msg:
        return None
    return {
        "id": msg.id,
        "chat_id": msg.chat_id,
        "sender_id": msg.sender_id,
        "type": msg.type.value,
        "body": msg.body,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }


async def unread_count(db: AsyncSession, chat_id: str, user_id: str) -> int:
    count = await db.scalar(
        select(func.count())
        .select_from(MessageStatus)
        .join(Message, Message.id == MessageStatus.message_id)
        .where(
            MessageStatus.user_id == user_id,
            Message.chat_id == chat_id,
            Message.sender_id != user_id,
            Message.deleted_at.is_(None),
            MessageStatus.state != DeliveryState.read,
        )
    )
    return int(count or 0)


async def enrich_chat(
    db: AsyncSession,
    chat: Chat,
    member: ChatMember | None,
    viewer_id: str,
) -> dict:
    peer = None
    if not chat.is_group and not chat.is_notes_to_self:
        ids = await member_ids(db, chat.id)
        other_id = next((uid for uid in ids if uid != viewer_id), None)
        if other_id:
            other = await db.get(User, other_id)
            if other:
                presence = await manager.presence_state(other_id)
                peer = _peer_dict(other, presence_state=presence)

    last = await last_message_dict(db, chat.id)
    unread = await unread_count(db, chat.id, viewer_id)

    return {
        "id": chat.id,
        "is_group": chat.is_group,
        "is_community": bool(getattr(chat, "is_community", False)),
        "is_notes_to_self": chat.is_notes_to_self,
        "name": chat.name,
        "description": getattr(chat, "description", None),
        "avatar_url": chat.avatar_url,
        "theme": chat.theme,
        "wallpaper": chat.wallpaper,
        "disappear_after_seconds": chat.disappear_after_seconds,
        "expires_at": chat.expires_at,
        "e2e_enabled": chat.e2e_enabled,
        "role": member.role.value if member else None,
        "pinned": member.pinned if member else False,
        "archived": member.archived if member else False,
        "muted": member.muted if member else False,
        "auto_translate_language": getattr(member, "auto_translate_language", None) if member else None,
        "created_at": chat.created_at,
        "created_by": chat.created_by,
        "unread_count": unread,
        "peer": peer,
        "last_message": last,
    }


async def create_direct_chat(db: AsyncSession, user: User, other_user_id: str) -> Chat:
    if user.id == other_user_id:
        raise ValueError("Cannot DM yourself — use notes-to-self")
    if await friend_service.is_blocked(db, user.id, other_user_id):
        raise PermissionError("Blocked")
    if not await friend_service.are_friends(db, user.id, other_user_id):
        raise PermissionError("Friends only for 1:1 chats")

    # Reuse existing DM if present
    my_chats = list((await db.scalars(select(ChatMember).where(ChatMember.user_id == user.id))).all())
    for membership in my_chats:
        chat = await db.get(Chat, membership.chat_id)
        if not chat or chat.is_group or chat.is_notes_to_self:
            continue
        other = await db.scalar(
            select(ChatMember).where(ChatMember.chat_id == chat.id, ChatMember.user_id == other_user_id)
        )
        if other:
            return chat

    chat = Chat(is_group=False, created_by=user.id)
    db.add(chat)
    await db.flush()
    db.add(ChatMember(chat_id=chat.id, user_id=user.id, role=MemberRole.member))
    db.add(ChatMember(chat_id=chat.id, user_id=other_user_id, role=MemberRole.member))
    await db.flush()
    return chat


async def get_or_create_notes(db: AsyncSession, user: User) -> Chat:
    existing = await db.scalar(
        select(Chat)
        .join(ChatMember, ChatMember.chat_id == Chat.id)
        .where(Chat.is_notes_to_self.is_(True), ChatMember.user_id == user.id)
    )
    if existing:
        return existing
    chat = Chat(is_group=False, is_notes_to_self=True, name="Notes to Self", created_by=user.id)
    db.add(chat)
    await db.flush()
    db.add(ChatMember(chat_id=chat.id, user_id=user.id, role=MemberRole.owner))
    await db.flush()
    return chat


async def create_group(
    db: AsyncSession,
    user: User,
    name: str,
    member_user_ids: list[str],
    *,
    description: str | None = None,
    is_community: bool = False,
) -> Chat:
    chat = Chat(
        is_group=True,
        is_community=is_community,
        name=name.strip(),
        description=(description or "").strip() or None,
        created_by=user.id,
    )
    db.add(chat)
    await db.flush()
    db.add(ChatMember(chat_id=chat.id, user_id=user.id, role=MemberRole.owner))
    for uid in member_user_ids:
        if uid == user.id:
            continue
        if not await friend_service.are_friends(db, user.id, uid):
            raise PermissionError(f"Can only add friends directly: {uid}")
        if await friend_service.is_blocked(db, user.id, uid):
            continue
        db.add(ChatMember(chat_id=chat.id, user_id=uid, role=MemberRole.member))
    await db.flush()
    event = "community.new" if is_community else "chat.new"
    for uid in {user.id, *member_user_ids}:
        await manager.publish(
            f"user:{uid}",
            event,
            {
                "chatId": chat.id,
                "name": chat.name,
                "isGroup": True,
                "isCommunity": is_community,
            },
        )
    return chat


async def list_chats(db: AsyncSession, user_id: str) -> list[tuple[Chat, ChatMember]]:
    rows = list((await db.scalars(select(ChatMember).where(ChatMember.user_id == user_id))).all())
    result = []
    now = datetime.now(UTC)
    for m in rows:
        chat = await db.get(Chat, m.chat_id)
        if not chat:
            continue
        if chat.expires_at is not None:
            exp = chat.expires_at if chat.expires_at.tzinfo else chat.expires_at.replace(tzinfo=UTC)
            if exp < now:
                continue
        result.append((chat, m))
    # Sort by last activity when available; fall back to created_at
    enriched_sort: list[tuple[Chat, ChatMember, float]] = []
    for chat, m in result:
        last = await db.scalar(
            select(Message.created_at)
            .where(Message.chat_id == chat.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        ts = (last or chat.created_at or datetime.min.replace(tzinfo=UTC)).timestamp()
        enriched_sort.append((chat, m, ts))
    enriched_sort.sort(key=lambda x: (not x[1].pinned, x[1].archived, -x[2]))
    return [(c, m) for c, m, _ in enriched_sort]


async def update_chat(
    db: AsyncSession,
    chat: Chat,
    *,
    name: str | None = None,
    avatar_url: str | None = None,
    theme: str | None = None,
    wallpaper: str | None = None,
    disappear_after_seconds: int | None = None,
    expires_in_hours: int | None = None,
    e2e_enabled: bool | None = None,
) -> Chat:
    if name is not None:
        chat.name = name
    if avatar_url is not None:
        chat.avatar_url = avatar_url
    if theme is not None:
        chat.theme = theme
    if wallpaper is not None:
        chat.wallpaper = wallpaper
    if disappear_after_seconds is not None:
        chat.disappear_after_seconds = disappear_after_seconds if disappear_after_seconds > 0 else None
    if expires_in_hours is not None:
        chat.expires_at = datetime.now(UTC) + timedelta(hours=expires_in_hours) if expires_in_hours > 0 else None
    if e2e_enabled is not None:
        chat.e2e_enabled = e2e_enabled
    await db.flush()
    return chat


async def add_members(db: AsyncSession, chat: Chat, adder_id: str, user_ids: list[str]) -> None:
    for uid in user_ids:
        if await get_member(db, chat.id, uid):
            continue
        if not await friend_service.are_friends(db, adder_id, uid):
            raise PermissionError("Can only add friends")
        db.add(ChatMember(chat_id=chat.id, user_id=uid, role=MemberRole.member))
        await manager.publish(f"user:{uid}", "chat.added", {"chatId": chat.id})
    await db.flush()


async def remove_member(db: AsyncSession, chat: Chat, user_id: str) -> None:
    member = await get_member(db, chat.id, user_id)
    if member:
        await db.delete(member)
        await db.flush()


async def promote(db: AsyncSession, chat_id: str, user_id: str) -> None:
    member = await get_member(db, chat_id, user_id)
    if not member:
        raise LookupError("Member not found")
    member.role = MemberRole.admin
    await db.flush()


async def demote(db: AsyncSession, chat_id: str, user_id: str) -> None:
    member = await get_member(db, chat_id, user_id)
    if not member:
        raise LookupError("Member not found")
    if member.role == MemberRole.owner:
        raise PermissionError("Cannot demote owner")
    member.role = MemberRole.member
    await db.flush()


async def leave_group(db: AsyncSession, chat: Chat, user_id: str) -> None:
    member = await get_member(db, chat.id, user_id)
    if not member:
        return
    if member.role == MemberRole.owner:
        # Transfer to earliest admin, else earliest member
        others = list(
            (
                await db.scalars(
                    select(ChatMember)
                    .where(ChatMember.chat_id == chat.id, ChatMember.user_id != user_id)
                    .order_by(ChatMember.joined_at.asc())
                )
            ).all()
        )
        admins = [m for m in others if m.role == MemberRole.admin]
        successor = admins[0] if admins else (others[0] if others else None)
        if successor:
            successor.role = MemberRole.owner
    await db.delete(member)
    await db.flush()


async def member_ids(db: AsyncSession, chat_id: str) -> list[str]:
    rows = list((await db.scalars(select(ChatMember).where(ChatMember.chat_id == chat_id))).all())
    return [r.user_id for r in rows]


async def broadcast_to_chat(db: AsyncSession, chat_id: str, event_type: str, data: dict) -> None:
    for uid in await member_ids(db, chat_id):
        await manager.publish(f"user:{uid}", event_type, data)


async def broadcast_presence_to_friends(
    db: AsyncSession,
    user_id: str,
    *,
    online: bool,
    state: str,
) -> None:
    friends = await friend_service.list_friends(db, user_id)
    payload = {"userId": user_id, "online": online, "state": state}
    for friend in friends:
        await manager.publish(f"user:{friend.id}", "presence", payload)
