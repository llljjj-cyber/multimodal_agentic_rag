import math
import os
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types
from langchain_community.document_loaders import DirectoryLoader, PyPDFLoader, TextLoader
from sqlalchemy.ext.asyncio import AsyncSession

from schemas import SourceOut
import crud
from models import ChunkModel, SourceModel


EMBED_MODEL = "gemini-embedding-2-preview"
DEFAULT_DIMENSIONS = 768
CHUNK_WORDS = 170
CHUNK_OVERLAP = 35
INLINE_MEDIA_LIMIT_BYTES = 18 * 1024 * 1024
FILE_API_POLL_SECONDS = 2
FILE_API_MAX_WAIT_SECONDS = 90


MODALITY_COLORS = {
    "text": "#9fc9a2",
    "url": "#9fbbe0",
    "pdf": "#c08532",
    "image": "#c0a8dd",
    "audio": "#dfa88f",
    "video": "#e6e5e0",
    "query": "#f54e00",
}


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if not norm_a or not norm_b:
        return 0.0
    return dot / (norm_a * norm_b)


def _clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text


def _chunk_text(text: str) -> list[str]:
    words = _clean_text(text).split()
    if not words:
        return []
    if len(words) <= CHUNK_WORDS:
        return [" ".join(words)]

    chunks: list[str] = []
    step = max(1, CHUNK_WORDS - CHUNK_OVERLAP)
    for start in range(0, len(words), step):
        chunk = words[start : start + CHUNK_WORDS]
        if len(chunk) >= 25:
            chunks.append(" ".join(chunk))
    return chunks


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


