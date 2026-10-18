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
 *
 * A `cancelled` job stopped at the user's request; frames already written stay on disk and
 * `frame_done/frame_total` say how far the interrupted unit got.
 */

export interface ApplyJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  /** Dataset units finished. NOT cameras and NOT frames — see module docstring. */
  processed_units: number;
  /** Total dataset units in this run. */
  total_units: number;
  /** Frames done within the running unit; undefined until the backend reports one. */
  frame_done?: number;
  frame_total?: number;
  unit_label?: string;
  elapsed_time?: number;
  estimated_remaining?: number;
  error?: string;
}

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
    total_units: data.total ?? 0,
    frame_done: data.frame_done,
    frame_total: data.frame_total,
    unit_label: data.unit_label,
    elapsed_time: data.elapsed_time,
    estimated_remaining: data.estimated_remaining,
    error: data.error,
  };
}

/** True while the job can still change: starting or running. */
export function isApplyJobActive(job: ApplyJobStatus): boolean {
  return job.status === 'starting' || job.status === 'running';
}

/** Seconds -> compact human duration ("45 s", "3 m 05 s", "1 h 12 m"). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
}
