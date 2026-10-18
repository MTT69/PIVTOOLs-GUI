/**
 * Types and small helpers shared by every calibration tab hook (see `useCalibrationCore`).
 */

/** Parse a numeric form field; null when empty/invalid (the field is unset). */
export const numOrNull = (s: string): number | null => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

/** Parse a positive integer form field; null when empty, invalid or < 1 (the field is unset). */
export const positiveIntOrNull = (s: string): number | null => {
  const v = parseInt(s, 10);
  return Number.isFinite(v) && v >= 1 ? v : null;
};

/** World-frame clicks (image-down pixels) defining origin/+X/+Y plus the origin's world mm. */
export interface WorldFrameClicks {
  origin: [number, number];
  x_axis: [number, number];
  y_axis: [number, number];
  origin_mm: [number, number];
}

/** One camera's `/calibration/validate` result (`validate_images_generic` shape). */
export interface CameraValidationResult {
  valid: boolean;
  /** Files, .set entries or .cine frames found (the backend's auto view count source). */
  found_count: number;
  expected_count?: number;
  sample_files?: string[];
  first_image_preview?: string;
  image_size?: [number, number];
  camera_path?: string;
  format_detected?: string;
  error?: string;
  suggested_pattern?: string;
  suggested_subfolder?: string;
  /** Set when the files start at the other index: true -> switch to 0-based, false -> 1-based. */
  suggested_zero_based?: boolean | null;
}

/** Validation of every camera the tab works on, keyed by camera number. */
export interface CalibrationValidation {
  valid: boolean;
  cameras: Record<number, CameraValidationResult>;
  /** Frames every camera has (min over cameras). */
  matching_count: number;
  /** First camera error, for the summary alert. */
  error?: string;
}

/**
 * A calibration view count and where the backend read it: `frame_total` /
 * `frame_total_source` from detect_views, restore_detections and generate_model.
 */
export interface ViewCount {
  n: number;
  /** "request", "n_views setting", "files", ".set index", ".cine header" or "inputs.mat cache". */
  source: string;
}

/**
 * Readable origin of an auto view count. null for a count the user set (request or the
 * n_views setting), which is not "auto".
 */
const VIEW_COUNT_SOURCE_TEXT: Record<string, string | null> = {
  request: null,
  'n_views setting': null,
  files: 'files found',
  '.set index': '.set index',
  '.cine header': '.cine header',
  'inputs.mat cache': 'saved detections',
};

/**
 * Helper text under a blank n_views field: "auto: N (from <source>)", or null when there is
 * nothing auto to report. A source this table does not know is shown verbatim, not hidden.
 */
export function autoViewCountText(count: ViewCount | null): string | null {
  if (!count) return null;
  const text = count.source in VIEW_COUNT_SOURCE_TEXT ? VIEW_COUNT_SOURCE_TEXT[count.source] : count.source;
  return text == null ? null : `auto: ${count.n} (from ${text})`;
}

/** Board detection on one frame (overlay points + their grid indices). */
export interface FrameDetection {
  grid_points: [number, number][];
  grid_indices?: [number, number][];
}

/** Per-camera, per-frame detections. */
export type DetectionsByCamera = Record<number, Record<number, FrameDetection>>;

/**
 * The per-source settings sidecar (`GET /calibration/settings`). Only the shared blocks are
 * typed; board blocks under `methods` are read by each board adapter.
 */
export interface SidecarSettings {
  image?: {
    image_format?: string;
    image_type?: string;
    n_views?: number | null;
    zero_based_indexing?: boolean;
    use_camera_subfolders?: boolean;
    camera_subfolders?: string[];
  };
  rig?: {
    camera?: number;
    camera_pair?: [number, number];
    dt?: number | null;
    datum_frame?: number | null;
    interpolator?: string;
    piv_type?: string;
  };
  methods?: Record<string, Record<string, unknown> | undefined>;
}

/** Raw `/calibration/model` or generate response; each tab maps it to its card shape. */
export type ModelData = Record<string, any>;
