from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import get_settings
from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.user import User
from backend.schemas.auth import MessageResponse
from backend.schemas.friend import (
    ContactMatch,
    ContactSyncRequest,
    FriendOut,
    FriendRequestCreate,
    FriendRequestOut,
    ReportCreate,
)
from backend.services import friend_service
from backend.services.realtime import manager

router = APIRouter(tags=["friends"])
settings = get_settings()


@router.post("/friends/requests", response_model=FriendRequestOut)
async def send_friend_request(
    data: FriendRequestCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        req = await friend_service.send_request(db, user.id, data.to_user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Blocked") from None
    return FriendRequestOut.model_validate(await friend_service.serialize_request(db, req))


@router.get("/friends/requests", response_model=list[FriendRequestOut])
async def list_friend_requests(
    direction: str = Query(default="incoming", pattern="^(incoming|outgoing)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await friend_service.list_requests(db, user.id, direction)
    return [
        FriendRequestOut.model_validate(await friend_service.serialize_request(db, r))
        for r in rows
    ]


@router.post("/friends/requests/{request_id}/accept", response_model=FriendRequestOut)
async def accept_request(
    request_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        req = await friend_service.accept_request(db, request_id, user.id)
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found") from None
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Blocked") from None
    return FriendRequestOut.model_validate(await friend_service.serialize_request(db, req))


@router.post("/friends/requests/{request_id}/decline", response_model=FriendRequestOut)
async def decline_request(
    request_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        req = await friend_service.decline_request(db, request_id, user.id)
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found") from None
    return FriendRequestOut.model_validate(await friend_service.serialize_request(db, req))


@router.delete("/friends/requests/{request_id}", response_model=MessageResponse)
async def cancel_request(
    request_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await friend_service.cancel_request(db, request_id, user.id)
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found") from None
    return MessageResponse(message="Request cancelled")


@router.get("/friends", response_model=list[FriendOut])
async def list_friends(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    friends = await friend_service.list_friends(db, user.id)
    out = []
    for f in friends:
        out.append(
            FriendOut(
                id=f.id,
                username=f.username,
                display_name=f.display_name,
                avatar_url=f.avatar_url,
                avatar_icon_id=f.avatar_icon_id,
                online=await manager.is_online(f.id),
                last_seen_at=f.last_seen_at,
                presence_state=await manager.presence_state(f.id),
            )
        )
    return out


@router.get("/friends/blocked", response_model=list[FriendOut])
async def list_blocked(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    blocked = await friend_service.list_blocked(db, user.id)
    return [
        FriendOut(
            id=u.id,
            username=u.username,
            display_name=u.display_name,
            avatar_url=u.avatar_url,
            avatar_icon_id=u.avatar_icon_id,
            online=False,
            last_seen_at=None,
            presence_state=None,
        )
        for u in blocked
    ]


@router.delete("/friends/{user_id}", response_model=MessageResponse)
async def unfriend(
    user_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await friend_service.unfriend(db, user.id, user_id)
    return MessageResponse(message="Unfriended")


@router.post("/friends/{user_id}/block", response_model=MessageResponse)
async def block(
    user_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await friend_service.block_user(db, user.id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return MessageResponse(message="Blocked")


@router.delete("/friends/{user_id}/block", response_model=MessageResponse)
async def unblock(
    user_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await friend_service.unblock_user(db, user.id, user_id)
    return MessageResponse(message="Unblocked")


@router.post("/users/{user_id}/report", response_model=dict)
async def report_user(
    user_id: str,
    data: ReportCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        report = await friend_service.report_user(
            db,
            reporter_id=user.id,
            reported_user_id=user_id,
            reason=data.reason,
            details=data.details,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="User not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    if data.also_block:
        await friend_service.block_user(db, user.id, user_id)

    return {
        "id": report.id,
        "status": report.status.value,
        "flaggedForReview": report.flagged_for_review,
        "blocked": bool(data.also_block),
        "message": "Report submitted",
    }


@router.get("/admin/reports")
async def admin_list_reports(
    status_filter: str | None = Query(default="pending", alias="status"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stub admin surface — allowed for configured admin emails or any user in debug."""
    admins = {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}
    if not settings.debug and user.email.lower() not in admins:
        raise HTTPException(status_code=403, detail="Admin only")
    rows = await friend_service.list_reports(db, status_filter=status_filter)
    return [
        {
            "id": r.id,
            "reporterId": r.reporter_id,
            "reportedUserId": r.reported_user_id,
            "reason": r.reason.value,
            "details": r.details,
            "status": r.status.value,
            "flaggedForReview": r.flagged_for_review,
            "createdAt": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/contacts/sync", response_model=list[ContactMatch])
async def sync_contacts(
    data: ContactSyncRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    matches = await friend_service.sync_contacts(db, user.id, data.phone_hashes)
    return [ContactMatch(**m) for m in matches]
