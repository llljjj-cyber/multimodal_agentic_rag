from typing import Any
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

from models import ChunkModel, SourceModel, Base, UserModel


async def create_chunk(
    db: AsyncSession,
    *,
    id: str,
    source_id: str,
    title: str,
    modality: str,
    chunk_index: int,
    text: str,
    vector: list[float],
    metadata_: dict[str, Any] = None,
) -> ChunkModel:
    chunk = ChunkModel(
        id=id,
        source_id=source_id,
        title=title,
        modality=modality,
        chunk_index=chunk_index,
        text=text,
        vector=vector,
        metadata_=metadata_ or {},
    )
    db.add(chunk)
    return chunk


async def create_source(
    db: AsyncSession,
    *,
    user_id: str,
    title: str,
    modality: str,
    summary: str,
    file_path: str | None = None,
    metadata_: dict[str, Any] | None = None,
) -> SourceModel:
    source = SourceModel(
        user_id=user_id,
        title=title,
        modality=modality,
        summary=summary,
        file_path=file_path,
        metadata_=metadata_ or {},
    )
    db.add(source)
    await db.flush()  # 关键：生成并拿到 source.id，但还不 commit
    return source


async def delete_source(db: AsyncSession, source: SourceModel) -> None:
    await db.delete(source)
    await db.commit()


async def get_source_by_id(db: AsyncSession, source_id: str) -> SourceModel | None:
    result = await db.execute(select(SourceModel).where(SourceModel.id == source_id))
    return result.scalar_one_or_none()


async def chunks_for_source(db: AsyncSession, source: SourceModel) -> list[ChunkModel]:
    result = await db.execute(select(ChunkModel).where(ChunkModel.source_id == source.id))
    return list(result.scalars().all())


async def list_sources(db: AsyncSession) -> list[SourceModel]:
    result = await db.execute(select(SourceModel))
    return list(result.scalars().all())


async def list_sources_by_user_id(db: AsyncSession, user_id: str) -> list[SourceModel]:
    result = await db.execute(select(SourceModel).where(SourceModel.user_id == user_id))
    return list(result.scalars().all())


async def search_in_source(
    db: AsyncSession,
    query_vector: list[float],
    source: SourceModel,
    top_k: int = 5,
) -> list[tuple[ChunkModel, float]]:
    distance = ChunkModel.vector.cosine_distance(query_vector)
    result = await db.execute(
        select(ChunkModel)
        .where(ChunkModel.source_id == source.id)
        .add_columns(distance.label("distance"))
        .order_by(distance)
        .limit(top_k)
    )
    return result.all()


async def search_chunks(
    db: AsyncSession,
    user_id: str,
    query_vector: list[float],
    top_k: int = 6,
) -> list[tuple[ChunkModel, float]]:
    distance = ChunkModel.vector.cosine_distance(query_vector)
    result = await db.execute(
        select(ChunkModel)
        .join(ChunkModel.source)
        .where(SourceModel.user_id == user_id)
        .add_columns(distance.label("distance"))
        .order_by(distance)
        .limit(top_k)
    )
    return result.all()


async def get_count_by_user_id(
    db: AsyncSession,
    user_id: str,
    Model: type[SourceModel] | type[ChunkModel],
) -> int:
    if Model is SourceModel:
        stmt = select(func.count(SourceModel.id)).where(SourceModel.user_id == user_id)
    elif Model is ChunkModel:
        stmt = (
            select(func.count(ChunkModel.id))
            .join(SourceModel, ChunkModel.source_id == SourceModel.id)
            .where(SourceModel.user_id == user_id)
        )
    else:
        raise ValueError(f"unsupported model: {Model}")
    result = await db.execute(stmt)
    return result.scalar_one()


async def count_by_modality(db: AsyncSession, user_id: str, Model: Base) -> dict[str, int]:
    if Model is SourceModel:
        sql = """
            SELECT s.modality, COUNT(*) AS n_modality
            FROM sources s
            WHERE s.user_id = :user_id
            GROUP BY s.modality;
        """
    elif Model is ChunkModel:
        sql = """
            SELECT c.modality, COUNT(*) AS n_modality
            FROM chunks c
            JOIN sources s ON c.source_id = s.id
            WHERE s.user_id = :user_id
            GROUP BY c.modality;
        """
    else:
        raise ValueError(f"unsupported model: {Model}")
    result = await db.execute(text(sql), {"user_id": user_id})
    return {modality: count for modality, count in result.all()}


async def space_stats(db: AsyncSession, user_id: str) -> dict:
    sources = await get_count_by_user_id(db, user_id, SourceModel)
    chunks = await get_count_by_user_id(db, user_id, ChunkModel)
    source_modalities = await count_by_modality(db, user_id, SourceModel)
    chunk_modalities = await count_by_modality(db, user_id, ChunkModel)
    return {
        "sources": sources,
        "chunks": chunks,
        "modalities": source_modalities,
        "chunk_modalities": chunk_modalities,
    }


async def get_user_by_username(db: AsyncSession, username: str) -> UserModel | None:
    result = await db.execute(select(UserModel).where(UserModel.username == username))
    return result.scalar_one_or_none()


async def create_user(db: AsyncSession, username: str, hashed_password: str) -> UserModel:
    user = UserModel(username=username, hashed_password=hashed_password)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
