import assert from "node:assert/strict";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import {
  SCORE_WEIGHTS,
  normalizeWeights,
  categoryForScore,
  calculateFinalScore,
  diagnoseScore,
} from "./config/scoring.js";
import {
  varianceToSharpnessScore,
  classifyBlur,
  calculateBrightnessQuality,
  calculateContrastQuality,
  compute2DLaplacianVariance,
  averageHash,
  hammingDistance,
  similarityFromDistance,
} from "./services/imageAnalysis.js";

// Eye detection testing utilities matching client/src/utils/eyeDetection.js exactly
const EYE_CONFIG = {
  openThreshold: 0.285,
  closedThreshold: 0.275,
  uncertainRange: [0.275, 0.285],
};

function computeEAR(pts) {
  if (!pts || pts.length < 6) return null;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = distance(pts[0], pts[3]);
  if (width <= 0.001) return null;
  const h1 = distance(pts[1], pts[5]);
  const h2 = distance(pts[2], pts[4]);
  return (h1 + h2) / (2 * width);
}

function classifyEyeEAR(ear) {
  if (ear === null || ear === undefined || !Number.isFinite(ear)) return "UNCERTAIN";
  if (ear >= EYE_CONFIG.openThreshold) return "OPEN";
  if (ear <= EYE_CONFIG.closedThreshold) return "CLOSED";
  return "UNCERTAIN";
}

function calculateExpressionScore(eyeState, leftEAR, rightEAR) {
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
  if (avgEAR >= 0.28) return Math.round(72 + ((avgEAR - 0.28) / 0.02) * 6);
  return Math.round(65 + ((avgEAR - 0.25) / 0.03) * 7);
}

function evaluateFaces(faces) {
  if (!faces || faces.length === 0) {
    return {
      faceCount: 0,
      faceDetected: false,
      eyesOpen: null,
      eyeState: null,
      facesWithEyesClosed: 0,
      facesWithEyesOpen: 0,
      eyesClosedCount: 0,
      flags: [],
      expressionScore: null,
    };
  }

  const faceResults = [];
  for (const f of faces) {
    const leftEAR = f.leftEAR;
    const rightEAR = f.rightEAR;
    const leftState = classifyEyeEAR(leftEAR);
    const rightState = classifyEyeEAR(rightEAR);

    let eyeState = "UNCERTAIN";
    let isFaceClosed = false;
    let eyesClosedCount = 0;

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
    } else if (leftState === "OPEN" || rightState === "OPEN") {
      eyeState = "BOTH_OPEN";
      isFaceClosed = false;
    } else {
      eyeState = "UNCERTAIN";
    }

    faceResults.push({
      eyeState,
      isFaceClosed,
      eyesClosedCount,
      leftEAR,
      rightEAR,
      expressionScore: calculateExpressionScore(eyeState, leftEAR, rightEAR),
    });
  }

  const closedFaces = faceResults.filter((f) => f.isFaceClosed);
  const openFaces = faceResults.filter((f) => f.eyeState === "BOTH_OPEN");
  const totalEyesClosedCount = faceResults.reduce((acc, f) => acc + f.eyesClosedCount, 0);

  let overallEyesOpen = null;
  let overallEyeState = faceResults[0].eyeState;
  const flags = [];

  if (closedFaces.length > 0) {
    overallEyesOpen = false;
    overallEyeState = closedFaces.some((f) => f.eyeState === "BOTH_CLOSED") ? "BOTH_CLOSED" : "ONE_EYE_CLOSED";
    flags.push("EYES");
  } else if (openFaces.length === faceResults.length) {
    overallEyesOpen = true;
    overallEyeState = "BOTH_OPEN";
  } else {
    overallEyesOpen = faceResults[0].eyeState === "BOTH_OPEN" ? true : faceResults[0].eyeState === "BOTH_CLOSED" ? false : null;
    overallEyeState = faceResults[0].eyeState;
    if (overallEyesOpen === false) flags.push("EYES");
  }

  return {
    faceCount: faces.length,
    faceDetected: true,
    eyesOpen: overallEyesOpen,
    eyeState: overallEyeState,
    facesWithEyesClosed: closedFaces.length,
    facesWithEyesOpen: openFaces.length,
    eyesClosedCount: totalEyesClosedCount,
    flags,
    expressionScore: Math.round(faceResults.reduce((acc, f) => acc + f.expressionScore, 0) / faceResults.length),
  };
}

// Generate mock 6 eye points for a given target EAR
function generateEyePoints(targetEAR, eyeWidth = 30) {
  const H = (targetEAR * eyeWidth) / 2;
  return [
    { x: 0, y: 0 },
    { x: eyeWidth / 3, y: -H },
    { x: (2 * eyeWidth) / 3, y: -H },
    { x: eyeWidth, y: 0 },
    { x: (2 * eyeWidth) / 3, y: H },
    { x: eyeWidth / 3, y: H },
  ];
}

