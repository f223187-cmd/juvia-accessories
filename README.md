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

Open http://127.0.0.1:8000. Set `JUVIA_ADMIN_EMAIL` to the email of the initial administrator and `JUVIA_SECRET` to a long random value before deployment. Firebase Email/Password sign-in is enabled for project `juvia-b0ed2`; the API verifies Firebase ID tokens. The Firestore database exists in `asia-south1` with production-mode rules, but Juvia catalogue/review/history data still uses SQLite. Vercel's `/tmp` database and uploads are ephemeral, so do not rely on production data persistence until the Firestore data path is completed. Firebase Storage is not enabled because the project remains on Spark.

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

The assistant currently uses keyword retrieval over published products; Firebase vector search is not configured. VTO runs MediaPipe Tasks Vision in the mobile browser, avoiding server-side camera uploads. The guided flow captures two wrist views for watches and bracelets, two hand/finger views for rings, and three neck views for necklaces. It supports front/rear camera switching. A published product's linked GLB/GLTF is rendered over its detected landmarks when available; otherwise the product image is used as a 2D preview. Landmark placement is an estimate and does not yet provide depth occlusion. Camera access requires HTTPS on phones. Captured photos remain in the browser session and are not uploaded. Models and the WASM runtime load from Google's model host and jsDelivr the first time the flow starts.

The Firebase Web App is registered and the client uses Firebase Auth. Firestore is provisioned but Juvia's product and activity APIs have not migrated from SQLite, and client rules remain closed. Cloud Storage requires a Blaze billing upgrade, which has not been approved. Firebase rejected the Vercel hostname in Authorized Domains; the UI falls back to Juvia API auth for that specific error. Add a custom authorized domain for native Firebase sign-in. True 3D try-on requires a suitable GLB/GLTF asset for each product; the bundled watch demo is at `web/assets/models/juvia-watch.glb`.

## Try VTO on a phone

For the current phone test, open https://juvia-accessories.vercel.app, sign in or register in Juvia, and tap **Virtual try-on**. The bundled **Watch VTO demo** is available without a product image. Allow camera access, use **Flip camera** to switch lenses, and follow the pose prompt. Production currently uses ephemeral SQLite for accounts/activity; Firestore sync is not yet implemented. Camera frames and captured photos stay on the device.
