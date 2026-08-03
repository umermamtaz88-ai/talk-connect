from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.friend import Block, ContactSync, FriendRequest, FriendRequestStatus, Friendship
from backend.models.otp import Report, ReportReason, ReportStatus
from backend.models.user import User, utcnow
from backend.core.redis_client import redis_manager
from backend.services.realtime import manager


def ordered_pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def _block_cache_key(user_id: str) -> str:
    return f"blocked:{user_id}"


async def _cache_add_block(blocker_id: str, blocked_id: str) -> None:
    r = redis_manager.r
    try:
        await r.sadd(_block_cache_key(blocker_id), blocked_id)
        await r.sadd(f"blocked_by:{blocked_id}", blocker_id)
    except Exception:
        pass


async def _cache_remove_block(blocker_id: str, blocked_id: str) -> None:
    r = redis_manager.r
    try:
        await r.srem(_block_cache_key(blocker_id), blocked_id)
        await r.srem(f"blocked_by:{blocked_id}", blocker_id)
    except Exception:
        pass


async def is_blocked(db: AsyncSession, user_a: str, user_b: str) -> bool:
    """True if either user has blocked the other. Prefers Redis set membership."""
    r = redis_manager.r
    try:
        if await r.sismember(_block_cache_key(user_a), user_b):
            return True
        if await r.sismember(_block_cache_key(user_b), user_a):
            return True
        # Negative cache miss — check DB and warm cache if found
    except Exception:
        pass

    row = await db.scalar(
        select(Block).where(
            or_(
                and_(Block.blocker_id == user_a, Block.blocked_id == user_b),
                and_(Block.blocker_id == user_b, Block.blocked_id == user_a),
            )
        )
    )
    if row:
        await _cache_add_block(row.blocker_id, row.blocked_id)
        return True
    return False


async def get_friendship(db: AsyncSession, user_a: str, user_b: str) -> Friendship | None:
    a, b = ordered_pair(user_a, user_b)
    return await db.scalar(select(Friendship).where(Friendship.user_id_a == a, Friendship.user_id_b == b))


async def are_friends(db: AsyncSession, user_a: str, user_b: str) -> bool:
    return await get_friendship(db, user_a, user_b) is not None


async def send_request(db: AsyncSession, from_user_id: str, to_user_id: str) -> FriendRequest:
    if from_user_id == to_user_id:
        raise ValueError("Cannot friend yourself")
    target = await db.get(User, to_user_id)
    if not target:
        raise ValueError("User not found")
    if await is_blocked(db, from_user_id, to_user_id):
        raise PermissionError("Blocked")
    if await are_friends(db, from_user_id, to_user_id):
        raise ValueError("Already friends")

    incoming = await db.scalar(
        select(FriendRequest).where(
            FriendRequest.from_user_id == to_user_id,
            FriendRequest.to_user_id == from_user_id,
            FriendRequest.status == FriendRequestStatus.pending,
        )
    )
    if incoming:
        return await accept_request(db, incoming.id, from_user_id)

    existing = await db.scalar(
        select(FriendRequest).where(
            FriendRequest.from_user_id == from_user_id,
            FriendRequest.to_user_id == to_user_id,
            FriendRequest.status == FriendRequestStatus.pending,
        )
    )
    if existing:
        return existing

    req = FriendRequest(from_user_id=from_user_id, to_user_id=to_user_id)
    db.add(req)
    await db.flush()
    await manager.publish(
        f"user:{to_user_id}",
        "friend.request",
        {"requestId": req.id, "fromUserId": from_user_id},
    )
    return req


def _brief_user(user: User | None) -> dict | None:
    if not user:
        return None
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "avatar_icon_id": user.avatar_icon_id,
    }


async def serialize_request(db: AsyncSession, req: FriendRequest) -> dict:
    from_user = await db.get(User, req.from_user_id)
    to_user = await db.get(User, req.to_user_id)
    return {
        "id": req.id,
        "from_user_id": req.from_user_id,
        "to_user_id": req.to_user_id,
        "status": req.status.value if hasattr(req.status, "value") else str(req.status),
        "created_at": req.created_at,
        "responded_at": req.responded_at,
        "from_user": _brief_user(from_user),
        "to_user": _brief_user(to_user),
    }


async def list_requests(db: AsyncSession, user_id: str, direction: str) -> list[FriendRequest]:
    if direction == "outgoing":
        q = select(FriendRequest).where(
            FriendRequest.from_user_id == user_id,
            FriendRequest.status == FriendRequestStatus.pending,
        )
    else:
        q = select(FriendRequest).where(
            FriendRequest.to_user_id == user_id,
            FriendRequest.status == FriendRequestStatus.pending,
        )
    return list((await db.scalars(q)).all())


async def accept_request(db: AsyncSession, request_id: str, user_id: str) -> FriendRequest:
    req = await db.get(FriendRequest, request_id)
    if not req or req.to_user_id != user_id or req.status != FriendRequestStatus.pending:
        raise LookupError("Request not found")
    if await is_blocked(db, req.from_user_id, req.to_user_id):
        raise PermissionError("Blocked")
    req.status = FriendRequestStatus.accepted
    req.responded_at = utcnow()
    a, b = ordered_pair(req.from_user_id, req.to_user_id)
    db.add(Friendship(user_id_a=a, user_id_b=b))
    await db.flush()
    await manager.publish(
        f"user:{req.from_user_id}",
        "friend.accepted",
        {"userId": user_id},
    )
    await manager.publish(
        f"user:{user_id}",
        "friend.accepted",
        {"userId": req.from_user_id},
    )
    return req


