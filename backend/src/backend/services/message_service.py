from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.chat import Chat
from backend.models.message import Attachment, DeliveryState, Message, MessageStatus, MessageType
from backend.models.reaction import ReactionTargetType
from backend.models.user import User, utcnow
from backend.services import chat_service, reaction_service
from backend.services.realtime import manager


def _message_dict(
    msg: Message,
    *,
    reaction_count: int = 0,
    my_reaction: str | None = None,
    reactions: list[dict] | None = None,
) -> dict:
    """Snake_case payload matching the frontend Message type."""
    return {
        "id": msg.id,
        "chat_id": msg.chat_id,
        "sender_id": msg.sender_id,
        "type": msg.type.value,
        "body": None if msg.deleted_at else msg.body,
        "reply_to_id": msg.reply_to_id,
        "forwarded_from_id": msg.forwarded_from_id,
        "context": msg.context,
        "code_language": msg.code_language,
        "transcript": msg.transcript,
        "view_once": msg.view_once,
        "edited_at": msg.edited_at.isoformat() if msg.edited_at else None,
        "deleted_at": msg.deleted_at.isoformat() if msg.deleted_at else None,
        "expires_at": msg.expires_at.isoformat() if msg.expires_at else None,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
        "reaction_count": reaction_count,
        "my_reaction": my_reaction,
        "reactions": reactions or [],
        "attachments": [
            {
                "id": a.id,
                "storage_key": a.storage_key,
                "mime_type": a.mime_type,
                "size_bytes": a.size_bytes,
                "filename": a.filename,
            }
            for a in (msg.attachments or [])
        ],
    }


async def send_message(
    db: AsyncSession,
    *,
    chat: Chat,
    sender: User,
    body: str | None = None,
    msg_type: str = "text",
    reply_to_id: str | None = None,
    code_language: str | None = None,
    transcript: str | None = None,
    view_once: bool = False,
    context: str | None = None,
    attachments: list[dict] | None = None,
) -> Message:
    from backend.services import friend_service

    if chat.expires_at:
        exp = chat.expires_at if chat.expires_at.tzinfo else chat.expires_at.replace(tzinfo=UTC)
        if exp < datetime.now(UTC):
            raise PermissionError("This chat has expired")

    # Block guard for 1:1 DMs — check before writing
    if not chat.is_group and not chat.is_notes_to_self:
        peer_ids = await chat_service.member_ids(db, chat.id)
        other_id = next((uid for uid in peer_ids if uid != sender.id), None)
        if other_id and await friend_service.is_blocked(db, sender.id, other_id):
            raise PermissionError("You can't message this user")

    expires_at = None
    if chat.disappear_after_seconds:
        expires_at = datetime.now(UTC) + timedelta(seconds=chat.disappear_after_seconds)

    msg = Message(
        chat_id=chat.id,
        sender_id=sender.id,
        type=MessageType(msg_type),
        body=body,
        reply_to_id=reply_to_id,
        code_language=code_language,
        transcript=transcript,
        view_once=view_once,
        context=context,
        expires_at=expires_at,
    )
    db.add(msg)
    await db.flush()

    for att in attachments or []:
        db.add(
            Attachment(
                message_id=msg.id,
                storage_key=att["storage_key"],
                mime_type=att.get("mime_type", "application/octet-stream"),
                size_bytes=att.get("size_bytes", 0),
                filename=att.get("filename"),
            )
        )

    member_ids = await chat_service.member_ids(db, chat.id)
    for uid in member_ids:
        state = DeliveryState.sent if uid == sender.id else DeliveryState.delivered
        db.add(MessageStatus(message_id=msg.id, user_id=uid, state=state))
    await db.flush()

    # Reload attachments relationship
    await db.refresh(msg, attribute_names=["attachments"])
    payload = _message_dict(msg, reactions=[])
    await chat_service.broadcast_to_chat(db, chat.id, "message.new", payload)
    await manager.publish(
        f"user:{sender.id}",
        "message.ack",
        {"messageId": msg.id, "chatId": chat.id},
    )
    return msg


