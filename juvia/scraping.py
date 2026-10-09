from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from pathlib import Path
import os, re, json, secrets
import ipaddress, socket
from urllib.parse import urljoin, urlsplit
from .core import *
router=APIRouter()

def public_http_url(url):
    parsed=urlsplit(url)
    if parsed.scheme.lower() not in {'http','https'} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Only public HTTP(S) product URLs are allowed')
    port=parsed.port or (443 if parsed.scheme.lower()=='https' else 80)
    addresses={entry[4][0].split('%')[0] for entry in socket.getaddrinfo(parsed.hostname,port,type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError('Private and local network addresses cannot be scraped')
    return url

def fetch_product_page(session,url):
    current=url
    for _ in range(6):
        current=public_http_url(current)
        response=session.get(current,timeout=(4,10),headers={'User-Agent':'JuviaCatalogBot/1.0'},allow_redirects=False,stream=True)
        if response.is_redirect:
            location=response.headers.get('Location'); response.close()
            if not location: raise ValueError('Invalid redirect from product page')
            next_url=urljoin(current,location)
            if urlsplit(current).scheme.lower()=='https' and urlsplit(next_url).scheme.lower()!='https':
                raise ValueError('HTTPS scraping redirects cannot downgrade to HTTP')
            current=next_url
            continue
        try:
            response.raise_for_status()
            content_type=response.headers.get('Content-Type','').split(';',1)[0].strip().lower()
            if content_type and content_type not in {'text/html','application/xhtml+xml'}:
                raise ValueError('Product page did not return HTML')
            chunks=[]; total=0
            for chunk in response.iter_content(64*1024):
                total+=len(chunk)
                if total>3*1024*1024: raise ValueError('Product page exceeds 3 MB')
                chunks.append(chunk)
            encoding=response.encoding or 'utf-8'
            return current,b''.join(chunks).decode(encoding,errors='replace')
        finally:
            response.close()
    raise ValueError('Product page redirected too many times')

@router.post('/api/scrape')
def scrape(x:ScrapeIn,u=Depends(admin)):
    validate_category(x.category)
    try: import requests
    except ImportError: raise HTTPException(503,'Install requests and beautifulsoup4 to enable scraping')
    from bs4 import BeautifulSoup
    added=[]
    with requests.Session() as session:
        session.trust_env=False
        for url in x.urls:
            try:
                source_url,html=fetch_product_page(session,url); soup=BeautifulSoup(html,'html.parser')
                name=(soup.select_one('meta[property="og:title"]') or soup.title)
                name=(name.get('content') if name and name.has_attr('content') else name.get_text(' ',strip=True) if name else '').strip()[:180]
                desc=soup.select_one('meta[name="description"]'); desc=desc.get('content','') if desc else ''
                img=soup.select_one('meta[property="og:image"]'); img=img.get('content','') if img else ''
                if not img:
                    image=soup.select_one('main img[src], article img[src], img[src]'); img=image.get('src','') if image else ''
                if not name or not img: continue
                img=urljoin(source_url,img.strip()); image_url=urlsplit(img)
                if image_url.scheme.lower() not in {'http','https'} or not image_url.hostname: continue
                price_node=soup.select_one('[itemprop="price"]'); price_txt=(price_node.get('content') or price_node.get_text()) if price_node else ''
                m=re.search(r'\d+(?:[.,]\d{1,2})?',price_txt.replace(',',''))
                price=float(m.group().replace(',','.')) if m else 0
                with db() as c:
                    cur=c.execute('INSERT INTO products(name,category,price,description,image,source,created,published) VALUES(?,?,?,?,?,?,?,0)',(name,x.category,price,desc[:2000],img,source_url,now())); added.append({'id':cur.lastrowid,'name':name,'category':x.category,'price':price,'published':False})
            except Exception: continue
    return {'added':added,'count':len(added),'note':'Imports require a public HTTP(S) HTML page with a product image. Image-only imports use a zero price and remain unpublished until administrator verification. Redirects to private networks and oversized pages are rejected. Respect target site terms and robots policy.'}

