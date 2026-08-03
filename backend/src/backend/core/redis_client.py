"""Redis client with in-memory fallback for local development."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from collections.abc import AsyncIterator, Callable
from typing import Any

from backend.core.config import get_settings

settings = get_settings()


class MemoryRedis:
    def __init__(self) -> None:
        self._kv: dict[str, tuple[str, float | None]] = {}
        self._sets: dict[str, set[str]] = defaultdict(set)
        self._channels: dict[str, list[asyncio.Queue[str]]] = defaultdict(list)
        self._lock = asyncio.Lock()

    def _expired(self, key: str) -> bool:
        item = self._kv.get(key)
        if not item:
            return True
        _, expires = item
        return expires is not None and expires <= time.time()

    async def get(self, key: str) -> str | None:
        if self._expired(key):
            self._kv.pop(key, None)
            return None
        return self._kv[key][0]

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        expires = time.time() + ex if ex else None
        self._kv[key] = (value, expires)

    async def setex(self, key: str, seconds: int, value: str) -> None:
        await self.set(key, value, ex=seconds)

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self._kv.pop(key, None)
            self._sets.pop(key, None)

    async def incr(self, key: str) -> int:
        current = await self.get(key)
        value = int(current or 0) + 1
        expires = self._kv.get(key, (None, None))[1]
        self._kv[key] = (str(value), expires)
        return value

    async def expire(self, key: str, seconds: int) -> None:
        if key in self._kv:
            val, _ = self._kv[key]
            self._kv[key] = (val, time.time() + seconds)

    async def sadd(self, key: str, *members: str) -> None:
        self._sets[key].update(members)

    async def srem(self, key: str, *members: str) -> None:
        self._sets[key].difference_update(members)

    async def smembers(self, key: str) -> set[str]:
        return set(self._sets.get(key, set()))

    async def scard(self, key: str) -> int:
        return len(self._sets.get(key, set()))

    async def sismember(self, key: str, member: str) -> bool:
        return member in self._sets.get(key, set())

    async def publish(self, channel: str, message: str) -> int:
        queues = list(self._channels.get(channel, []))
        for queue in queues:
            await queue.put(message)
        return len(queues)

    async def subscribe(self, *channels: str) -> AsyncIterator[tuple[str, str]]:
        queue: asyncio.Queue[str] = asyncio.Queue()
        for channel in channels:
            self._channels[channel].append(queue)
        try:
            while True:
                message = await queue.get()
                # Memory pubsub delivers raw payload; channel is unknown — fan as first
                yield channels[0], message
        finally:
            for channel in channels:
                if queue in self._channels[channel]:
                    self._channels[channel].remove(queue)


class RedisManager:
    def __init__(self) -> None:
        self.client: Any = None
        self._memory = MemoryRedis()
        self._using_memory = True

    async def connect(self) -> None:
        try:
            from redis.asyncio import Redis

            client = Redis.from_url(settings.redis_url, decode_responses=True)
            await client.ping()
            self.client = client
            self._using_memory = False
        except Exception:
            self.client = self._memory
            self._using_memory = True

    async def close(self) -> None:
        if not self._using_memory and self.client is not None:
            await self.client.aclose()

    @property
    def r(self) -> Any:
        if self.client is None:
            return self._memory
        return self.client


redis_manager = RedisManager()


async def get_redis() -> Any:
    return redis_manager.r


async def rate_limit(key: str, *, limit: int, window_seconds: int) -> bool:
    """Return True if request is allowed, False if rate-limited."""
    r = redis_manager.r
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, window_seconds)
    return count <= limit
