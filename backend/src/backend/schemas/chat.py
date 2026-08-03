from datetime import datetime

from pydantic import BaseModel, Field


class DirectChatCreate(BaseModel):
    user_id: str = Field(alias="userId")

    model_config = {"populate_by_name": True}


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    member_user_ids: list[str] = Field(default_factory=list, alias="memberUserIds")
    description: str | None = Field(default=None, max_length=500)
    is_community: bool = Field(default=False, alias="isCommunity")

    model_config = {"populate_by_name": True}


class ChatUpdate(BaseModel):
    name: str | None = None
    avatar_url: str | None = Field(default=None, alias="avatarUrl")
    theme: str | None = None
    wallpaper: str | None = None
    disappear_after_seconds: int | None = Field(default=None, alias="disappearAfterSeconds")
    expires_in_hours: int | None = Field(default=None, alias="expiresInHours")
    e2e_enabled: bool | None = Field(default=None, alias="e2eEnabled")
    auto_translate_language: str | None = Field(default=None, alias="autoTranslateLanguage")

    model_config = {"populate_by_name": True}


class AddMembersRequest(BaseModel):
    user_ids: list[str] = Field(alias="userIds")

    model_config = {"populate_by_name": True}


class PeerOut(BaseModel):
    id: str
    username: str
    display_name: str
    avatar_url: str | None = None
    avatar_icon_id: str | None = None
    avatar_type: str | None = None
    presence_state: str | None = None
    status_text: str | None = None
    focus_until: datetime | None = None
    focus_message: str | None = None


class ChatOut(BaseModel):
    id: str
    is_group: bool
    is_community: bool = False
    is_notes_to_self: bool
    name: str | None = None
    description: str | None = None
    avatar_url: str | None = None
    theme: str | None = None
    wallpaper: str | None = None
    disappear_after_seconds: int | None = None
    expires_at: datetime | None = None
    e2e_enabled: bool = False
    role: str | None = None
    pinned: bool = False
    archived: bool = False
    muted: bool = False
    auto_translate_language: str | None = None
    created_at: datetime
    unread_count: int = 0
    peer: PeerOut | None = None
    last_message: dict | None = None
    created_by: str | None = None


class AttachmentIn(BaseModel):
    storage_key: str = Field(alias="storageKey")
    mime_type: str = Field(default="application/octet-stream", alias="mimeType")
    size_bytes: int = Field(default=0, alias="sizeBytes")
    filename: str | None = None

    model_config = {"populate_by_name": True}


class MessageCreate(BaseModel):
    body: str | None = None
    type: str = "text"
    reply_to_id: str | None = Field(default=None, alias="replyToId")
    code_language: str | None = Field(default=None, alias="codeLanguage")
    transcript: str | None = None
    view_once: bool = Field(default=False, alias="viewOnce")
    context: str | None = None
    attachments: list[AttachmentIn] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class MessageEdit(BaseModel):
    body: str = Field(min_length=1)


class MessageReact(BaseModel):
    emoji: str = Field(min_length=1, max_length=32)


class ForwardRequest(BaseModel):
    target_chat_id: str = Field(alias="targetChatId")

    model_config = {"populate_by_name": True}


class CallCreate(BaseModel):
    chat_id: str = Field(alias="chatId")
    call_type: str = Field(default="video", alias="callType")

    model_config = {"populate_by_name": True}


class VaultCreate(BaseModel):
    filename: str
    size_bytes: int = Field(alias="sizeBytes")
    mime_type: str = Field(default="application/octet-stream", alias="mimeType")
    checksum_sha256: str | None = Field(default=None, alias="checksumSha256")
    receiver_id: str | None = Field(default=None, alias="receiverId")
    chat_id: str | None = Field(default=None, alias="chatId")
    download_limit: int | None = Field(default=None, alias="downloadLimit")
    expires_hours: int = Field(default=72, alias="expiresHours")

    model_config = {"populate_by_name": True}


class FocusUpdate(BaseModel):
    until: datetime | None = None
    message: str | None = Field(default=None, max_length=200)
    share_with: list[str] = Field(default_factory=list, alias="shareWith")

    model_config = {"populate_by_name": True}
