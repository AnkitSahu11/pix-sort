import fs from "node:fs/promises";
import path from "node:path";
import { Jimp } from "jimp";

export const HAMMING_THRESHOLD = 6;

const LAPLACIAN = [
  [0, 1, 0],
  [1, -4, 1],
  [0, 1, 0]
];

export async function loadImage(filePath) {
  return Jimp.read(filePath);
}

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function computeBlurVariance(image) {
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const values = new Float64Array(width * height);

  image.scan((x, y, idx) => {
    values[y * width + x] = luminance(
      image.bitmap.data[idx],
      image.bitmap.data[idx + 1],
      image.bitmap.data[idx + 2]
    );
  });

  const edges = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          sum += values[(y + ky) * width + (x + kx)] * LAPLACIAN[ky + 1][kx + 1];
        }
      }
      edges.push(sum);
    }
  }

  if (!edges.length) return 0;
  const mean = edges.reduce((a, b) => a + b, 0) / edges.length;
  return edges.reduce((acc, value) => acc + (value - mean) ** 2, 0) / edges.length;
}

export async function analyzeBlur(filePath) {
  const image = await loadImage(filePath);
  image.greyscale();
  image.resize({ w: 220, h: 220 });
  return computeBlurVariance(image);
}

export async function computeAHash(filePath) {
  const image = await loadImage(filePath);
  image.greyscale();
  image.resize({ w: 8, h: 8 });

  const pixels = [];
  image.scan((x, y, idx) => {
    pixels.push(image.bitmap.data[idx]);
  });

  const average = pixels.reduce((a, b) => a + b, 0) / pixels.length;
  return pixels.map((p) => (p >= average ? 1 : 0));
}

export function hammingDistance(a, b) {
  let distance = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance + Math.abs(a.length - b.length);
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = Array(size).fill(0);
  }

  find(x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  union(a, b) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
  }
}

export function buildGroups(photos) {
  const uf = new UnionFind(photos.length);

  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      if (hammingDistance(photos[i].hashBits, photos[j].hashBits) <= HAMMING_THRESHOLD) {
        uf.union(i, j);
      }
    }
  }

  const groups = new Map();
  photos.forEach((photo, index) => {
    const root = uf.find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(photo);
  });

  const groupIds = new Map();
  let groupNumber = 1;
  for (const members of groups.values()) {
    if (members.length < 2) {
      members.forEach((photo) => groupIds.set(String(photo._id), null));
      continue;
    }
    const id = `G${String(groupNumber).padStart(3, "0")}`;
    groupNumber++;
    members.forEach((photo) => groupIds.set(String(photo._id), id));
  }

  return groupIds;
}

export async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    // File may already be gone.
  }
}

export function uploadPath(uploadDir, filename) {
  return path.join(uploadDir, filename);
}
