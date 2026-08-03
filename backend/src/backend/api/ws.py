import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jwt import PyJWTError

from backend.core.database import AsyncSessionLocal
from backend.core.security import decode_token
from backend.services import chat_service
from backend.services.realtime import manager

router = APIRouter(tags=["websocket"])


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str | None = None):
    if not token:
        await websocket.close(code=4401)
        return

    try:
        payload = decode_token(token, expected_type="access")
        user_id = payload["sub"]
    except (PyJWTError, KeyError, ValueError):
        await websocket.close(code=4401)
        return

    connection_id = await manager.connect(user_id, websocket)

    # Fan presence out to friends (not just self)
    try:
        async with AsyncSessionLocal() as db:
            await chat_service.broadcast_presence_to_friends(
                db, user_id, online=True, state="online"
            )
    except Exception:
        pass

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "data": {"message": "Invalid JSON"}})
                continue

            msg_type = message.get("type")
            data = message.get("data") or {}

            if msg_type == "ping":
                await manager.refresh_presence(user_id)
                await websocket.send_json({"type": "pong"})
                continue

            # Typing: deliver to chat members via user: channels
            if msg_type == "typing":
                chat_id = data.get("chatId")
                if chat_id:
                    async with AsyncSessionLocal() as db:
                        await chat_service.broadcast_to_chat(
                            db,
                            chat_id,
                            "typing",
                            {
                                "chatId": chat_id,
                                "userId": user_id,
                                "isTyping": data.get("isTyping", True),
                            },
                        )
                continue

            if msg_type in {"call.offer", "call.answer", "call.ice", "call.hangup"}:
                target_user = data.get("toUserId")
                if target_user:
                    await manager.publish(
                        f"user:{target_user}", msg_type, {**data, "fromUserId": user_id}
                    )
                continue

            await websocket.send_json(
                {"type": "error", "data": {"message": f"Unknown type: {msg_type}"}}
            )
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(connection_id)
        # Notify friends when last connection drops
        if not manager.user_connections.get(user_id):
            try:
                async with AsyncSessionLocal() as db:
                    await chat_service.broadcast_presence_to_friends(
                        db, user_id, online=False, state="offline"
                    )
            except Exception:
                pass
