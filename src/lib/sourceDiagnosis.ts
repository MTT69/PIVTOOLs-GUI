/**
 * Source-diagnosis response types, guards and apply→store mapping.
 * Pure module. The apply vocabulary mirrors the backend's
 * `APPLY_FIELDS` (`source_diagnosis.py`).
 */

import { sanitizePath, withSourceAt } from './sourcePath';

export const APPLY_FIELDS = [
  'source_path',
  'image_type',
  'image_format',
  'start_index',
  'use_camera_subfolders',
  'camera_subfolders',
  'camera_count',
  'camera_numbers',
  'pairing_preset',
] as const;

export interface SuggestionApply {
  source_path?: string;
  image_type?: string;
  image_format?: string[];
  start_index?: number;
  use_camera_subfolders?: boolean;
  camera_subfolders?: string[];
  camera_count?: number;
  camera_numbers?: number[];
  pairing_preset?: string;
}

export interface Suggestion {
  id: string;
  message: string;
  apply: SuggestionApply;
  label: string;
}

export interface StreamInfo {
  index: number;
  prefix: string;
  width: number;
  height: number;
  decoder: string;
  camera: number | null;
}

export interface Diagnosis {
  found: string | null;
  suggestions: Suggestion[];
  streams: StreamInfo[] | null;
}

export interface DiagnosisEntry extends Diagnosis {
  /** Names the offerer, e.g. "Camera 2" or "Source 2, camera 1". */
  label: string;
}

export interface MergedSuggestion extends Suggestion {
  labels: string[];
  /** True when some entries did not offer this suggestion. */
  partial: boolean;
}

// Preset → stride mapping
export const PRESET_STRIDES: Record<string, { fs: number; ps: number }> = {
  ab_format:     { fs: 0, ps: 1 },
  pre_paired:    { fs: 0, ps: 1 },
  time_resolved: { fs: 1, ps: 1 },
  skip_frames:   { fs: 1, ps: 2 },
};

const isString = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isArrayOf = <T>(v: unknown, guard: (x: unknown) => x is T): v is T[] =>
  Array.isArray(v) && v.every(guard);

const APPLY_TYPE_GUARDS: Record<(typeof APPLY_FIELDS)[number], (v: unknown) => boolean> = {
  source_path: isString,
  image_type: isString,
  image_format: (v) => isArrayOf(v, isString),
  start_index: isInt,
  use_camera_subfolders: isBool,
  camera_subfolders: (v) => isArrayOf(v, isString),
  camera_count: isInt,
  camera_numbers: (v) => isArrayOf(v, isInt),
  pairing_preset: isString,
};

/** Validate one `apply` object against the closed vocabulary. Throws on any violation. */
export function parseApply(raw: unknown): SuggestionApply {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Suggestion apply must be an object');
  }
  const obj = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (!(APPLY_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`Unknown suggestion field "${key}"`);
    }
    if (key === 'image_format' && !Array.isArray(value)) {
      throw new Error('Suggestion field "image_format" must be a list');
    }
    if (!APPLY_TYPE_GUARDS[key as (typeof APPLY_FIELDS)[number]](value)) {
      throw new Error(`Suggestion field "${key}" has the wrong type`);
    }
  }
  if ('camera_count' in obj !== 'camera_numbers' in obj) {
    throw new Error('Suggestion fields "camera_count" and "camera_numbers" must come together');
  }
  return { ...obj } as SuggestionApply;
}

const STREAM_FIELDS = ['index', 'prefix', 'width', 'height', 'decoder', 'camera'];

function parseStream(raw: unknown): StreamInfo {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Stream must be an object');
  }
  const s = raw as Record<string, unknown>;
  for (const key of Object.keys(s)) {
    if (!STREAM_FIELDS.includes(key)) throw new Error(`Unknown stream field "${key}"`);
  }
  if (
    !isInt(s.index) || !isString(s.prefix) || !isInt(s.width) || !isInt(s.height) ||
    !isString(s.decoder) || !(s.camera === null || isInt(s.camera))
  ) {
    throw new Error('Stream needs int "index"/"width"/"height", string "prefix"/"decoder" and int-or-null "camera"');
  }
  return s as unknown as StreamInfo;
}

