from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import uuid4

from fastapi import WebSocket

from backend.core.config import get_settings
from backend.core.redis_client import redis_manager

settings = get_settings()

ConnectionHandler = Callable[[str, dict[str, Any]], Awaitable[None]]


class ConnectionManager:
    def __init__(self) -> None:
        # connection_id -> (user_id, websocket)
        self.active: dict[str, tuple[str, WebSocket]] = {}
        # user_id -> set of connection_ids
        self.user_connections: dict[str, set[str]] = {}

    async def connect(self, user_id: str, websocket: WebSocket) -> str:
        await websocket.accept()
        connection_id = str(uuid4())
        self.active[connection_id] = (user_id, websocket)
        self.user_connections.setdefault(user_id, set()).add(connection_id)

        r = redis_manager.r
        socket_key = f"{settings.instance_id}:{connection_id}"
        await r.sadd(f"sockets:{user_id}", socket_key)
        await r.setex(f"presence:{user_id}", 60, "online")
        return connection_id

    async def disconnect(self, connection_id: str) -> None:
        entry = self.active.pop(connection_id, None)
        if not entry:
            return
        user_id, _ = entry
        conns = self.user_connections.get(user_id, set())
        conns.discard(connection_id)
        if not conns:
            self.user_connections.pop(user_id, None)

        r = redis_manager.r
        socket_key = f"{settings.instance_id}:{connection_id}"
        await r.srem(f"sockets:{user_id}", socket_key)
        remaining = await r.scard(f"sockets:{user_id}")
        if remaining == 0:
            # Grace period: keep presence briefly; TTL will expire
            await r.setex(f"presence:{user_id}", 15, "offline")

    async def refresh_presence(self, user_id: str, state: str | None = None) -> None:
        current = state or await redis_manager.r.get(f"presence:{user_id}") or "online"
        if current in {"offline", None}:
            current = "online"
        await redis_manager.r.setex(f"presence:{user_id}", 60, current)

    async def set_presence(self, user_id: str, state: str) -> None:
        """Adaptive presence: online | offline | on_call | screen_sharing.

        Callers that need friend fan-out should use chat_service.broadcast_presence_to_friends.
        """
        await redis_manager.r.setex(f"presence:{user_id}", 60, state)
        await self.publish(
            f"user:{user_id}",
            "presence",
            {"userId": user_id, "online": state != "offline", "state": state},
        )

    async def send_to_connection(self, connection_id: str, event: dict[str, Any]) -> None:
        entry = self.active.get(connection_id)
        if not entry:
            return
        _, ws = entry
        await ws.send_json(event)

    async def send_to_user(self, user_id: str, event: dict[str, Any]) -> None:
        for connection_id in list(self.user_connections.get(user_id, set())):
            await self.send_to_connection(connection_id, event)

    async def publish(self, channel: str, event_type: str, data: dict[str, Any]) -> None:
        payload = json.dumps({"type": event_type, "data": data, "channel": channel})
        await redis_manager.r.publish(channel, payload)
        # Always deliver locally for memory/redis fallback consistency
        await self._deliver_local(channel, {"type": event_type, "data": data})

    async def _deliver_local(self, channel: str, event: dict[str, Any]) -> None:
        if channel.startswith("user:"):
            user_id = channel.split(":", 1)[1]
            await self.send_to_user(user_id, event)
        elif channel.startswith("friends:"):
            # friends:{user_id} — fans out to that user's friend sockets via caller publishing per friend
            user_id = channel.split(":", 1)[1]
            await self.send_to_user(user_id, event)

    async def is_online(self, user_id: str) -> bool:
        value = await redis_manager.r.get(f"presence:{user_id}")
        return value not in {None, "offline"}

    async def presence_state(self, user_id: str) -> str:
        return (await redis_manager.r.get(f"presence:{user_id}")) or "offline"


manager = ConnectionManager()
