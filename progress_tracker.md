### Ready and Tested
1. Customer and admin views use the existing role system; admin APIs remain role-protected.
2. Product add/edit/delete and publish/unpublish controls are wired to the catalogue APIs.
3. Scraped image-only products can be imported as unpublished zero-price test entries; pages without an actual product image are skipped. Admin can also upload JPG, PNG, and WebP product images.
4. VTO laptop check (390×844 Chrome with an isolated synthetic camera feed) confirmed on-device hand detection, automatic first wrist capture, linked watch GLB loading, and live watch movement tracking. Guided prompts now explain full-hand framing and wrist turns. Real phone-camera fit remains unverified.
5. Published products can expose their linked self-contained GLB model to VTO; the model is positioned, scaled, and rotated from detected landmarks. The catalogue exposes the VTO action for image-free products with a linked GLB. This remains landmark-based browser AR without body occlusion or per-device fit calibration.
6. Firebase project has the `juvia-web` app registered; Email/Password auth is enabled and the Standard Firestore database was created in `asia-south1` with production-mode rules.
7. Juvia's web client is configured for Firebase Auth; the API verifies Firebase ID tokens and maps roles using `JUVIA_ADMIN_EMAIL`. The approved admin email is set in Vercel Production.
8. The user's watch GLB is bundled at `web/assets/models/juvia-watch.glb`; startup idempotently seeds a published, image-free `Watch VTO demo` product linked to it.
9. Local checks passed for Python compilation, JavaScript syntax, Firebase identity mapping, mocked camera switching, image-only import, product image upload/fetch, published-only model lookup, and browser model loading/landmark placement.
10. Latest production deployment is at https://juvia-accessories.vercel.app. Live checks passed for the homepage, public watch catalogue (`has_3d_asset: 1`), updated catalogue script, and bundled GLB download; Vercel's Python 3.12 build completed.
11. Mobile-size Chrome VTO check passed with the real MediaPipe hand/face models and bundled watch GLB: the fixture hand was detected, the first wrist view captured automatically, an invalid pose showed red guidance, and a valid wrist pose showed green with the watch placed on the wrist. Camera permission waiting is cancellable and delayed model loading reports a retry path. Physical phone-camera behavior still needs device verification.
12. Mobile-size VTO workflow regression passed: watches load only Hand Landmarker, the GLB responds to changing 3D wrist orientation, invalid/valid guides render red/green, and pose-diverse cropped views save without a fixed two-photo sequence. Ring finger detection and face-plus-shoulder neck gating were checked; a face without shoulder landmarks stays invalid. The actual MediaPipe hand, face, and pose models loaded in the isolated browser. Circumference is recorded from a user soft-tape reading, not inferred from the camera.

### Remaining Modules
1. Product, review, history, and inventory data still use SQLite; Firestore sync and realtime updates are not implemented. Firestore is safely closed to client access until rules and the server data path are ready.
2. Cloud Storage requires Blaze billing; the user chose to remain on Spark, so Storage is not enabled. Uploaded files on Vercel would remain ephemeral.
3. Firebase Auth rejected `juvia-accessories.vercel.app` in the Authorized Domains form. The UI falls back to Juvia API auth on Firebase's `auth/unauthorized-domain`; a custom authorized domain is needed for native Firebase login.
4. The four real test image files have not yet been supplied. The admin upload form and image-only scraper are ready; imported products remain pending until verified.
5. The watch GLB is available; ring, bracelet, and necklace GLBs must still be made/supplied. Model-to-body fit calibration, occlusion, and actual phone camera testing remain outstanding.
6. Vector search needs a Firestore data path plus an embeddings provider. Production still uses ephemeral SQLite for catalogue, accounts, and activity; Firestore sync/realtime updates are not implemented.
7. Physical phone camera permissions, front/back switching, live landmarks, and real-world fit still need testing. Desktop synthetic landmark tests do not replace phone testing.
