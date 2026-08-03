from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class FriendRequestCreate(BaseModel):
    to_user_id: str = Field(alias="toUserId")

    model_config = {"populate_by_name": True}


class FriendUserBrief(BaseModel):
    id: str
    username: str
    display_name: str
    avatar_url: str | None = None
    avatar_icon_id: str | None = None


class FriendRequestOut(BaseModel):
    id: str
    from_user_id: str
    to_user_id: str
    status: str
    created_at: datetime
    responded_at: datetime | None = None
    from_user: FriendUserBrief | None = None
    to_user: FriendUserBrief | None = None

    model_config = {"from_attributes": True}

    @field_validator("status", mode="before")
    @classmethod
    def status_to_str(cls, v):
        return v.value if hasattr(v, "value") else v


class FriendOut(BaseModel):
    id: str
    username: str
    display_name: str
    avatar_url: str | None = None
    avatar_icon_id: str | None = None
    online: bool = False
    last_seen_at: datetime | None = None
    presence_state: str | None = None


class ContactSyncRequest(BaseModel):
    phone_hashes: list[str]


class ContactMatch(BaseModel):
    phone_hash: str
    user_id: str | None = None
    username: str | None = None
    display_name: str | None = None


class ReportCreate(BaseModel):
    reason: str = Field(
        pattern="^(spam|harassment|inappropriate_content|impersonation|other)$"
    )
    details: str | None = Field(default=None, max_length=2000)
    also_block: bool = Field(default=True, alias="alsoBlock")

    model_config = {"populate_by_name": True}
