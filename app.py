from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from juvia import auth, catalogue, reviews, assistant, history, assets, vto, analytics, scraping
app=FastAPI(title='Juvia API',version='1.0.0')
for module in (auth,catalogue,reviews,assistant,history,assets,vto,analytics,scraping):
    app.include_router(module.router)

@app.middleware('http')
async def cache_policy(request:Request,call_next):
    # Pages and scripts must revalidate so phones pick up new releases; 3D models can be cached for a day.
    response=await call_next(request)
    path=request.url.path
    if path.endswith('.glb'): response.headers.setdefault('Cache-Control','public, max-age=86400')
    elif path=='/' or path.endswith(('.html','.js','.css','.svg')): response.headers['Cache-Control']='no-cache'
    elif path.startswith('/api/'): response.headers.setdefault('Cache-Control','no-store')
    return response

app.mount('/',StaticFiles(directory=Path(__file__).parent/'web',html=True),name='web')
