import os
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession

load_dotenv()

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware


from app_state import RAG_STORE
from database import get_db, init_db
from schemas import AskRequest, User
from routers.auth import router as auth_router
from routers.sources import router as sources_router
from routers.conversation import router as conversation_router
from routers.chat import router as chat_router
from services.agent_runtime import run_agent_once
from dependencies import get_current_user


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

    answer, session_id, retrieval, trace = await run_agent_once(
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
app.include_router(conversation_router)
app.include_router(chat_router)

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8897"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)