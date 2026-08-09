import asyncio

import crud
from app_state import RAG_STORE
from database import get_db


async def main():
    async for db in get_db():
        user = await crud.get_user_by_username(db, "learning 1")
        if user is None:
            print("用户不存在: learning 1")
            return
        result = await RAG_STORE.search_chunks(db, user.id, query="agent 是什么")
        print(result)


asyncio.run(main())
