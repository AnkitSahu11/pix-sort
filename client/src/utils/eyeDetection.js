import * as faceapi from "face-api.js";
import { updateEyes } from "../api";

export const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";

export const EYE_CONFIG = Object.freeze({
  openThreshold: 0.285,
  closedThreshold: 0.275,
  uncertainRange: [0.275, 0.285],
  minimumFaceConfidence: 0.20,
  minimumFaceSize: 20,
  inputSize: 512,
  scoreThreshold: 0.20,
  maxInferenceDimension: 1280,
});

let readyPromise = null;

/**
 * Loads face-api.js neural net models for face and 68-point landmark detection.
 */
export async function loadAIModels() {
  if (!readyPromise) {
    readyPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    ]).catch((err) => {
      readyPromise = null;
      console.error("[EyeDetection] Failed to load face-api models from CDN:", err);
      throw err;
    });
  }
  await readyPromise;
  return true;
}

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Calculates Eye Aspect Ratio (EAR) for a 6-point eye contour.
 * Points: [p0, p1, p2, p3, p4, p5]
 * Left eye indices: 36..41
 * Right eye indices: 42..47
 * EAR = (||p1 - p5|| + ||p2 - p4||) / (2 * ||p0 - p3||)
 */
export function computeEAR(pts) {
  if (!pts || pts.length < 6) return null;
  const width = distance(pts[0], pts[3]);
  if (!Number.isFinite(width) || width <= 0.001) return null;
  const h1 = distance(pts[1], pts[5]);
  const h2 = distance(pts[2], pts[4]);
  if (!Number.isFinite(h1) || !Number.isFinite(h2)) return null;
  const ear = (h1 + h2) / (2 * width);
  return Number.isFinite(ear) && ear >= 0 ? ear : null;
}

/**
 * Validates that 6 eye landmark points exist, are finite, and have reasonable geometry.
 */
export function validateEyeLandmarks(pts, faceBox) {
  if (!pts || pts.length < 6) return false;
  for (let i = 0; i < 6; i++) {
    const p = pts[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  const width = distance(pts[0], pts[3]);
  if (!Number.isFinite(width) || width < 2.0) return false;
  if (faceBox && width > faceBox.width * 0.85) return false;
  return true;
}

/**
 * Classifies a single eye EAR using calibrated threshold logic:
 * - >= openThreshold (0.285) -> OPEN
 * - <= closedThreshold (0.275) -> CLOSED
 * - in-between -> UNCERTAIN
 */
export function classifyEyeEAR(ear, config = EYE_CONFIG) {
  if (ear === null || ear === undefined || !Number.isFinite(ear)) return "UNCERTAIN";
  if (ear >= config.openThreshold) return "OPEN";
  if (ear <= config.closedThreshold) return "CLOSED";
  return "UNCERTAIN";
}

/**
 * Calculates a continuous expression quality score (0–100) based on eye state and EAR values.
 */
export function calculateExpressionScore(eyeState, leftEAR, rightEAR, confidence = 1.0) {
  const avgEAR = (leftEAR && rightEAR) ? (leftEAR + rightEAR) / 2 : (leftEAR || rightEAR || 0.25);

  if (eyeState === "BOTH_OPEN") {
    if (avgEAR >= 0.32) return Math.round(94 + Math.min(6, (avgEAR - 0.32) * 50));
    return Math.round(88 + ((avgEAR - 0.285) / 0.035) * 6);
  }

  if (eyeState === "ONE_EYE_CLOSED") {
    return Math.round(35 + Math.min(15, avgEAR * 35));
  }

  if (eyeState === "BOTH_CLOSED") {
    if (avgEAR <= 0.20) return Math.round(12 + (avgEAR / 0.20) * 6);
    return Math.round(18 + Math.min(7, (avgEAR - 0.20) * 70));
  }

  // UNCERTAIN state: 65 - 78 pts
  if (avgEAR >= 0.28) return Math.round(72 + ((avgEAR - 0.28) / 0.02) * 6);
  return Math.round(65 + ((avgEAR - 0.25) / 0.03) * 7);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error(`Failed to load image at ${url}`));
    img.src = url;
  });
}

