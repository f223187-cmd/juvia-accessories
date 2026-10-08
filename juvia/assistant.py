from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from pathlib import Path
import os, re, json, secrets
from .core import *
router=APIRouter()

@router.post('/api/chat')
def chat(x:ChatIn,u=Depends(current)):
    terms={t.lower() for t in re.findall(r'[a-zA-Z0-9]+',x.message) if len(t)>2}
    with db() as c: rows=[dict(r) for r in c.execute('SELECT * FROM products ORDER BY id DESC LIMIT 100')]
    ranked=sorted(rows,key=lambda p:len(terms & set(re.findall(r'[a-zA-Z0-9]+',(p['name']+' '+p['description']+' '+p['category']).lower()))),reverse=True)
    hits=[p for p in ranked[:3] if terms & set((p['name']+' '+p['description']+' '+p['category']).lower().split())]
    answer=('Here are a few Juvia accessories that may match: '+ '; '.join(f"{p['name']} ({p['category']}, ${p['price']:.2f})" for p in hits)) if hits else 'I can help you find watches, bracelets, rings, or necklaces. Tell me a category, style, or budget.'
    log(u,'chat',x.message); return {'answer':answer,'products':hits}

