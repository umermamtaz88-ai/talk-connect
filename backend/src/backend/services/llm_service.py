"""Gemini LLM client — server-side only. Uses native Generative Language API."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from backend.core.config import get_settings

logger = logging.getLogger("talkconnect.ai")

SYSTEM_PROMPT = (
    "You are Talk Connect AI, a helpful assistant inside the TALK CONNECT messaging app. "
    "Be concise, friendly, and useful. Do not claim to be a human."
)


def _api_base(model: str) -> str:
    return f"https://generativelanguage.googleapis.com/v1beta/models/{model}"


def _headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "x-goog-api-key": get_settings().gemini_api_key,
    }


def _contents_from_history(history: list[dict[str, str]], user_message: str) -> list[dict[str, Any]]:
    contents: list[dict[str, Any]] = []
    for row in history:
        role = "user" if row["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": row["content"]}]})
    contents.append({"role": "user", "parts": [{"text": user_message}]})
    return contents


async def stream_chat(
    *,
    user_message: str,
    history: list[dict[str, str]] | None = None,
) -> AsyncIterator[str]:
    """Yield text chunks from Gemini streamGenerateContent."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    model = settings.llm_model
    url = f"{_api_base(model)}:streamGenerateContent?alt=sse"
    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": _contents_from_history(history or [], user_message),
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048},
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
        async with client.stream("POST", url, headers=_headers(), json=payload) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                logger.error("Gemini stream error %s: %s", resp.status_code, body[:500])
                raise RuntimeError(f"LLM error ({resp.status_code})")
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                for cand in event.get("candidates") or []:
                    for part in (cand.get("content") or {}).get("parts") or []:
                        text = part.get("text")
                        if text:
                            yield text


async def translate_text(text: str, target_language: str) -> tuple[str, str | None]:
    """Return (translated_text, detected_source_language_or_None)."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    model = settings.llm_model
    url = f"{_api_base(model)}:generateContent"
    prompt = (
        f"Translate the following message into {target_language}. "
        "Respond with ONLY a JSON object of the form "
        '{"translation":"...","sourceLanguage":"xx"} '
        "where sourceLanguage is an ISO 639-1 code. No markdown.\n\n"
        f"Message:\n{text}"
    )
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048},
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=15.0)) as client:
        resp = await client.post(url, headers=_headers(), json=payload)
        if resp.status_code >= 400:
            logger.error("Gemini translate error %s: %s", resp.status_code, resp.text[:500])
            raise RuntimeError(f"Translation error ({resp.status_code})")
        data = resp.json()

    parts = (
        ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
    )
    raw = "".join(p.get("text") or "" for p in parts).strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        parsed = json.loads(raw)
        translation = str(parsed.get("translation") or "").strip()
        source = parsed.get("sourceLanguage")
        source_lang = str(source).strip() if source else None
        if translation:
            return translation, source_lang
    except json.JSONDecodeError:
        pass
    return raw, None
