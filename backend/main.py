import os
from contextlib import asynccontextmanager
from typing import Any


from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession


load_dotenv()
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from google.genai import types as genai_types

from app_state import RAG_STORE
from database import get_db, init_db
from schemas import AskRequest, User
from routers.auth import router as auth_router
from routers.sources import router as sources_router
from dependencies import get_current_user

SETUP_ERROR = ""

try:
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from agentic_rag_agent.agent import build_agent

    ADK_AVAILABLE = bool(os.getenv("GOOGLE_API_KEY"))
except Exception:
    Runner = None
    InMemorySessionService = None
    build_agent = None
    ADK_AVAILABLE = False
    SETUP_ERROR = "无法导入 Google ADK。请安装 backend 依赖并设置 GOOGLE_API_KEY。"

if not os.getenv("GOOGLE_API_KEY"):
    SETUP_ERROR = "Gemini Embedding 2 与 ADK 回答流程需要设置 GOOGLE_API_KEY。"


APP_NAME = "multimodal_agentic_rag"
SESSION_SERVICE = InMemorySessionService()

@asynccontextmanager
async def lifespan(app: FastAPI) -> None:
    await init_db()
    yield

app = FastAPI(
    title="个人资料助手 · 多模态 Agentic RAG",
    version="0.1.0",
    lifespan=lifespan)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5177,http://127.0.0.1:5177").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _event_text(event: Any) -> str:
    if not getattr(event, "content", None) or not event.content.parts:
        return ""
    fragments = []
    for part in event.content.parts:
        text = getattr(part, "text", None)
        if text:
            fragments.append(text)
    return "".join(fragments)

async def _run_adk_agent(
    question: str, 
    db: AsyncSession,
    user_id: str,
    session_id: str | None = None,
    top_k: int = 6) -> tuple[str, str, dict[str, Any] | None, list[dict]]:
    """Agent 自己调工具；返回（回答，最后一次检索结果）。"""
    if not ADK_AVAILABLE:
        raise HTTPException(503, SETUP_ERROR or "Google ADK 不可用。")
    
    last_retrieval: dict[str, Any] | None = None
    trace: list[dict] = []

    async def retrieve_relevant_context(query: str, top_k: int = top_k) -> dict:
        nonlocal last_retrieval # 内层函数如果对外层变量名做 赋值（=），默认会当成新的局部变量，不会去改外层的那个名字。
        results = await RAG_STORE.search(db, user_id, query, top_k) # 闭包 ？
        last_retrieval = results
        trace.append({
            "agent": "检索工具",
            "status": "complete",
            "detail": f"已检索到 {len(results['matches'])} 条资料（query={query!r}）",
        })
        return RAG_STORE.retrieval_payload(results)

    async def inspect_embedding_space() -> dict:
        space = await RAG_STORE.space_tool(db, user_id)
        trace.append(({
            "agent": "空间检查",
            "status": "complete",
            "detail": (
                f"{space['sources']} 份资料，{space['chunks']} 个分块，"
                f"{space['dimensions']} 维"
            ),
        }))
        return space 

    request_agent = build_agent(
        [retrieve_relevant_context, inspect_embedding_space]
    )
    if SESSION_SERVICE is None:
        raise HTTPException(503, "SessionService 未初始化")
    
    if session_id:
        session = await SESSION_SERVICE.get_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=session_id
        )
        if session is None:
            raise HTTPException(404, "会话不存在或无权访问")
    else:
        session = await SESSION_SERVICE.create_session(
            app_name=APP_NAME,
            user_id=user_id
        )
    request_runner = Runner(
        agent=request_agent,
        app_name=APP_NAME,
        session_service=SESSION_SERVICE,
    )
    content = genai_types.Content(
        role="user",
        parts=[genai_types.Part(text=question)]
    )
    final_text = ""
    async for event in request_runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=content,
    ):
        text = _event_text(event)
        if text:
            final_text = text
    if not final_text.strip():
        raise HTTPException(502, "Agent 未生成有效回答。")
    return final_text, session.id, last_retrieval, trace


@app.get("/space")
async def space(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)):
    return await RAG_STORE.snapshot(db, user.id)


@app.post("/ask")
async def ask(
    req: AskRequest, 
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)):
    if not req.question.strip():
        raise HTTPException(400, "问题不能为空。")

    answer, session_id, retrieval, trace = await _run_adk_agent(
    question=req.question.strip(),
    db=db,
    user_id=user.id,
    session_id=req.session_id,
    top_k=req.top_k,
    )
    retrieval = retrieval or {}
    trace.append({
    "agent": "回答合成",
    "status": "complete",
    "detail": "已生成有依据的回答；引用在界面单独展示",
})
    return {
        "answer": answer,
        "matches": retrieval.get("matches", []),
        "session_id": session_id,
        "query_point": retrieval.get("query_point"),
        "trace": trace,
        "space": retrieval.get("space")
    }

app.include_router(auth_router)
app.include_router(sources_router)

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8897"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)