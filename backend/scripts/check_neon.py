import asyncio

from sqlalchemy import text

from backend.core.config import get_settings
from backend.core.database import engine, init_db


async def main() -> None:
    s = get_settings()
    print("db=", s.database_url.split("@")[-1])
    await init_db()
    async with engine.connect() as conn:
        r = await conn.execute(text("select 1"))
        print("ping", r.scalar())
        r2 = await conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
        )
        tables = [row[0] for row in r2]
        print("tables", len(tables))
        print(tables)


if __name__ == "__main__":
    asyncio.run(main())
