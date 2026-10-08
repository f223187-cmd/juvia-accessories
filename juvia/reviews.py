from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from pathlib import Path
import os, re, json, secrets
from .core import *
router=APIRouter()

@router.post('/api/products/{pid}/reviews')
def review(pid:int,x:ReviewIn,u=Depends(current)):
    with db() as c:
        if not c.execute('SELECT id FROM products WHERE id=?',(pid,)).fetchone(): raise HTTPException(404,'Product not found')
        try: cur=c.execute('INSERT INTO reviews(product_id,user_id,rating,text,created) VALUES(?,?,?,?,?)',(pid,u['id'],x.rating,x.text,now()))
        except sqlite3.IntegrityError: raise HTTPException(409,'You have already reviewed this product')
        row=c.execute('SELECT * FROM reviews WHERE id=?',(cur.lastrowid,)).fetchone()
    log(u,'review',f'product:{pid}'); return dict(row)
@router.get('/api/products/{pid}/reviews')
def reviews(pid:int):
    with db() as c: return [dict(r) for r in c.execute('SELECT r.*,u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE product_id=? ORDER BY r.id DESC',(pid,))]