function prepareInferenceCanvas(img, maxDim = EYE_CONFIG.maxInferenceDimension) {
  const srcW = img.naturalWidth || img.width || 1;
  const srcH = img.naturalHeight || img.height || 1;

  let dstW = srcW;
  let dstH = srcH;

  if (srcW > maxDim || srcH > maxDim) {
    if (srcW >= srcH) {
      dstW = maxDim;
      dstH = Math.round((srcH / srcW) * maxDim);
    } else {
      dstH = maxDim;
      dstW = Math.round((srcW / srcH) * maxDim);
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, dstW, dstH);
  return canvas;
}

/**
 * Performs multi-scale face and 68-point landmark detection on canvas.
 */
async function detectFacesWithFallback(canvas) {
  // Pass 1: standard inference size (512)
  let detections = await faceapi
    .detectAllFaces(
      canvas,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: EYE_CONFIG.inputSize,
        scoreThreshold: EYE_CONFIG.scoreThreshold,
      })
    )
    .withFaceLandmarks();

  // Pass 2: If no faces found with 512 on large canvas, try 416 with sensitive threshold
  if ((!detections || detections.length === 0) && (canvas.width >= 400 || canvas.height >= 400)) {
    detections = await faceapi
      .detectAllFaces(
        canvas,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: 0.15,
        })
      )
      .withFaceLandmarks();
  }

  return detections || [];
}

/**
 * Performs comprehensive multi-face detection, landmark geometry verification,
 * and adaptive closed-eye detection.
 */
