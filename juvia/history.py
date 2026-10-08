from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from pathlib import Path
import os, re, json, secrets
from .core import *
router=APIRouter()

@router.get('/api/history')
def history(u=Depends(current)):
    with db() as c: return [dict(r) for r in c.execute('SELECT kind,detail,created FROM interactions WHERE user_id=? ORDER BY id DESC LIMIT 100',(u['id'],))]