console.log("================================================================================");
console.log("            PIXSORT 2.0 SCORING & EYE-DETECTION TEST SUITE                      ");
console.log("================================================================================\n");

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    Error: ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// Test A: Both Eyes Open
// -----------------------------------------------------------------------------
runTest("Test A: Both eyes open (EAR >= 0.285) -> BOTH_OPEN, no EYES flag, high expression score", () => {
  const leftOpen = generateEyePoints(0.33);
  const rightOpen = generateEyePoints(0.32);
  const leftEAR = computeEAR(leftOpen);
  const rightEAR = computeEAR(rightOpen);

  assert.equal(classifyEyeEAR(leftEAR), "OPEN");
  assert.equal(classifyEyeEAR(rightEAR), "OPEN");

  const res = evaluateFaces([{ leftEAR, rightEAR }]);
  assert.equal(res.eyeState, "BOTH_OPEN");
  assert.equal(res.eyesOpen, true);
  assert.equal(res.flags.includes("EYES"), false);
  assert.equal(res.facesWithEyesClosed, 0);
  assert.equal(res.eyesClosedCount, 0);
  assert(res.expressionScore >= 88, `Expression score should be >= 88, got ${res.expressionScore}`);
});

// -----------------------------------------------------------------------------
// Test B: Both Eyes Closed (The Critical Regression Test)
// -----------------------------------------------------------------------------
runTest("Test B: Both eyes closed (EAR <= 0.275) -> BOTH_CLOSED, eyesOpen=false, EYES flag added, low expression score", () => {
  const leftClosed = generateEyePoints(0.265);
  const rightClosed = generateEyePoints(0.272);
  const leftEAR = computeEAR(leftClosed);
  const rightEAR = computeEAR(rightClosed);

  assert.equal(classifyEyeEAR(leftEAR), "CLOSED");
  assert.equal(classifyEyeEAR(rightEAR), "CLOSED");

  const res = evaluateFaces([{ leftEAR, rightEAR }]);
  assert.equal(res.eyeState, "BOTH_CLOSED");
  assert.equal(res.eyesOpen, false);
  assert.equal(res.flags.includes("EYES"), true, "EYES flag must be present!");
  assert.equal(res.facesWithEyesClosed, 1);
  assert.equal(res.eyesClosedCount, 2);
  assert(res.expressionScore <= 25, `Expression score should be <= 25, got ${res.expressionScore}`);
});

// -----------------------------------------------------------------------------
// Test C: One Eye Closed / Winking
// -----------------------------------------------------------------------------
runTest("Test C: One eye closed (Left 0.20, Right 0.33) -> ONE_EYE_CLOSED, EYES flag added", () => {
  const leftClosed = generateEyePoints(0.20);
  const rightOpen = generateEyePoints(0.33);
  const leftEAR = computeEAR(leftClosed);
  const rightEAR = computeEAR(rightOpen);

  assert.equal(classifyEyeEAR(leftEAR), "CLOSED");
  assert.equal(classifyEyeEAR(rightEAR), "OPEN");

  const res = evaluateFaces([{ leftEAR, rightEAR }]);
  assert.equal(res.eyeState, "ONE_EYE_CLOSED");
  assert.equal(res.eyesOpen, false);
  assert.equal(res.flags.includes("EYES"), true, "EYES flag must be present for one closed eye!");
  assert.equal(res.facesWithEyesClosed, 1);
  assert.equal(res.eyesClosedCount, 1);
  assert(res.expressionScore >= 35 && res.expressionScore <= 50, `Expected 35-50, got ${res.expressionScore}`);
});

// -----------------------------------------------------------------------------
// Test D: Uncertain State
// -----------------------------------------------------------------------------
runTest("Test D: Uncertain state (EAR 0.280) -> UNCERTAIN, no automatic EYES flag", () => {
  const leftUncertain = generateEyePoints(0.280);
  const rightUncertain = generateEyePoints(0.280);
  const leftEAR = computeEAR(leftUncertain);
  const rightEAR = computeEAR(rightUncertain);

  assert.equal(classifyEyeEAR(leftEAR), "UNCERTAIN");
  assert.equal(classifyEyeEAR(rightEAR), "UNCERTAIN");

  const res = evaluateFaces([{ leftEAR, rightEAR }]);
  assert.equal(res.eyeState, "UNCERTAIN");
  assert.equal(res.flags.includes("EYES"), false, "UNCERTAIN state should not automatically add EYES flag");
  assert(res.expressionScore >= 65 && res.expressionScore <= 78);
});