async def decline_request(db: AsyncSession, request_id: str, user_id: str) -> FriendRequest:
    req = await db.get(FriendRequest, request_id)
    if not req or req.to_user_id != user_id or req.status != FriendRequestStatus.pending:
        raise LookupError("Request not found")
    req.status = FriendRequestStatus.declined
    req.responded_at = utcnow()
    await db.flush()
    return req


async def cancel_request(db: AsyncSession, request_id: str, user_id: str) -> None:
    req = await db.get(FriendRequest, request_id)
    if not req or req.from_user_id != user_id or req.status != FriendRequestStatus.pending:
        raise LookupError("Request not found")
    req.status = FriendRequestStatus.cancelled
    req.responded_at = utcnow()
    await db.flush()


async def list_friends(db: AsyncSession, user_id: str) -> list[User]:
    rows = (
        await db.scalars(
            select(Friendship).where(or_(Friendship.user_id_a == user_id, Friendship.user_id_b == user_id))
        )
    ).all()
    friend_ids = [r.user_id_b if r.user_id_a == user_id else r.user_id_a for r in rows]
    if not friend_ids:
        return []
    return list((await db.scalars(select(User).where(User.id.in_(friend_ids)))).all())


async def unfriend(db: AsyncSession, user_id: str, other_id: str) -> None:
    friendship = await get_friendship(db, user_id, other_id)
    if friendship:
        await db.delete(friendship)
        await db.flush()


async def _cancel_pending_requests(db: AsyncSession, a: str, b: str) -> None:
    rows = list(
        (
            await db.scalars(
                select(FriendRequest).where(
                    FriendRequest.status == FriendRequestStatus.pending,
                    or_(
                        and_(FriendRequest.from_user_id == a, FriendRequest.to_user_id == b),
                        and_(FriendRequest.from_user_id == b, FriendRequest.to_user_id == a),
                    ),
                )
            )
        ).all()
    )
    for req in rows:
        req.status = FriendRequestStatus.cancelled
        req.responded_at = utcnow()
    if rows:
        await db.flush()


async def block_user(db: AsyncSession, blocker_id: str, blocked_id: str) -> None:
    if blocker_id == blocked_id:
        raise ValueError("Cannot block yourself")
    await unfriend(db, blocker_id, blocked_id)
    await _cancel_pending_requests(db, blocker_id, blocked_id)
    row = await db.scalar(
        select(Block).where(Block.blocker_id == blocker_id, Block.blocked_id == blocked_id)
    )
    if not row:
        db.add(Block(blocker_id=blocker_id, blocked_id=blocked_id))
        await db.flush()
    await _cache_add_block(blocker_id, blocked_id)
    await manager.publish(
        f"user:{blocker_id}",
        "user.blocked",
        {"userId": blocked_id},
    )


async def unblock_user(db: AsyncSession, blocker_id: str, blocked_id: str) -> None:
    row = await db.scalar(
        select(Block).where(Block.blocker_id == blocker_id, Block.blocked_id == blocked_id)
    )
    if row:
        await db.delete(row)
        await db.flush()
    await _cache_remove_block(blocker_id, blocked_id)
    await manager.publish(
        f"user:{blocker_id}",
        "user.unblocked",
        {"userId": blocked_id},
    )


async def list_blocked(db: AsyncSession, blocker_id: str) -> list[User]:
    rows = list(
        (await db.scalars(select(Block).where(Block.blocker_id == blocker_id).order_by(Block.created_at.desc()))).all()
    )
    if not rows:
        return []
    ids = [r.blocked_id for r in rows]
    users = list((await db.scalars(select(User).where(User.id.in_(ids)))).all())
    by_id = {u.id: u for u in users}
    return [by_id[i] for i in ids if i in by_id]


async def report_user(
    db: AsyncSession,
    *,
    reporter_id: str,
    reported_user_id: str,
    reason: str,
    details: str | None = None,
) -> Report:
    if reporter_id == reported_user_id:
        raise ValueError("Cannot report yourself")
    target = await db.get(User, reported_user_id)
    if not target:
        raise LookupError("User not found")
    try:
        reason_enum = ReportReason(reason)
    except ValueError as exc:
        raise ValueError("Invalid report reason") from exc

    report = Report(
        reporter_id=reporter_id,
        reported_user_id=reported_user_id,
        reason=reason_enum,
        details=(details or "").strip() or None,
        status=ReportStatus.pending,
    )
    db.add(report)
    await db.flush()

    since = datetime.now(UTC) - timedelta(days=30)
    recent = await db.scalar(
        select(func.count())
        .select_from(Report)
        .where(
            Report.reported_user_id == reported_user_id,
            Report.created_at >= since,
        )
    )
    if int(recent or 0) >= 3:
        report.flagged_for_review = True
        await db.flush()

    return report


async def list_reports(
    db: AsyncSession,
    *,
    status_filter: str | None = "pending",
    limit: int = 50,
) -> list[Report]:
    q = select(Report).order_by(Report.created_at.desc()).limit(limit)
    if status_filter:
        try:
            st = ReportStatus(status_filter)
            q = q.where(Report.status == st)
        except ValueError:
            pass
    return list((await db.scalars(q)).all())


async def sync_contacts(db: AsyncSession, user_id: str, phone_hashes: list[str]) -> list[dict]:
    matches: list[dict] = []
    for phone_hash in phone_hashes:
        matched = await db.scalar(select(User).where(User.phone_hash == phone_hash, User.id != user_id))
        if matched and await is_blocked(db, user_id, matched.id):
            matched = None
        db.add(
            ContactSync(
                user_id=user_id,
                phone_hash=phone_hash,
                matched_user_id=matched.id if matched else None,
            )
        )
        matches.append(
            {
                "phone_hash": phone_hash,
                "user_id": matched.id if matched else None,
                "username": matched.username if matched else None,
                "display_name": matched.display_name if matched else None,
            }
        )
    await db.flush()
    return matches
