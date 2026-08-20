import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

import crud
from database import get_db
from dependencies import get_current_user
from models import ConversationModel
from schemas import ChatRequest, User
from services.agentic_rag_agent.agent_runtime import (
    _event_text,
    build_runner,
    ensure_adk_session,
    stream_agent,
)


router = APIRouter(prefix="/chat", tags=["聊天"])


async def _prepare_chat(
    body: ChatRequest,
    db: AsyncSession,
    user: User,
) -> ConversationModel:
    if body.conv_id is None:
        raw = body.message.strip().replace("\n", " ")
        raw = body.message if body.message else "新会话"
        conv = await crud.create_conversation(db, user_id=user.id, title=raw[:20] + '...' if len(raw) > 20 else raw)
    else:
        conv = await crud.get_conversation(db, body.conv_id)
        if conv is None:
            raise HTTPException(status_code=404, detail="会话不存在")
        if conv.user_id != user.id:
            raise HTTPException(status_code=403, detail="无权访问该会话")

    await crud.create_message(db, conv_id=conv.id, role="user", content=body.message)
    return conv


@router.post("/stream")
async def stream_chat(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = await _prepare_chat(body, db, user)

    async def event_generator():
        yield f"data: {json.dumps({'conv_id': conv.id}, ensure_ascii=False)}\n\n"

        session = await ensure_adk_session(user.id, conv.adk_session_id)
        if conv.adk_session_id != session.id:
            await crud.update_conversation_session(db, conv, session.id)

        runner, _state = build_runner(db, user.id)

        parts: list[str] = []
        saw_partial = False
        final_text = ""

        async for event in stream_agent(
            runner=runner,
            user_id=user.id,
            session_id=session.id,
            question=body.message,
            streaming=True,
        ):
            text = _event_text(event)
            if not text:
                continue

            if getattr(event, "partial", False):
                saw_partial = True
                parts.append(text)
                yield f"data: {text}\n\n"

            else:
                final_text = text
                if not saw_partial:
                    parts.append(text)
                    yield f"data: {text}\n\n"

        reply = final_text or "".join(parts)
        if reply:
            await crud.create_message(
                db, conv_id=conv.id, role="assistant", content=reply
            )
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")