import fs from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import Photo from "../models/Photo.js";
import Project from "../models/Project.js";
import { contentHash, calculateFinalScore } from "../services/imageAnalysis.js";
import {
  enqueuePhotos,
  recomputeGroups,
  retryFailed,
  analysisEvents,
} from "../services/analysisQueue.js";
import { diagnoseScore } from "../config/scoring.js";

const UPLOAD_DIR = path.resolve("uploads");
const THUMB_DIR = path.resolve("uploads/thumbs");

const publicPhoto = (p) => {
  const x = p.toObject ? p.toObject() : p;
  return {
    ...x,
    _id: String(x._id),
    url: `/uploads/${encodeURIComponent(x.filename)}`,
    thumbnailUrl: x.thumbnailPath
      ? `/uploads/thumbs/${encodeURIComponent(path.basename(x.thumbnailPath))}`
      : null,
  };
};

export async function listPhotos(req, res, next) {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const skip = (page - 1) * limit;

    const q = { userId: req.user._id };
    if (req.query.projectId) q.projectId = req.query.projectId;
    if (req.query.status) q.status = req.query.status;
    if (req.query.flagged === "true") {
      q.$or = [
        { flagged: true },
        { "flags.0": { $exists: true } },
        { "analysis.eyesOpen": false },
        { "analysis.blurStatus": "blurry" },
      ];
    }

    if (req.query.category && req.query.category !== "all") {
      const ranges = {
        best: { $gte: 90 },
        good: { $gte: 75, $lt: 90 },
        review: { $lt: 75 },
      };
      if (ranges[req.query.category]) q["analysis.finalScore"] = ranges[req.query.category];
      if (req.query.category === "flagged") {
        delete q["analysis.finalScore"];
        q.$or = [
          { status: "flagged" },
          { flagged: true },
          { "flags.0": { $exists: true } },
          { "analysis.eyesOpen": false },
          { "analysis.eyesClosed": true },
          { "analysis.blurStatus": "blurry" },
        ];
      }
      if (req.query.category === "favorite") q.favorite = true;
      if (req.query.category === "duplicates") q.duplicateGroupId = { $ne: null };
      if (req.query.category === "rejected") q.status = "rejected";
    }

    if (req.query.search) {
      q.originalName = {
        $regex: String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    }

    const sortMap = {
      score: { "analysis.finalScore": -1 },
      sharp: { "analysis.sharpnessScore": -1 },
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      face: { "analysis.faceQualityScore": -1 },
      technical: { "analysis.technicalScore": -1 },
    };
    const sort = sortMap[req.query.sort] || { frameIndex: 1 };

    const [photos, total] = await Promise.all([
      Photo.find(q).select("-hashBits -filePath").sort(sort).skip(skip).limit(limit).lean(),
      Photo.countDocuments(q),
    ]);

    res.json({
      success: true,
      data: {
        photos: photos.map(publicPhoto),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function getPhoto(req, res, next) {
  try {
    const p = await Photo.findOne({ _id: req.params.id, userId: req.user._id }).select("-hashBits");
    if (!p) {
      return res.status(404).json({ success: false, message: "Photo not found", errorCode: "NOT_FOUND" });
    }
    res.json({ success: true, data: publicPhoto(p) });
  } catch (e) {
    next(e);
  }
}

export async function uploadPhotos(req, res, next) {
  try {
    await fs.mkdir(THUMB_DIR, { recursive: true });
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ success: false, message: "No photos uploaded", errorCode: "EMPTY_UPLOAD" });
    }

    let targetProjectId = null;
    if (req.body.projectId) {
      const project = await Project.findOne({ _id: req.body.projectId, userId: req.user._id });
      if (!project) {
        // Clean up temporary files on project failure
        await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {})));
        return res.status(404).json({
          success: false,
          message: "Project not found or unauthorized",
          errorCode: "PROJECT_NOT_FOUND",
        });
      }
      targetProjectId = project._id;
    }

    const existing = await Photo.countDocuments({ userId: req.user._id });
    const docs = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const hash = await contentHash(f.path);

      if (await Photo.exists({ userId: req.user._id, "metadata.sha256": hash })) {
        await fs.unlink(f.path).catch(() => {});
        continue;
      }

      docs.push({
        userId: req.user._id,
        projectId: targetProjectId,
        filename: f.filename,
        originalName: f.originalname,
        filePath: f.path,
        frameIndex: existing + i + 1,
        status: "unreviewed",
        flagged: false,
        flags: [],
        metadata: { sha256: hash },
        analysis: { analysisStatus: "pending", flags: [] },
      });
    }

    const inserted = docs.length ? await Photo.insertMany(docs) : [];
    enqueuePhotos(inserted);

    res.status(202).json({
      success: true,
      data: {
        jobId: `batch-${Date.now()}`,
        accepted: inserted.length,
        skipped: files.length - inserted.length,
        photos: inserted.map(publicPhoto),
      },
      message: "Upload accepted. Analysis continues in background.",
    });
  } catch (e) {
    next(e);
  }
}

