from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from pathlib import Path
import os, re, json, secrets
import struct
from .core import *
router=APIRouter()

@router.post('/api/assets')
async def asset(product_id:Optional[int]=None,file:UploadFile=File(...),u=Depends(admin)):
    ext=Path(file.filename or '').suffix.lower()
    if ext!='.glb': raise HTTPException(415,'Upload a self-contained GLB asset for virtual try-on')
    if product_id is not None:
        with db() as c:
            if not c.execute('SELECT id FROM products WHERE id=?',(product_id,)).fetchone(): raise HTTPException(404,'Product not found')
    raw=await file.read(50*1024*1024+1)
    if not raw: raise HTTPException(400,'Asset file is empty')
    if len(raw)>50*1024*1024: raise HTTPException(413,'Asset exceeds 50 MB')
    if len(raw)<12 or raw[:4]!=b'glTF' or struct.unpack_from('<I',raw,4)[0]!=2 or struct.unpack_from('<I',raw,8)[0]!=len(raw):
        raise HTTPException(400,'File is not a valid GLB 2.0 asset')
    safe=f'{secrets.token_hex(12)}{ext}'; path=UPLOADS/safe; path.write_bytes(raw)
    with db() as c:
        cur=c.execute('INSERT INTO assets(product_id,filename,path,created) VALUES(?,?,?,?)',(product_id,file.filename,path.name,now())); return {'id':cur.lastrowid,'filename':file.filename,'url':'/uploads/'+path.name}
@router.post('/api/product-images')
async def product_image(file:UploadFile=File(...),u=Depends(admin)):
    ext=Path(file.filename or '').suffix.lower(); allowed={'.jpg','.jpeg','.png','.webp'}
    if ext not in allowed or file.content_type not in {'image/jpeg','image/png','image/webp'}: raise HTTPException(415,'Upload a JPG, PNG, or WebP image')
    raw=await file.read(10*1024*1024+1)
    if not raw: raise HTTPException(400,'Image file is empty')
    if len(raw)>10*1024*1024: raise HTTPException(413,'Image exceeds 10 MB')
    name=f'{secrets.token_hex(12)}{ext}';(UPLOADS/name).write_bytes(raw)
    return {'filename':file.filename,'url':'/uploads/'+name}
@router.get('/api/assets')
def assets(u=Depends(admin)):
    with db() as c: return [dict(r) for r in c.execute('SELECT id,product_id,filename,path,created FROM assets ORDER BY id DESC')]
@router.get('/api/products/{pid}/asset')
def product_asset(pid:int):
    with db() as c:
        product=c.execute('SELECT published FROM products WHERE id=?',(pid,)).fetchone()
        if not product or not product['published']: raise HTTPException(404,'Product asset not found')
        asset=c.execute("SELECT filename,path FROM assets WHERE product_id=? AND lower(filename) LIKE '%.glb' ORDER BY id DESC LIMIT 1",(pid,)).fetchone()
    if not asset: raise HTTPException(404,'Product asset not found')
    return {'filename':asset['filename'],'url':'/uploads/'+Path(asset['path']).name}
@router.get('/uploads/{name}')
def get_upload(name:str):
    p=UPLOADS/Path(name).name
    if not p.is_file(): p=ROOT/'web'/'assets'/'models'/Path(name).name
    if not p.is_file(): raise HTTPException(404,'Asset not found')
    return FileResponse(p)

