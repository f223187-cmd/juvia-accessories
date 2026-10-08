from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from pathlib import Path
import os, re, json, secrets
from .core import *
router=APIRouter()

@router.get('/api/analytics')
def analytics(u=Depends(admin)):
    with db() as c:
        cat={r['category']:r['n'] for r in c.execute('SELECT category,COUNT(*) n FROM products GROUP BY category')}
        activity={r['kind']:r['n'] for r in c.execute('SELECT kind,COUNT(*) n FROM interactions GROUP BY kind')}
        return {'users':c.execute('SELECT COUNT(*) FROM users').fetchone()[0],'products':c.execute('SELECT COUNT(*) FROM products').fetchone()[0],'reviews':c.execute('SELECT COUNT(*) FROM reviews').fetchone()[0],'products_by_category':{k:cat.get(k,0) for k in sorted(CATEGORIES)},'interactions':activity}