async def list_messages(
    db: AsyncSession,
    chat_id: str,
    user_id: str,
    *,
    limit: int = 50,
    before: str | None = None,
) -> list[dict]:
    q = select(Message).where(Message.chat_id == chat_id).order_by(Message.created_at.desc()).limit(limit)
    if before:
        before_msg = await db.get(Message, before)
        if before_msg:
            q = (
                select(Message)
                .where(Message.chat_id == chat_id, Message.created_at < before_msg.created_at)
                .order_by(Message.created_at.desc())
                .limit(limit)
            )
    rows = list((await db.scalars(q)).all())
    now = datetime.now(UTC)
    out = []
    for msg in reversed(rows):
        if msg.expires_at:
            exp = msg.expires_at if msg.expires_at.tzinfo else msg.expires_at.replace(tzinfo=UTC)
            if exp < now:
                continue
        await db.refresh(msg, attribute_names=["attachments"])
        reaction_rows = await reaction_service.list_reactions(
            db, target_type=ReactionTargetType.message, target_id=msg.id
        )
        reactions = [{"user_id": r.user_id, "emoji": r.emoji} for r in reaction_rows]
        mine = next((r["emoji"] for r in reactions if r["user_id"] == user_id), None)
        payload = _message_dict(
            msg,
            reaction_count=len(reactions),
            my_reaction=mine,
            reactions=reactions,
        )
        if msg.type == MessageType.location:
            from backend.services import location_service

            share = await location_service.get_share_for_message(db, msg.id)
            if share:
                payload["location_share"] = location_service.share_to_dict(share)
        out.append(payload)
    return out


async def edit_message(db: AsyncSession, msg: Message, user_id: str, body: str) -> Message:
    if msg.sender_id != user_id:
        raise PermissionError("Not your message")
    if msg.type not in {MessageType.text, MessageType.code}:
        raise ValueError("Only text/code messages can be edited")
    msg.body = body
    msg.edited_at = utcnow()
    await db.flush()
    await db.refresh(msg, attribute_names=["attachments"])
    await chat_service.broadcast_to_chat(db, msg.chat_id, "message.edited", _message_dict(msg))
    return msg


async def delete_message(db: AsyncSession, msg: Message, user_id: str) -> None:
    if msg.sender_id != user_id:
        # allow chat admin moderation
        member = await chat_service.get_member(db, msg.chat_id, user_id)
        if not member or member.role.value not in {"admin", "owner"}:
            raise PermissionError("Not your message")
    msg.deleted_at = utcnow()
    msg.body = None
    await db.flush()
    await chat_service.broadcast_to_chat(
        db, msg.chat_id, "message.deleted", {"messageId": msg.id, "chatId": msg.chat_id}
    )


async def forward_message(
    db: AsyncSession, msg: Message, sender: User, target_chat: Chat
) -> Message:
    return await send_message(
        db,
        chat=target_chat,
        sender=sender,
        body=msg.body,
        msg_type=msg.type.value,
        code_language=msg.code_language,
        transcript=msg.transcript,
        context="forwarded",
        attachments=[
            {
                "storage_key": a.storage_key,
                "mime_type": a.mime_type,
                "size_bytes": a.size_bytes,
                "filename": a.filename,
            }
            for a in (msg.attachments or [])
        ],
    )


async def mark_read(db: AsyncSession, message_id: str, user: User) -> None:
    if not user.read_receipts_enabled:
        return
    msg = await db.get(Message, message_id)
    if not msg:
        raise LookupError("Message not found")
    status = await db.scalar(
        select(MessageStatus).where(MessageStatus.message_id == message_id, MessageStatus.user_id == user.id)
    )
    if status:
        status.state = DeliveryState.read
        status.updated_at = utcnow()
        await db.flush()
    await chat_service.broadcast_to_chat(
        db,
        msg.chat_id,
        "message.read",
        {"messageId": message_id, "userId": user.id, "chatId": msg.chat_id},
    )


async def search_messages(db: AsyncSession, chat_id: str, q: str, limit: int = 30) -> list[dict]:
    pattern = f"%{q}%"
    rows = list(
        (
            await db.scalars(
                select(Message)
                .where(
                    Message.chat_id == chat_id,
                    Message.deleted_at.is_(None),
                    or_(Message.body.ilike(pattern), Message.transcript.ilike(pattern)),
                )
                .order_by(Message.created_at.desc())
                .limit(limit)
            )
        ).all()
    )
    return [_message_dict(m) for m in rows]


async def react(db: AsyncSession, msg: Message, user_id: str, emoji: str):
    reaction = await reaction_service.upsert_reaction(
        db,
        target_type=ReactionTargetType.message,
        target_id=msg.id,
        user_id=user_id,
        emoji=emoji,
    )
    await chat_service.broadcast_to_chat(
        db,
        msg.chat_id,
        "message.reaction",
        {"messageId": msg.id, "userId": user_id, "emoji": emoji, "chatId": msg.chat_id},
    )
    return reaction


async def unreact(db: AsyncSession, msg: Message, user_id: str) -> None:
    await reaction_service.remove_reaction(
        db, target_type=ReactionTargetType.message, target_id=msg.id, user_id=user_id
    )