function parseSuggestion(raw: unknown): Suggestion {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Suggestion must be an object');
  }
  const s = raw as Record<string, unknown>;
  if (!isString(s.id) || !isString(s.message) || !isString(s.label)) {
    throw new Error('Suggestion needs string "id", "message" and "label"');
  }
  return { id: s.id, message: s.message, label: s.label, apply: parseApply(s.apply) };
}

/** Validate a /validate response. Missing keys mean the backend is older than this GUI. */
export function parseDiagnosis(raw: unknown): Diagnosis {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (!('found' in r) || !('suggestions' in r) || !('streams' in r)) {
    throw new Error(
      'validate response has no "found"/"suggestions"/"streams"; the backend is older than this GUI',
    );
  }
  if (r.found !== null && !isString(r.found)) throw new Error('"found" must be a string or null');
  if (!Array.isArray(r.suggestions)) throw new Error('"suggestions" must be a list');
  if (r.streams !== null && !Array.isArray(r.streams)) throw new Error('"streams" must be a list or null');
  return {
    found: r.found,
    suggestions: r.suggestions.map(parseSuggestion),
    streams: r.streams === null ? null : (r.streams as unknown[]).map(parseStream),
  };
}

/** Canonical JSON of `apply`: keys sorted, arrays kept in order. */
function applyKey(apply: SuggestionApply): string {
  const rec = apply as Record<string, unknown>;
  return JSON.stringify(Object.keys(rec).sort().map((k) => [k, rec[k]]));
}

/**
 * Merge per-entry suggestions on equal `apply`. Order is the smallest position at
 * which any entry offered the suggestion, ties broken by entry order.
 */
export function mergeSuggestions(entries: DiagnosisEntry[]): MergedSuggestion[] {
  const byKey = new Map<string, { item: MergedSuggestion; pos: number; entry: number }>();
  entries.forEach((entry, entryIdx) => {
    entry.suggestions.forEach((s, pos) => {
      const key = applyKey(s.apply);
      const hit = byKey.get(key);
      if (!hit) {
        byKey.set(key, { item: { ...s, labels: [entry.label], partial: false }, pos, entry: entryIdx });
        return;
      }
      if (!hit.item.labels.includes(entry.label)) hit.item.labels.push(entry.label);
      if (pos < hit.pos || (pos === hit.pos && entryIdx < hit.entry)) {
        hit.pos = pos;
        hit.entry = entryIdx;
      }
    });
  });
  const merged = [...byKey.values()].sort((a, b) => a.pos - b.pos || a.entry - b.entry);
  return merged.map(({ item }) => ({ ...item, partial: item.labels.length < entries.length }));
}

/** The "found" sentences: once if all non-null ones agree, else prefixed by label. */
export function foundLines(entries: DiagnosisEntry[]): string[] {
  const present = entries.filter((e): e is DiagnosisEntry & { found: string } => e.found !== null);
  if (present.length === 0) return [];
  if (present.every((e) => e.found === present[0].found)) return [present[0].found];
  return present.map((e) => `${e.label}: ${e.found}`);
}

export function formatSize(s: StreamInfo): string {
  return `${s.width}×${s.height}`;
}

export interface ImageTypeDefaults {
  image_type: string;
  image_format: string[];
  pairing_preset: string;
  frame_stride: number;
  pair_stride: number;
  start_index: number;
}

/** The Setup Image Type dropdown rule. The only image-type→preset rule in the GUI. */
export function imageTypeDefaults(imageType: string, currentStartIndex: number): ImageTypeDefaults {
  switch (imageType) {
    case 'cine':
      return {
        image_type: imageType, image_format: ['Camera%d.cine'], pairing_preset: 'time_resolved',
        frame_stride: 1, pair_stride: 1, start_index: 1,
      };
    case 'lavision_set':
      return {
        image_type: imageType, image_format: ['data.set'], pairing_preset: 'pre_paired',
        frame_stride: 0, pair_stride: 1, start_index: currentStartIndex,
      };
    case 'lavision_im7':
      return {
        image_type: imageType, image_format: ['B%05d.im7'], pairing_preset: 'pre_paired',
        frame_stride: 0, pair_stride: 1, start_index: currentStartIndex,
      };
    default:
      return {
        image_type: imageType, image_format: ['B%05d_A.tif', 'B%05d_B.tif'], pairing_preset: 'ab_format',
        frame_stride: 0, pair_stride: 1, start_index: currentStartIndex,
      };
  }
}

