"""OTP / transactional email delivery.

Prefers Resend when RESEND_API_KEY is set; otherwise SMTP; otherwise logs the code
(and returns it in debug API responses so local testing still works).
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

import httpx

from backend.core.config import get_settings

logger = logging.getLogger("talkconnect.email")


def _otp_html(app_name: str, name: str, code: str, ttl_minutes: int) -> str:
    return f"""<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;background:#0b0f19;color:#e8eaed;padding:32px;">
  <div style="max-width:420px;margin:0 auto;background:#141a28;border-radius:16px;padding:28px;">
    <p style="margin:0 0 8px;font-size:14px;opacity:.7;">Hi {name},</p>
    <p style="margin:0 0 20px;font-size:15px;">Your {app_name} verification code:</p>
    <p style="margin:0 0 20px;font-size:36px;letter-spacing:.35em;font-weight:700;text-align:center;">{code}</p>
    <p style="margin:0;font-size:13px;opacity:.65;">Expires in {ttl_minutes} minutes. If you didn't request this, ignore this email.</p>
  </div>
</body></html>"""


async def send_otp_email(
    to: str,
    code: str,
    *,
    display_name: str | None = None,
    ttl_minutes: int | None = None,
) -> bool:
    """Send a 6-digit OTP. Returns True if a provider accepted the message."""
    settings = get_settings()
    ttl = ttl_minutes or settings.otp_ttl_minutes
    name = display_name or to.split("@")[0]
    subject = f"{code} is your {settings.app_name} verification code"
    text_body = (
        f"Hi {name},\n\n"
        f"Your {settings.app_name} verification code is:\n\n"
        f"    {code}\n\n"
        f"This code expires in {ttl} minutes. If you didn't request it, ignore this email.\n"
    )
    html = _otp_html(settings.app_name, name, code, ttl)

    if settings.resend_api_key:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {settings.resend_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "from": settings.resend_from or "Talk Connect <onboarding@resend.dev>",
                        "to": [to],
                        "subject": subject,
                        "html": html,
                        "text": text_body,
                    },
                )
            if resp.status_code < 300:
                logger.info("OTP emailed via Resend to %s", to)
                return True
            logger.error("Resend failed %s: %s", resp.status_code, resp.text[:300])
        except Exception:
            logger.exception("Resend OTP failed for %s", to)

    if settings.smtp_host and settings.smtp_from:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = settings.smtp_from
            msg["To"] = to
            msg.set_content(text_body)
            msg.add_alternative(html, subtype="html")
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
                if settings.smtp_use_tls:
                    smtp.starttls()
                if settings.smtp_user:
                    smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(msg)
            logger.info("OTP emailed via SMTP to %s", to)
            return True
        except Exception:
            logger.exception("Failed to SMTP OTP to %s — falling back to log", to)

    logger.warning("════════════════════════════════════════")
    logger.warning("  OTP for %s → %s", to, code)
    logger.warning("════════════════════════════════════════")
    return False


# Backward-compatible sync wrapper used by older call sites
def send_verification_otp(email: str, code: str, *, display_name: str | None = None) -> bool:
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(send_otp_email(email, code, display_name=display_name))

    # Already in async context — schedule and assume logged/dev path
    loop.create_task(send_otp_email(email, code, display_name=display_name))
    return False
