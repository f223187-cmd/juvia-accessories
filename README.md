# Juvia

Juvia is a web-only accessories commerce prototype. Its product API restricts product categories to watches, bracelets, rings, and necklaces. It includes authentication, catalogue management, scraping, reviews, a product assistant, interaction history, 3D asset upload, webcam landmark estimation, and analytics.

Each backend module has its own router file under `juvia/`: `auth.py`, `catalogue.py`, `scraping.py`, `reviews.py`, `assistant.py`, `history.py`, `assets.py`, `vto.py`, and `analytics.py`. Matching web UI logic lives in `web/modules/` with a separate JavaScript file for each module. Shared database, token, and validation helpers live in `juvia/core.py`; `app.py` assembles the routers and serves the web client.

## Run

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload
```

Open http://127.0.0.1:8000. Set `JUVIA_ADMIN_EMAIL` to the email of the account that will register as the initial administrator. Set `JUVIA_SECRET` to a long random value before deployment. Vercel can host the FastAPI app and static web UI, but its `/tmp` SQLite database and uploads are ephemeral; use Firestore and Cloud Storage before relying on persistent customer accounts or catalogue data.

## Module endpoints

- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- Catalogue: `GET/POST /api/products`, `GET/PATCH/DELETE /api/products/{id}`
- Scraper: `POST /api/scrape` (admin; accepts allowed-category product pages)
- Reviews: `POST /api/products/{id}/reviews`, `GET /api/products/{id}/reviews`
- Assistant: `POST /api/chat`
- History: `GET /api/history`
- 3D assets: `POST /api/assets` (admin; GLB/GLTF/OBJ), `GET /api/assets`
- VTO: `GET /api/vto/status`; live MediaPipe inference runs in the phone browser
- Analytics: `GET /api/analytics` (admin)

The assistant uses a local product/review retrieval baseline with no external model requirement. VTO runs MediaPipe Tasks Vision in the mobile browser, avoiding server-side camera uploads. The guided capture flow asks for two wrist views for watches and bracelets, two hand/finger views for rings, and three automatically captured neck views for necklaces. Camera access requires HTTPS on phones. Captured photos remain in the browser session and are not uploaded; VTO currently does not render the accessory overlay. Models and the WASM runtime load from Google's model host and jsDelivr the first time the flow starts.

## Try VTO on a phone

Open https://juvia-accessories.vercel.app in your mobile browser, create an account, and tap **Virtual try-on**. Choose Watch, Bracelet, Ring, or Necklace and tap **Start guided capture**. Allow camera access and follow the pose prompt; detection pop-ups appear and photos are captured after the target stays in frame. Necklaces take three views automatically. The first start downloads the MediaPipe browser runtime and models; keep the page open while they load. Camera frames and captured photos stay on the device.
