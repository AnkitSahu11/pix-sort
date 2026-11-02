import express from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import * as c from "../controllers/photoController.js";
import Photo from "../models/Photo.js";
import { enqueuePhotos } from "../services/analysisQueue.js";

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.resolve("uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const allowedMimes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedExts = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const upload = multer({
  storage,
  limits: {
    files: Number(process.env.MAX_UPLOAD_FILES || 500),
    fileSize: Number(process.env.MAX_FILE_SIZE_MB || 50) * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimes.has(file.mimetype) && allowedExts.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, and WebP image formats are allowed"), false);
    }
  },
});

router.use(requireAuth);

router.get("/", c.listPhotos);
router.get("/export/zip", c.exportZip);
router.get("/export/csv", c.exportCsv);
router.get("/stats", c.stats);
router.post(
  "/upload",
  upload.array("photos", Number(process.env.MAX_UPLOAD_FILES || 500)),
  c.uploadPhotos
);
router.post("/batch-analyze", c.batchAnalyze);
router.post("/retry-analysis", c.retryAnalysis);
router.post("/keep-only", c.keepOnly);
router.get("/:id/similar", c.similar);
router.post("/:id/analyze", async (req, res, next) => {
  try {
    const p = await Photo.findOne({ _id: req.params.id, userId: req.user._id });
    if (!p) {
      return res.status(404).json({
        success: false,
        message: "Photo not found or unauthorized",
        errorCode: "NOT_FOUND",
      });
    }
    enqueuePhotos([p]);
    res.status(202).json({ success: true, message: "Analysis queued" });
  } catch (e) {
    next(e);
  }
});

router.get("/:id", c.getPhoto);
router.delete("/:id", c.deletePhoto);
router.patch("/:id/status", c.updateStatus);
router.patch("/:id/flag", c.updateFlag);
router.patch("/:id/eyes", c.updateEyes);
router.post("/reset", c.resetPhotos);

export default router;