export async function analyzePhotoFace(photo) {
  await loadAIModels();

  const sourceUrl = photo.url || photo.thumbnailUrl;
  const img = await loadImage(sourceUrl);
  const canvas = prepareInferenceCanvas(img, EYE_CONFIG.maxInferenceDimension);

  const detections = await detectFacesWithFallback(canvas);

  console.log(`[EyeDetection:Debug] Photo ${photo.originalName || photo._id}: ${detections.length} face(s) detected`);

  if (!detections || detections.length === 0) {
    console.log(`[EyeDetection:Debug] Photo ${photo.originalName || photo._id}: No face detected.`);
    return {
      faceCount: 0,
      faceDetected: false,
      faceChecked: true,
      faceScore: null,
      faceQualityScore: null,
      eyesOpen: null,
      eyesClosed: null,
      eyeState: null,
      eyeConfidence: null,
      leftEAR: null,
      rightEAR: null,
      avgEAR: null,
      facesWithEyesClosed: 0,
      facesWithEyesOpen: 0,
      eyesClosedCount: 0,
      flags: [],
      expressionScore: null,
    };
  }

  const canvasArea = canvas.width * canvas.height;
  const faceResults = [];

  for (let i = 0; i < detections.length; i++) {
    const det = detections[i];
    const score = det.detection.score;
    const box = det.detection.box;
    const faceArea = box.width * box.height;
    const areaRatio = Math.min(1, faceArea / canvasArea);

    if (box.width < EYE_CONFIG.minimumFaceSize || box.height < EYE_CONFIG.minimumFaceSize) {
      console.log(`[EyeDetection:Debug] Skipping face #${i + 1}: box too small (${box.width.toFixed(0)}x${box.height.toFixed(0)})`);
      continue;
    }

    const landmarks = det.landmarks;
    const has68Landmarks = landmarks && landmarks.positions && landmarks.positions.length === 68;

    // Landmark indexes: Left eye (36-41), Right eye (42-47)
    const leftPts = landmarks.getLeftEye();
    const rightPts = landmarks.getRightEye();

    const leftValid = validateEyeLandmarks(leftPts, box);
    const rightValid = validateEyeLandmarks(rightPts, box);

    const leftEAR = leftValid ? computeEAR(leftPts) : null;
    const rightEAR = rightValid ? computeEAR(rightPts) : null;
    const avgEAR = (leftEAR !== null && rightEAR !== null) ? (leftEAR + rightEAR) / 2 : (leftEAR ?? rightEAR ?? null);

    const leftState = classifyEyeEAR(leftEAR);
    const rightState = classifyEyeEAR(rightEAR);

    let eyeState = "UNCERTAIN";
    let isFaceClosed = false;
    let eyesClosedCount = 0;
    let confidence = score;

    if (leftValid && rightValid) {
      if (leftState === "CLOSED" && rightState === "CLOSED") {
        eyeState = "BOTH_CLOSED";
        isFaceClosed = true;
        eyesClosedCount = 2;
      } else if (
        (leftState === "CLOSED" && rightState === "OPEN") ||
        (leftState === "OPEN" && rightState === "CLOSED") ||
        (leftState === "CLOSED" && rightState === "UNCERTAIN") ||
        (leftState === "UNCERTAIN" && rightState === "CLOSED")
      ) {
        eyeState = "ONE_EYE_CLOSED";
        isFaceClosed = true;
        eyesClosedCount = 1;
      } else if (leftState === "OPEN" && rightState === "OPEN") {
        eyeState = "BOTH_OPEN";
        isFaceClosed = false;
        eyesClosedCount = 0;
      } else if (avgEAR !== null && avgEAR <= EYE_CONFIG.closedThreshold + 0.005) {
        // Average EAR is in the closed zone (e.g. 0.215 mid-blink)
        eyeState = "BOTH_CLOSED";
        isFaceClosed = true;
        eyesClosedCount = 2;
      } else if (leftState === "OPEN" || rightState === "OPEN") {
        eyeState = "BOTH_OPEN";
        isFaceClosed = false;
        confidence *= 0.85;
      } else {
        eyeState = "UNCERTAIN";
        confidence *= 0.75;
      }
    } else if (leftValid || rightValid) {
      const singleState = leftValid ? leftState : rightState;
      if (singleState === "CLOSED") {
        eyeState = "BOTH_CLOSED";
        isFaceClosed = true;
        eyesClosedCount = 1;
      } else if (singleState === "OPEN") {
        eyeState = "BOTH_OPEN";
        isFaceClosed = false;
      } else {
        eyeState = "UNCERTAIN";
      }
      confidence *= 0.7;
    }

    const scaleBonus = Math.min(15, areaRatio * 150);
    const landmarkBonus = leftValid && rightValid ? 10 : 0;
    const faceQuality = Math.min(100, Math.round(score * 75 + scaleBonus + landmarkBonus));
    const expressionScore = calculateExpressionScore(eyeState, leftEAR, rightEAR, confidence);

    console.log(
      `[EyeDetection:Debug] Face #${i + 1} | 68-Landmarks: ${has68Landmarks} | Left EAR: ${leftEAR !== null ? leftEAR.toFixed(3) : "N/A"} (${leftState}) | Right EAR: ${rightEAR !== null ? rightEAR.toFixed(3) : "N/A"} (${rightState}) | Avg EAR: ${avgEAR !== null ? avgEAR.toFixed(3) : "N/A"} | State: ${eyeState} | FaceClosed: ${isFaceClosed}`
    );

    faceResults.push({
      detectionScore: score,
      box,
      areaRatio,
      faceQuality,
      leftEAR: leftEAR !== null ? Math.round(leftEAR * 1000) / 1000 : null,
      rightEAR: rightEAR !== null ? Math.round(rightEAR * 1000) / 1000 : null,
      avgEAR: avgEAR !== null ? Math.round(avgEAR * 1000) / 1000 : null,
      leftState,
      rightState,
      eyeState,
      isFaceClosed,
      eyesClosedCount,
      confidence: Math.round(confidence * 100) / 100,
      expressionScore,
    });
  }

  if (faceResults.length === 0) {
    console.log(`[EyeDetection:Debug] Photo ${photo.originalName || photo._id}: No viable faces passed size/geometry filters.`);
    return {
      faceCount: detections.length,
      faceDetected: true,
      faceChecked: true,
      faceScore: Math.round(detections[0].detection.score * 100),
      faceQualityScore: Math.round(detections[0].detection.score * 70),
      eyesOpen: null,
      eyesClosed: null,
      eyeState: "UNCERTAIN",
      eyeConfidence: 0.5,
      leftEAR: null,
      rightEAR: null,
      avgEAR: null,
      facesWithEyesClosed: 0,
      facesWithEyesOpen: 0,
      eyesClosedCount: 0,
      flags: [],
      expressionScore: 70,
    };
  }

  faceResults.sort((a, b) => b.areaRatio - a.areaRatio);
  const primaryFace = faceResults[0];

  const totalWeight = faceResults.reduce((acc, f) => acc + (f.areaRatio + 0.1), 0);
  const weightedQuality = Math.round(
    faceResults.reduce((acc, f) => acc + f.faceQuality * (f.areaRatio + 0.1), 0) / totalWeight
  );
  const weightedExpression = Math.round(
    faceResults.reduce((acc, f) => acc + f.expressionScore * (f.areaRatio + 0.1), 0) / totalWeight
  );

  const closedFaces = faceResults.filter((f) => f.isFaceClosed);
  const openFaces = faceResults.filter((f) => f.eyeState === "BOTH_OPEN");
  const totalEyesClosedCount = faceResults.reduce((acc, f) => acc + f.eyesClosedCount, 0);

  const anyClosed = closedFaces.length > 0;
  const allOpen = openFaces.length === faceResults.length;

  let overallEyesOpen = null;
  let overallEyeState = primaryFace.eyeState;
  const flags = [];

  if (anyClosed) {
    overallEyesOpen = false;
    overallEyeState = closedFaces.some((f) => f.eyeState === "BOTH_CLOSED") ? "BOTH_CLOSED" : "ONE_EYE_CLOSED";
    flags.push("EYES");
  } else if (allOpen) {
    overallEyesOpen = true;
    overallEyeState = "BOTH_OPEN";
  } else {
    overallEyesOpen = primaryFace.eyeState === "BOTH_OPEN" ? true : primaryFace.eyeState === "BOTH_CLOSED" ? false : null;
    overallEyeState = primaryFace.eyeState;
    if (overallEyesOpen === false) flags.push("EYES");
  }

  const result = {
    faceCount: detections.length,
    faceDetected: true,
    faceChecked: true,
    faceScore: Math.round(primaryFace.detectionScore * 100),
    faceQualityScore: weightedQuality,
    eyesOpen: overallEyesOpen,
    eyesClosed: overallEyesOpen === false,
    eyeState: overallEyeState,
    eyeConfidence: primaryFace.confidence,
    leftEAR: primaryFace.leftEAR,
    rightEAR: primaryFace.rightEAR,
    avgEAR: primaryFace.avgEAR,
    facesWithEyesClosed: closedFaces.length,
    facesWithEyesOpen: openFaces.length,
    eyesClosedCount: totalEyesClosedCount,
    flags,
    expressionScore: weightedExpression,
  };

  console.log(
    `[EyeDetection:Result] ${photo.originalName || "Photo"} | Faces: ${result.faceCount} | Quality: ${result.faceQualityScore} | EyeState: ${result.eyeState} (L:${result.leftEAR ?? "—"}, R:${result.rightEAR ?? "—"}, Avg:${result.avgEAR ?? "—"}) | ClosedEyes: ${result.eyesClosedCount} | EYES Flag: ${flags.includes("EYES")}`
  );

  return result;
}

