from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from juvia import auth, catalogue, reviews, assistant, history, assets, vto, analytics, scraping
app=FastAPI(title='Juvia API',version='1.0.0')
for module in (auth,catalogue,reviews,assistant,history,assets,vto,analytics,scraping):
    app.include_router(module.router)
app.mount('/',StaticFiles(directory=Path(__file__).parent/'web',html=True),name='web')
