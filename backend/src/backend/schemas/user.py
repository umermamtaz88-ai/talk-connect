from datetime import datetime

from pydantic import BaseModel, Field


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    bio: str | None = None
    status_text: str | None = None
    last_seen_visibility: str | None = None
    read_receipts_enabled: bool | None = None
    typing_indicators_enabled: bool | None = None
    phone_visibility: str | None = None
    findable_by_phone: str | None = None


class PublicProfile(BaseModel):
    id: str
    username: str
    display_name: str
    bio: str | None = None
    status_text: str | None = None
    avatar_url: str | None = None
    avatar_type: str | None = None
    avatar_video_url: str | None = None
    cover_photo_url: str | None = None
    last_seen_at: datetime | None = None
    is_friend: bool = False
    is_online: bool = False
    presence_state: str | None = None
    focus: dict | None = None

    model_config = {"from_attributes": True}


class AvatarUploadRequest(BaseModel):
    avatar_url: str | None = None
    avatar_video_url: str | None = None


class AvatarIconRequest(BaseModel):
    avatar_icon_id: str = Field(alias="avatarIconId")

    model_config = {"populate_by_name": True}


class CoverPhotoRequest(BaseModel):
    cover_photo_url: str
