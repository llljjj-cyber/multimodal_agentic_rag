import os
from pathlib import Path
import re
from typing import Literal
import uuid 

from sqlalchemy.ext.asyncio import AsyncSession

from langchain_core.documents import Document
from langchain_community.document_loaders import UnstructuredMarkdownLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_mineru import MinerULoader
from starlette.concurrency import run_in_threadpool

import crud
from models import SourceModel
from services.rag.embedding import _doc_embedding


CHUNK_SIZE = 600         
CHUNK_OVERLAP = 120       
MIN_CHUNK_CHARS = 30      
PARENT_CATEGORIES = {"Title"}
CHILD_CATEGORIES = {"NarrativeText", "Text", "Table", "ListItem", "UncategorizedText"}
SKIP_PATTERNS = ("Wikipedia",)


# 入库 text 路径
def _normalize_text(text: str) -> str:
  text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
  text = re.sub(r"[ \t]+", " ", text)           # 行内空白
  text = re.sub(r"\n{3,}", "\n\n", text)        # 过多空行
  return text.strip()

_text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    length_function=len,
    separators=["\n\n", "\n", "。", "！", "？", ". ", " ", ""],
    is_separator_regex=False
)

def _chunk_text(text: str) -> list[str]:
    text = _normalize_text(text)
    chunks = _text_splitter.split_text(text)
    return [c.strip() for c in chunks if len(c.strip()) >= MIN_CHUNK_CHARS]

def _text_to_documents(title: str, text: str) -> list[Document]:
    chunks = _chunk_text(text)
    if not chunks:
        raise ValueError("资料文本为空或太短")
    return [
        Document(
            page_content=t,
            metadata={
                "title": title,
                "modality": "text",
                "chunk_index": i+1
            }
        )
        for i , t in enumerate(chunks)
    ]

async def add_text_source(
    db: AsyncSession, 
    user_id: str, 
    title: str, 
    text: str | None = None, 
    modality: str = "text", 
    saved_path: str | None = None,
    file: bool = False, 
    docs: list[Document] | None = None) -> SourceModel:
    if not file:
        docs = await run_in_threadpool(_text_to_documents, title, text)
    try:
        source = await crud.create_source(
            db=db,
            user_id=user_id,
            title=title.strip() or f"{modality.title()} source", # 注意
            modality=modality,
            summary=_normalize_text(text)[:220] if not file else docs[0].page_content[:220] ,
            saved_path=saved_path,
        )

        embed_docs = await run_in_threadpool(_doc_embedding, docs, sparse=False, colbert=False)
        for index, doc in enumerate(embed_docs):
            meta = doc.metadata
            await crud.create_chunk(
                db=db,
                id=f"{source.id}-{index + 1}",
                source_id=source.id,
                text=doc.page_content,
                metadata_={"chunk_index": index + 1},
                title=meta.get("title") or title,
                modality=meta.get("modality") or modality,
                chunk_index=index + 1,
                vector=meta.get("dense")
            )
        await db.commit()
        await db.refresh(source)
    
    except Exception:
        await db.rollback()
        raise
    return source

# 加载 支持 pdf, txt,  md
# 转换为 Markdown 文件
def _pdf_to_md(file_path: str) -> Path:
    loader = MinerULoader(source=file_path, mode="precision", token=os.getenv("MINERU_TOKEN"))
    docs = loader.load()
    tempo = Path(__file__).parent / "tempo" / "md-uploads"
    tempo.mkdir(parents=True, exist_ok=True)
    path = tempo / f"{Path(file_path).stem}_{uuid.uuid4().hex[:8]}.md"
    with open(str(path), "w", encoding="utf-8") as f:
        for doc in docs:
            f.write(f"{doc.page_content}")
    return path

def _normalize_content(doc: Document) -> str:
    """提取元素正文；表格优先用 metadata 里的 HTML。"""
    if doc.metadata.get("category") == "Table":
        html = doc.metadata.get("text_as_html")
        if html:
            return html.strip()
    return (doc.page_content or "").strip()

def _is_noise(text: str) -> bool:
    if not text or len(text) < 2:
        return True
    return any(p in text for p in SKIP_PATTERNS)

def build_parent_child_groups(
    docs: list[Document],
    *,
    parent_categories: set[str] = PARENT_CATEGORIES,
    child_categories: set[str] = CHILD_CATEGORIES
) -> list[dict]:
    """
    把 Unstructured elements 整理成父子组。
    返回格式:
    [
        {
            "parent_id": "...",
            "title": "2023",
            "parent_doc": Document(...),   # 仅标题
            "children": [Document(...), ...],
            "full_text": "2023\n\nIn the 37th annual...",  # 标题+子内容合并
        },
        ...
    ]
    """
    groups: list[dict] = []
    id_to_group: dict[str, dict] = {}

    # 收集所有的父节点
    for doc in docs:
        category = doc.metadata.get("category")
        element_id = doc.metadata.get("element_id")
        if category not in parent_categories or not element_id:
            continue

        title = _normalize_content(doc)
        if _is_noise(title):
            continue

        group = {
            "parent_id": element_id,
            "title": title,
            "parent_doc": doc,
            "children": [],
            "full_text": title,
        }
        groups.append(group)
        id_to_group[element_id] = group
    
    # 再把子元素挂到对应的 parent_id 下
    for doc in docs:
        category = doc.metadata.get("category")
        if category in parent_categories or category == "Image":
            continue
        if category not in child_categories:
            continue

        content = _normalize_content(doc)
        if _is_noise(content):
            continue

        parent_id = doc.metadata.get("parent_id")
        if parent_id and parent_id in id_to_group:
            group = id_to_group[parent_id]
            group["children"].append(doc)
            group["full_text"] += f"\n\n{content}"
            # id_to_group[parent_id] = group # group 是字典，是可变对象
    # 去掉没有子内容的空组
    return [g for g in groups if g["children"]]

