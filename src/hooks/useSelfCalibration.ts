import { useState, useEffect, useCallback, useRef } from 'react';

/** One iteration of the self-calibration convergence history. */
export interface SC2IterationRecord {
  iteration: number;
  rms_disparity: number;
  delta_z: number;
  delta_tilt_x: number;
  delta_tilt_y: number;
  cumulative_z: number;
  cumulative_tilt_x: number;
  cumulative_tilt_y: number;
}

/** A completed self-calibration result (assembled from the job's flat fields). */
export interface SC2Result {
  converged: boolean;
  n_iterations: number;
  z_offset: number;
  tilt_x: number;
  tilt_y: number;
  tilt_x_deg: number;
  tilt_y_deg: number;
  final_rms_disparity: number;
  history: SC2IterationRecord[];
  figures: string[];
}

/** The saved self_cal block on the stereo record. */
export interface SC2Status {
  has_self_calibration: boolean;
  baked: boolean;
  z_offset: number;
  tilt_x: number;
  tilt_y: number;
  tilt_x_deg: number;
  tilt_y_deg: number;
  converged: boolean;
  n_iterations: number;
  final_rms_disparity: number;
  n_images: number;
  window_size: number;
  overlap: number;
  source?: string;
  figures?: string[];
}

/**
 * Stereo self-calibration (Wieneke 2005) on the calibration backend. Loads the saved
 * stereo model + recorded PIV particle frames from a base_path dataset, recovers the
 * laser sheet (z_offset, tilt_x, tilt_y), and **bakes** that correction into both
 * cameras' extrinsics (the DaVis convention) so 3C reconstruction sits on the true
 * sheet. Six diagnostic figures are saved into the calibration source folder. To undo
 * a baked correction, regenerate the stereo model and re-run.
 */
export function useSelfCalibration(
  cam1: number,
  cam2: number,
  board: string,
  sourcePathIdx: number = 0,
) {
  // Run parameters
  const [nImages, setNImages] = useState(20);
  const [windowSize, setWindowSize] = useState(64);
  const [overlap, setOverlap] = useState(50.0);
  const [applyFilters, setApplyFilters] = useState(true);
  const [basePathIdx, setBasePathIdx] = useState(0);
  const [basePaths, setBasePaths] = useState<string[]>([]);

  // Job
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  // Results + saved status
  const [result, setResult] = useState<SC2Result | null>(null);
  const [status, setStatus] = useState<SC2Status | null>(null);
  const [figures, setFigures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const locator = useCallback(
    () => ({ board, camera_pair: [cam1, cam2], source_path_idx: sourcePathIdx }),
    [board, cam1, cam2, sourcePathIdx],
  );

  // A served self-cal figure URL (cache-busted on result change via the figure list).
  const figureUrl = useCallback(
    (name: string) =>
      `/backend/calibration/self_cal/figure?name=${encodeURIComponent(name)}` +
      `&board=${board}&camera_pair=${cam1},${cam2}&source_path_idx=${sourcePathIdx}`,
    [board, cam1, cam2, sourcePathIdx],
  );

  // Load base_paths (PIV datasets) once so the user can pick the source frames.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/backend/config');
        if (res.ok) {
          const cfg = await res.json();
          if (Array.isArray(cfg.base_paths)) setBasePaths(cfg.base_paths);
        }
      } catch {
        /* base paths are best-effort; default to index 0 */
      }
    })();
  }, []);

  // Read the saved self_cal block + figure list for the current pair.
  const checkStatus = useCallback(async () => {
    try {
      const q = `stereo=1&board=${board}&camera_pair=${cam1},${cam2}&source_path_idx=${sourcePathIdx}`;
      const res = await fetch(`/backend/calibration/self_cal/result?${q}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.has_self_calibration) {
        setStatus(data);
        if (data.n_images) setNImages(data.n_images);
        if (data.window_size) setWindowSize(data.window_size);
        if (data.overlap) setOverlap(data.overlap);
      } else {
        setStatus(null);
      }
      setFigures(Array.isArray(data.figures) ? data.figures : []);
    } catch {
      /* ignore on mount */
    }
  }, [board, cam1, cam2, sourcePathIdx]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const pollJob = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/backend/calibration/self_cal/status/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        setJobStatus(data.status);
        setJobProgress(data.progress ?? 0);
        if (data.status === 'completed') {
          setIsRunning(false);
          setResult({
            converged: !!data.converged,
            n_iterations: data.n_iterations ?? 0,
            z_offset: data.z_offset ?? 0,
            tilt_x: data.tilt_x ?? 0,
            tilt_y: data.tilt_y ?? 0,
            tilt_x_deg: data.tilt_x_deg ?? 0,
            tilt_y_deg: data.tilt_y_deg ?? 0,
            final_rms_disparity: data.final_rms_disparity ?? 0,
            history: data.history ?? [],
            figures: data.figures ?? [],
          });
          if (Array.isArray(data.figures)) setFigures(data.figures);
          checkStatus();
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } else if (data.status === 'failed') {
          setIsRunning(false);
          setError(data.error || 'Self-calibration failed');
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        /* keep polling */
      }
    },
    [checkStatus],
  );

  const runSelfCalibration = useCallback(async () => {
    setError(null);
    setResult(null);
    setIsRunning(true);
    setJobProgress(0);
    setJobStatus('starting');
    try {
      const res = await fetch('/backend/calibration/self_cal/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...locator(),
          base_path_idx: basePathIdx,
          n_images: nImages,
          window_size: windowSize,
          overlap,
          apply_filters: applyFilters,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to start self-calibration');
        setIsRunning(false);
        return;
      }
      setJobId(data.job_id);
      pollRef.current = setInterval(() => pollJob(data.job_id), 1000);
    } catch (e: any) {
      setError(e?.message || 'Failed to start self-calibration');
      setIsRunning(false);
    }
  }, [locator, basePathIdx, nImages, windowSize, overlap, applyFilters, pollJob]);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  return {
    // Parameters
    nImages, setNImages,
    windowSize, setWindowSize,
    overlap, setOverlap,
    applyFilters, setApplyFilters,
    basePathIdx, setBasePathIdx, basePaths,

    // Job
    jobId, jobStatus, jobProgress, isRunning, runSelfCalibration,

    // Results + status
    result, status, figures, figureUrl,
    hasSelfCal: status?.has_self_calibration ?? false,

    // Error + actions
    error, checkStatus,
  };
}