export async function updateStatus(req, res, next) {
  try {
    const allowed = ["unreviewed", "shortlisted", "flagged", "rejected", "favorite"];
    if (!allowed.includes(req.body.status)) {
      return res.status(400).json({ success: false, message: "Invalid status", errorCode: "VALIDATION_ERROR" });
    }

    const p = await Photo.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      {
        $set: {
          status: req.body.status,
          flagged: req.body.status === "flagged" || (req.body.flags && req.body.flags.length > 0),
          favorite: req.body.status === "favorite",
        },
      },
      { new: true }
    ).select("-hashBits");

    if (!p) {
      return res.status(404).json({ success: false, message: "Photo not found", errorCode: "NOT_FOUND" });
    }
    res.json({ success: true, data: publicPhoto(p) });
  } catch (e) {
    next(e);
  }
}

export async function updateFlag(req, res, next) {
  try {
    const isFlagged = Boolean(req.body.flagged);
    const p = await Photo.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      {
        $set: {
          flagged: isFlagged,
          status: isFlagged ? "flagged" : "unreviewed",
        },
      },
      { new: true }
    ).select("-hashBits");

    if (!p) {
      return res.status(404).json({ success: false, message: "Photo not found", errorCode: "NOT_FOUND" });
    }
    res.json({ success: true, data: publicPhoto(p) });
  } catch (e) {
    next(e);
  }
}

export async function updateEyes(req, res, next) {
  try {
    const current = await Photo.findOne({ _id: req.params.id, userId: req.user._id });
    if (!current) {
      return res.status(404).json({ success: false, message: "Photo not found", errorCode: "NOT_FOUND" });
    }

    const {
      faceDetected,
      faceChecked,
      faceCount,
      faceScore,
      faceQualityScore,
      eyesOpen,
      eyesClosed,
      eyeState,
      eyeConfidence,
      leftEAR,
      rightEAR,
      avgEAR,
      expressionScore,
      facesWithEyesClosed,
      facesWithEyesOpen,
      eyesClosedCount,
    } = req.body;

    const flags = new Set(current.flags || []);

    // Manage blur SOFT flag based on blurStatus
    if (current.analysis?.blurStatus === "blurry") {
      flags.add("SOFT");
    } else {
      flags.delete("SOFT");
    }

    current.analysis.faceChecked = true;

    if (faceDetected === false || faceCount === 0) {
      // Landscape or non-portrait
      current.analysis.faceDetected = false;
      current.analysis.faceCount = 0;
      current.analysis.faceScore = null;
      current.analysis.faceQualityScore = null;
      current.analysis.expressionScore = null;
      current.analysis.eyesOpen = null;
      current.analysis.eyesClosed = null;
      current.analysis.eyeState = null;
      current.analysis.eyeConfidence = null;
      current.analysis.leftEAR = null;
      current.analysis.rightEAR = null;
      current.analysis.avgEAR = null;
      current.analysis.facesWithEyesClosed = 0;
      current.analysis.facesWithEyesOpen = 0;
      current.analysis.eyesClosedCount = 0;
      flags.delete("EYES");
    } else if (faceDetected === true || (faceCount && Number(faceCount) > 0)) {
      current.analysis.faceDetected = true;
      current.analysis.faceCount = Number(faceCount) || 1;

      const fScore = Number.isFinite(Number(faceQualityScore ?? faceScore))
        ? Math.max(0, Math.min(100, Number(faceQualityScore ?? faceScore)))
        : null;
      current.analysis.faceScore = fScore;
      current.analysis.faceQualityScore = fScore;

      const expScore = Number.isFinite(Number(expressionScore))
        ? Math.max(0, Math.min(100, Number(expressionScore)))
        : null;
      current.analysis.expressionScore = expScore;

      const isEyesClosed =
        eyeState === "BOTH_CLOSED" ||
        eyeState === "ONE_EYE_CLOSED" ||
        eyesClosed === true ||
        eyesOpen === false ||
        Number(facesWithEyesClosed) > 0 ||
        Number(eyesClosedCount) > 0;

      const isEyesOpen =
        (eyeState === "BOTH_OPEN" || eyesOpen === true) && !isEyesClosed;

      if (isEyesClosed) {
        current.analysis.eyesOpen = false;
        current.analysis.eyesClosed = true;
        flags.add("EYES");
      } else if (isEyesOpen) {
        current.analysis.eyesOpen = true;
        current.analysis.eyesClosed = false;
        flags.delete("EYES");
      } else {
        current.analysis.eyesOpen = null;
        current.analysis.eyesClosed = null;
        flags.delete("EYES");
      }

      current.analysis.eyeState = eyeState || (isEyesClosed ? "BOTH_CLOSED" : isEyesOpen ? "BOTH_OPEN" : "UNCERTAIN");
      current.analysis.eyeConfidence = Number.isFinite(Number(eyeConfidence)) ? Number(eyeConfidence) : null;
      current.analysis.leftEAR = Number.isFinite(Number(leftEAR)) ? Number(leftEAR) : null;
      current.analysis.rightEAR = Number.isFinite(Number(rightEAR)) ? Number(rightEAR) : null;
      current.analysis.avgEAR = Number.isFinite(Number(avgEAR)) ? Number(avgEAR) : null;
      current.analysis.facesWithEyesClosed = Number(facesWithEyesClosed) || (isEyesClosed ? 1 : 0);
      current.analysis.facesWithEyesOpen = Number(facesWithEyesOpen) || (isEyesOpen ? 1 : 0);
      current.analysis.eyesClosedCount = Number(eyesClosedCount) || (eyeState === "BOTH_CLOSED" ? 2 : eyeState === "ONE_EYE_CLOSED" ? 1 : 0);
    }

    current.flags = Array.from(flags);
    current.analysis.flags = Array.from(flags);
    current.flagged = flags.size > 0;
    if (flags.size > 0 && current.status === "unreviewed") {
      current.status = "flagged";
    }

    // Recalculate final score with dynamic weight renormalization
    current.analysis.finalScore = calculateFinalScore(current.analysis);
    await current.save();

    const diag = diagnoseScore(current.analysis, current.originalName);
    console.log(
      `[Eye Sync:Success] ${current.originalName} (${current._id}) -> FaceDetected: ${current.analysis.faceDetected}, FaceChecked: ${current.analysis.faceChecked}, State: ${current.analysis.eyeState}, EyesOpen: ${current.analysis.eyesOpen}, EyesClosed: ${current.analysis.eyesClosed}, LeftEAR: ${current.analysis.leftEAR}, RightEAR: ${current.analysis.rightEAR}, Flags: [${current.flags.join(", ")}], Score: ${current.analysis.finalScore}`
    );
    console.log(diag.diagnosticText);

    res.json({ success: true, data: publicPhoto(current) });
  } catch (e) {
    console.error(`[Eye Sync:Error] Failed for photo ${req.params.id}:`, e);
    next(e);
  }
}

