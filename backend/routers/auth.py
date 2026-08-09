from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

import crud
from database import get_db
from schemas import User, UserCreate, Token
from security import verify_password, create_access_token, hash_password

router = APIRouter(prefix="/auth", tags=["认证"])


@router.post("/register", response_model=User, status_code=201)
async def create_user(user: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await crud.get_user_by_username(db, user.username)
    if existing is not None:
        raise HTTPException(status_code=400, detail=f"用户{user.username}已存在")
    return await crud.create_user(db, user.username, hash_password(user.password))

@router.post("/login", response_model=Token)
async def login(user: UserCreate, db: AsyncSession = Depends(get_db)) -> Token:
    result = await crud.get_user_by_username(db, user.username)
    if result is None or not verify_password(user.password, result.hashed_password):
        raise HTTPException(status_code=401, detail="账户或密码错误")
    token = create_access_token(data={"sub": result.username})
    return Token(access_token=token)
   
