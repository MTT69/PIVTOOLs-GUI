'use client';

// --- Type Definitions ---

export type DType = "uint8" | "uint16";

export interface RawImage {
  data: Uint8Array | Uint16Array;
  width: number;
  height: number;
  bitDepth: number;
  dtype: DType;
}


// --- Helper Functions ---

function hexToRgb(hex: string): [number, number, number] {
  const parsed = hex.replace("#", "");
  const bigint = parseInt(parsed, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Builds a colormap array for image rendering.
 * @param name The name of the colormap (e.g., 'gray', 'viridis').
 * @param size The number of colors in the map.
 * @returns A Uint8ClampedArray of RGB values.
 */
export function buildColormap(name: "gray" | "viridis", size = 256): Uint8ClampedArray {
  const arr = new Uint8ClampedArray(size * 3);
  if (name === "gray") {
    for (let i = 0; i < size; i++) {
      arr[i * 3] = i;
      arr[i * 3 + 1] = i;
      arr[i * 3 + 2] = i;
    }
    return arr;
  }

  // Viridis colormap stops
  const stops = ["#440154", "#414487", "#2A788E", "#22A884", "#7AD151", "#FDE725"];
  const colors = stops.map(hexToRgb);

  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    const seg = (colors.length - 1) * t;
    const i0 = Math.floor(seg);
    const i1 = Math.min(i0 + 1, colors.length - 1);
    const localT = seg - i0;
    
    const r = Math.round(lerp(colors[i0][0], colors[i1][0], localT));
    const g = Math.round(lerp(colors[i0][1], colors[i1][1], localT));
    const b = Math.round(lerp(colors[i0][2], colors[i1][2], localT));

    arr[i * 3] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
  return arr;
}

/**
 * Calculates a percentile from a raw typed array using sampling for performance.
 * @param arr The raw image data array.
 * @param p The percentile to calculate (0-100).
 * @returns The value at the specified percentile.
 */
export function percentileFromRaw(arr: Uint8Array | Uint16Array, p: number): number {
  const n = arr.length;
  // Use a smaller sample for very large images to avoid slow sorting
  const sampleSize = Math.min(n, 200_000);

  let sample: number[];
  if (sampleSize === n) {
    sample = Array.from(arr);
  } else {
    // Reservoir-like random sample for large arrays
    sample = [];
    const step = Math.max(1, Math.floor(n / sampleSize));
    for (let i = 0; i < n && sample.length < sampleSize; i += step) {
      sample.push(arr[i]);
    }
  }
  
  sample.sort((a, b) => a - b);
  const idx = Math.min(sample.length - 1, Math.max(0, Math.floor((p / 100) * sample.length)));
  return sample[idx];
}

/**
 * Decodes a base64 string into an ArrayBuffer.
 * @param base64 The base64 encoded string.
 * @returns An ArrayBuffer.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Decodes a base64 string into a specific typed array.
 * @param base64 The base64 encoded string.
 * @param dtype The target data type ('uint8' or 'uint16').
 * @returns A Uint8Array or Uint16Array.
 */
export function decodeTypedArray(base64: string, dtype: DType): Uint8Array | Uint16Array {
  const buf = base64ToArrayBuffer(base64);
  let arr: Uint8Array | Uint16Array;
  if (dtype === "uint16") {
    arr = new Uint16Array(buf);
  } else {
    arr = new Uint8Array(buf);
  }
  if (typeof window !== 'undefined') {
    console.log('[decodeTypedArray] base64 length:', base64.length, 'decoded array length:', arr.length, 'sample:', arr.slice(0, 8));
  }
  return arr;
}