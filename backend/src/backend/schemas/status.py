from datetime import datetime

from pydantic import BaseModel, Field


class StatusCreate(BaseModel):
    type: str = Field(pattern="^(image|video|text)$")
    storage_key: str | None = None
    caption: str | None = None
    background_style: str | None = None
    privacy: str = "friends"
    audience_ids: list[str] | None = None


class StatusOut(BaseModel):
    id: str
    user_id: str
    type: str
    storage_key: str | None = None
    caption: str | None = None
    background_style: str | None = None
    privacy: str
    audience_ids: list[str] | None = None
    is_highlighted: bool
    created_at: datetime
    expires_at: datetime
    reaction_count: int = 0
    view_count: int = 0
    my_reaction: str | None = None

    model_config = {"from_attributes": True}


class StatusFeedUserOut(BaseModel):
    id: str
    username: str
    display_name: str
    avatar_url: str | None = None
    avatar_icon_id: str | None = None
    avatar_type: str | None = None


class StatusFeedItem(BaseModel):
    user: StatusFeedUserOut
    statuses: list[StatusOut]
    has_unseen: bool


# Back-compat alias
class StatusFeedUser(StatusFeedItem):
    pass


class StatusReactRequest(BaseModel):
    emoji: str = Field(min_length=1, max_length=32)


class StatusReplyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class StatusViewOut(BaseModel):
    viewer_id: str
    viewed_at: datetime
    username: str | None = None
    display_name: str | None = None


class ReactionOut(BaseModel):
    user_id: str
    emoji: str
    created_at: datetime
    username: str | None = None
    display_name: str | None = None