export async function keepOnly(req, res, next) {
  try {
    const { groupId, keepId } = req.body;
    const members = await Photo.find({ userId: req.user._id, duplicateGroupId: groupId });
    if (!members.some((p) => String(p._id) === String(keepId))) {
      return res.status(404).json({ success: false, message: "Photo/group not found", errorCode: "NOT_FOUND" });
    }

    await Photo.updateMany(
      { userId: req.user._id, duplicateGroupId: groupId },
      { $set: { status: "rejected", flagged: false } }
    );
    await Photo.updateOne(
      { _id: keepId, userId: req.user._id },
      { $set: { status: "shortlisted" } }
    );

    res.json({ success: true, message: "Duplicate group shortlisted" });
  } catch (e) {
    next(e);
  }
}

export async function similar(req, res, next) {
  try {
    const p = await Photo.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!p) {
      return res.status(404).json({ success: false, message: "Photo not found", errorCode: "NOT_FOUND" });
    }

    const q = p.duplicateGroupId
      ? { userId: req.user._id, duplicateGroupId: p.duplicateGroupId, _id: { $ne: p._id } }
      : { userId: req.user._id, _id: { $ne: p._id } };

    const photos = await Photo.find(q)
      .select("-hashBits -filePath")
      .sort({ "analysis.finalScore": -1 })
      .limit(20)
      .lean();

    res.json({ success: true, data: photos.map(publicPhoto) });
  } catch (e) {
    next(e);
  }
}

export async function batchAnalyze(req, res, next) {
  try {
    const q = { userId: req.user._id };
    if (req.body.projectId) q.projectId = req.body.projectId;
    const photos = await Photo.find(q);
    enqueuePhotos(photos);
    res.status(202).json({ success: true, data: { queued: photos.length } });
  } catch (e) {
    next(e);
  }
}

export async function retryAnalysis(req, res, next) {
  try {
    const n = await retryFailed(req.user._id);
    res.json({ success: true, data: { queued: n } });
  } catch (e) {
    next(e);
  }
}

