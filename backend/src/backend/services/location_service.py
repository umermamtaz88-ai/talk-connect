from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.chat import Chat
from backend.models.location import LocationMode, LocationShare, LocationStatus
from backend.models.message import Message
from backend.models.user import User, utcnow
from backend.services import chat_service, message_service
from backend.services.realtime import manager

ALLOWED_LIVE_MINUTES = {15, 60, 480}


def _share_dict(share: LocationShare) -> dict:
    return {
        "id": share.id,
        "message_id": share.message_id,
        "chat_id": share.chat_id,
        "sender_id": share.sender_id,
        "mode": share.mode.value if hasattr(share.mode, "value") else share.mode,
        "status": share.status.value if hasattr(share.status, "value") else share.status,
        "latitude": share.latitude,
        "longitude": share.longitude,
        "accuracy_meters": share.accuracy_meters,
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
        "stopped_early": share.stopped_early,
        "started_at": share.started_at.isoformat() if share.started_at else None,
        "last_updated_at": share.last_updated_at.isoformat() if share.last_updated_at else None,
    }


async def create_static(
    db: AsyncSession,
    *,
    chat: Chat,
    sender: User,
    latitude: float,
    longitude: float,
    accuracy_meters: float | None = None,
) -> tuple[Message, LocationShare]:
    msg = await message_service.send_message(
        db,
        chat=chat,
        sender=sender,
        body="Shared a location",
        msg_type="location",
    )
    share = LocationShare(
        message_id=msg.id,
        chat_id=chat.id,
        sender_id=sender.id,
        mode=LocationMode.static,
        status=LocationStatus.active,
        latitude=latitude,
        longitude=longitude,
        accuracy_meters=accuracy_meters,
        expires_at=None,
    )
    db.add(share)
    await db.flush()
    # Re-broadcast so clients get location_share attached to the message
    payload = message_service._message_dict(msg)
    payload["location_share"] = _share_dict(share)
    await chat_service.broadcast_to_chat(db, chat.id, "message.new", payload)
    return msg, share


async def create_live(
    db: AsyncSession,
    *,
    chat: Chat,
    sender: User,
    latitude: float,
    longitude: float,
    duration_minutes: int,
    accuracy_meters: float | None = None,
) -> tuple[Message, LocationShare]:
    if duration_minutes not in ALLOWED_LIVE_MINUTES:
        raise ValueError("durationMinutes must be 15, 60, or 480")

    msg = await message_service.send_message(
        db,
        chat=chat,
        sender=sender,
        body="Started live location",
        msg_type="location",
    )
    expires = datetime.now(UTC) + timedelta(minutes=duration_minutes)
    share = LocationShare(
        message_id=msg.id,
        chat_id=chat.id,
        sender_id=sender.id,
        mode=LocationMode.live,
        status=LocationStatus.active,
        latitude=latitude,
        longitude=longitude,
        accuracy_meters=accuracy_meters,
        expires_at=expires,
    )
    db.add(share)
    await db.flush()
    payload = message_service._message_dict(msg)
    payload["location_share"] = _share_dict(share)
    await chat_service.broadcast_to_chat(db, chat.id, "message.new", payload)
    return msg, share


async def get_share(db: AsyncSession, share_id: str) -> LocationShare | None:
    return await db.get(LocationShare, share_id)


async def get_share_for_message(db: AsyncSession, message_id: str) -> LocationShare | None:
    return await db.scalar(select(LocationShare).where(LocationShare.message_id == message_id))


def _is_expired(share: LocationShare) -> bool:
    if share.status != LocationStatus.active:
        return True
    if share.mode == LocationMode.static:
        return False
    if not share.expires_at:
        return False
    exp = share.expires_at if share.expires_at.tzinfo else share.expires_at.replace(tzinfo=UTC)
    return exp <= datetime.now(UTC)


async def update_position(
    db: AsyncSession,
    *,
    share: LocationShare,
    sender: User,
    latitude: float,
    longitude: float,
    accuracy_meters: float | None = None,
) -> LocationShare:
    if share.sender_id != sender.id:
        raise PermissionError("Only the sender can update this share")
    if share.mode != LocationMode.live:
        raise PermissionError("Only live shares can be updated")
    if _is_expired(share):
        share.status = LocationStatus.expired
        await db.flush()
        raise PermissionError("This live share has ended")

    share.latitude = latitude
    share.longitude = longitude
    if accuracy_meters is not None:
        share.accuracy_meters = accuracy_meters
    share.last_updated_at = utcnow()
    await db.flush()

    await chat_service.broadcast_to_chat(
        db,
        share.chat_id,
        "location.update",
        {
            "locationShareId": share.id,
            "shareId": share.id,
            "messageId": share.message_id,
            "chatId": share.chat_id,
            "latitude": share.latitude,
            "longitude": share.longitude,
            "accuracyMeters": share.accuracy_meters,
            "expiresAt": share.expires_at.isoformat() if share.expires_at else None,
        },
    )
    return share


async def stop_share(
    db: AsyncSession,
    *,
    share: LocationShare,
    actor: User,
    reason: str = "stopped_by_sender",
) -> LocationShare:
    if share.sender_id != actor.id:
        raise PermissionError("Only the sender can stop this share")
    if share.status != LocationStatus.active:
        return share

    share.status = LocationStatus.stopped
    share.stopped_early = True
    share.expires_at = datetime.now(UTC)
    share.last_updated_at = utcnow()
    await db.flush()

    await chat_service.broadcast_to_chat(
        db,
        share.chat_id,
        "location.stopped",
        {
            "locationShareId": share.id,
            "shareId": share.id,
            "messageId": share.message_id,
            "chatId": share.chat_id,
            "reason": reason if reason in {"expired", "stopped_by_sender", "manual"} else "stopped_by_sender",
        },
    )
    return share


async def expire_old_shares(db: AsyncSession) -> int:
    now = datetime.now(UTC)
    rows = list(
        (
            await db.scalars(
                select(LocationShare).where(
                    LocationShare.mode == LocationMode.live,
                    LocationShare.status == LocationStatus.active,
                    LocationShare.expires_at.is_not(None),
                    LocationShare.expires_at <= now,
                )
            )
        ).all()
    )
    for share in rows:
        share.status = LocationStatus.expired
        share.last_updated_at = utcnow()
        await chat_service.broadcast_to_chat(
            db,
            share.chat_id,
            "location.stopped",
            {
                "locationShareId": share.id,
                "shareId": share.id,
                "messageId": share.message_id,
                "chatId": share.chat_id,
                "reason": "expired",
            },
        )
    if rows:
        await db.flush()
    return len(rows)


def share_to_dict(share: LocationShare) -> dict:
    return _share_dict(share)
