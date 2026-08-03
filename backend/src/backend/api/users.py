from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.user import User
from backend.schemas.auth import UserOut
from backend.schemas.user import (
    AvatarIconRequest,
    AvatarUploadRequest,
    CoverPhotoRequest,
    PublicProfile,
    UserUpdate,
)
from backend.schemas.chat import FocusUpdate
from backend.services import auth_service, user_service
from backend.models.user import AvatarType
from backend.models.vault import AvatarIcon


router = APIRouter(prefix="/users", tags=["users"])


@router.get("/search", response_model=list[PublicProfile])
async def search(
    q: str = Query(min_length=1),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    users = await user_service.search_users(db, user, q)
    results = []
    for u in users:
        profile = await user_service.get_public_profile(db, user, u.id)
        results.append(PublicProfile(**profile))
    return results


@router.patch("/me", response_model=UserOut)
async def update_me(
    data: UserUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    updated = await user_service.update_me(db, user, data)
    return auth_service.to_user_out(updated)


@router.post("/me/avatar", response_model=UserOut)
async def set_avatar(
    data: AvatarUploadRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if data.avatar_url is not None:
        user.avatar_url = data.avatar_url
        user.avatar_type = AvatarType.photo
    if data.avatar_video_url is not None:
        user.avatar_video_url = data.avatar_video_url
    await db.flush()
    return auth_service.to_user_out(user)


@router.post("/me/avatar/icon", response_model=UserOut)
async def set_avatar_icon(
    data: AvatarIconRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    icon = await db.get(AvatarIcon, data.avatar_icon_id)
    if not icon:
        raise HTTPException(status_code=404, detail="Icon not found")
    user.avatar_icon_id = icon.id
    user.avatar_type = AvatarType.icon
    user.avatar_url = icon.preview_url
    await db.flush()
    return auth_service.to_user_out(user)


@router.get("/avatar-icons")
async def list_avatar_icons(db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select

    rows = list((await db.scalars(select(AvatarIcon))).all())
    return [
        {"id": i.id, "style": i.style, "label": i.label, "previewUrl": i.preview_url, "config": i.config}
        for i in rows
    ]


@router.post("/me/focus")
async def set_focus(
    data: FocusUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await user_service.set_focus(db, user, data.until, data.message, data.share_with)
    return {"message": "Focus updated", "until": data.until, "shareWith": data.share_with}


@router.delete("/me/focus", response_model=dict)
async def clear_focus(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await user_service.set_focus(db, user, None, None, [])
    return {"message": "Focus cleared"}



@router.post("/me/cover-photo", response_model=UserOut)
async def set_cover(
    data: CoverPhotoRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user.cover_photo_url = data.cover_photo_url
    await db.flush()
    return auth_service.to_user_out(user)


@router.post("/me/export")
async def export_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await user_service.export_account(db, user)


@router.delete("/me", response_model=dict)
async def delete_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await user_service.delete_account(db, user)
    return {"message": "Account deleted"}


@router.get("/{user_id}", response_model=PublicProfile)
async def get_user(
    user_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        profile = await user_service.get_public_profile(db, user, user_id)
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found") from None
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Blocked") from None
    return PublicProfile(**profile)
