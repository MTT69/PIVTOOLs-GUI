/**
 * Shared shape + payload mapping for the calibration apply job
 * (`POST /backend/calibration/apply`, polled at `/calibration/apply/status/<job_id>`).
 *
 * Every calibration tab — planar dotboard/ChArUco, joint multi-camera, scale factor and the
 * three stereo tabs — drives the same backend job, so they read the same payload through
 * `readApplyJobStatus` and render it with `CalibrationJobProgress`.
 *
 * Field meanings, which the backend defines and the UI must not re-interpret:
 *   progress            0-100 across the WHOLE run (all dataset units).
 *   processed / total   DATASET-UNIT counts (`n_units = len(units)`), not cameras, not frames.
 *   frame_done/_total   frames within the unit currently running; 0 until it reports.
 *   unit_label          human name of that unit, e.g. "run3/Cam2" or "run3/Cam1_Cam2".
 *   estimated_remaining seconds; present only while running with progress > 0.
 *   out_dirs            output directory of each dataset unit.
 *   dt_used / dt_source per unit, aligned with out_dirs: the dt (s) that unit is calibrated with
 *                       and whether it came from the request or the model-stamped dt.
 *   warnings            problems that did not stop the run: pairings applied without a frame
 *                       comparison (from the start), a run config that could not be stamped;
 *                       the vectors were still written. Always a list; required.
 *   n_cameras / cameras the cameras the job calibrates (every camera of a mono rig).
 *
 * A `cancelled` job stopped at the user's request; frames already written stay on disk,
 * `frame_done/frame_total` say how far the interrupted unit got, and `error` is the backend's
 * account of what was written where.
 */

import { ApiError } from './api';

/** Status poll interval of a calibration job (apply, self-calibration), ms. */
export const POLL_INTERVAL_MS = 1000;

/**
 * HTTP status of a job start the backend refused (a `.pivraw` run the reader refuses, a
 * calibration frame mismatch): no job exists, and the body names the camera, image and field.
 */
export const START_REFUSED_STATUS = 400;

/** True when a thrown job-start failure is the backend's refusal, not a failed request. */
export function isStartRefusal(e: unknown): boolean {
  return e instanceof ApiError && e.status === START_REFUSED_STATUS;
}

export interface ApplyJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  /** Dataset units finished. NOT cameras and NOT frames — see module docstring. */
  processed_units: number;
  /** Total dataset units in this run; null until the backend reports it. */
  total_units: number | null;
  /** Frames done within the running unit; undefined until the backend reports one. */
  frame_done?: number;
  frame_total?: number;
  unit_label?: string;
  elapsed_time?: number;
  estimated_remaining?: number;
  /** Per-unit output directories; undefined until the backend reports the job. */
  out_dirs?: string[];
  /** Per-unit dt (s), aligned with `out_dirs`. */
  dt_used?: number[];
  /** Per-unit dt origin, aligned with `out_dirs`. */
  dt_source?: ('request' | 'model')[];
  /** Non-fatal problems the run reported; undefined only on the client's placeholder statuses. */
  warnings?: string[];
  /**
   * Set on the client's own status for a start the backend refused (HTTP 400, or
   * `success: false`): no job exists and nothing was written. `error` is the reason.
   */
  refused?: boolean;
  /**
   * Stereo frame pairs skipped because the reconstructed pass is absent in one or both
   * cameras. Written by the backend on completion; `readApplyJobStatus` reads 0 until then
   * (always 0 for mono). Undefined only on the client's own placeholder statuses.
   */
  n_frames_skipped?: number;
  /** Number of cameras the job calibrates; undefined until the backend reports it. */
  n_cameras?: number;
  /** Camera numbers the job calibrates; undefined until the backend reports them. */
  cameras?: number[];
  error?: string;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

/**
 * The `warnings` list of a calibration job response. Required: a response without one
 * comes from a backend older than this GUI, so it fails loudly instead of hiding them.
 */
export function parseWarnings(data: any, where: string): string[] {
  if (!isStringArray(data?.warnings)) {
    throw new Error(`${where} has no "warnings" list; the backend is older than this GUI`);
  }
  return data.warnings;
}

/** A calibration job start: the job and its warnings, or why the backend refused it. */
export type JobStart =
  | { kind: 'started'; jobId: string; warnings: string[] }
  | { kind: 'refused'; error: string };

/**
 * Read a 2xx start response (`/calibration/apply`, `/calibration/self_cal/run`). Some
 * refusals still answer 200 with `success: false`; a 400 refusal is thrown by `postJson`
 * and the caller treats it the same way. Throws on a malformed response: no boolean
 * `success`, a refusal without an `error` message, or a success without a job id.
 */
export function parseJobStart(data: any, where: string): JobStart {
  if (typeof data?.success !== 'boolean') {
    throw new Error(`${where} answered without a "success" flag`);
  }
  if (!data.success) {
    if (typeof data.error !== 'string' || data.error === '') {
      throw new Error(`${where} refused the job without saying why`);
    }
    return { kind: 'refused', error: data.error };
  }
  if (typeof data.job_id !== 'string' || data.job_id === '') {
    throw new Error(`${where} answered success without a job id`);
  }
  return { kind: 'started', jobId: data.job_id, warnings: parseWarnings(data, where) };
}
const isNumberArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(x => typeof x === 'number');

/**
 * Map a raw `/calibration/apply/status/<job_id>` payload onto {@link ApplyJobStatus}.
 *
 * Optional fields stay `undefined` when the backend has not reported them, so the display can
 * omit that segment instead of showing an invented zero.
 */
export function readApplyJobStatus(data: any): ApplyJobStatus {
  return {
    status: data.status,
    progress: data.progress ?? 0,
    processed_units: data.processed ?? 0,
    total_units: typeof data.total === 'number' ? data.total : null,
    frame_done: data.frame_done,
    frame_total: data.frame_total,
    unit_label: data.unit_label,
    elapsed_time: data.elapsed_time,
    estimated_remaining: data.estimated_remaining,
    out_dirs: data.out_dirs,
    dt_used: data.dt_used,
    dt_source: data.dt_source,
    warnings: parseWarnings(data, 'apply status'),
    n_frames_skipped: typeof data.n_frames_skipped === 'number' ? data.n_frames_skipped : 0,
    n_cameras: typeof data.n_cameras === 'number' ? data.n_cameras : undefined,
    cameras: isNumberArray(data.cameras) ? data.cameras : undefined,
    error: data.error,
  };
}

/** True while the job can still change: starting or running. */
export function isApplyJobActive(job: ApplyJobStatus): boolean {
  return job.status === 'starting' || job.status === 'running';
}

/**
 * "dt used: X s (model)" for an apply job: one value when every unit shares the same dt and
 * source, else one entry per unit labelled by its output folder. null until reported.
 */
export function formatDtUsed(job: ApplyJobStatus): string | null {
  const { dt_used: dts, dt_source: sources, out_dirs: dirs } = job;
  if (!dts || !sources || !dirs || dts.length === 0) return null;
  const entry = (i: number) => `${dts[i]} s (${sources[i]})`;
  if (dts.every((d, i) => d === dts[0] && sources[i] === sources[0])) return `dt used: ${entry(0)}`;
  const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  return `dt used: ${dts.map((_, i) => `${basename(dirs[i])} ${entry(i)}`).join(', ')}`;
}

/** Seconds -> compact human duration ("45 s", "3 m 05 s", "1 h 12 m"). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
}