class MultimodalRagStore:
    def __init__(self, dimensions: int = DEFAULT_DIMENSIONS):
        self.dimensions = dimensions
        self.api_key = os.getenv("GOOGLE_API_KEY", "")
        self.client = genai.Client(api_key=self.api_key) if self.api_key else None
        self.events: list[dict[str, Any]] = []
        self.embedding_provider = "gemini-embedding-2-preview"

    async def _sources_num(self, db: AsyncSession, user_id: str) -> int:
        return await crud.get_count_by_user_id(db, user_id, SourceModel)

    async def _chunks_num(self, db: AsyncSession, user_id: str) -> int:
        return await crud.get_count_by_user_id(db, user_id, ChunkModel)

    def _require_client(self) -> genai.Client:
        if not self.client:
            raise RuntimeError("Gemini Embedding 2 需要设置 GOOGLE_API_KEY。")
        return self.client

    def _emit(self, event_type: str, payload: dict[str, Any]) -> None:
        self.events.append({"type": event_type, "at": time.time(), **payload})
        self.events = self.events[-80:]

    def _embed_text(self, text: str, task_prefix: str) -> list[float]:
        content = f"{task_prefix}: {text}"
        client = self._require_client()

        result = client.models.embed_content(
            model=EMBED_MODEL,
            contents=[content],
            config=types.EmbedContentConfig(output_dimensionality=self.dimensions),
        )
        return result.embeddings[0].values

    def _embed_uploaded_file(self, data: bytes, mime_type: str, title: str) -> list[float]:
        client = self._require_client()
        suffix = Path(title).suffix or self._suffix_from_mime(mime_type)
        uploaded = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as temp_file:
                temp_file.write(data)
                temp_file.flush()
                uploaded = client.files.upload(
                    file=temp_file.name,
                    config=types.UploadFileConfig(mime_type=mime_type, display_name=title),
                )

            waited = 0
            while getattr(getattr(uploaded, "state", None), "name", "") == "PROCESSING":
                if waited >= FILE_API_MAX_WAIT_SECONDS:
                    raise ValueError("Gemini 仍在处理该媒体文件。请稍后再试，或上传更短的片段。")
                time.sleep(FILE_API_POLL_SECONDS)
                waited += FILE_API_POLL_SECONDS
                uploaded = client.files.get(name=uploaded.name)

            state_name = getattr(getattr(uploaded, "state", None), "name", "")
            if state_name and state_name not in {"ACTIVE", "SUCCEEDED"}:
                raise ValueError(f"Gemini 无法处理该媒体文件。文件状态：{state_name}。")

            part = types.Part.from_uri(file_uri=uploaded.uri, mime_type=mime_type)
            result = client.models.embed_content(
                model=EMBED_MODEL,
                contents=[part],
                config=types.EmbedContentConfig(output_dimensionality=self.dimensions),
            )
            return result.embeddings[0].values
        finally:
            uploaded_name = getattr(uploaded, "name", None)
            if uploaded_name:
                try:
                    client.files.delete(name=uploaded_name)
                except Exception as exc:
                    self._emit("file_cleanup_failed", {"name": uploaded_name, "error": str(exc)})

    def _embed_file(self, data: bytes, mime_type: str, title: str, notes: str) -> tuple[list[float], str]:
        client = self._require_client()

        use_file_api = (
            len(data) > INLINE_MEDIA_LIMIT_BYTES
            or mime_type.startswith("video/")
            or mime_type.startswith("audio/")
        )
        if use_file_api:
            return self._embed_uploaded_file(data, mime_type, title), "gemini-file-api"

        part = types.Part.from_bytes(data=data, mime_type=mime_type)
        try:
            result = client.models.embed_content(
                model=EMBED_MODEL,
                contents=[part],
                config=types.EmbedContentConfig(output_dimensionality=self.dimensions),
            )
            return result.embeddings[0].values, "gemini-inline"
        except Exception:
            if mime_type.startswith(("video/", "audio/")) or mime_type == "application/pdf":
                return self._embed_uploaded_file(data, mime_type, title), "gemini-file-api"
            raise
    
    def _pca_projection(self, vectors: dict[str, list[float]]) -> dict[str, dict[str, float]]:
        if not vectors:
            return {}

        ids = list(vectors)
        rows = [vectors[item_id][: self.dimensions] for item_id in ids]
        if len(rows) == 1:
            return {ids[0]: {"x": 0.0, "y": 0.0, "z": 0.0}}

        means = [sum(row[index] for row in rows) / len(rows) for index in range(self.dimensions)]
        centered = [[row[index] - means[index] for index in range(self.dimensions)] for row in rows]
        components: list[list[float]] = []

        for component_index in range(3):
            candidate = [
                math.sin((index + 1) * (component_index + 1) * 0.017)
                + math.cos((index + 1) * (component_index + 2) * 0.013)
                for index in range(self.dimensions)
            ]
            candidate = _normalize(_orthogonalize(candidate, components))

            for _ in range(24):
                scores = [_dot(row, candidate) for row in centered]
                next_candidate = [0.0] * self.dimensions
                for score, row in zip(scores, centered):
                    for index, value in enumerate(row):
                        next_candidate[index] += score * value
                next_candidate = _normalize(_orthogonalize(next_candidate, components))
                if not any(next_candidate):
                    break
                candidate = next_candidate

            if not any(candidate):
                candidate = [0.0] * self.dimensions
                candidate[min(component_index, self.dimensions - 1)] = 1.0
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

    async def add_text_source(self, db: AsyncSession, user_id: str, title: str, text: str, modality: str = "text", seed: bool = False) -> SourceModel:
        chunks = _chunk_text(text)
        if not chunks:
            raise ValueError("资料文本为空。")

        try:
            source = await crud.create_source(
                db=db,
                user_id=user_id,
                title=title.strip() or f"{modality.title()} source",
                modality=modality,
                summary=_clean_text(text)[:220],
                file_path=None,
            )
            for index, chunk_text in enumerate(chunks):
                vector = self._embed_text(chunk_text, "task: retrieval document")
                await crud.create_chunk(
                    db=db,
                    id=f"{source.id}-{index + 1}",
                    source_id=source.id,
                    title=source.title,
                    modality=modality,
                    chunk_index=index+1,
                    text=chunk_text,
                    vector=vector,
                    metadata_={"chunk_index": index + 1},
                )
            await db.commit()
            await db.refresh(source)
        
        except Exception:
            await db.rollback()
            raise

        if not seed:
            self._emit("source_added",
            {"source_id": source.id, "title": source.title, "chunks": len(chunks)})
        return source

    async def add_file_source(self, db: AsyncSession, user_id: str, title: str, data: bytes, mime_type: str, notes: str = "") -> SourceModel:
        modality = self._modality_from_mime(mime_type)
        display_text = _clean_text(notes) or f"{title} ({mime_type}) embedded natively in Gemini Embedding 2."
        try:   
            media_vector, embedding_path = self._embed_file_1(data, mime_type, title, display_text)
            annotation_text = _clean_text(f"{title}. {display_text}")
            annotation_vector = self._embed_text(annotation_text, "task: retrieval document")
            vector = _blend_vectors(media_vector, annotation_vector)
            source = await crud.create_source(
                db=db,
                user_id=user_id,
                title=title.strip() or "Uploaded source",
                modality=modality,
                summary=display_text[:220],
                metadata_={
                    "mime_type": mime_type,
                    "bytes": len(data),
                    "embedding_path": embedding_path,
                    "annotation_blended": True,
                },
            )
            await crud.create_chunk(
                db=db,
                id=f"{source.id}-1",
                source_id=source.id,
                title=source.title,
                modality=modality,
                chunk_index=1,
                text=display_text,
                vector=vector,
                metadata_={
                    "mime_type": mime_type,
                    "bytes": len(data),
                    "native_multimodal": bool(self.client),
                    "embedding_path": embedding_path,
                    "annotation_blended": True,
                },
            )
            await db.commit()
            await db.refresh(source)
        except Exception:
            await db.rollback()
            raise
        self._emit("source_added", {"source_id": source.id, "title": source.title, "chunks": 1})
        return source

    async def add_source_inner(self, db: AsyncSession, user_id: str, directory_path: str, seed=False) -> list[SourceModel]:
        path = Path(directory_path)
        all_docs = []
       
        pdf_loader = DirectoryLoader(
            path,
            glob="**/*.pdf", 
            loader_cls=PyPDFLoader,
            loader_kwargs={"mode": "page"},
            silent_errors=True)
        pdf_docs = pdf_loader.load()
        all_docs.extend(pdf_docs)

        txt_loader = DirectoryLoader(
            path,
            glob="**/*.txt",
            loader_cls=TextLoader,
            loader_kwargs={"encoding": "utf-8"},
            silent_errors=True)
        all_docs.extend(txt_loader.load())

        if not all_docs:
            raise ValueError("文件夹解析后为空。")

        classify = {}
        for doc in all_docs:
            doc_source = doc.metadata.get("source","unknown")
            if doc_source not in classify:
                classify[doc_source] = [doc]
            else:
                classify[doc_source].append(doc)

        sources = []
        for doc_source, docs in classify.items():
            if doc_source == "unknown":
                continue
            doc_path = Path(doc_source)
            try:
                source = await crud.create_source(
                    db=db,
                    user_id=user_id,
                    title=doc_path.stem,
                    modality=doc_path.suffix.strip("."),
                    summary=docs[0].page_content[:200],
                    file_path=str(doc_path),
                )

                chunk_count = 0
                for index, doc in enumerate(docs):
                    if not doc.page_content:
                        continue
                    vector = self._embed_text(doc.page_content, "task: retrieval document")
                    await crud.create_chunk(
                        db=db,
                        id=f"{source.id}-{index + 1}",
                        source_id=source.id,
                        title=source.title,
                        modality=doc_path.suffix.strip("."),
                        chunk_index=index+1,
                        text=doc.page_content,
                        vector=vector,
                        metadata_={"chunk_index": index + 1},
                    )
                    chunk_count += 1
                if chunk_count == 0:
                    await db.rollback()
                else:
                    await db.commit()
                    await db.refresh(source)
                    sources.append(source)


            except Exception:
                await db.rollback()
                self._emit("source_added_error",
            {"source_path": str(doc_path), "title": doc_path.stem, "chunks": len(docs)})

        if not seed:
            self._emit("directory_added",
            {"directory_path": str(path), "title": path.stem, "successfully_add_sources": len(sources)})
        return sources

    async def remove_source(self, db: AsyncSession, user_id: str, source_id: str) -> bool:
        source = await crud.get_source_by_id(db, source_id)
        if not source or source.user_id != user_id:
            return False
        await crud.delete_source(db, source)
        self._emit("source_removed", {"source_id": source_id, "title": source.title})
        return True

    async def search(self, db: AsyncSession, user_id: str, query: str, top_k: int = 6) -> dict[str, Any]:
        query_vector = self._embed_text(query, "task: question answering | query")
        query_id = f"query-{uuid.uuid4().hex[:8]}"
        source_vectors = await self._source_vectors(db, user_id)
        projections = self._pca_projection({**source_vectors, query_id: query_vector})
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
        self._emit("query_embedded", {"query": query, "matches": [m["id"] for m in matches]})
        space = await self.snapshot(db, user_id, projections=projections)
        return {
            "query_point": query_point,
            "matches": matches,
            "space": space
            }

    async def search_chunks(self, db: AsyncSession, user_id: str, query: str, top_k: int = 6) -> dict[str, Any]:
        query_vector = self._embed_text(query, "task: question answering | query")
        result: list[ChunkModel,float] = await crud.search_chunks(db, user_id, query_vector, top_k)
        chunk_matches: list[dict[str, Any]] = []
        if not result:
            return {}
        for chunk, distance in result:
            chunk_matches.append({
                "id": chunk.id,
                "source_id": chunk.source_id,
                "title": chunk.title,
                "modality": chunk.modality,
                "text": chunk.text,
                "score": round(1 - distance, 4),
                "metadata": {"chunk_id": chunk.id, **chunk.metadata_}
            })
        matches = sorted(chunk_matches, key=lambda item: item["score"], reverse=True)
        return {"matches": matches}

    async def _chunks_for_source(self, db: AsyncSession, source: SourceModel) -> list[ChunkModel]:
        return await crud.chunks_for_source(db, source)

    async def _source_vector(self, db: AsyncSession, source: SourceModel) -> list[float]:
        chunks: list[ChunkModel] = await self._chunks_for_source(db, source)
        if not chunks:
            return [0.0] * self.dimensions

        vector = [0.0] * self.dimensions
        for chunk in chunks:
            for index, value in enumerate(chunk.vector[: self.dimensions]):
                vector[index] += value
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]

    async def _source_vectors(self, db: AsyncSession, user_id: str) -> dict[str, list[float]]:
        sources: list[SourceModel] = await crud.list_sources_by_user_id(db, user_id)
        vectors: list[list[float]] = []
        for source in sources:
            vector = await self._source_vector(db, source)
            vectors.append(vector)
        return {source.id: vector for source, vector in zip(sources, vectors)}

    def _source_point(self, source: SourceModel, projection: dict[str, float]) -> dict[str, Any]:
        return {
            "id": source.id,
            "source_id": source.id,
            "title": source.title,
            "modality": source.modality,
            "projection": projection,
            "color": MODALITY_COLORS.get(source.modality, "#94a3b8"),
            "preview": source.summary,
        }

    async def snapshot(self, db: AsyncSession, user_id: str, projections: dict[str, dict[str, float]] | None = None) -> dict[str, Any]:
        source_vectors = await self._source_vectors(db, user_id)
        projection_map = projections or self._pca_projection(source_vectors)
        sources: list[SourceModel] = await crud.list_sources_by_user_id(db, user_id)
        points = [
            self._source_point(source, projection_map.get(source.id, {"x": 0.0, "y": 0.0, "z": 0.0}))
            for source in sources
        ]
        return {
            "sources": [SourceOut.model_validate(source) for source in sources],
            "points": points,
            "events": self.events,
            "provider": self.embedding_provider,
            "dimensions": self.dimensions,
            "model": EMBED_MODEL,
            "projection": {
                "method": "pca_3d",
                "basis": "当前资料向量，提问时会一并包含查询向量",
            },
        }

    async def retrieval_tool(self, db: AsyncSession, user_id: str, query: str, top_k: int = 5) -> dict[str, Any]:
        results = await self.search(db, user_id, query, top_k=top_k)
        return self.retrieval_payload(results)

    def retrieval_payload(self, results: dict[str, Any]) -> dict[str, Any]:
        return {
            "provider": self.embedding_provider,
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

    async def space_tool(self, db: AsyncSession, user_id: str) -> dict[str, Any]:
        space = await crud.space_stats(db, user_id)
        return {
            "sources": space["sources"],
            "chunks": space["chunks"],
            "dimensions": self.dimensions,
            "provider": self.embedding_provider,
            "modalities": space["modalities"],
            "chunk_modalities": space["chunk_modalities"],
            "projection": "pca_3d",
        }

    @staticmethod
    def _modality_from_mime(mime_type: str) -> str:
        if mime_type == "application/pdf":
            return "pdf"
        if mime_type.startswith("image/"):
            return "image"
        if mime_type.startswith("audio/"):
            return "audio"
        if mime_type.startswith("video/"):
            return "video"
        return "text"

    @staticmethod
    def _suffix_from_mime(mime_type: str) -> str:
        if mime_type == "application/pdf":
            return ".pdf"
        if mime_type.startswith("image/"):
            return f".{mime_type.split('/', 1)[1].split(';', 1)[0]}"
        if mime_type.startswith("audio/"):
            return ".mp3"
        if mime_type.startswith("video/"):
            return ".mp4"
        return ".bin"
