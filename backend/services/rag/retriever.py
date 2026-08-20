import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

import crud
from models import ChunkModel, SourceModel
from services.rag.embedding import _text_embedding
from services.rag.space import snapshot, _source_vectors, _pca_projection


EMBED_MODEL = "bgem3-flag-1024"
DIMENSIONS = 1024

MODALITY_COLORS = {
    "text": "#9fc9a2",
    "url": "#9fbbe0",
    "pdf": "#c08532",
    "txt": "#c0a8dd",
    "query": "#f54e00",
}


async def search_sources(db: AsyncSession, user_id: str, query: str, top_k: int = 6) -> dict[str, Any]:
    query_vector = (
        await run_in_threadpool(_text_embedding, query)
    ).get("dense", None)
    if query_vector is None:
        raise ValueError("Dense vector is required for search")
    query_id = f"query-{uuid.uuid4().hex[:8]}"
    source_vectors = await _source_vectors(db, user_id)
    projections = await run_in_threadpool(
        lambda: _pca_projection({**source_vectors, query_id: query_vector})
    )
    query_point = {
            "id": query_id,
            "source_id": "query",
            "title": query,
            "modality": "query",
            "projection": projections.get(query_id, {"x": 0.0, "y": 0.0, "z": 0.0}),
            "color": MODALITY_COLORS["query"],
            "score": 1,
            "preview": "查询向量已投影到当前资料集合中。",
        }
    sources: list[SourceModel] = await crud.list_sources_by_user_id(db, user_id)
    source_matches: dict[str, dict[str, Any]] = {}
    for source in sources:
        results: tuple[ChunkModel,float] = await crud.search_in_source(db, query_vector, source, 1)
        if not results:
            continue
        chunk = results[0]
        source_matches[source.id] = {
            "id": source.id,
            "source_id": source.id,
            "title": source.title,
            "modality": source.modality,
            "text": chunk[0].text,
            "score": round(1 - chunk[1], 4),
            "metadata": {"best_chunk": chunk[0].id, **chunk[0].metadata_},

        }
    matches = sorted(source_matches.values(), key=lambda item: item["score"], reverse=True)[:top_k]
    space = await snapshot(db, user_id, projections=projections)
    return {
        "query_point": query_point,
        "matches": matches,
        "space": space
        }


async def search_chunks(
    db: AsyncSession, 
    user_id: str, 
    query: str, 
    top_k: int = 6,
    dense: bool = True,
    sparse: bool = False,
    colbert: bool = False
    ) -> dict[str, Any]:
    # 暂时只支持dense向量搜索
    query_vector = (await run_in_threadpool(
        lambda: _text_embedding(query, dense=dense, sparse=sparse, colbert=colbert)
    )).get("dense", None)
    if query_vector is None:
        raise ValueError("Dense vector is required for search")
    result: list[tuple[ChunkModel, float]] = await crud.search_chunks(db, user_id, query_vector, top_k)
    chunk_matches: list[dict[str, Any]] = []
    if not result:
        return {"matches": []}
    parent_ids = set()
    for chunk, distance in result:
        if chunk.parent_id:
            if chunk.parent_id in parent_ids:
                continue
            parent_ids.add(chunk.parent_id)
            parent_text = await crud.get_parent_doc_by_id(db, chunk.parent_id)
            if parent_text:
                text = parent_text.text
            else:
                text = chunk.text
        else:
            text = chunk.text
        chunk_matches.append({
            "id": chunk.id,
            "source_id": chunk.source_id,
            "title": chunk.title,
            "modality": chunk.modality,
            "text": text,
            "score": round(1 - distance, 4),
            "metadata": {"chunk_id": chunk.id, **chunk.metadata_}
        })
    matches = sorted(chunk_matches, key=lambda item: item["score"], reverse=True)
    return {"matches": matches}


def retrieval_payload(results: dict[str, Any]) -> dict[str, Any]:
    """将检索结果转换为Agentic RAG的payload格式"""
    return {
        "embedding_model": EMBED_MODEL,
        "matches": [
            {
                "citation": match["id"],
                "source": match["title"],
                "modality": match["modality"],
                "similarity": match["score"],
                "evidence": match["text"],
            }
            for match in results["matches"]
        ],
    }
