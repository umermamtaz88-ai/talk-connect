from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.ai import MessageTranslation
from backend.models.message import Message
from backend.services import llm_service


async def translate_message(
    db: AsyncSession,
    *,
    message: Message,
    target_language: str,
) -> MessageTranslation:
    lang = target_language.strip().lower()[:16]
    if not lang:
        raise ValueError("targetLanguage is required")

    cached = await db.scalar(
        select(MessageTranslation).where(
            MessageTranslation.message_id == message.id,
            MessageTranslation.target_language == lang,
        )
    )
    if cached:
        return cached

    text = (message.body or "").strip()
    if not text:
        raise ValueError("Message has no text to translate")

    translated, source = await llm_service.translate_text(text, lang)
    row = MessageTranslation(
        message_id=message.id,
        target_language=lang,
        source_language=source,
        translated_text=translated,
    )
    db.add(row)
    await db.flush()
    return row
