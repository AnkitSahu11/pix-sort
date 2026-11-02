export const SCORE_WEIGHTS = Object.freeze({
  aiQuality: 30,
  sharpness: 20,
  faceQuality: 15,
  expression: 10,
  technical: 15,
  composition: 10,
});

export function normalizeWeights(weights = SCORE_WEIGHTS) {
  const total = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
  if (total <= 0) throw new Error("Score weights must have a positive total");
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number(value || 0) / total]));
}

export function categoryForScore(score) {
  if (score == null) return "review";
  if (score >= 90) return "best";
  if (score >= 75) return "good";
  if (score >= 50) return "review";
  return "low";
}

export function calculateFinalScore(input = {}) {
  const value = (key) => {
    const raw = input[key];
    if (raw === null || raw === undefined || raw === "" || raw === "unavailable") return null;
    const num = Number(raw);
    return Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : null;
  };

  const values = {
    aiQuality: value("aiQualityScore"),
    sharpness: value("sharpnessScore"),
    faceQuality: value("faceQualityScore"),
    expression: value("expressionScore"),
    technical: value("technicalScore"),
    composition: value("compositionScore"),
  };

  let weighted = 0;
  let weightSum = 0;

  for (const [key, rawWeight] of Object.entries(SCORE_WEIGHTS)) {
    if (values[key] !== null) {
      weighted += values[key] * rawWeight;
      weightSum += rawWeight;
    }
  }

  if (weightSum === 0) return null;
  const final = Math.round((weighted / weightSum) * 100) / 100;
  return Math.max(0, Math.min(100, final));
}

export function diagnoseScore(input = {}, label = "") {
  const finalScore = calculateFinalScore(input);
  const category = categoryForScore(finalScore);

  const value = (key) => {
    const raw = input[key];
    if (raw === null || raw === undefined || raw === "" || raw === "unavailable") return "unavailable";
    const num = Number(raw);
    return Number.isFinite(num) ? `${Math.round(num * 10) / 10}` : "unavailable";
  };

  let weightSum = 0;
  for (const [key, rawWeight] of Object.entries(SCORE_WEIGHTS)) {
    const v = input[`${key}Score`];
    if (v !== null && v !== undefined && v !== "" && v !== "unavailable" && Number.isFinite(Number(v))) {
      weightSum += rawWeight;
    }
  }

  const lines = [
    `--- [Score Diagnostics: ${label || "Photo"}] ---`,
    `Sharpness:     ${value("sharpnessScore")} (weight: ${SCORE_WEIGHTS.sharpness})`,
    `Technical:     ${value("technicalScore")} (weight: ${SCORE_WEIGHTS.technical})`,
    `Face Quality:  ${value("faceQualityScore")} (weight: ${SCORE_WEIGHTS.faceQuality})`,
    `Expression:    ${value("expressionScore")} (weight: ${SCORE_WEIGHTS.expression})`,
    `Composition:   ${value("compositionScore")} (weight: ${SCORE_WEIGHTS.composition})`,
    `AI Quality:    ${value("aiQualityScore")} (weight: ${SCORE_WEIGHTS.aiQuality})`,
    `Available Weight Sum: ${weightSum} / 100`,
    `Final Score:   ${finalScore !== null ? finalScore : "N/A"}`,
    `Category:      ${category.toUpperCase()}`,
    `-----------------------------------------`,
  ];

  return {
    finalScore,
    category,
    weightSum,
    diagnosticText: lines.join("\n"),
  };
}

