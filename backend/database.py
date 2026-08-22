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
    from models import ChunkModel, SourceModel, UserModel, ConversationModel, MessageModel, ParentDocModel, ShelfModel # noqa: F401

    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
        # 数据库中表的更新
        await conn.execute(
            text(
                """
                ALTER TABLE sources
                ADD COLUMN IF NOT EXISTS shelf_id VARCHAR(16)
                """
            )
        )
        await conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'fk_sources_shelf_id'
                    ) THEN
                        ALTER TABLE sources
                        ADD CONSTRAINT fk_sources_shelf_id
                        FOREIGN KEY (shelf_id) REFERENCES shelves (id) ON DELETE SET NULL;
                    END IF;
                END $$;
                """
            )
        )
        await conn.execute(
            text(
                """
                ALTER TABLE sources
                ADD COLUMN IF NOT EXISTS chunk_count INTEGER DEFAULT 0 NOT NULL
                """
            )
        )
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