import os
from typing import Any

from FlagEmbedding import BGEM3FlagModel
from langchain_core.documents import Document
from dotenv import load_dotenv


load_dotenv()


_model = None

def get_model():
    global _model
    if _model is None:
        _model = BGEM3FlagModel(os.getenv("BGE_MODEL_PATH"),  use_fp16=False)
    return _model

def _doc_embedding(
    documents: list[Document], 
    model: BGEM3FlagModel | None = None,
    batch_size: int = 16, 
    dense: bool = True, 
    sparse: bool = True, 
    colbert: bool = True
    ) -> list[Document]:
    if model is None:
        model = get_model()

    for i in range(0, len(documents), batch_size):
        batch = documents[i: i + batch_size]
        embeddings = model.encode(
            [doc.page_content for doc in batch],
            batch_size=batch_size,
            max_length=2000,
            return_dense=dense,
            return_sparse=sparse,
            return_colbert_vecs=colbert)
        for j, doc in enumerate(batch):
            if dense:
                doc.metadata["dense"] = embeddings["dense_vecs"][j].tolist()
            if sparse:
                doc.metadata["sparse"] = embeddings["lexical_weights"][j]
            if colbert:
                doc.metadata["colbert"] = embeddings["colbert_vecs"][j]
    return documents

def _text_embedding(
    text: str, 
    model: BGEM3FlagModel | None = None, 
    dense: bool = True, 
    sparse: bool = True, 
    colbert: bool = True
    ) -> dict[str, list[float] | None]:
    if model is None:
        model = get_model()
    result = model.encode(
        text, 
        return_dense=dense, 
        return_sparse=sparse, 
        return_colbert_vecs=colbert
        )
    vec = result["dense_vecs"]
    if hasattr(vec, "ndim") and vec.ndim == 2:
        vec = vec[0]
    return {
        "dense": vec.tolist() if dense else None,
        "sparse": result["lexical_weights"] if sparse else None,
        "colbert": result["colbert_vecs"].tolist() if colbert else None
    }