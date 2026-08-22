from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError

import crud
from database import get_db
from dependencies import get_current_user
from schemas import ShelfRenameRequest, ShelfRequest, ShelfResponse


router = APIRouter(prefix="/shelves", tags=["书架"])

@router.post("")
async def create_shelf(req: ShelfRequest, db=Depends(get_db), user=Depends(get_current_user)):
    try:
        shelf = await crud.create_shelf(db=db, user_id=user.id, name=req.name)
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(400, detail="书架已存在") from e
    await db.commit()
    return ShelfResponse.model_validate(shelf)

@router.get("")
async def get_shelves(db=Depends(get_db), user=Depends(get_current_user)):
    shelves = await crud.list_shelves_by_user_id(db=db, user_id=user.id)
    return [ShelfResponse.model_validate(shelf) for shelf in shelves]

@router.patch("/{shelf_id}")
async def rename_shelf(shelf_id: str, req: ShelfRenameRequest, db=Depends(get_db), user=Depends(get_current_user)):
    shelf = await crud.get_shelf(db=db, shelf_id=shelf_id)
    if not shelf:
        raise HTTPException(404, detail="书架不存在")
    if shelf.user_id != user.id:
        raise HTTPException(403, detail="无权修改")
    try:
        await crud.rename_shelf(db=db, shelf=shelf, name=req.name)
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(400, detail="书架名称已存在") from e
    await db.commit()
    return ShelfResponse.model_validate(shelf)

@router.delete("/{shelf_id}")
async def delete_shelf(shelf_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    shelf = await crud.get_shelf(db=db, shelf_id=shelf_id)
    if not shelf:
        raise HTTPException(404, detail="书架不存在")
    if shelf.user_id != user.id:
        raise HTTPException(403, detail="无权修改")
    await crud.delete_shelf(db=db, shelf=shelf)
    return {"deleted": f"<{shelf_id}>"}

