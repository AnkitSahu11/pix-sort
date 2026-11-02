# PixSort 2.0

PixSort is an upgraded MERN photo-culling application that preserves the original contact-sheet workflow while adding authenticated projects, background analysis, pagination, real-time progress, technical scoring, duplicate grouping, browser-side face/eye analysis, and secure exports.

## Existing functionality preserved
- Express + MongoDB + React/Vite
- Multi-photo upload and drag/drop UI
- Blur/sharpness analysis
- Perceptual hash duplicate grouping
- Browser face/eye analysis with face-api.js
- Keep/reject/review workflow
- Duplicate group "keep only" workflow
- ZIP and CSV export
- Darkroom/contact-sheet visual language

## Major upgrades
- JWT auth in an HTTP-only cookie, bcrypt password hashing, verification/reset/change password flows
- Nodemailer email verification/reset links
- Helmet, CORS, rate limiting, secure upload validation, consistent API envelopes
- Sharp-based image analysis and thumbnail generation
- Background in-process analysis queue; no 1000-image synchronous HTTP request
- Socket.IO analysis events
- MongoDB pagination and useful indexes
- Technical score + configurable weighted final score
- Duplicate-group best-frame recommendation
- Statuses: unreviewed, shortlisted, flagged, rejected, favorite
- Dashboard statistics, filtering and sorting
- Retry failed analysis
- Lazy thumbnail loading and memoized photo cards

## Score model
Weights live in `server/config/scoring.js`:

- AI quality 30%
- Sharpness 20%
- Face quality 15%
- Expression 10%
- Technical 15%
- Composition 10%

The calculation only uses signals that are actually available. Missing model signals are not fabricated; the remaining weights are renormalized.

## AI limitation
The current project uses real `face-api.js` models for browser face/landmark analysis. A true aesthetic-quality model is deliberately **not fabricated**. `aiQualityScore` remains unavailable until a real TensorFlow.js/ONNX aesthetic model is configured. The scoring architecture is already model-swappable through the central scoring service.

## Setup

### Server
```bash
cd server
npm install
copy .env.example .env
npm run dev
```

### Client
```bash
cd client
npm install
npm run dev
```

MongoDB must be running. Configure SMTP credentials in `server/.env` for registration verification and password reset.

## Important environment variables
`PORT`, `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_URL`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM`, `VERIFICATION_EXPIRES_MINUTES`, `RESET_EXPIRES_MINUTES`, `MAX_UPLOAD_FILES`, `MAX_FILE_SIZE_MB`.

## Large batches
Upload only stores metadata/files and queues analysis. The HTTP request does not run the complete image-analysis pipeline. The worker processes each image independently, so one failed image does not terminate the batch. Socket.IO sends per-photo analysis events to the client.

This is an intentionally clean single-process queue. For multi-instance production deployment, replace `server/services/analysisQueue.js` with BullMQ + Redis without changing the photo-analysis service API.

## Remaining limitations
- Aesthetic AI is model-pluggable but no fake score is generated without a real configured model.
- Browser face/eye inference still depends on the user's device and the face-api.js CDN unless models are self-hosted.
- RAW formats are not enabled yet; the upload pipeline is isolated so a RAW decoder can be added later.
- The in-process queue is appropriate for a local/single-server deployment; Redis/BullMQ should be used for horizontally scaled production workers.
