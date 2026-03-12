import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Iteration record from self-calibration convergence history
 */
export interface IterationRecord {
  iteration: number;
  rms_disparity: number;
  delta_z: number;
  delta_tilt_x: number;
  delta_tilt_y: number;
  cumulative_z: number;
  cumulative_tilt_x: number;
  cumulative_tilt_y: number;
}

/**
 * Self-calibration result from backend
 */
export interface SelfCalResult {
  converged: boolean;
  n_iterations: number;
  z_offset: number;
  tilt_x: number;
  tilt_y: number;
  tilt_x_deg: number;
  tilt_y_deg: number;
  final_rms_disparity: number;
  history: IterationRecord[];
}

/**
 * Self-calibration status from config
 */
export interface SelfCalStatus {
  has_self_calibration: boolean;
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
}

/**
 * Hook for managing stereo self-calibration state and operations.
 */
export function useSelfCalibration(cam1: number, cam2: number, method: string) {
  // Parameters
  const [nImages, setNImages] = useState(20);
  const [windowSize, setWindowSize] = useState(64);
  const [overlap, setOverlap] = useState(50.0);

  // Preview
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [cam1Image, setCam1Image] = useState<string | null>(null);
  const [cam2Image, setCam2Image] = useState<string | null>(null);
  const [previewFrameIdx, setPreviewFrameIdx] = useState(1);
  const [subFrame, setSubFrame] = useState<"A" | "B">("A");
  const [showCorrected, setShowCorrected] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [totalFrames, setTotalFrames] = useState(1);
  const [viewMode, setViewMode] = useState<"overlay" | "side_by_side">("overlay");

  // Job
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  // Results
  const [result, setResult] = useState<SelfCalResult | null>(null);

  // Config status
  const [status, setStatus] = useState<SelfCalStatus | null>(null);

  // Error
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Track whether user has loaded at least one preview.
  // Auto-reload only fires after this becomes true (first Load Preview click).
  const hasLoadedPreview = useRef(false);

  // Check status on mount
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/backend/calibrate/self_calibration/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        // Sync parameters from config
        if (data.n_images) setNImages(data.n_images);
        if (data.window_size) setWindowSize(data.window_size);
        if (data.overlap) setOverlap(data.overlap);
      }
    } catch {
      // Ignore on mount
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Load dewarp preview
  const loadDewarpPreview = useCallback(async (corrected: boolean = false) => {
    setPreviewLoading(true);
    setError(null);
    try {
      const body: Record<string, any> = {
        cam1,
        cam2,
        method,
        frame_idx: previewFrameIdx,
        sub_frame: subFrame,
        source_path_idx: 0,
      };
      if (corrected) {
        // Prefer fresh result (just-completed run) over saved config status
        if (result) {
          body.z_offset = result.z_offset;
          body.tilt_x = result.tilt_x;
          body.tilt_y = result.tilt_y;
        } else if (status?.has_self_calibration) {
          body.z_offset = status.z_offset;
          body.tilt_x = status.tilt_x;
          body.tilt_y = status.tilt_y;
        }
      }

      const res = await fetch('/backend/calibrate/self_calibration/dewarp_preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setPreviewImage(data.overlay || data.image);
        setCam1Image(data.cam1_image || null);
        setCam2Image(data.cam2_image || null);
        if (data.total_frames) {
          setTotalFrames(data.total_frames);
        }
        hasLoadedPreview.current = true;
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load preview');
    } finally {
      setPreviewLoading(false);
    }
  }, [cam1, cam2, method, previewFrameIdx, subFrame, status, result]);

  // Auto-reload preview when frame, subFrame, or showCorrected changes.
  // Only fires after the user has loaded at least one preview (Load Preview click).
  // Debounced at 300ms to handle rapid slider drags without flooding the backend.
  //
  // Note on deps: loadDewarpPreview is intentionally excluded. We only want to
  // trigger reloads on user-initiated state changes (frame, subFrame, corrected
  // toggle), not when status/result cause loadDewarpPreview to be recreated.
  // The effect closure always captures the latest loadDewarpPreview from the
  // current render, so it uses up-to-date status/result values when it fires.
  useEffect(() => {
    if (!hasLoadedPreview.current) return;
    const timer = setTimeout(() => {
      loadDewarpPreview(showCorrected);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFrameIdx, subFrame, showCorrected]);

  // Poll job status
  const pollJob = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/backend/calibrate/self_calibration/job/${id}`);
      if (!res.ok) return;
      const data = await res.json();

      setJobStatus(data.status);
      setJobProgress(data.progress ?? 0);

      if (data.status === 'completed') {
        setIsRunning(false);
        if (data.result) {
          setResult(data.result);
        }
        // Refresh config status
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
      // Keep polling
    }
  }, [checkStatus]);

  // Run self-calibration
  const runSelfCalibration = useCallback(async () => {
    setError(null);
    setResult(null);
    setIsRunning(true);
    setJobProgress(0);
    setJobStatus('starting');

    try {
      const res = await fetch('/backend/calibrate/self_calibration/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cam1,
          cam2,
          method,
          source_path_idx: 0,
          n_images: nImages,
          window_size: windowSize,
          overlap,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setIsRunning(false);
        return;
      }

      setJobId(data.job_id);
      // Start polling
      pollRef.current = setInterval(() => pollJob(data.job_id), 1000);
    } catch (e: any) {
      setError(e.message || 'Failed to start self-calibration');
      setIsRunning(false);
    }
  }, [cam1, cam2, method, nImages, windowSize, overlap, pollJob]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  return {
    // Parameters
    nImages,
    setNImages,
    windowSize,
    setWindowSize,
    overlap,
    setOverlap,

    // Preview
    previewImage,
    cam1Image,
    cam2Image,
    previewFrameIdx,
    setPreviewFrameIdx,
    subFrame,
    setSubFrame,
    showCorrected,
    setShowCorrected,
    previewLoading,
    loadDewarpPreview,
    totalFrames,
    viewMode,
    setViewMode,

    // Job
    jobId,
    jobStatus,
    jobProgress,
    isRunning,
    runSelfCalibration,

    // Results
    result,

    // Config status
    status,
    hasSelfCal: status?.has_self_calibration ?? false,

    // Error
    error,

    // Actions
    checkStatus,
  };
}
