import os
from dotenv import load_dotenv
import asyncio
import httpx
from langchain_core.documents import Document

load_dotenv()

BATCH_SIZE = 20
async def get_bge_m3_embeddings(documents: list[Document], batch_size: int = BATCH_SIZE):
    "只支持dense向量"
    url = "https://api.siliconflow.cn/v1/embeddings"
    api_key = os.getenv("SILICONFLOW_API_KEY")
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    
    for i in range(0, len(documents), batch_size):
        batch = [doc for doc in documents[i: i + batch_size]]
        batch_texts = [doc.page_content for doc in batch]
        payload = {
            "model": "BAAI/bge-m3",
            "input": batch_texts,                 
            "encoding_format": "float",     
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

        items = sorted(data["data"], key=lambda x: x["index"])
        vectors = [item["embedding"] for item in items]
        for j, doc in enumerate(batch):
            doc.metadata["dense"] = vectors[j]
            doc.metadata["sparse"] = None
            doc.metadata["colbert"] = None
    return documents

