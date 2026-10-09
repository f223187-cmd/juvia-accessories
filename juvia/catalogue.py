from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from pathlib import Path
import os, re, json, secrets
from .core import *
router=APIRouter()

@router.get('/api/products')
def products(category:Optional[str]=None,q:Optional[str]=None):
    if category: validate_category(category)
    sql='SELECT * FROM products'; args=[]; clauses=['published=1']
    if category: clauses.append('category=?'); args.append(category)
    if q: clauses.append('(name LIKE ? OR description LIKE ?)'); args.extend([f'%{q}%',f'%{q}%'])
    if clauses: sql+=' WHERE '+' AND '.join(clauses)
    sql+=' ORDER BY id DESC'
    with db() as c: return [dict(r) for r in c.execute(sql,args)]
@router.get('/api/admin/products')
def admin_products(u=Depends(admin)):
    with db() as c: return [dict(r) for r in c.execute('SELECT * FROM products ORDER BY id DESC')]
@router.post('/api/products')
def add_product(x:ProductIn,u=Depends(admin)):
    validate_category(x.category)
    with db() as c:
        cur=c.execute('INSERT INTO products(name,category,price,description,image,source,created,published) VALUES(?,?,?,?,?,?,?,?)',(x.name,x.category,x.price,x.description,x.image,x.source,now(),int(x.published))); r=c.execute('SELECT * FROM products WHERE id=?',(cur.lastrowid,)).fetchone()
    return dict(r)
@router.patch('/api/products/{pid}')
def update_product(pid:int,x:ProductIn,u=Depends(admin)):
    validate_category(x.category)
    with db() as c:
        if not c.execute('SELECT id FROM products WHERE id=?',(pid,)).fetchone(): raise HTTPException(404,'Product not found')
        c.execute('UPDATE products SET name=?,category=?,price=?,description=?,image=?,source=?,published=? WHERE id=?',(x.name,x.category,x.price,x.description,x.image,x.source,int(x.published),pid)); return dict(c.execute('SELECT * FROM products WHERE id=?',(pid,)).fetchone())
@router.delete('/api/products/{pid}')
def delete_product(pid:int,u=Depends(admin)):
    with db() as c: c.execute('DELETE FROM products WHERE id=?',(pid,))
    return {'deleted':True}

