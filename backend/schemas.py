from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

class TextSourceRequest(BaseModel):
    title: str
    text: str
    modality: Literal["text"] = "text"


class UrlSourceRequest(BaseModel):
    url: HttpUrl
    title: Optional[str] = None


class AskRequest(BaseModel):
    question: str
    session_id: str | None = None
    top_k: int = Field(6, ge=1, le=12)


class UserCreate(BaseModel):
    """创建用户：需要用户名和密码"""

    username: str = Field(..., min_length=1, max_length=12, examples=["ljlkjj"])
    password: str = Field(..., min_length=6, max_length=12, examples=["SIUDUJODFHJ"])

class User(BaseModel):
    """返回给客户端用户信息"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str

class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    modality: str
    summary: str
    file_path: str | None
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias="metadata_",
    )
    created_at: datetime

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"