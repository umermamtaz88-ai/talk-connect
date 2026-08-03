from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import get_settings
from backend.core.database import AsyncSessionLocal, get_db
from backend.core.deps import get_current_user
from backend.core.redis_client import rate_limit
from backend.models.user import User
from backend.services import ai_service

router = APIRouter(prefix="/ai", tags=["ai"])
settings = get_settings()


class AIChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    conversation_id: str | None = Field(default=None, alias="conversationId")

    model_config = {"populate_by_name": True}


@router.post("/chat")
async def ai_chat(
    data: AIChatRequest,
    user: User = Depends(get_current_user),
):
    """Stream an AI reply as Server-Sent Events. API key never leaves the server."""
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI assistant is not configured",
        )

    allowed = await rate_limit(
        f"ai:chat:{user.id}",
        limit=settings.ai_rate_limit_per_minute,
        window_seconds=60,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="AI rate limit exceeded — try again in a minute",
        )

    async with AsyncSessionLocal() as db:
        try:
            conv, chunks = await ai_service.stream_reply(
                db,
                user_id=user.id,
                message=data.message.strip(),
                conversation_id=data.conversation_id,
            )
            conversation_id = conv.id
        except Exception as exc:
            await db.rollback()
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    async def event_stream():
        yield f"data: {json.dumps({'type': 'meta', 'conversationId': conversation_id})}\n\n"
        full: list[str] = []
        try:
            async for piece in chunks:
                full.append(piece)
                yield f"data: {json.dumps({'type': 'token', 'text': piece})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
            return

        text = "".join(full)
        async with AsyncSessionLocal() as save_db:
            try:
                await ai_service.finalize_assistant(save_db, conversation_id, text)
                await save_db.commit()
            except Exception:
                await save_db.rollback()
        yield f"data: {json.dumps({'type': 'done', 'conversationId': conversation_id})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/conversations")
async def list_conversations(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select

    from backend.models.ai import AIConversation

    rows = list(
        (
            await db.scalars(
                select(AIConversation)
                .where(AIConversation.user_id == user.id)
                .order_by(AIConversation.updated_at.desc())
                .limit(20)
            )
        ).all()
    )
    return [
        {
            "id": c.id,
            "title": c.title,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        }
        for c in rows
    ]
