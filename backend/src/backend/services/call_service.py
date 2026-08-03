from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import get_settings
from backend.models.call import Call, CallParticipant, CallStatus, CallType
from backend.models.user import User, utcnow
from backend.services import chat_service
from backend.services.realtime import manager

settings = get_settings()


def _livekit_token(room: str, user: User) -> str:
    if settings.livekit_api_key and settings.livekit_api_secret:
        try:
            from livekit import api

            token = api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
            token.with_identity(user.id).with_name(user.display_name).with_grants(
                api.VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True)
            ).with_ttl(timedelta(hours=2))
            return token.to_jwt()
        except Exception:
            pass
    # Dev stub — client should treat as non-LiveKit local mode
    return f"dev-livekit-token:{room}:{user.id}"


async def start_call(
    db: AsyncSession,
    *,
    chat_id: str,
    starter: User,
    call_type: str = "video",
) -> Call:
    from backend.models.chat import Chat
    from backend.services import friend_service

    await chat_service.require_member(db, chat_id, starter.id)
    chat = await db.get(Chat, chat_id)
    if chat and not chat.is_group and not chat.is_notes_to_self:
        peer_ids = await chat_service.member_ids(db, chat_id)
        other_id = next((uid for uid in peer_ids if uid != starter.id), None)
        if other_id and await friend_service.is_blocked(db, starter.id, other_id):
            raise PermissionError("You can't call this user")

    call = Call(
        chat_id=chat_id,
        started_by=starter.id,
        call_type=CallType(call_type),
        status=CallStatus.ringing,
        livekit_room=None,
    )
    db.add(call)
    await db.flush()
    call.livekit_room = f"call-{call.id}"
    db.add(CallParticipant(call_id=call.id, user_id=starter.id, joined_at=utcnow()))
    await db.flush()

    await manager.set_presence(starter.id, "on_call")
    await chat_service.broadcast_to_chat(
        db,
        chat_id,
        "call.incoming",
        {
            "callId": call.id,
            "fromUserId": starter.id,
            "callType": call.call_type.value,
            "chatId": chat_id,
        },
    )
    return call


async def join_call(db: AsyncSession, call: Call, user: User) -> dict:
    await chat_service.require_member(db, call.chat_id, user.id)
    part = await db.get(CallParticipant, {"call_id": call.id, "user_id": user.id})
    if not part:
        part = await db.scalar(
            select(CallParticipant).where(CallParticipant.call_id == call.id, CallParticipant.user_id == user.id)
        )
    if not part:
        part = CallParticipant(call_id=call.id, user_id=user.id, joined_at=utcnow())
        db.add(part)
    else:
        part.joined_at = utcnow()
        part.left_at = None
    call.status = CallStatus.active
    await db.flush()
    await manager.set_presence(user.id, "on_call")
    room = call.livekit_room or f"call-{call.id}"
    return {
        "livekitUrl": settings.livekit_url or "wss://dev.livekit.local",
        "token": _livekit_token(room, user),
        "room": room,
        "callId": call.id,
    }


async def leave_call(db: AsyncSession, call: Call, user: User) -> Call:
    part = await db.scalar(
        select(CallParticipant).where(CallParticipant.call_id == call.id, CallParticipant.user_id == user.id)
    )
    if part:
        part.left_at = utcnow()
        part.screen_sharing = False
    await manager.set_presence(user.id, "online")

    active = list(
        (
            await db.scalars(
                select(CallParticipant).where(
                    CallParticipant.call_id == call.id,
                    CallParticipant.joined_at.is_not(None),
                    CallParticipant.left_at.is_(None),
                )
            )
        ).all()
    )
    if not active:
        call.status = CallStatus.ended
        call.ended_at = utcnow()
        if call.started_at:
            start = call.started_at if call.started_at.tzinfo else call.started_at.replace(tzinfo=UTC)
            call.duration_seconds = int((datetime.now(UTC) - start).total_seconds())
        await chat_service.broadcast_to_chat(
            db, call.chat_id, "call.ended", {"callId": call.id, "reason": "hangup"}
        )
    await db.flush()
    return call


async def set_screen_share(db: AsyncSession, call: Call, user: User, sharing: bool) -> None:
    part = await db.scalar(
        select(CallParticipant).where(CallParticipant.call_id == call.id, CallParticipant.user_id == user.id)
    )
    if part:
        part.screen_sharing = sharing
        await db.flush()
        await manager.set_presence(user.id, "screen_sharing" if sharing else "on_call")


async def history(db: AsyncSession, chat_id: str, limit: int = 30) -> list[Call]:
    return list(
        (
            await db.scalars(
                select(Call).where(Call.chat_id == chat_id).order_by(Call.started_at.desc()).limit(limit)
            )
        ).all()
    )
