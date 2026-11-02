import sharp from "sharp";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { calculateFinalScore, categoryForScore } from "../config/scoring.js";

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(v) || 0));
}

/**
 * Maps raw 2D Laplacian variance to a calibrated 0–100 sharpness score.
 * - < 20: blurry / soft (0–35)
 * - 20–65: acceptable / moderate (40–68)
 * - 65–200: sharp / good (70–88)
 * - > 200: crisp / excellent (90–100)
 */
export function varianceToSharpnessScore(variance) {
  if (!Number.isFinite(variance) || variance <= 0) return 0;

  if (variance <= 30) {
    return Math.round(clamp((variance / 30) * 45) * 100) / 100;
  }
  if (variance <= 80) {
    const t = (variance - 30) / (80 - 30);
    return Math.round((45 + t * 27) * 100) / 100;
  }
  if (variance <= 220) {
    const t = (variance - 80) / (220 - 80);
    return Math.round((72 + t * 18) * 100) / 100;
  }
  const t = Math.min(1, (variance - 220) / 380);
  return Math.round((90 + t * 9.8) * 100) / 100;
}

export function classifyBlur(sharpnessScore) {
  if (sharpnessScore < 45) return "blurry";
  if (sharpnessScore < 68) return "acceptable";
  return "sharp";
}

/**
 * Evaluates photographic exposure quality from mean channel luminance (0–255).
 * Properly exposed midtones (80–165) score 88–98+.
 * Severe underexposure (< 35) or overexposure (> 225) score low.
 */
export function calculateBrightnessQuality(meanLuminance) {
  const lum = clamp(meanLuminance, 0, 255);
  if (lum >= 80 && lum <= 165) {
    const dev = Math.abs(lum - 122.5);
    return Math.round(98 - (dev / 42.5) * 8);
  }
  if (lum < 80) {
    if (lum <= 35) {
      return Math.round(10 + (lum / 35) * 35);
    }
    return Math.round(45 + ((lum - 35) / 45) * 43);
  }
  if (lum <= 215) {
    return Math.round(90 - ((lum - 165) / 50) * 25);
  }
  return Math.round(Math.max(10, 65 - ((lum - 215) / 40) * 50));
}

/**
 * Evaluates dynamic range / contrast quality from channel stdev (0–128).
 * Healthy contrast (38–76) scores 88–98.
 * Extremely flat (< 15) or extreme clipping (> 95) score lower.
 */
export function calculateContrastQuality(stdev) {
  const s = clamp(stdev, 0, 128);
  if (s >= 38 && s <= 76) {
    const dev = Math.abs(s - 57);
    return Math.round(98 - (dev / 19) * 8);
  }
  if (s < 38) {
    if (s <= 15) {
      return Math.round(15 + (s / 15) * 35);
    }
    return Math.round(50 + ((s - 15) / 23) * 38);
  }
  if (s <= 95) {
    return Math.round(90 - ((s - 76) / 19) * 15);
  }
  return Math.round(Math.max(20, 75 - ((s - 95) / 33) * 45));
}

/**
 * Computes 2D Discrete Laplacian Convolution over a greyscale image.
 * Uses standard 4-neighbour discrete Laplacian operator:
 *   Laplacian(x, y) = I(x+1, y) + I(x-1, y) + I(x, y+1) + I(x, y-1) - 4 * I(x, y)
 */
