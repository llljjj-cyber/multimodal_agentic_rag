import uuid
from datetime import datetime
from typing import Any, Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func # Text 是一个可变长度的文本字段，没有长度限制（不像 String(255)那样有最大字符数），适合存储较长的内容
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

DEFAULT_DIMENSIONS = 768


def new_id() -> str:
  return uuid.uuid4().hex[:10]

class UserModel(Base):
  __tablename__ = "users"

  id: Mapped[str] = mapped_column(String(16), primary_key=True, default=new_id)
  username: Mapped[str] = mapped_column(String(12), nullable=False, unique= True)
  hashed_password: Mapped[str] = mapped_column(String(200), nullable=False)

  sources: Mapped[list["SourceModel"]] = relationship(
    back_populates="user",
    cascade="all, delete-orphan",
  )
  conversations: Mapped[list["ConversationModel"]] = relationship(
    back_populates="user",
    cascade="all, delete-orphan",
  )


class SourceModel(Base):
  """对应 rag_store.RackSource"""
  __tablename__ = "sources"

  id: Mapped[str] = mapped_column(String(16), primary_key=True, default=new_id)
  user_id: Mapped[str] = mapped_column(String(16), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
  title: Mapped[str] = mapped_column(String(255), nullable=False)
  modality: Mapped[str] = mapped_column(String(32), nullable=False)  # text/url/pdf/image/audio/video
  summary: Mapped[str] = mapped_column(Text, default="")
  file_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
  metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

  user: Mapped["UserModel"] = relationship(back_populates="sources")
  chunks: Mapped[list["ChunkModel"]] = relationship(
    back_populates="source",
    cascade="all, delete-orphan",
  )

  @property
  def chunk_count(self) -> int:
    return len(self.chunks)


class ChunkModel(Base):
  """对应 rag_store.RackChunk"""
  __tablename__ = "chunks"

  id: Mapped[str] = mapped_column(String(32), primary_key=True)
  source_id: Mapped[str] = mapped_column(
    String(16),
    ForeignKey("sources.id", ondelete="CASCADE"),
    nullable=False,
    index=True,
  )
  title: Mapped[str] = mapped_column(String(255), nullable=False)
  modality: Mapped[str] = mapped_column(String(32), nullable=False)
  chunk_index: Mapped[int] = mapped_column(Integer, default=1)
  text: Mapped[str] = mapped_column(Text, nullable=False)
  vector: Mapped[list[float]] = mapped_column(Vector(DEFAULT_DIMENSIONS), nullable=False)
  metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

  source: Mapped["SourceModel"] = relationship(back_populates="chunks")


class MessageModel(Base):
  __tablename__ = "messages"

  id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
  conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
  role: Mapped[str] = mapped_column(String(20))
  content: Mapped[str] = mapped_column(String(4000))
  created_at:Mapped[datetime] = mapped_column(
      DateTime(timezone=True), server_default=func.now()
  ) 
  
  conversation: Mapped["ConversationModel"] = relationship(back_populates="messages")


class ConversationModel(Base):
  __tablename__ = "conversations"

  id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
  user_id: Mapped[str] = mapped_column(String(16), ForeignKey("users.id", ondelete="CASCADE"),index=True)
  adk_session_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
  title: Mapped[str] = mapped_column(String(100), default="新对话")
  created_at: Mapped[datetime] = mapped_column(
      DateTime(timezone=True), server_default=func.now()
      )
  
  messages: Mapped[list["MessageModel"]] = relationship(back_populates="conversation", cascade="all, delete-orphan")
  user: Mapped["UserModel"] = relationship(back_populates="conversations")
