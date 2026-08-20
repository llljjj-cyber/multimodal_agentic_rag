import os
from collections.abc import AsyncGenerator

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine 
from sqlalchemy.orm import DeclarativeBase
from google.adk.sessions import DatabaseSessionService

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

SESSION_SERVICE = DatabaseSessionService(DATABASE_URL)

engine = create_async_engine(DATABASE_URL)
async_session = async_sessionmaker[AsyncSession](engine, class_=AsyncSession, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session

async def init_db() -> None:
    from models import ChunkModel, SourceModel, UserModel, ConversationModel, MessageModel, ParentDocModel  # noqa: F401

    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
        # 数据库中表的更新
        await conn.execute(
            text(
                """
                ALTER TABLE conversations
                ADD COLUMN IF NOT EXISTS adk_session_id VARCHAR(100)
                """
            )
        )
        await conn.execute(
            text(
                """
                ALTER TABLE messages
                ALTER COLUMN content TYPE TEXT
                """
            )
        )
        await conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_conversations_adk_session_id
                ON conversations (adk_session_id)
                """
            )
        )