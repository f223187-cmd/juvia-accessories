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

## Tests

```bash
node --test tests/vto/wristpose.test.mjs
```

Focused try-on solver tests run on landmarks and pixels from real phone frames (scale, forearm alignment, fallback, rotation and jitter robustness, ring and necklace poses).

## Module endpoints

- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- Catalogue: `GET/POST /api/products`, `GET/PATCH/DELETE /api/products/{id}`
- Scraper: `POST /api/scrape` (admin; accepts allowed-category product pages)
- Reviews: `POST /api/products/{id}/reviews`, `GET /api/products/{id}/reviews`
- Assistant: `POST /api/chat`
- History: `GET /api/history`
- 3D assets: `POST /api/assets` (admin; self-contained GLB files up to 50 MB), `GET /api/assets`
- VTO: `GET /api/vto/status`; live MediaPipe inference runs in the phone browser
- Analytics: `GET /api/analytics` (admin)

The stylist (assistant) uses TF-IDF vector retrieval over published products with budget, category, and gift understanding; it works for guests and logs chats for signed-in users. Live try-on runs MediaPipe Tasks Vision in the browser and renders each product's GLB with Three.js (`web/modules/vto3d.js`, poses from `web/modules/wristpose.js`): watches and bracelets follow the wrist and forearm, rings the ring finger, and necklaces the shoulders and chin. Lighting, colour, and reflections are estimated from the live frame, the piece casts soft shadows and contact shading on the skin, and depth-only occluders hide parts behind the body. A soft-tape reading sizes the piece; otherwise size is estimated from the hand or the measured forearm. Camera frames and photos stay on the device; models and the WASM runtime load from Google's model host and jsDelivr. Demo ring, bracelet, and necklace models are generated with `python tools/make_demo_models.py` and seeded with the bundled watch on startup.

The Firebase Web App is registered and the client uses Firebase Auth. Firestore is provisioned but Juvia's product and activity APIs have not migrated from SQLite, and client rules remain closed. Cloud Storage requires a Blaze billing upgrade, which has not been approved. Firebase rejected the Vercel hostname in Authorized Domains; the UI falls back to Juvia API auth for that specific error. Add a custom authorized domain for native Firebase sign-in. True 3D try-on requires a suitable self-contained GLB asset for each product; the bundled watch demo is at `web/assets/models/juvia-watch.glb`. The scraper fetches public HTTP(S) HTML only, rejects redirects to private networks, limits page responses to 3 MB, and imports only pages with a product image.

## Try VTO on a phone

For the current phone test, open https://juvia-accessories.vercel.app and tap **Try on** (or **Try on** on any product); no account is needed to browse or try on. Pick a watch, bracelet, ring or necklace, allow camera access, use the flip button to switch lenses, and follow the on-screen hint. Accounts, reviews and activity use ephemeral SQLite in production until Firestore sync is implemented. Camera frames and photos stay on the device.