export async function stats(req, res, next) {
  try {
    const q = { userId: req.user._id };
    if (req.query.projectId) q.projectId = req.query.projectId;
    const flaggedQuery = {
      ...q,
      $or: [
        { status: "flagged" },
        { flagged: true },
        { "flags.0": { $exists: true } },
        { "analysis.eyesOpen": false },
        { "analysis.eyesClosed": true },
        { "analysis.blurStatus": "blurry" },
      ],
    };
    const [total, analyzed, shortlisted, flagged, rejected, duplicates, favorite, best, good, review, avg] = await Promise.all([
      Photo.countDocuments(q),
      Photo.countDocuments({ ...q, "analysis.analysisStatus": "complete" }),
      Photo.countDocuments({ ...q, status: { $in: ["shortlisted", "favorite"] } }),
      Photo.countDocuments(flaggedQuery),
      Photo.countDocuments({ ...q, status: "rejected" }),
      Photo.countDocuments({ ...q, duplicateGroupId: { $ne: null } }),
      Photo.countDocuments({ ...q, $or: [{ status: "favorite" }, { favorite: true }] }),
      Photo.countDocuments({ ...q, "analysis.finalScore": { $gte: 90 } }),
      Photo.countDocuments({ ...q, "analysis.finalScore": { $gte: 75, $lt: 90 } }),
      Photo.countDocuments({
        ...q,
        $or: [
          { "analysis.finalScore": { $lt: 75 } },
          { "analysis.finalScore": null },
        ],
      }),
      Photo.aggregate([
        { $match: q },
        { $match: { "analysis.finalScore": { $ne: null } } },
        { $group: { _id: null, avg: { $avg: "$analysis.finalScore" } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        total,
        analyzed,
        shortlisted,
        flagged,
        rejected,
        duplicates,
        favorite,
        best,
        good,
        review,
        averageQualityScore: avg[0]?.avg ? Math.round(avg[0].avg * 100) / 100 : 0,
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function resetPhotos(req, res, next) {
  try {
    const photos = await Photo.find({ userId: req.user._id });
    await Promise.all(
      photos.map(async (p) => {
        await fs.unlink(p.filePath).catch(() => {});
        if (p.thumbnailPath) await fs.unlink(p.thumbnailPath).catch(() => {});
      })
    );
    await Photo.deleteMany({ userId: req.user._id });
    res.json({ success: true, message: "Project photos reset" });
  } catch (e) {
    next(e);
  }
}

export async function deletePhoto(req, res, next) {
  try {
    const p = await Photo.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!p) {
      return res.status(404).json({ success: false, message: "Photo not found", errorCode: "NOT_FOUND" });
    }
    await fs.unlink(p.filePath).catch(() => {});
    if (p.thumbnailPath) await fs.unlink(p.thumbnailPath).catch(() => {});
    res.json({ success: true, message: "Photo deleted" });
  } catch (e) {
    next(e);
  }
}

export async function exportZip(req, res, next) {
  try {
    const photos = await Photo.find({
      userId: req.user._id,
      status: { $in: ["shortlisted", "favorite"] },
    }).sort({ frameIndex: 1 });

    if (!photos.length) {
      return res.status(404).json({ success: false, message: "No shortlisted photos", errorCode: "EMPTY_SHORTLIST" });
    }

    res.attachment("pixsort-shortlist.zip");
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", next);
    archive.pipe(res);

    const used = new Set();
    for (const p of photos) {
      let name = p.originalName;
      if (used.has(name)) {
        const ext = path.extname(name);
        const base = path.basename(name, ext);
        let n = 2;
        while (used.has(`${base}-${n}${ext}`)) n++;
        name = `${base}-${n}${ext}`;
      }
      used.add(name);
      archive.file(p.filePath, { name });
    }
    await archive.finalize();
  } catch (e) {
    next(e);
  }
}

export async function exportCsv(req, res, next) {
  try {
    const photos = await Photo.find({ userId: req.user._id }).sort({ frameIndex: 1 });
    const header = "frame,filename,status,flagged,score,sharpness,face_score,expression,technical,ai_quality,duplicate_group";
    const rows = photos.map((p) =>
      [
        p.frameIndex,
        p.originalName,
        p.status,
        p.flagged,
        p.analysis?.finalScore ?? "",
        p.analysis?.sharpnessScore ?? "",
        p.analysis?.faceQualityScore ?? "",
        p.analysis?.expressionScore ?? "",
        p.analysis?.technicalScore ?? "",
        p.analysis?.aiQualityScore ?? "",
        p.duplicateGroupId ?? "",
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(",")
    );
    res.type("text/csv").attachment("pixsort-export.csv").send([header, ...rows].join("\n"));
  } catch (e) {
    next(e);
  }
}

export { analysisEvents };

