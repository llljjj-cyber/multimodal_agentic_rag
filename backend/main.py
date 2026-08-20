import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession

load_dotenv()

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware


from database import get_db, init_db
from schemas import User
from routers.auth import router as auth_router
from routers.sources import router as sources_router
from routers.conversations import router as conversation_router
from routers.chat import router as chat_router
from dependencies import get_current_user
from services.rag.space import snapshot


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
    for origin in os.getenv("ALLOWED_ORIGINS").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}

    
@app.get("/space")
async def space(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)):
    return await snapshot(db, user.id)


app.include_router(auth_router)
app.include_router(sources_router)
app.include_router(conversation_router)
app.include_router(chat_router)

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8897"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)