import math

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from schemas import SourceOut
import crud
from models import ChunkModel, SourceModel



EMBED_MODEL = "bgem3-flag-1024"
DIMENSIONS = 1024

MODALITY_COLORS = {
    "text": "#9fc9a2",
    "url": "#9fbbe0",
    "pdf": "#c08532",
    "txt": "#c0a8dd",
    "query": "#f54e00",
}


def _blend_vectors(primary: list[float], secondary: list[float], secondary_weight: float = 0.32) -> list[float]:
    primary_weight = 1.0 - secondary_weight
    blended = [
        (left * primary_weight) + (right * secondary_weight)
        for left, right in zip(primary, secondary)
    ]
    norm = math.sqrt(sum(value * value for value in blended)) or 1.0
    return [value / norm for value in blended]


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm < 1e-12:
        return [0.0] * len(vector)
    return [value / norm for value in vector]


def _orthogonalize(vector: list[float], components: list[list[float]]) -> list[float]:
    adjusted = vector[:]
    for component in components:
        projection = _dot(adjusted, component)
        adjusted = [value - projection * component[index] for index, value in enumerate(adjusted)]
    return adjusted


def _pca_projection(vectors: dict[str, list[float]]) -> dict[str, dict[str, float]]:
    if not vectors:
        return {}

    ids = list(vectors)
    rows = [vectors[item_id][: DIMENSIONS] for item_id in ids]
    if len(rows) == 1:
        return {ids[0]: {"x": 0.0, "y": 0.0, "z": 0.0}}

    means = [sum(row[index] for row in rows) / len(rows) for index in range(DIMENSIONS)]
    centered = [[row[index] - means[index] for index in range(DIMENSIONS)] for row in rows]
    components: list[list[float]] = []

    for component_index in range(3):
        candidate = [
            math.sin((index + 1) * (component_index + 1) * 0.017)
            + math.cos((index + 1) * (component_index + 2) * 0.013)
            for index in range(DIMENSIONS)
        ]
        candidate = _normalize(_orthogonalize(candidate, components))

        for _ in range(24):
            scores = [_dot(row, candidate) for row in centered]
            next_candidate = [0.0] * DIMENSIONS
            for score, row in zip(scores, centered):
                for index, value in enumerate(row):
                    next_candidate[index] += score * value
            next_candidate = _normalize(_orthogonalize(next_candidate, components))
            if not any(next_candidate):
                break
            candidate = next_candidate

        if not any(candidate):
            candidate = [0.0] * DIMENSIONS
            candidate[min(component_index, DIMENSIONS - 1)] = 1.0
        components.append(candidate)

    raw = {
        item_id: [_dot(row, component) for component in components]
        for item_id, row in zip(ids, centered)
    }
    max_radius = max(
        math.sqrt(values[0] * values[0] + values[1] * values[1] + values[2] * values[2])
        for values in raw.values()
    ) or 1.0
    scale = 2.65 / max_radius
    return {
        item_id: {
            "x": round(values[0] * scale, 4),
            "y": round(values[1] * scale, 4),
            "z": round(values[2] * scale, 4),
        }
        for item_id, values in raw.items()
    }


async def _source_vector(db: AsyncSession, source: SourceModel) -> list[float]:
    chunks: list[ChunkModel] = await crud.chunks_for_source(db, source)
    if not chunks:
        return [0.0] * DIMENSIONS

    vector = [0.0] * DIMENSIONS
    for chunk in chunks:
        for index, value in enumerate(chunk.vector[: DIMENSIONS]): # 为何要限制维度？
            vector[index] += value
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


async def _source_vectors(db: AsyncSession, user_id: str) -> dict[str, list[float]]:
    sources: list[SourceModel] = await crud.list_sources_by_user_id(db, user_id)
    vectors: list[list[float]] = []
    for source in sources:
        vector = await _source_vector(db, source)
        vectors.append(vector)
    return {source.id: vector for source, vector in zip(sources, vectors)}


def _source_point(source: SourceModel, projection: dict[str, float]) -> dict[str, Any]:
    return {
        "id": source.id,
        "source_id": source.id,
        "title": source.title,
        "modality": source.modality,
        "projection": projection,
        "color": MODALITY_COLORS.get(source.modality, "#94a3b8"),
        "preview": source.summary,
    }


async def snapshot(db: AsyncSession, user_id: str, projections: dict[str, dict[str, float]] | None = None) -> dict[str, Any]:
    source_vectors = await _source_vectors(db, user_id)
    projection_map = projections or run_in_threadpool(_pca_projection, source_vectors)
    sources: list[SourceModel] = await crud.list_sources_by_user_id(db, user_id)
    points = [
        _source_point(source, projection_map.get(source.id, {"x": 0.0, "y": 0.0, "z": 0.0}))
        for source in sources
    ]
    return {
        "sources": [SourceOut.model_validate(source) for source in sources],
        "points": points,
        "dimensions": DIMENSIONS,
        "embedding_model": EMBED_MODEL,
        "projection": {
            "method": "pca_3d",
            "basis": "当前资料向量，提问时会一并包含查询向量",
        },
    }


async def space_tool(db: AsyncSession, user_id: str) -> dict[str, Any]:
    space = await crud.space_stats(db, user_id)
    return {
        "sources": space["sources"],
        "chunks": space["chunks"],
        "dimensions": DIMENSIONS,
        "embedding_model": EMBED_MODEL,
        "modalities": space["modalities"],
        "chunk_modalities": space["chunk_modalities"],
        "projection": "pca_3d",
    }