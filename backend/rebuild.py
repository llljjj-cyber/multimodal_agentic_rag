"""一次性为已有资料回填 centroid + PCA。用法：cd backend && python scripts/rebuild_space.py"""
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv
load_dotenv(BACKEND_ROOT / ".env")

import crud
from database import async_session
from models import UserModel
from services.rag.space import compute_centroid, rebuild_user_space
from sqlalchemy import select


async def backfill_user(db, user_id: str) -> None:
    sources = await crud.list_sources_by_user_id(db, user_id)
    for source in sources:
        chunks = await crud.chunks_for_source(db, source)
        vectors = []
        for chunk in chunks:
            vec = chunk.vector
            if hasattr(vec, "tolist"):
                vec = vec.tolist()
            vectors.append(vec)
        centroid = compute_centroid(vectors)
        if centroid:
            await crud.update_source_centroid(db, source, centroid)
    await db.commit()
    await rebuild_user_space(db, user_id)
    print(f"user {user_id}: {len(sources)} sources rebuilt")


async def main():
    async with async_session() as db:
        users = (await db.execute(select(UserModel))).scalars().all()
        for user in users:
            await backfill_user(db, user.id)


if __name__ == "__main__":
    asyncio.run(main())