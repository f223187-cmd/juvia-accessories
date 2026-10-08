from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from pathlib import Path
import os, re, json, secrets
from .core import *
router=APIRouter()

@router.post('/api/auth/register')
def register(x:Credentials):
    email=x.email.strip().lower()
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',email): raise HTTPException(422,'Enter a valid email')
    try:
        role='admin' if email==os.getenv('JUVIA_ADMIN_EMAIL','').strip().lower() and os.getenv('JUVIA_ADMIN_EMAIL') else 'customer'
        with db() as c: cur=c.execute('INSERT INTO users(email,name,password,role,created) VALUES(?,?,?,?,?)',(email,x.name.strip() or email.split('@')[0],pw_hash(x.password),role,now())); uid=cur.lastrowid
    except sqlite3.IntegrityError: raise HTTPException(409,'Email already registered')
    with db() as c: u=dict(c.execute('SELECT id,email,name,role FROM users WHERE id=?',(uid,)).fetchone())
    return {'token':token(uid),'user':u}
@router.post('/api/auth/login')
def login(x:Credentials):
    with db() as c: r=c.execute('SELECT * FROM users WHERE email=?',(x.email.strip().lower(),)).fetchone()
    if not r or not pw_ok(x.password,r['password']): raise HTTPException(401,'Email or password is incorrect')
    return {'token':token(r['id']),'user':{'id':r['id'],'email':r['email'],'name':r['name'],'role':r['role']}}
@router.get('/api/auth/me')
def me(u=Depends(current)): return u

