from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from pathlib import Path
import os, re, json, secrets
from .core import *
router=APIRouter()

@router.post('/api/assets')
async def asset(product_id:Optional[int]=None,file:UploadFile=File(...),u=Depends(admin)):
    ext=Path(file.filename or '').suffix.lower()
    if ext not in {'.glb','.gltf','.obj'}: raise HTTPException(415,'Upload a GLB, GLTF, or OBJ asset')
    raw=await file.read()
    if len(raw)>50*1024*1024: raise HTTPException(413,'Asset exceeds 50 MB')
    safe=f'{secrets.token_hex(12)}{ext}'; path=UPLOADS/safe; path.write_bytes(raw)
    with db() as c:
        cur=c.execute('INSERT INTO assets(product_id,filename,path,created) VALUES(?,?,?,?)',(product_id,file.filename,path.name,now())); return {'id':cur.lastrowid,'filename':file.filename,'url':'/uploads/'+path.name}
@router.get('/api/assets')
def assets():
    with db() as c: return [dict(r) for r in c.execute('SELECT id,product_id,filename,path,created FROM assets ORDER BY id DESC')]
@router.get('/uploads/{name}')
def get_upload(name:str):
    p=UPLOADS/Path(name).name
    if not p.is_file(): raise HTTPException(404,'Asset not found')
    return FileResponse(p)