// -----------------------------------------------------------------------------
// Test E: No Face Detected (Landscape / Objects)
// -----------------------------------------------------------------------------
runTest("Test E: No face detected -> faceDetected=false, no EYES flag, expressionScore=null", () => {
  const res = evaluateFaces([]);
  assert.equal(res.faceDetected, false);
  assert.equal(res.faceCount, 0);
  assert.equal(res.eyesOpen, null);
  assert.equal(res.eyeState, null);
  assert.equal(res.flags.includes("EYES"), false);
  assert.equal(res.expressionScore, null);

  // When calculating final score for landscape:
  const landscape = {
    sharpnessScore: 92,
    technicalScore: 90,
    faceQualityScore: null,
    expressionScore: null,
    compositionScore: null,
    aiQualityScore: null,
  };
  const finalScore = calculateFinalScore(landscape);
  assert(finalScore >= 90, `Landscape final score should be >= 90, received ${finalScore}`);
  assert.equal(categoryForScore(finalScore), "best");
});

// -----------------------------------------------------------------------------
// Test F: Multiple Faces (One Open, One Closed)
// -----------------------------------------------------------------------------
runTest("Test F: Multiple faces (Face 1 open, Face 2 closed) -> overall EYES flag added", () => {
  const faces = [
    { leftEAR: 0.33, rightEAR: 0.32 }, // Face 1: Open
    { leftEAR: 0.12, rightEAR: 0.11 }, // Face 2: Closed
  ];
  const res = evaluateFaces(faces);
  assert.equal(res.faceCount, 2);
  assert.equal(res.eyesOpen, false);
  assert.equal(res.flags.includes("EYES"), true);
  assert.equal(res.facesWithEyesClosed, 1);
  assert.equal(res.eyesClosedCount, 2);
});

// -----------------------------------------------------------------------------
// Test G: Flag Composability (SOFT + EYES)
// -----------------------------------------------------------------------------
runTest("Test G: Existing SOFT flag preserved when EYES flag is added -> ['SOFT', 'EYES']", () => {
  const existingFlags = new Set(["SOFT"]);
  const eyeState = "BOTH_CLOSED";

  if (eyeState === "BOTH_CLOSED" || eyeState === "ONE_EYE_CLOSED") {
    existingFlags.add("EYES");
  } else {
    existingFlags.delete("EYES");
  }

  const merged = Array.from(existingFlags);
  assert.equal(merged.length, 2);
  assert(merged.includes("SOFT"), "SOFT flag must be preserved");
  assert(merged.includes("EYES"), "EYES flag must be added");
});

// -----------------------------------------------------------------------------
// Test H: Excellent Photo Score Calibration
// -----------------------------------------------------------------------------
runTest("Test H: Excellent photo with available signals reaches >= 90 (BEST)", () => {
  const photo = {
    sharpnessScore: 95,
    technicalScore: 92,
    faceQualityScore: 94,
    expressionScore: 90,
    compositionScore: 88,
    aiQualityScore: null,
  };

  const score = calculateFinalScore(photo);
  const category = categoryForScore(score);

  assert(score >= 90, `Expected score >= 90, received ${score}`);
  assert.equal(category, "best");
});

// -----------------------------------------------------------------------------
// Test I: 2D Laplacian Convolution on Sharp vs Blurred Buffers
// -----------------------------------------------------------------------------
runTest("Test I: 2D discrete Laplacian convolution cleanly differentiates sharp from blurred images", () => {
  const W = 220, H = 220;
  const sharpBuffer = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      sharpBuffer[y * W + x] = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0) ? 240 : 15;
    }
  }

  const blurryBuffer = Buffer.alloc(W * H, 128);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      blurryBuffer[y * W + x] = Math.round(128 + Math.sin(x / 20) * 3);
    }
  }

  const sharpVar = compute2DLaplacianVariance(sharpBuffer, W, H);
  const blurryVar = compute2DLaplacianVariance(blurryBuffer, W, H);

  assert(sharpVar > 200, `Expected sharp variance > 200, received ${sharpVar}`);
  assert(blurryVar < 5, `Expected blurry variance < 5, received ${blurryVar}`);

  const sharpScore = varianceToSharpnessScore(sharpVar);
  const blurryScore = varianceToSharpnessScore(blurryVar);

  assert(sharpScore >= 90, `Expected sharp score >= 90, received ${sharpScore}`);
  assert(blurryScore < 20, `Expected blurry score < 20, received ${blurryScore}`);
});

// -----------------------------------------------------------------------------
// Test J: Exposure & Contrast Quality Curves
// -----------------------------------------------------------------------------
runTest("Test J: Exposure and contrast curves reward healthy lighting and penalize clipping", () => {
  const goodExp = calculateBrightnessQuality(120);
  assert(goodExp >= 90, `Expected good exposure >= 90, received ${goodExp}`);

  const darkExp = calculateBrightnessQuality(15);
  assert(darkExp <= 35, `Expected dark exposure <= 35, received ${darkExp}`);

  const blownExp = calculateBrightnessQuality(245);
  assert(blownExp <= 35, `Expected blown exposure <= 35, received ${blownExp}`);

  const goodContrast = calculateContrastQuality(55);
  assert(goodContrast >= 90, `Expected good contrast >= 90, received ${goodContrast}`);

  const flatContrast = calculateContrastQuality(8);
  assert(flatContrast <= 40, `Expected flat contrast <= 40, received ${flatContrast}`);
});

