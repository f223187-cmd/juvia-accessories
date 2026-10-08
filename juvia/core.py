import os, re, json, time, hmac, hashlib, sqlite3, secrets, base64
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from fastapi import HTTPException, Depends, Header
from pydantic import BaseModel, Field
ROOT=Path(__file__).resolve().parent.parent
RUNTIME=Path('/tmp') if os.getenv('VERCEL') else ROOT
DB=Path(os.getenv('JUVIA_DB_PATH',str(RUNTIME/'juvia.db')))
UPLOADS=Path(os.getenv('JUVIA_UPLOADS_PATH',str(RUNTIME/'uploads'))); UPLOADS.mkdir(parents=True,exist_ok=True)
secret_value=os.getenv('JUVIA_SECRET')
if not secret_value:
    if os.getenv('VERCEL'): raise RuntimeError('Set JUVIA_SECRET in Vercel project environment variables')
    secret_value='local-development-secret-change-before-deploy'
SECRET=secret_value.encode()
CATEGORIES={'watches','bracelets','rings','necklaces'}
def db():
    c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; c.execute('PRAGMA foreign_keys=ON'); return c
def init():
    with db() as c:
        c.executescript('''CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('watches','bracelets','rings','necklaces')), price REAL NOT NULL, description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), text TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(product_id,user_id));
        CREATE TABLE IF NOT EXISTS interactions(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, detail TEXT NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS assets(id INTEGER PRIMARY KEY, product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, filename TEXT NOT NULL, path TEXT NOT NULL, created TEXT NOT NULL);''')
init()
def now(): return datetime.now(timezone.utc).isoformat()
def pw_hash(p,s=None):
    s=s or secrets.token_hex(16); return s+':'+hashlib.pbkdf2_hmac('sha256',p.encode(),s.encode(),180000).hex()
def pw_ok(p,stored):
    try: s,h=stored.split(':'); return hmac.compare_digest(pw_hash(p,s).split(':')[1],h)
    except ValueError: return False
def token(uid):
    payload=base64.urlsafe_b64encode(json.dumps({'uid':uid,'exp':int(time.time())+86400}).encode()).decode().rstrip('='); sig=hmac.new(SECRET,payload.encode(),hashlib.sha256).hexdigest(); return payload+'.'+sig
def current(authorization:Optional[str]=Header(None)):
    if not authorization or not authorization.lower().startswith('bearer '): raise HTTPException(401,'Sign in required')
    try:
        payload,sig=authorization.split()[1].split('.'); expected=hmac.new(SECRET,payload.encode(),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig,expected): raise ValueError()
        d=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
        if d['exp']<time.time(): raise ValueError()
        with db() as c: u=c.execute('SELECT id,email,name,role FROM users WHERE id=?',(d['uid'],)).fetchone()
        if not u: raise ValueError()
        return dict(u)
    except Exception: raise HTTPException(401,'Invalid or expired session')
def admin(u=Depends(current)):
    if u['role']!='admin': raise HTTPException(403,'Administrator access required')
    return u
def log(u,kind,detail):
    with db() as c: c.execute('INSERT INTO interactions(user_id,kind,detail,created) VALUES(?,?,?,?)',(u['id'],kind,detail[:1000],now()))
class Credentials(BaseModel): email:str; password:str=Field(min_length=8); name:str=''
class ProductIn(BaseModel): name:str=Field(min_length=1,max_length=180); category:str; price:float=Field(ge=0); description:str=''; image:str=''; source:str=''
class ReviewIn(BaseModel): rating:int=Field(ge=1,le=5); text:str=Field(min_length=1,max_length=2000)
class ChatIn(BaseModel): message:str=Field(min_length=1,max_length=2000)
class ScrapeIn(BaseModel): urls:list[str]=Field(min_length=1,max_length=20); category:str
def validate_category(cat):
    if cat not in CATEGORIES: raise HTTPException(422,'Category must be watches, bracelets, rings, or necklaces')
