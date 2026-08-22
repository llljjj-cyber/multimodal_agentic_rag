
import ipaddress
import os
from pathlib import Path
import socket
from urllib.parse import urlparse
import uuid

from fastapi.responses import FileResponse
import httpx
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession

from services.rag import store

load_dotenv()
from bs4 import BeautifulSoup
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Depends
from starlette.concurrency import run_in_threadpool

from services.rag.space import snapshot as get_space_snapshot
from database import get_db
import crud
from schemas import SourceMoveToShelfRequest, SourceOut, SourceRenameRequest, TextSourceRequest, UrlSourceRequest, User
from dependencies import get_current_user


ALLOWED_SUFFIX = {".pdf", ".md", ".txt"}

def _extract_text_from_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    return " ".join(soup.get_text(" ").split())


def _validate_fetch_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("仅支持 HTTP 与 HTTPS 网址。")

    if os.getenv("ALLOW_PRIVATE_URLS", "").lower() == "true":
        return

    if parsed.hostname.lower() == "localhost":
        raise ValueError("默认禁止抓取 localhost 与内网地址。")

    try:
        address_info = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as exc:
        raise ValueError(f"无法解析网址主机：{parsed.hostname}") from exc

    for item in address_info:
        address = ipaddress.ip_address(item[4][0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
            raise ValueError("默认禁止抓取 localhost 与内网地址。")

router = APIRouter(prefix="/sources",tags=["资源管理"])


@router.post("/text")
async def add_text_source(
    req: TextSourceRequest, 
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)):
    try:
        source = await store.add_text_source(db, user.id, req.title, req.text, req.modality)
        if req.shelf_id:
            await crud.move_source_to_shelf(db, source, req.shelf_id)
        space = await get_space_snapshot(db, user.id)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"source": SourceOut.model_validate(source), "space": space}


@router.post("/url")
async def add_url_source(
    req: UrlSourceRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
    ):
    try:
        url = str(req.url)
        await run_in_threadpool(_validate_fetch_url, url)
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
        text = _extract_text_from_html(response.text)
        title = req.title or url.replace("https://", "").replace("http://", "")[:80]
        source = await store.add_text_source(db, user.id, title, text[:12000], "url")
        if req.shelf_id:
            await crud.move_source_to_shelf(db, source, req.shelf_id)
        space = await get_space_snapshot(db, user.id)
    except Exception as exc:
        raise HTTPException(400, f"无法入库该网址：{exc}") from exc
    return {"source": SourceOut.model_validate(source), "space": space}


@router.post("/file")
async def add_file_source(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    file: UploadFile = File(...),
    title: str | None = Form(None),
    shelf_id: str | None = Form(None),
):
    suffix = Path(file.filename or "").suffix.lower()
    title = title or file.filename or ""
    if suffix not in ALLOWED_SUFFIX:
        raise HTTPException(400, f"仅支持 {', '.join(ALLOWED_SUFFIX)}")
    
    upload_dir = Path(__file__).resolve().parent.parent / "services" / "rag" / "tempo" / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid.uuid4().hex}{suffix}"
    saved_path = upload_dir / safe_name

    try:
        content = await file.read()
        if not content:
            raise HTTPException(400, "文件为空")
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(400, "文件大小上限为 50 MB，请上传更小的文件。")
        saved_path.write_bytes(content)
        modality = suffix[1:]  # pdf / md / txt
        source = await store.add_file_source(
            db, user.id, str(saved_path), modality=modality, title=title
        )
        if shelf_id:
            await crud.move_source_to_shelf(db, source, shelf_id)   
        space = await get_space_snapshot(db, user.id)
    except Exception as exc:
        Path(saved_path).unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from exc
    
    return {"source": SourceOut.model_validate(source), "space": space}


@router.get("/{source_id}")
async def get_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    source = await store.get_source(db, user.id, source_id)
    if not source:
        raise HTTPException(404, "未找到该资料。")
    return {"source": SourceOut.model_validate(source)}


@router.get("/{source_id}/file")
async def get_source_file(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    source = await store.get_source(db, user.id, source_id)
    if not source:
        raise HTTPException(404, "未找到该资料。")
    if source.modality not in ["pdf", "md", "txt"]:
        raise HTTPException(400, "不支持该类型文件。")
    if not source.saved_path:
        raise HTTPException(404, "未找到该文件路径。")
    if not Path(source.saved_path).exists():
        raise HTTPException(404, "未找到该文件。")
    ext = Path(source.saved_path).suffix
    filename = f"{source.title}{ext}"
    media_type = "text/markdown" if ext == ".md" else "application/pdf" if ext == ".pdf" else "text/plain"
    return FileResponse(source.saved_path, filename=filename, media_type=media_type)

@router.patch("/{source_id}/title")
async def rename_source(
    source_id: str,
    req: SourceRenameRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    source = await store.get_source(db, user.id, source_id)
    if not source:
        raise HTTPException(404, "未找到该资料。")
    source = await crud.update_source_title(db, source, req.title)
    space = await get_space_snapshot(db, user.id)
    return {"source": SourceOut.model_validate(source), "space": space}

@router.patch("/{source_id}/shelf")
async def move_source_to_shelf(
    source_id: str,
    req: SourceMoveToShelfRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    source = await store.get_source(db, user.id, source_id)
    if not source:
        raise HTTPException(404, "未找到该资料。")
    if source.user_id != user.id:
        raise HTTPException(403, "无权修改")
    await crud.move_source_to_shelf(db, source, req.shelf_id)
    space = await get_space_snapshot(db, user.id)
    return {"source": SourceOut.model_validate(source), "space": space}

@router.delete("/{source_id}")
async def delete_source(
    source_id: str, 
    db: AsyncSession=Depends(get_db),
    user: User=Depends(get_current_user)):
    source = await store.get_source(db, user.id, source_id)
    if not source:
        raise HTTPException(404, "未找到该资料。")
    if source.saved_path:
        Path(source.saved_path).unlink(missing_ok=True)
    removed = await store.remove_source(db, user.id, source_id)
    if not removed:
        raise HTTPException(404, "未找到该资料。")
    space = await get_space_snapshot(db, user.id)
    return {"deleted": source_id, "space": space}
