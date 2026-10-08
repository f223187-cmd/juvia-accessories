from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from pathlib import Path
import os, re, json, secrets
from .core import *
router=APIRouter()

@router.post('/api/scrape')
def scrape(x:ScrapeIn,u=Depends(admin)):
    validate_category(x.category)
    try: import requests
    except ImportError: raise HTTPException(503,'Install requests and beautifulsoup4 to enable scraping')
    from bs4 import BeautifulSoup
    added=[]
    for url in x.urls:
        if not url.startswith(('https://','http://')): continue
        try:
            res=requests.get(url,timeout=12,headers={'User-Agent':'JuviaCatalogBot/1.0'}); res.raise_for_status(); soup=BeautifulSoup(res.text,'html.parser')
            name=(soup.select_one('meta[property="og:title"]') or soup.title)
            name=(name.get('content') if name and name.has_attr('content') else name.get_text(' ',strip=True) if name else '').strip()[:180]
            desc=soup.select_one('meta[name="description"]'); desc=desc.get('content','') if desc else ''
            img=soup.select_one('meta[property="og:image"]'); img=img.get('content','') if img else ''
            price_node=soup.select_one('[itemprop="price"]'); price_txt=(price_node.get('content') or price_node.get_text()) if price_node else ''
            m=re.search(r'\d+(?:[.,]\d{1,2})?',price_txt.replace(',',''))
            if not name or not m: continue
            price=float(m.group().replace(',','.'))
            with db() as c:
                cur=c.execute('INSERT INTO products(name,category,price,description,image,source,created) VALUES(?,?,?,?,?,?,?)',(name,x.category,price,desc[:2000],img,url,now())); added.append({'id':cur.lastrowid,'name':name,'category':x.category,'price':price})
        except Exception: continue
    return {'added':added,'count':len(added),'note':'Respect target site terms and robots policy; scraper imports only basic Open Graph and price metadata.'}

