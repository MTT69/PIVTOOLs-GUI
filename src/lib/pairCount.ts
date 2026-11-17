/**
 * The frame-pair count the backend computes, and why it may have none. Pure module.
 *
 * `GET /backend/config` and `POST /backend/update_config` (in `updated.images`)
 * carry `images.num_frame_pairs` and `images.per_loop_frame_pairs`. A `.pivraw`
 * run the reader refuses has no count: both are null and `images.pairing_error`
 * holds the reader's message. When the run is paired, `pairing_error` is absent.
 * The three keys are computed by the backend and are never posted back.
 */

import { errorMessage } from './api';

export const SERVER_ONLY_IMAGE_KEYS = ['num_frame_pairs', 'per_loop_frame_pairs', 'pairing_error'] as const;

export type PairCount =
  /** The config has not been fetched yet: none of the three keys is present. */
  | { state: 'unloaded' }
  | { state: 'counted'; pairs: number; perLoop: number }
  /** The reader refused the run; `error` is its message, to show in place of a count. */
  | { state: 'refused'; error: string };

/**
 * Pairs `numImages` frames give under the pairing strides, for the Setup page to show
 * as the user types. The backend's `Config._stride_pair_count` is the same formula:
 * pair n's frame B is `start_index + (n - 1) * pairStride + frameStride`, so n runs to
 * `(numImages - 1 - frameStride) // pairStride + 1`. `frameStride` 0 (pre-paired) is
 * the same formula, every `pairStride`-th entry. Strides the backend refuses by name
 * (a negative frame stride, a pair stride below 1) give 0; the refusal itself arrives
 * as `images.pairing_error`.
 */
export function strideFramePairs(numImages: number, frameStride: number, pairStride: number): number {
  if (frameStride < 0 || pairStride < 1) return 0;
  return Math.max(0, Math.floor((numImages - 1 - frameStride) / pairStride) + 1);
}

/** A whole number >= 0. */
export const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Read the pair count from a config's `images` section. Throws when the keys break
 * the contract (a count beside an error, a missing or non-integer count), since a
 * guessed count would let a run start, or block one, for no reason the user can see.
 */
export function parsePairCount(images: Record<string, unknown> | null | undefined): PairCount {
  const img = images ?? {};
  if (SERVER_ONLY_IMAGE_KEYS.every((k) => img[k] === undefined)) return { state: 'unloaded' };
  const error = img.pairing_error;
  if (error !== undefined && error !== null) {
    if (typeof error !== 'string' || error === '') {
      throw new Error('images.pairing_error must be a non-empty string');
    }
    if (img.num_frame_pairs !== null || img.per_loop_frame_pairs !== null) {
      throw new Error('images.pairing_error is set, so num_frame_pairs and per_loop_frame_pairs must be null');
    }
    return { state: 'refused', error };
  }
  if (!isCount(img.num_frame_pairs) || !isCount(img.per_loop_frame_pairs)) {
    throw new Error(
      'images.num_frame_pairs and per_loop_frame_pairs must be whole numbers when there is no pairing_error',
    );
  }
  return { state: 'counted', pairs: img.num_frame_pairs, perLoop: img.per_loop_frame_pairs };
}

/** The pair count to show, or the reason there is none, for a Run or Setup panel. */
export interface PairStatus {
  pairs: number | null;
  error: string | null;
}

/**
 * `parsePairCount` for display: a refusal's message, or a contract fault worded as an
 * unreadable count, becomes `error`, which blocks Run; `pairs` is null until counted.
 */
export function pairStatus(images: Record<string, unknown> | null | undefined): PairStatus {
  let pc: PairCount;
  try {
    pc = parsePairCount(images);
  } catch (e) {
    return { pairs: null, error: `The pair count from the backend is unreadable: ${errorMessage(e)}` };
  }
  if (pc.state === 'refused') return { pairs: null, error: pc.error };
  return { pairs: pc.state === 'counted' ? pc.pairs : null, error: null };
}

/**
 * Merge `updated.images` from an update_config response into the GUI's images.
 *
 * When the response carries a count, the three server keys are replaced as one:
 * `pairing_error` becomes null when the response has none, so an error from an
 * earlier refusal is never left beside a fresh count. (The page's state update
 * merges shallowly, so an absent key would keep the old error; null overrides it.)
 */
export function mergeImagesUpdate(
  current: Record<string, unknown>,
  updated: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...current, ...updated };
  if ('num_frame_pairs' in updated) merged.pairing_error = updated.pairing_error ?? null;
  return merged;
}

/** Throws when a config update would post a server-computed images key back. */
export function assertNoServerOnlyKeys(payload: Record<string, unknown>): void {
  const images = payload.images;
  if (typeof images !== 'object' || images === null) return;
  const posted = SERVER_ONLY_IMAGE_KEYS.filter((k) => k in images);
  if (posted.length > 0) {
    throw new Error(`images.${posted.join(', images.')} are computed by the backend and must not be posted`);
  }
}