export function compute2DLaplacianVariance(buffer, width, height) {
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    const prevRowOffset = (y - 1) * width;
    const nextRowOffset = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const center = buffer[rowOffset + x];
      const lap =
        buffer[rowOffset + (x + 1)] +
        buffer[rowOffset + (x - 1)] +
        buffer[nextRowOffset + x] +
        buffer[prevRowOffset + x] -
        4 * center;

      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

export async function analyzeImage(filePath, thumbnailPath) {
  const image = sharp(filePath, { failOn: "error" });
  const meta = await image.metadata();

  // Resize for statistical color analysis
  const stats = await sharp(filePath)
    .resize({ width: 320, height: 320, fit: "inside" })
    .removeAlpha()
    .stats();

  const channels = stats.channels;
  const means = channels.map((c) => c.mean);
  const stdevs = channels.map((c) => c.stdev);

  const rawMeanBrightness = means.reduce((a, b) => a + b, 0) / (means.length || 1);
  const rawMeanStdev = stdevs.reduce((a, b) => a + b, 0) / (stdevs.length || 1);

  const brightnessScore = calculateBrightnessQuality(rawMeanBrightness);
  const contrastScore = calculateContrastQuality(rawMeanStdev);

  const saturation =
    meta.channels >= 3
      ? clamp(((means[0] || 0) + (means[1] || 0) + (means[2] || 0)) / 3 / 255 * 100)
      : null;

  // Compute 2D discrete Laplacian variance on 220x220 greyscale buffer
  const sampleWidth = 220;
  const sampleHeight = 220;
  const gray = await sharp(filePath)
    .resize({ width: sampleWidth, height: sampleHeight, fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rawVariance = compute2DLaplacianVariance(gray.data, sampleWidth, sampleHeight);
  const sharpnessScore = varianceToSharpnessScore(rawVariance);
  const blurStatus = classifyBlur(sharpnessScore);

  // Technical score combines exposure quality (35%), contrast quality (30%), and sharpness (35%)
  const technicalScore = Math.round(
    clamp(brightnessScore * 0.35 + contrastScore * 0.30 + sharpnessScore * 0.35)
  );

  // Compute 64-bit perceptual aHash for duplicate grouping
  const hashBits = await averageHash(filePath);

  // Generate 480px contact-sheet thumbnail
  if (thumbnailPath) {
    await sharp(filePath)
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(thumbnailPath);
  }

  // Diagnostic log for development verification
  console.log(`[ImageAnalysis] File: ${path.basename(filePath)} | Raw Variance: ${rawVariance.toFixed(1)} -> Sharpness: ${sharpnessScore} (${blurStatus}) | Brightness: ${rawMeanBrightness.toFixed(1)} (${brightnessScore}pts) | Contrast: ${rawMeanStdev.toFixed(1)} (${contrastScore}pts) | Technical: ${technicalScore}`);

  return {
    width: meta.width || null,
    height: meta.height || null,
    brightness: Math.round(brightnessScore * 100) / 100,
    brightnessRaw: Math.round(rawMeanBrightness * 100) / 100,
    contrast: Math.round(contrastScore * 100) / 100,
    contrastRaw: Math.round(rawMeanStdev * 100) / 100,
    saturation: saturation == null ? null : Math.round(saturation * 100) / 100,
    noiseScore: null,
    rawSharpnessMetric: Math.round(rawVariance * 100) / 100,
    sharpnessScore: Math.round(sharpnessScore * 100) / 100,
    blurVar: Math.round(rawVariance * 100) / 100,
    blurStatus,
    technicalScore,
    hashBits,
    thumbnailPath,
  };
}

export async function averageHash(filePath) {
  const { data } = await sharp(filePath)
    .resize(8, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let avg = 0;
  for (const p of data) avg += p;
  avg /= data.length || 1;

  return Array.from(data, (p) => (p >= avg ? 1 : 0));
}

export function hammingDistance(a, b) {
  let d = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) d++;
  }
  return d + Math.abs(a.length - b.length);
}

export function similarityFromDistance(d) {
  return Math.round(Math.max(0, 100 - (d / 64) * 100) * 100) / 100;
}

export function contentHash(filePath) {
  return new Promise(async (resolve, reject) => {
    try {
      const hash = crypto.createHash("sha256");
      const data = await fs.readFile(filePath);
      resolve(hash.update(data).digest("hex"));
    } catch (e) {
      reject(e);
    }
  });
}

export { categoryForScore, calculateFinalScore };

