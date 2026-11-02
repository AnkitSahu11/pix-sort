import mongoose from "mongoose";

const analysisSchema = new mongoose.Schema({
  sharpnessScore: { type: Number, default: null },
  rawSharpnessMetric: { type: Number, default: null },
  blurStatus: { type: String, enum: ["sharp", "acceptable", "blurry", "unavailable"], default: "unavailable" },
  blurVar: { type: Number, default: null },
  faceCount: { type: Number, default: null },
  faceDetected: { type: Boolean, default: null },
  faceChecked: { type: Boolean, default: false },
  faceScore: { type: Number, default: null },
  eyesOpen: { type: Boolean, default: null },
  eyesClosed: { type: Boolean, default: null },
  eyeState: { type: String, enum: ["BOTH_OPEN", "ONE_EYE_CLOSED", "BOTH_CLOSED", "UNCERTAIN", null], default: null },
  eyeConfidence: { type: Number, default: null },
  leftEAR: { type: Number, default: null },
  rightEAR: { type: Number, default: null },
  avgEAR: { type: Number, default: null },
  facesWithEyesClosed: { type: Number, default: 0 },
  facesWithEyesOpen: { type: Number, default: 0 },
  eyesClosedCount: { type: Number, default: 0 },
  flags: { type: [String], default: [] },
  expressionScore: { type: Number, default: null },
  faceQualityScore: { type: Number, default: null },
  technicalScore: { type: Number, default: null },
  aiQualityScore: { type: Number, default: null },
  compositionScore: { type: Number, default: null },
  finalScore: { type: Number, default: null },
  width: { type: Number, default: null },
  height: { type: Number, default: null },
  brightness: { type: Number, default: null },
  brightnessRaw: { type: Number, default: null },
  contrast: { type: Number, default: null },
  contrastRaw: { type: Number, default: null },
  saturation: { type: Number, default: null },
  noiseScore: { type: Number, default: null },
  analysisStatus: { type: String, enum: ["pending", "processing", "complete", "partial", "failed"], default: "pending" },
  analysisError: { type: String, default: null },
  analyzedAt: { type: Date, default: null },
}, { _id: false });

const photoSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null, index: true },
  filename: { type: String, required: true },
  metadata: { sha256: { type: String, index: true } },
  originalName: { type: String, required: true },
  filePath: { type: String, required: true },
  thumbnailPath: { type: String, default: null },
  frameIndex: { type: Number, required: true },
  status: { type: String, enum: ["unreviewed", "shortlisted", "flagged", "rejected", "favorite"], default: "unreviewed", index: true },
  flagged: { type: Boolean, default: false, index: true },
  flags: { type: [String], default: [], index: true },
  favorite: { type: Boolean, default: false },
  hashBits: { type: [Number], default: [] },
  duplicateGroupId: { type: String, default: null, index: true },
  similarityScore: { type: Number, default: null },
  isBestInGroup: { type: Boolean, default: false },
  analysis: analysisSchema,
}, { timestamps: true });

photoSchema.index({ userId: 1, projectId: 1, createdAt: -1 });
photoSchema.index({ userId: 1, "analysis.finalScore": -1 });
photoSchema.index({ userId: 1, status: 1, createdAt: -1 });
photoSchema.index({ userId: 1, flagged: 1 });
photoSchema.index({ userId: 1, flags: 1 });

export default mongoose.model("Photo", photoSchema);