// Set of photo IDs currently being analyzed to prevent duplicate passes
const activeAnalyses = new Set();

/**
 * Runs client-side facial and eye analysis pass on a queue of photos sequentially.
 */
export async function runBackgroundEyePass(photos, onResult, onError) {
  try {
    await loadAIModels();
  } catch (e) {
    onError?.("model", e);
    return;
  }

  for (const p of photos) {
    const photoId = String(p._id);

    // Skip if already in progress
    if (activeAnalyses.has(photoId)) {
      console.log(`[EyeDetection] Skipping photo ${p.originalName || photoId}: Analysis already in progress.`);
      continue;
    }

    // Skip if already checked and completed
    if (
      p.analysis?.faceChecked === true ||
      (p.analysis?.faceDetected === false && p.analysis?.faceCount === 0) ||
      (p.analysis?.faceDetected === true && p.analysis?.eyeState !== null && p.analysis?.eyeState !== undefined)
    ) {
      console.log(`[EyeDetection] Skipping photo ${p.originalName || photoId}: faceChecked is already true.`);
      continue;
    }

    activeAnalyses.add(photoId);

    try {
      console.log(`[EyeDetection] Starting analysis on photo: ${p.originalName || photoId}`);
      const result = await analyzePhotoFace(p);

      console.log(`[EyeDetection] Sending PATCH /api/photos/${photoId}/eyes payload:`, {
        faceDetected: result.faceDetected,
        eyeState: result.eyeState,
        eyesClosed: result.eyesClosed,
        leftEAR: result.leftEAR,
        rightEAR: result.rightEAR,
      });

      const res = await updateEyes(photoId, {
        ...result,
        eyesClosed: result.eyesOpen === false,
        faceChecked: true,
      });

      console.log(`[EyeDetection] PATCH /api/photos/${photoId}/eyes succeeded! MongoDB updated.`);

      const updatedPhoto = res.data?.data;
      if (updatedPhoto) {
        onResult?.(photoId, updatedPhoto.analysis, updatedPhoto.flags);
      } else {
        onResult?.(photoId, { ...result, faceChecked: true }, result.flags);
      }
    } catch (e) {
      console.error(`[EyeDetection] Error analyzing photo ${p.originalName || photoId}:`, e);
      onError?.(photoId, e);
    } finally {
      activeAnalyses.delete(photoId);
    }
  }
}
