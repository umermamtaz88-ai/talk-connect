from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user, require_status_visible
from backend.models.reaction import ReactionTargetType
from backend.models.status import StatusPost
from backend.models.user import User
from backend.schemas.auth import MessageResponse
from backend.schemas.status import (
    ReactionOut,
    StatusCreate,
    StatusFeedItem,
    StatusOut,
    StatusReactRequest,
    StatusReplyRequest,
    StatusViewOut,
)
from backend.services import reaction_service, status_service

router = APIRouter(prefix="/status", tags=["status"])


@router.post("", response_model=StatusOut)
async def create_status(
    data: StatusCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        post = await status_service.create_status(db, user, data)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    return await status_service.enrich_status(db, post, user.id)


@router.get("/feed", response_model=list[StatusFeedItem])
async def status_feed(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await status_service.feed(db, user)


@router.get("/{status_id}", response_model=StatusOut)
async def get_status(
    post: StatusPost = Depends(require_status_visible),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await status_service.enrich_status(db, post, user.id)


@router.delete("/{status_id}", response_model=MessageResponse)
async def delete_status(
    status_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    post = await db.get(StatusPost, status_id)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Status not found")
    try:
        await status_service.delete_status(db, post, user.id)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your status") from None
    return MessageResponse(message="Status deleted")


@router.post("/{status_id}/view", response_model=MessageResponse)
async def view_status(
    post: StatusPost = Depends(require_status_visible),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await status_service.record_view(db, post, user.id)
    return MessageResponse(message="View recorded")


@router.get("/{status_id}/views", response_model=list[StatusViewOut])
async def status_views(
    status_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    post = await db.get(StatusPost, status_id)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Status not found")
    try:
        views = await status_service.list_views(db, post, user.id)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Poster only") from None
    return [StatusViewOut(**v) for v in views]


@router.post("/{status_id}/react", response_model=ReactionOut)
async def react(
    data: StatusReactRequest,
    post: StatusPost = Depends(require_status_visible),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    reaction = await status_service.react(db, post, user.id, data.emoji)
    return ReactionOut(
        user_id=reaction.user_id,
        emoji=reaction.emoji,
        created_at=reaction.created_at,
        username=user.username,
        display_name=user.display_name,
    )


@router.delete("/{status_id}/react", response_model=MessageResponse)
async def unreact(
    post: StatusPost = Depends(require_status_visible),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await status_service.unreact(db, post, user.id)
    return MessageResponse(message="Reaction removed")


@router.post("/{status_id}/reply", response_model=MessageResponse)
async def reply(
    data: StatusReplyRequest,
    post: StatusPost = Depends(require_status_visible),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await status_service.reply(db, post, user.id, data.message)
    return MessageResponse(message="Reply sent")


@router.get("/{status_id}/reactions", response_model=list[ReactionOut])
async def reactions(
    post: StatusPost = Depends(require_status_visible),
    db: AsyncSession = Depends(get_db),
):
    rows = await reaction_service.list_reactions(
        db, target_type=ReactionTargetType.status, target_id=post.id
    )
    out = []
    for row in rows:
        u = await db.get(User, row.user_id)
        out.append(
            ReactionOut(
                user_id=row.user_id,
                emoji=row.emoji,
                created_at=row.created_at,
                username=u.username if u else None,
                display_name=u.display_name if u else None,
            )
        )
    return out


@router.post("/{status_id}/highlight", response_model=StatusOut)
async def highlight(
    status_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    post = await db.get(StatusPost, status_id)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Status not found")
    try:
        post = await status_service.highlight(db, post, user.id)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your status") from None
    return await status_service.enrich_status(db, post, user.id)
