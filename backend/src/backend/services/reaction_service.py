from __future__ import annotations

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.reaction import Reaction, ReactionTargetType
from backend.services.realtime import manager


async def upsert_reaction(
    db: AsyncSession,
    *,
    target_type: ReactionTargetType,
    target_id: str,
    user_id: str,
    emoji: str,
) -> Reaction:
    existing = await db.scalar(
        select(Reaction).where(
            Reaction.target_type == target_type,
            Reaction.target_id == target_id,
            Reaction.user_id == user_id,
        )
    )
    if existing:
        existing.emoji = emoji
        reaction = existing
    else:
        reaction = Reaction(
            target_type=target_type,
            target_id=target_id,
            user_id=user_id,
            emoji=emoji,
        )
        db.add(reaction)
    await db.flush()

    event_type = f"{target_type.value}.reaction"
    await manager.publish(
        f"user:{user_id}",
        event_type,
        {"statusId" if target_type == ReactionTargetType.status else "messageId": target_id, "userId": user_id, "emoji": emoji},
    )
    return reaction


async def remove_reaction(
    db: AsyncSession,
    *,
    target_type: ReactionTargetType,
    target_id: str,
    user_id: str,
) -> None:
    existing = await db.scalar(
        select(Reaction).where(
            Reaction.target_type == target_type,
            Reaction.target_id == target_id,
            Reaction.user_id == user_id,
        )
    )
    if existing:
        await db.delete(existing)
        await db.flush()


async def list_reactions(
    db: AsyncSession,
    *,
    target_type: ReactionTargetType,
    target_id: str,
) -> list[Reaction]:
    return list(
        (
            await db.scalars(
                select(Reaction).where(
                    Reaction.target_type == target_type,
                    Reaction.target_id == target_id,
                )
            )
        ).all()
    )


async def count_reactions(
    db: AsyncSession,
    *,
    target_type: ReactionTargetType,
    target_id: str,
) -> int:
    rows = await list_reactions(db, target_type=target_type, target_id=target_id)
    return len(rows)


async def my_reaction(
    db: AsyncSession,
    *,
    target_type: ReactionTargetType,
    target_id: str,
    user_id: str,
) -> str | None:
    row = await db.scalar(
        select(Reaction).where(
            and_(
                Reaction.target_type == target_type,
                Reaction.target_id == target_id,
                Reaction.user_id == user_id,
            )
        )
    )
    return row.emoji if row else None