def build_parent_child_documents(
    docs: list[Document],
) -> tuple[list[Document], list[Document]]:
    """
    生成可直接入库的父子 Document。
    - parent_docs: 每个 Title 下合并后的完整段落（大块，供回填上下文）
    - child_docs:  每个子元素单独一条（小块，供精细检索）
      child metadata 里带 parent_id / parent_title，方便检索后取 parent
    """
    groups = build_parent_child_groups(docs)
    parent_docs: list[Document] = []
    child_docs: list[Document] = []

    for group in groups:
        parent_id = group["parent_id"]
        title = group["title"]
        source = group["parent_doc"].metadata.get("source")

        parent_docs.append(
            Document(
                page_content=group["full_text"],
                metadata={
                    "doc_type": "parent",
                    "parent_id": parent_id,
                    "title": title,
                    "source": source,
                    "child_count": len(group["children"])
                },
            )
        )

        for i, child in enumerate(group["children"]):
            child_docs.append(
                Document(
                    page_content=_normalize_content(child),
                    metadata={
                        "doc_type": "child",
                        "parent_id": parent_id,
                        "parent_title": title,
                        "source": source,
                        "category": child.metadata.get("category"),
                        "element_id": child.metadata.get("element_id"),
                        "child_index": i
                    },
                )
            )
    return parent_docs, child_docs

def _parent_child_doc_from_md(file_path: str) -> tuple[list[Document], list[Document]]:
    loader = UnstructuredMarkdownLoader(
        file_path=file_path,
        mode="elements"
    )
    docs = loader.load()
    parent_docs, child_docs = build_parent_child_documents(docs)
    return parent_docs, child_docs

def load_txt_file(file_path: str) -> list[Document]:
    loader = TextLoader(file_path=file_path, encoding="utf-8")
    docs = _text_splitter.split_documents(loader.load())
    return docs

# markdown, pdf 文件添加
async def add_file_source(db: AsyncSession, user_id: str, saved_path: str, modality: Literal["md", "pdf", "txt"], title: str | None = None):
    if modality.lower() == "txt":
        docs = await run_in_threadpool(load_txt_file, saved_path) 
        if not docs:
            raise ValueError("文件解析后为空")
        source = await add_text_source(
            db=db,
            user_id=user_id,
            title=title or "未命名", #
            modality="txt",
            file=True,
            docs=docs,
            saved_path=saved_path
        )
    else:
        if modality.lower() == "pdf":
            md_path = str(await run_in_threadpool(_pdf_to_md, saved_path))
        elif modality.lower() == "md":
            md_path = None
        else:
            raise ValueError("不支持该类型文件")
        try:
            parent_docs, child_docs = await run_in_threadpool(
                        _parent_child_doc_from_md,
                        md_path if md_path else saved_path,
                    )
            if not parent_docs or not child_docs:
                raise ValueError("文件解析后为空")

            source = await crud.create_source(
                db=db,
                user_id=user_id,
                title=title or (Path(md_path).stem if md_path else Path(saved_path).stem),
                modality=modality,
                summary=parent_docs[0].page_content[:200],
                saved_path=saved_path,
            )

            for p in parent_docs:
                await crud.create_parent_doc(
                    db=db,
                    id=p.metadata.get("parent_id"),
                    source_id=source.id,
                    title=p.metadata.get("title"),
                    text=p.page_content,
                    child_count=p.metadata.get("child_count"),
                )

            embed_docs = await run_in_threadpool(
                    lambda: _doc_embedding(child_docs, sparse=False, colbert=False)
                )
            for index, doc in enumerate(embed_docs):
                meta = doc.metadata
                await crud.create_chunk(
                    db=db,
                    id=f"{source.id}-{index + 1}",
                    source_id=source.id,
                    parent_id=meta.get("parent_id"),
                    text=doc.page_content,
                    metadata_={"chunk_index": index + 1},
                    title=meta.get("parent_title"),
                    modality=modality,
                    chunk_index=index+1,
                    vector=meta.get("dense")
                )
            await db.commit()
            await db.refresh(source)
        except Exception:
            await db.rollback()
            raise
        finally:
            if md_path:
                Path(md_path).unlink(missing_ok=True)
    return source
            
async def get_source(db: AsyncSession, user_id: str, source_id: str) -> SourceModel | None:
    source = await crud.get_source_by_id(db, source_id)
    if not source or source.user_id != user_id:
        return None
    return source

# 删除 source
async def remove_source(db: AsyncSession, user_id: str, source_id: str) -> bool:
    source = await crud.get_source_by_id(db, source_id)
    if not source or source.user_id != user_id:
        return False
    await crud.delete_source(db, source)
    return True