export interface SetupConfigView {
  paths: { source_paths: string[] };
  images: { start_index: number };
}

export interface SetupPayload {
  paths?: Record<string, unknown>;
  images?: Record<string, unknown>;
}

/**
 * Map an apply onto the Setup store's `paths` / `images` patch. An `image_type` is
 * expanded with the Setup dropdown rule first, so every other key wins over it.
 */
export function buildSetupPayload(
  apply: SuggestionApply,
  config: SetupConfigView,
  sourcePathIdx: number,
): SetupPayload {
  parseApply(apply);
  const paths: Record<string, unknown> = {};
  const images: Record<string, unknown> = {};

  if (apply.image_type !== undefined) {
    Object.assign(images, imageTypeDefaults(apply.image_type, config.images.start_index));
  }
  if (apply.source_path !== undefined) {
    paths.source_paths = withSourceAt(config.paths.source_paths, sourcePathIdx, sanitizePath(apply.source_path));
  }
  if (apply.image_format !== undefined) images.image_format = apply.image_format;
  if (apply.start_index !== undefined) images.start_index = apply.start_index;
  if (apply.use_camera_subfolders !== undefined) images.use_camera_subfolders = apply.use_camera_subfolders;
  if (apply.camera_subfolders !== undefined) paths.camera_subfolders = apply.camera_subfolders;
  if (apply.camera_count !== undefined) {
    paths.camera_count = apply.camera_count;
    paths.camera_numbers = apply.camera_numbers; // parseApply guarantees the pair
  }
  if (apply.pairing_preset !== undefined) {
    const strides = PRESET_STRIDES[apply.pairing_preset];
    if (!strides) throw new Error(`Unknown pairing_preset "${apply.pairing_preset}"`);
    images.pairing_preset = apply.pairing_preset;
    images.frame_stride = strides.fs;
    images.pair_stride = strides.ps;
  }

  const payload: SetupPayload = {};
  if (Object.keys(paths).length > 0) payload.paths = paths;
  if (Object.keys(images).length > 0) payload.images = images;
  return payload;
}

export interface CalibrationWrites {
  configPaths?: { camera_count: number; camera_numbers: number[] };
  sourcePath?: string;
  image?: {
    image_type?: string;
    image_format?: string;
    zero_based_indexing?: boolean;
    use_camera_subfolders?: boolean;
    camera_subfolders?: string[];
  };
}

/** Map an apply onto the calibration config pointer keys and per-source sidecar fields. */
export function calibrationWrites(apply: SuggestionApply): CalibrationWrites {
  parseApply(apply);
  const out: CalibrationWrites = {};
  const image: NonNullable<CalibrationWrites['image']> = {};

  if (apply.camera_count !== undefined) {
    out.configPaths = { camera_count: apply.camera_count, camera_numbers: apply.camera_numbers! }; // parseApply guarantees the pair
  }
  if (apply.source_path !== undefined) out.sourcePath = sanitizePath(apply.source_path);
  if (apply.image_type !== undefined) image.image_type = apply.image_type;
  if (apply.use_camera_subfolders !== undefined) image.use_camera_subfolders = apply.use_camera_subfolders;
  if (apply.camera_subfolders !== undefined) image.camera_subfolders = apply.camera_subfolders;
  if (apply.image_format !== undefined) {
    if (apply.image_format.length !== 1) {
      throw new Error(
        `Calibration holds one image pattern, but the suggestion has ${apply.image_format.length}`,
      );
    }
    image.image_format = apply.image_format[0];
  }
  if (apply.start_index !== undefined) {
    if (apply.start_index !== 0 && apply.start_index !== 1) {
      throw new Error(`start_index must be 0 or 1 for calibration, got ${apply.start_index}`);
    }
    image.zero_based_indexing = apply.start_index === 0;
  }
  if (apply.pairing_preset !== undefined) throw new Error('pairing_preset is a Setup-only field');

  if (Object.keys(image).length > 0) out.image = image;
  return out;
}
