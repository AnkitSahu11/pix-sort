import Photo from "../models/Photo.js";
import {
  analyzeImage,
  hammingDistance,
  similarityFromDistance,
  calculateFinalScore,
  categoryForScore,
} from "./imageAnalysis.js";
import { diagnoseScore } from "../config/scoring.js";
import path from "node:path";
import { EventEmitter } from "node:events";

const jobs = [];
let running = false;
export const analysisEvents = new EventEmitter();

export function enqueuePhotos(photos) {
  for (const photo of photos) {
    jobs.push(String(photo._id));
  }
  processQueue();
}

async function processQueue() {
  if (running) return;
  running = true;
  const users = new Set();

  try {
    while (jobs.length) {
      const id = jobs.shift();
      try {
        const photo = await Photo.findById(id).select("userId projectId");
        if (photo) {
          users.add(`${photo.userId}:${photo.projectId || ""}`);
        }
        await analyzeOne(id);
      } catch (e) {
        console.error(`[Queue Error] Failed analyzing photo ${id}:`, e);
        await Photo.updateOne(
          { _id: id },
          {
            $set: {
              "analysis.analysisStatus": "failed",
              "analysis.analysisError": e.message || "Analysis error",
            },
          }
        );
        analysisEvents.emit("photo", { photoId: id, status: "failed", error: e.message });
      }
    }

    for (const key of users) {
      const [userId, projectId] = key.split(":");
      await recomputeGroups(userId, projectId || null);
    }
  } finally {
    running = false;
  }
}

async function analyzeOne(id) {
  const photo = await Photo.findById(id);
  if (!photo) return;

  await Photo.updateOne(
    { _id: id },
    { $set: { "analysis.analysisStatus": "processing" } }
  );
  analysisEvents.emit("photo", {
    photoId: id,
    userId: String(photo.userId),
    status: "processing",
  });

  const thumbPath = path.resolve("uploads/thumbs", `${photo.filename}.jpg`);
  const result = await analyzeImage(photo.filePath, thumbPath);

  const flags = [];
  if (result.blurStatus === "blurry") {
    flags.push("SOFT");
  }

  const updated = {
    ...result,
    flags,
    analysisStatus: "complete",
    analysisError: null,
    analyzedAt: new Date(),
    faceQualityScore: null,
    expressionScore: null,
    aiQualityScore: null,
    compositionScore: null,
  };

  const final = calculateFinalScore(updated);
  updated.finalScore = final;

  await Photo.updateOne(
    { _id: id },
    {
      $set: {
        hashBits: result.hashBits,
        thumbnailPath: result.thumbnailPath,
        flags,
        flagged: flags.length > 0,
        analysis: updated,
      },
    }
  );

  const diag = diagnoseScore(updated, photo.originalName);
  console.log(`[Queue] Processed ${photo.originalName} (${id}) -> Score: ${final} (${diag.category.toUpperCase()})`);

  analysisEvents.emit("photo", {
    photoId: id,
    userId: String(photo.userId),
    status: "complete",
    analysis: updated,
  });
}

export async function recomputeGroups(userId, projectId = null) {
  const query = { userId };
  if (projectId) query.projectId = projectId;

  const photos = await Photo.find(query)
    .select("_id hashBits analysis.finalScore")
    .sort({ frameIndex: 1 })
    .lean();

  const parent = new Map(photos.map((p) => [String(p._id), String(p._id)]));
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) {
      parent.set(r, parent.get(parent.get(r)));
      r = parent.get(r);
    }
    return r;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent.set(b, a);
  };

  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      if (hammingDistance(photos[i].hashBits || [], photos[j].hashBits || []) <= 6) {
        union(String(photos[i]._id), String(photos[j]._id));
      }
    }
  }

  const groups = new Map();
  for (const p of photos) {
    const root = find(String(p._id));
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(p);
  }

  let num = 1;
  const ops = [];

  for (const members of groups.values()) {
    if (members.length < 2) {
      ops.push(
        Photo.updateOne(
          { _id: members[0]._id },
          {
            $set: {
              duplicateGroupId: null,
              isBestInGroup: false,
              similarityScore: null,
            },
          }
        )
      );
      continue;
    }

    const gid = `G${String(num++).padStart(4, "0")}`;
    const best = [...members].sort(
      (a, b) => (b.analysis?.finalScore ?? -1) - (a.analysis?.finalScore ?? -1)
    )[0];

    for (const p of members) {
      const d = hammingDistance(best.hashBits || [], p.hashBits || []);
      ops.push(
        Photo.updateOne(
          { _id: p._id },
          {
            $set: {
              duplicateGroupId: gid,
              isBestInGroup: String(p._id) === String(best._id),
              similarityScore: similarityFromDistance(d),
            },
          }
        )
      );
    }
  }

  await Promise.all(ops);
  return groups.size;
}

export async function retryFailed(userId) {
  const failed = await Photo.find({
    userId,
    "analysis.analysisStatus": "failed",
  });
  enqueuePhotos(failed);
  return failed.length;
}

export function queueStats() {
  return { pending: jobs.length, running };
}

