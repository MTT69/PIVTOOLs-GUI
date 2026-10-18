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
  found_count: number | 'container';
  expected_count?: number;
  sample_files?: string[];
  first_image_preview?: string;
  image_size?: [number, number];
  camera_path?: string;
  format_detected?: string;
  container_format?: boolean;
  error?: string;
  suggested_pattern?: string;
  suggested_subfolder?: string;
}

/** Validation of every camera the tab works on, keyed by camera number. */
export interface CalibrationValidation {
  valid: boolean;
  cameras: Record<number, CameraValidationResult>;
  /** Frames every camera has (min over cameras); 'container' when any camera is a container. */
  matching_count: number | 'container';
  /** First camera error, for the summary alert. */
  error?: string;
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
