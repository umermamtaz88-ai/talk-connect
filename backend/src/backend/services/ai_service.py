from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.models.ai import AIConversation, AIMessage
from backend.services import llm_service


async def get_or_create_conversation(
    db: AsyncSession,
    user_id: str,
    conversation_id: str | None,
) -> AIConversation:
    if conversation_id:
        conv = await db.scalar(
            select(AIConversation)
            .where(AIConversation.id == conversation_id, AIConversation.user_id == user_id)
            .options(selectinload(AIConversation.messages))
        )
        if conv:
            return conv
    conv = AIConversation(user_id=user_id, title=None)
    db.add(conv)
    await db.flush()
    # Reload with messages relationship
    conv = await db.scalar(
        select(AIConversation)
        .where(AIConversation.id == conv.id)
        .options(selectinload(AIConversation.messages))
    )
    assert conv is not None
    return conv


async def list_history(conv: AIConversation, *, limit: int = 40) -> list[dict[str, str]]:
    msgs = list(conv.messages or [])[-limit:]
    return [{"role": m.role, "content": m.content} for m in msgs if m.role in {"user", "assistant"}]


async def append_user_message(db: AsyncSession, conv: AIConversation, content: str) -> AIMessage:
    msg = AIMessage(conversation_id=conv.id, role="user", content=content)
    db.add(msg)
    if not conv.title:
        conv.title = content.strip()[:80] or "Chat"
    conv.updated_at = datetime.now(UTC)
    await db.flush()
    return msg


async def append_assistant_message(db: AsyncSession, conv: AIConversation, content: str) -> AIMessage:
    msg = AIMessage(conversation_id=conv.id, role="assistant", content=content)
    db.add(msg)
    conv.updated_at = datetime.now(UTC)
    await db.flush()
    return msg


async def stream_reply(
    db: AsyncSession,
    *,
    user_id: str,
    message: str,
    conversation_id: str | None,
) -> tuple[AIConversation, AsyncIterator[str]]:
    """Persist the user turn, then return an async iterator of assistant token chunks.

    The caller must drain the iterator and then call `finalize_assistant` to store the reply.
    """
    conv = await get_or_create_conversation(db, user_id, conversation_id)
    history = await list_history(conv)
    await append_user_message(db, conv, message)
    await db.commit()

    async def _gen() -> AsyncIterator[str]:
        async for chunk in llm_service.stream_chat(user_message=message, history=history):
            yield chunk

    return conv, _gen()


async def finalize_assistant(db: AsyncSession, conversation_id: str, content: str) -> AIMessage:
    conv = await db.get(AIConversation, conversation_id)
    if not conv:
        raise LookupError("Conversation not found")
    return await append_assistant_message(db, conv, content)
