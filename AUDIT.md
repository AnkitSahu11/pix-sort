# PixSort Codebase Audit + Upgrade

## What was already present
- MERN-style Express/Mongoose + React/Vite project.
- Jimp Laplacian-style blur variance analysis.
- 64-bit average hash and O(n²) Union-Find duplicate grouping.
- Multer uploads to `server/uploads`.
- Browser face-api.js TinyFaceDetector + 68-point landmarks and EAR eye detection.
- Contact-sheet UI, duplicate groups, reviewer keyboard shortcuts, keep/reject, ZIP/CSV export.

## Problems found
- No authentication or user/project ownership.
- Upload HTTP request performed expensive image analysis synchronously.
- Up to 500 files only and no durable analysis job state.
- Jimp was used for the main image pipeline instead of a faster Sharp pipeline.
- Full photo list loaded at once; no pagination.
- No thumbnails; grid could request full-resolution images.
- No technical quality score or transparent final scoring configuration.
- No face/quality fields beyond the basic eye boolean.
- Duplicate recomputation was quadratic and happened in the request path.
- API responses were inconsistent and did not use success/data/errorCode envelopes.
- CORS was unrestricted, no Helmet, no auth rate limiting, no secure cookies.
- Password/email/account functionality was absent.
- Browser AI failures were not durable/retryable.
- Existing status vocabulary was too limited for flag/favorite workflows.
- No real aesthetic model was present; the upgrade intentionally does not fabricate one.

## Upgrade strategy
The existing photo-culling workflow was retained. The server was reorganized around controllers/services/middleware, the Photo document was extended instead of replaced conceptually, and the React contact-sheet/reviewer experience remains the main interaction model.

## Production path
The current worker is an in-process asynchronous queue so the app remains easy to run locally. For multiple Node instances, move the queue adapter to BullMQ + Redis. The image analysis service and API contracts are already separated so that migration does not require rewriting the UI.