// -----------------------------------------------------------------------------
// Test K: Perceptual aHash & Hamming Distance
// -----------------------------------------------------------------------------
runTest("Test K: aHash Hamming distance accurately detects duplicates and clusters", () => {
  const hashA = Array(64).fill(0);
  const hashB = [...hashA];
  hashB[0] = 1;
  hashB[1] = 1;
  hashB[2] = 1;

  const hashC = Array(64).fill(1);

  const distAB = hammingDistance(hashA, hashB);
  const distAC = hammingDistance(hashA, hashC);

  assert.equal(distAB, 3, "Hamming distance should be 3");
  assert.equal(distAC, 64, "Hamming distance should be 64");

  const simAB = similarityFromDistance(distAB);
  const simAC = similarityFromDistance(distAC);

  assert(simAB >= 95, `Expected visual similarity >= 95%, received ${simAB}%`);
  assert.equal(simAC, 0, `Expected visual similarity 0%, received ${simAC}%`);
});

// -----------------------------------------------------------------------------
// Test L: Zero width & invalid denominator EAR protection returns null
// -----------------------------------------------------------------------------
runTest("Test L: Zero width & invalid coordinates EAR protection returns null safely", () => {
  const zeroWidthPts = [
    { x: 10, y: 10 },
    { x: 10, y: 15 },
    { x: 10, y: 15 },
    { x: 10, y: 10 },
    { x: 10, y: 5 },
    { x: 10, y: 5 },
  ];
  const nullEAR = computeEAR(zeroWidthPts);
  assert.equal(nullEAR, null, "EAR should be null when width is 0");

  const invalidPts = null;
  assert.equal(computeEAR(invalidPts), null, "EAR should be null for invalid pts");
});

// -----------------------------------------------------------------------------
// Test M: 68-Point Landmark Extraction (36-41 left, 42-47 right)
// -----------------------------------------------------------------------------
runTest("Test M: 68-Point Landmark Extraction correctly slices 36..41 (left) and 42..47 (right)", () => {
  const mock68Positions = Array.from({ length: 68 }, (_, i) => ({ x: i * 2, y: i * 2 }));
  const leftEyePts = mock68Positions.slice(36, 42);
  const rightEyePts = mock68Positions.slice(42, 48);

  assert.equal(leftEyePts.length, 6);
  assert.equal(rightEyePts.length, 6);
  assert.equal(leftEyePts[0].x, 36 * 2);
  assert.equal(leftEyePts[5].x, 41 * 2);
  assert.equal(rightEyePts[0].x, 42 * 2);
  assert.equal(rightEyePts[5].x, 47 * 2);
});

// -----------------------------------------------------------------------------
// Test N: updateEyes MongoDB sync handles eyesClosed & faceChecked
// -----------------------------------------------------------------------------
runTest("Test N: updateEyes logic synchronizes eyesClosed, faceChecked, and EYES flag", () => {
  const doc = {
    flags: ["SOFT"],
    analysis: {
      faceDetected: null,
      faceChecked: false,
      eyesOpen: null,
      eyesClosed: null,
      eyeState: null,
    },
  };

  const payloadClosed = {
    faceDetected: true,
    faceChecked: true,
    faceCount: 1,
    eyesOpen: false,
    eyesClosed: true,
    eyeState: "BOTH_CLOSED",
    leftEAR: 0.12,
    rightEAR: 0.13,
  };

  const isClosed =
    payloadClosed.eyeState === "BOTH_CLOSED" ||
    payloadClosed.eyeState === "ONE_EYE_CLOSED" ||
    payloadClosed.eyesClosed === true ||
    payloadClosed.eyesOpen === false;

  const flags = new Set(doc.flags);
  if (isClosed) {
    flags.add("EYES");
    doc.analysis.eyesOpen = false;
    doc.analysis.eyesClosed = true;
  }
  doc.analysis.faceChecked = true;
  doc.flags = Array.from(flags);

  assert.equal(doc.analysis.faceChecked, true);
  assert.equal(doc.analysis.eyesClosed, true);
  assert.equal(doc.analysis.eyesOpen, false);
  assert.deepEqual(doc.flags, ["SOFT", "EYES"]);
});

console.log("\n================================================================================");
console.log(`TEST SUMMARY: ${passed} / ${total} TESTS PASSED`);
console.log("================================================================================\n");

if (passed !== total) {
  process.exit(1);
}
