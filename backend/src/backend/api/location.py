from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_chat_or_404, get_current_user, require_chat_member
from backend.models.chat import Chat, ChatMember
from backend.models.user import User
from backend.services import location_service, message_service

router = APIRouter(tags=["location"])


class StaticLocationIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float | None = Field(default=None, alias="accuracyMeters")

    model_config = {"populate_by_name": True}


class LiveLocationIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    duration_minutes: int = Field(alias="durationMinutes")
    accuracy_meters: float | None = Field(default=None, alias="accuracyMeters")

    model_config = {"populate_by_name": True}


class LocationUpdateIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float | None = Field(default=None, alias="accuracyMeters")
    accuracy: float | None = None  # alias used by second brief

    model_config = {"populate_by_name": True}


def _message_with_share(msg, share) -> dict:
    data = message_service._message_dict(msg)
    data["location_share"] = location_service.share_to_dict(share)
    return data


@router.post("/chats/{chat_id}/messages/location")
async def send_static_location(
    data: StaticLocationIn,
    chat: Chat = Depends(get_chat_or_404),
    user: User = Depends(get_current_user),
    _: ChatMember = Depends(require_chat_member),
    db: AsyncSession = Depends(get_db),
):
    try:
        msg, share = await location_service.create_static(
            db,
            chat=chat,
            sender=user,
            latitude=data.latitude,
            longitude=data.longitude,
            accuracy_meters=data.accuracy_meters,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    return _message_with_share(msg, share)


@router.post("/chats/{chat_id}/messages/location/live")
@router.post("/chats/{chat_id}/location/start")
async def start_live_location(
    data: LiveLocationIn,
    chat: Chat = Depends(get_chat_or_404),
    user: User = Depends(get_current_user),
    _: ChatMember = Depends(require_chat_member),
    db: AsyncSession = Depends(get_db),
):
    try:
        msg, share = await location_service.create_live(
            db,
            chat=chat,
            sender=user,
            latitude=data.latitude,
            longitude=data.longitude,
            duration_minutes=data.duration_minutes,
            accuracy_meters=data.accuracy_meters,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    return _message_with_share(msg, share)


@router.patch("/location-shares/{share_id}")
@router.patch("/location/{share_id}")
async def update_live_location(
    share_id: str,
    data: LocationUpdateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    share = await location_service.get_share(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Location share not found")
    from backend.services import chat_service

    try:
        await chat_service.require_member(db, share.chat_id, user.id)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not a member of this chat") from None

    accuracy = data.accuracy_meters if data.accuracy_meters is not None else data.accuracy
    try:
        share = await location_service.update_position(
            db,
            share=share,
            sender=user,
            latitude=data.latitude,
            longitude=data.longitude,
            accuracy_meters=accuracy,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    return location_service.share_to_dict(share)


@router.post("/location-shares/{share_id}/stop")
@router.post("/location/{share_id}/stop")
async def stop_live_location(
    share_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    share = await location_service.get_share(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Location share not found")
    try:
        share = await location_service.stop_share(
            db, share=share, actor=user, reason="stopped_by_sender"
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    return location_service.share_to_dict(share)


@router.get("/location-shares/{share_id}")
@router.get("/location/{share_id}")
async def get_location_share(
    share_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    share = await location_service.get_share(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Location share not found")
    from backend.services import chat_service

    try:
        await chat_service.require_member(db, share.chat_id, user.id)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not a member of this chat") from None
    return location_service.share_to_dict(share)
