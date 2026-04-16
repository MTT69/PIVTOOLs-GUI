import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Per-camera fiducial set for stepped-planar calibration.
 * Backend contract: {origin: [x, y], x_axis: [x, y], y_axis: [x, y]}
 */
export interface FiducialSet {
  origin: [number, number] | null;
  x_axis: [number, number] | null;
  y_axis: [number, number] | null;
}

/**
 * Detection data for a single stepped board frame (single camera).
 */
export interface SteppedDetection {
  blobs: [number, number][];
  level_A: { centers: [number, number][]; n_points: number; grid_indices?: [number, number][] };
  level_B: { centers: [number, number][]; n_points: number; grid_indices?: [number, number][] };
  image_size: [number, number];
}

/**
 * Per-pose detection summary returned by the sequence detection job.
 */
export interface PoseSummary {
  frame_idx: number;
  is_datum: boolean;
  ok?: boolean;
  n_blobs?: number;
  n_level_A?: number;
  n_level_B?: number;
  error?: string;
}

/**
 * Camera model returned by load / generate_camera_model completion.
 */
export interface CameraModel {
  model_type?: 'pinhole';
  camera_matrix?: number[][];
  dist_coeffs?: number[];
  focal_length?: [number, number];
  principal_point?: [number, number];
  reprojection_error: number;
  num_poses?: number;
  image_width?: number;
  image_height?: number;
  rms?: number;
  model_path?: string;
}

/**
 * Validation result from backend (single-camera validator).
 */
export interface ValidationResult {
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

/**
 * Generic job status (used for per-camera fit and multi-camera fit).
 */
export interface JobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress?: number;
  stage?: string;
  processed_frames?: number;
  total_frames?: number;
  per_frame_status?: unknown;
  sequence_id?: string;
  poses?: PoseSummary[];
  frame_indices?: number[];
  datum_frame_idx?: number;
  camera?: number;
  rms?: number;
  num_poses?: number;
  model_path?: string;
  K?: number[][];
  dist?: number[];
  error?: string;
}

/**
 * Multi-camera job status (generate_camera_model_all).
 */
export interface MultiCameraJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  processed_cameras: number;
  total_cameras: number;
  current_camera?: number;
  current_camera_progress?: number;
  camera_results?: Record<
    string,
    {
      status: string;
      rms?: number;
      num_poses?: number;
      model_path?: string;
      error?: string;
    }
  > & {
    global_alignment?: {
      status: 'completed' | 'failed' | 'skipped';
      error?: string;
      cameras?: Record<number, { shift_x: number; shift_y: number; source: string }>;
      invert_ux?: boolean;
      reason?: string;
    };
  };
  error?: string;
}

export type SequenceStatus = 'idle' | 'detecting' | 'ready' | 'error';

/**
 * Hook for managing stepped-planar calibration state and operations.
 *
 * New backend API (per-camera sequence flow):
 *  1. POST /calibration/stepped_planar/detect_sequence         (per camera)
 *  2. POST /calibration/stepped_planar/snap_fiducial           (origin / x_axis / y_axis)
 *  3. POST /calibration/stepped_planar/generate_camera_model   (per camera)
 *  4. POST /calibration/stepped_planar/generate_camera_model_all (all cameras)
 *  5. GET  /calibration/stepped_planar/model                   (load saved)
 *
 * Per-camera state (sequenceId, fiducials, clickedLevel, cameraModel) is
 * stored in Record<number, ...> maps keyed by camera number so the active
 * camera selector only switches which slice of state the UI edits.
 */
export function useSteppedPlanarCalibration(
  cameraOptions: number[],
  sourcePaths: string[],
) {
  // ---------- Source selection ----------
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState(1);

  // ---------- Image config (persisted to config.yaml) ----------
  const [imageFormat, setImageFormat] = useState('calib%05d.tif');
  const [imageType, setImageType] = useState('standard');
  const [numImages, setNumImages] = useState<string>('10');
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);

  // ---------- Board geometry + dt (persisted) ----------
  const [dotSpacingMm, setDotSpacingMm] = useState(28.89);
  const [stepHeightMm, setStepHeightMm] = useState(3.0);
  const [boardThicknessMm, setBoardThicknessMm] = useState(14.8);
  const [dt, setDt] = useState(1.0);

  // ---------- Sequence-mode controls ----------
  const [numCalibrationFrames, setNumCalibrationFrames] = useState<number>(10);
  const [datumFrame, setDatumFrame] = useState<number>(1);

  // ---------- Validation state ----------
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // ---------- Per-camera sequence state ----------
  const [sequenceId, setSequenceIdMap] = useState<Record<number, string | null>>({});
  const [sequenceStatus, setSequenceStatusMap] = useState<Record<number, SequenceStatus>>({});
  const [sequencePoses, setSequencePosesMap] = useState<Record<number, PoseSummary[] | null>>({});
  const [sequenceError, setSequenceErrorMap] = useState<Record<number, string | null>>({});
  const [detectionProgress, setDetectionProgressMap] = useState<Record<number, number>>({});

  // ---------- Per-camera fiducials + clicked level ----------
  const [fiducials, setFiducialsMap] = useState<Record<number, FiducialSet>>({});
  const [clickedLevel, setClickedLevelMap] = useState<Record<number, 'peak' | 'trough'>>({});

  // ---------- Per-camera, per-pose peak/trough labels ----------
  // Shape: { [camera]: { [frame_idx]: 'peak' | 'trough' } }. Required by
  // the backend since the auto-detect was removed — operator declares
  // each pose's label via a dropdown in the per-pose grid.
  const [poseLevels, setPoseLevelsMap] = useState<Record<number, Record<number, string>>>({});

  // ---------- Per-camera detection overlay ----------
  const [detectionData, setDetectionDataMap] = useState<Record<number, SteppedDetection | null>>({});
  const setDetectionDataFor = (cam: number, d: SteppedDetection | null) =>
    setDetectionDataMap(prev => ({ ...prev, [cam]: d }));

  // ---------- Per-camera fit job + camera model ----------
  const [fitJobStatus, setFitJobStatusMap] = useState<Record<number, JobStatus | null>>({});
  const [cameraModel, setCameraModelMap] = useState<Record<number, CameraModel | null>>({});
  const [modelLoading, setModelLoading] = useState<Record<number, boolean>>({});
  const [modelLoadError, setModelLoadError] = useState<Record<number, string | null>>({});

  // ---------- Multi-camera fit job ----------
  const [multiCameraJobStatus, setMultiCameraJobStatus] = useState<MultiCameraJobStatus | null>(null);

  // ---------- Vector calibration job ----------
  const [vectorJobStatus, setVectorJobStatus] = useState<MultiCameraJobStatus | null>(null);

  // ---------- Model type (always pinhole for stepped planar under new design) ----------
  const [modelType, setModelType] = useState<string>('pinhole');

  // ---------- Refs for guards + polling ----------
  const configLoadedRef = useRef(false);
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectPollRefs = useRef<Record<number, ReturnType<typeof setInterval> | null>>({});
  const fitPollRefs = useRef<Record<number, ReturnType<typeof setInterval> | null>>({});
  const multiPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vectorPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------- Helpers for per-camera state updates ----------
  const setSequenceIdFor = (cam: number, v: string | null) =>
    setSequenceIdMap(prev => ({ ...prev, [cam]: v }));
  const setSequenceStatusFor = (cam: number, v: SequenceStatus) =>
    setSequenceStatusMap(prev => ({ ...prev, [cam]: v }));
  const setSequencePosesFor = (cam: number, v: PoseSummary[] | null) =>
    setSequencePosesMap(prev => ({ ...prev, [cam]: v }));
  const setSequenceErrorFor = (cam: number, v: string | null) =>
    setSequenceErrorMap(prev => ({ ...prev, [cam]: v }));
  const setDetectionProgressFor = (cam: number, v: number) =>
    setDetectionProgressMap(prev => ({ ...prev, [cam]: v }));
  const setFiducialsFor = (
    cam: number,
    update: FiducialSet | ((prev: FiducialSet) => FiducialSet),
  ) =>
    setFiducialsMap(prev => {
      const existing = prev[cam] ?? { origin: null, x_axis: null, y_axis: null };
      const next = typeof update === 'function' ? update(existing) : update;
      return { ...prev, [cam]: next };
    });
  const setClickedLevelFor = (cam: number, level: 'peak' | 'trough') => {
    setClickedLevelMap(prev => ({ ...prev, [cam]: level }));
    // Propagate the new datum choice to every existing per-pose entry
    // for this camera — matches the expected workflow: pick the datum
    // face, have it carry to every other pose, then override any
    // individual pose as needed.
    setPoseLevelsMap(prev => {
      const existing = prev[cam] || {};
      const next: Record<number, string> = {};
      for (const k of Object.keys(existing)) next[Number(k)] = level;
      return { ...prev, [cam]: next };
    });
  };

  const setPoseLevelFor = (cam: number, frameIdx: number, level: string) =>
    setPoseLevelsMap(prev => ({
      ...prev,
      [cam]: { ...(prev[cam] || {}), [frameIdx]: level },
    }));
  const setFitJobStatusFor = (cam: number, v: JobStatus | null) =>
    setFitJobStatusMap(prev => ({ ...prev, [cam]: v }));
  const setCameraModelFor = (cam: number, v: CameraModel | null) =>
    setCameraModelMap(prev => ({ ...prev, [cam]: v }));
  const setModelLoadingFor = (cam: number, v: boolean) =>
    setModelLoading(prev => ({ ...prev, [cam]: v }));
  const setModelLoadErrorFor = (cam: number, v: string | null) =>
    setModelLoadError(prev => ({ ...prev, [cam]: v }));

  // ---------- Load config on mount ----------
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Calibration image settings
        const calRes = await fetch('/backend/calibration/config');
        if (calRes.ok) {
          const calData = await calRes.json();
          if (calData.image_format) setImageFormat(calData.image_format);
          if (calData.image_type) setImageType(calData.image_type);
          if (calData.num_images) setNumImages(String(calData.num_images));
          if (calData.calibration_sources !== undefined) setCalibrationSources(calData.calibration_sources);
          if (calData.use_camera_subfolders !== undefined) setUseCameraSubfolders(calData.use_camera_subfolders);
          if (calData.camera_subfolders !== undefined) setCameraSubfolders(calData.camera_subfolders);
        }

        // Stepped-planar board geometry + dt
        const cfgRes = await fetch('/backend/config');
        if (cfgRes.ok) {
          const cfgData = await cfgRes.json();
          const sp = cfgData.calibration?.stepped_planar || {};
          const sb = cfgData.calibration?.stepped_board || {};
          const merged = { ...sb, ...sp };
          if (merged.dot_spacing_mm) setDotSpacingMm(merged.dot_spacing_mm);
          if (merged.step_height_mm) setStepHeightMm(merged.step_height_mm);
          if (merged.board_thickness_mm) setBoardThicknessMm(merged.board_thickness_mm);
          if (merged.dt) setDt(merged.dt);
          if (merged.datum_frame) setDatumFrame(merged.datum_frame);
          if (merged.num_calibration_frames) setNumCalibrationFrames(merged.num_calibration_frames);
          // Stepped-planar-only: per-camera operator state
          if (sp.clicked_level && typeof sp.clicked_level === 'object') {
            const parsed: Record<number, 'peak' | 'trough'> = {};
            for (const [k, v] of Object.entries(sp.clicked_level)) {
              if (v === 'peak' || v === 'trough') parsed[Number(k)] = v;
            }
            setClickedLevelMap(parsed);
          }
          if (sp.pose_levels && typeof sp.pose_levels === 'object') {
            const parsed: Record<number, Record<number, string>> = {};
            for (const [camKey, inner] of Object.entries(sp.pose_levels)) {
              if (inner && typeof inner === 'object') {
                const innerParsed: Record<number, string> = {};
                for (const [fk, fv] of Object.entries(inner as Record<string, unknown>)) {
                  innerParsed[Number(fk)] = String(fv);
                }
                parsed[Number(camKey)] = innerParsed;
              }
            }
            setPoseLevelsMap(parsed);
          }
          if (sp.fiducials && typeof sp.fiducials === 'object') {
            const parsed: Record<number, FiducialSet> = {};
            for (const [camKey, fset] of Object.entries(sp.fiducials)) {
              if (fset && typeof fset === 'object') {
                parsed[Number(camKey)] = fset as FiducialSet;
              }
            }
            setFiducialsMap(parsed);
          }
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
      configLoadedRef.current = true;

      // Initial validation for the currently selected camera
      setValidating(true);
      try {
        const valRes = await fetch('/backend/calibration/dotboard/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_path_idx: sourcePathIdx, camera }),
        });
        const valData = await valRes.json();
        setValidation(valData);
      } catch (e) {
        console.error('Initial validation failed:', e);
      } finally {
        setValidating(false);
      }
    };
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Validate images for the current camera ----------
  const validateImages = useCallback(async () => {
    setValidating(true);
    try {
      const res = await fetch('/backend/calibration/dotboard/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera,
        }),
      });
      const data = await res.json();
      setValidation(data);
    } catch (e) {
      console.error('Validation failed:', e);
      setValidation({ valid: false, found_count: 0, error: String(e) });
    } finally {
      setValidating(false);
    }
  }, [sourcePathIdx, camera]);

  // ---------- Save config (debounced) ----------
  const saveConfig = useCallback(() => {
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
    configDebounceRef.current = setTimeout(async () => {
      try {
        await fetch('/backend/calibration/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_format: imageFormat,
            image_type: imageType,
            num_images: parseInt(numImages) || 10,
            calibration_sources: calibrationSources,
            use_camera_subfolders: useCameraSubfolders,
            camera_subfolders: cameraSubfolders,
          }),
        });

        await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calibration: {
              stepped_planar: {
                dot_spacing_mm: dotSpacingMm,
                step_height_mm: stepHeightMm,
                board_thickness_mm: boardThicknessMm,
                dt,
                datum_frame: datumFrame,
                num_calibration_frames: numCalibrationFrames,
                // Per-camera operator state — stepped_planar didn't
                // persist any of this previously, but the CLI path
                // needs it to run headless.
                clicked_level: clickedLevel,
                pose_levels: poseLevels,
                fiducials,
              },
            },
          }),
        });
      } catch (e) {
        console.error('Failed to save config:', e);
      }

      validateImages();
    }, 500);
  }, [
    imageFormat, imageType, numImages, calibrationSources, useCameraSubfolders,
    cameraSubfolders, dotSpacingMm, stepHeightMm, boardThicknessMm, dt,
    datumFrame, numCalibrationFrames, validateImages,
    clickedLevel, poseLevels, fiducials,
  ]);

  // Auto-save when any persisted param changes (after initial load)
  useEffect(() => {
    if (!configLoadedRef.current) return;
    saveConfig();
  }, [saveConfig]);

  // ---------- Clear per-camera state helper ----------
  const clearCameraState = useCallback((cam: number) => {
    setSequenceIdFor(cam, null);
    setSequenceStatusFor(cam, 'idle');
    setSequencePosesFor(cam, null);
    setSequenceErrorFor(cam, null);
    setDetectionProgressFor(cam, 0);
    setFiducialsFor(cam, { origin: null, x_axis: null, y_axis: null });
    setClickedLevelMap(prev => {
      const next = { ...prev };
      delete next[cam];
      return next;
    });
    setPoseLevelsMap(prev => {
      const next = { ...prev };
      delete next[cam];
      return next;
    });
    setFitJobStatusFor(cam, null);
    // Stop any polling for this camera
    const dp = detectPollRefs.current[cam];
    if (dp) { clearInterval(dp); detectPollRefs.current[cam] = null; }
    const fp = fitPollRefs.current[cam];
    if (fp) { clearInterval(fp); fitPollRefs.current[cam] = null; }
  }, []);

  // Clear ALL per-camera sequence state when source path changes (stale pixels)
  useEffect(() => {
    if (!configLoadedRef.current) return;
    setSequenceIdMap({});
    setSequenceStatusMap({});
    setSequencePosesMap({});
    setSequenceErrorMap({});
    setDetectionProgressMap({});
    setDetectionDataMap({});
    setFiducialsMap({});
    setClickedLevelMap({});
    setFitJobStatusMap({});
    setCameraModelMap({});
    setModelLoadError({});
    // Stop all polling
    Object.values(detectPollRefs.current).forEach(h => { if (h) clearInterval(h); });
    Object.values(fitPollRefs.current).forEach(h => { if (h) clearInterval(h); });
    detectPollRefs.current = {};
    fitPollRefs.current = {};
  }, [sourcePathIdx]);

  // ---------- Detect sequence for one camera ----------
  const detectSequence = useCallback(async (cam: number) => {
    if (numCalibrationFrames < 1) {
      setSequenceErrorFor(cam, 'numCalibrationFrames must be >= 1');
      return;
    }
    if (datumFrame < 1 || datumFrame > numCalibrationFrames) {
      setSequenceErrorFor(
        cam,
        `Datum frame ${datumFrame} is outside the sequence range [1, ${numCalibrationFrames}]`,
      );
      return;
    }

    setSequenceStatusFor(cam, 'detecting');
    setSequenceErrorFor(cam, null);
    setSequencePosesFor(cam, null);
    setSequenceIdFor(cam, null);
    setDetectionProgressFor(cam, 0);

    try {
      const res = await fetch('/backend/calibration/stepped_planar/detect_sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: cam,
          num_frames: numCalibrationFrames,
          start_frame_idx: 1,
          datum_frame_idx: datumFrame,
        }),
      });
      const data = await res.json();
      if (!data.job_id) {
        setSequenceStatusFor(cam, 'error');
        setSequenceErrorFor(cam, data.error || 'Failed to start sequence detection');
        return;
      }
      const jobId = data.job_id;

      const poll = async () => {
        try {
          const pollRes = await fetch(
            `/backend/calibration/stepped_planar/detect_sequence/job/${jobId}`,
          );
          const pollData = await pollRes.json();
          if (pollData.progress !== undefined) {
            setDetectionProgressFor(cam, pollData.progress);
          }
          if (pollData.status === 'completed') {
            const handle = detectPollRefs.current[cam];
            if (handle) { clearInterval(handle); detectPollRefs.current[cam] = null; }
            setSequenceIdFor(cam, pollData.sequence_id);
            const poses = (pollData.poses || []) as PoseSummary[];
            setSequencePosesFor(cam, poses);
            // Only seed the datum pose's label. Non-datum poses start
            // empty — user must verify each via click-to-label. This
            // persists to config.yaml so the CLI knows what's confirmed.
            setPoseLevelsMap(prev => {
              const currentCam = prev[cam] || {};
              const datum = clickedLevel[cam] || 'peak';
              return { ...prev, [cam]: { ...currentCam, [datumFrame]: datum } };
            });
            // Populate detection overlay from datum frame data
            if (pollData.datum_detection) {
              setDetectionDataFor(cam, pollData.datum_detection);
            }
            setDetectionProgressFor(cam, 100);
            setSequenceStatusFor(cam, 'ready');
          } else if (pollData.status === 'failed') {
            const handle = detectPollRefs.current[cam];
            if (handle) { clearInterval(handle); detectPollRefs.current[cam] = null; }
            setSequenceStatusFor(cam, 'error');
            setSequenceErrorFor(cam, pollData.error || 'Sequence detection failed');
          }
        } catch (e) {
          console.error('Sequence detection poll failed:', e);
        }
      };
      poll();
      detectPollRefs.current[cam] = setInterval(poll, 500);
    } catch (e) {
      setSequenceStatusFor(cam, 'error');
      setSequenceErrorFor(cam, String(e));
    }
  }, [sourcePathIdx, numCalibrationFrames, datumFrame]);

  // ---------- Snap a fiducial click for one camera ----------
  const snapFiducial = useCallback(
    async (
      cam: number,
      which: 'origin' | 'x_axis' | 'y_axis',
      clickX: number,
      clickY: number,
    ): Promise<{ snapped_x: number; snapped_y: number } | null> => {
      const sid = sequenceId[cam];
      if (!sid) {
        setSequenceErrorFor(cam, 'No sequence detected. Run detect_sequence first.');
        return null;
      }
      try {
        const res = await fetch('/backend/calibration/stepped_planar/snap_fiducial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sequence_id: sid,
            click_x: clickX,
            click_y: clickY,
          }),
        });
        const data = await res.json();
        if (data.snapped_x !== undefined && data.snapped_y !== undefined) {
          const sx = data.snapped_x as number;
          const sy = data.snapped_y as number;
          setFiducialsFor(cam, prev => ({ ...prev, [which]: [sx, sy] }));
          return { snapped_x: sx, snapped_y: sy };
        }
        console.error('snap_fiducial failed:', data.error);
        // Fall back to raw click so user isn't stuck
        setFiducialsFor(cam, prev => ({ ...prev, [which]: [clickX, clickY] }));
        return null;
      } catch (e) {
        console.error('snap_fiducial error:', e);
        setFiducialsFor(cam, prev => ({ ...prev, [which]: [clickX, clickY] }));
        return null;
      }
    },
    [sequenceId],
  );

  // ---------- Generate camera model for one camera ----------
  const generateCameraModel = useCallback(async (cam: number) => {
    const sid = sequenceId[cam];
    const fids = fiducials[cam];
    const level = clickedLevel[cam];
    if (!sid) {
      setSequenceErrorFor(cam, 'No sequence detected. Run detect_sequence first.');
      return;
    }
    if (!fids || !fids.origin || !fids.x_axis || !fids.y_axis) {
      setSequenceErrorFor(cam, 'Set all three fiducials (origin, +X, +Y) first.');
      return;
    }
    if (level !== 'peak' && level !== 'trough') {
      setSequenceErrorFor(cam, "Select clicked level ('peak' or 'trough') first.");
      return;
    }

    setFitJobStatusFor(cam, { status: 'starting', progress: 0 });
    try {
      const res = await fetch('/backend/calibration/stepped_planar/generate_camera_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequence_id: sid,
          fiducials: {
            origin: fids.origin,
            x_axis: fids.x_axis,
            y_axis: fids.y_axis,
          },
          clicked_level: level,
          pose_levels: poseLevels[cam] || {},
        }),
      });
      const data = await res.json();
      if (!data.job_id) {
        setFitJobStatusFor(cam, {
          status: 'failed',
          error: data.error || 'Failed to start camera model generation',
        });
        return;
      }
      const jobId = data.job_id;

      const poll = async () => {
        try {
          const pollRes = await fetch(
            `/backend/calibration/stepped_planar/generate_camera_model/job/${jobId}`,
          );
          const pollData = await pollRes.json();
          setFitJobStatusFor(cam, pollData);

          if (pollData.status === 'completed') {
            const handle = fitPollRefs.current[cam];
            if (handle) { clearInterval(handle); fitPollRefs.current[cam] = null; }
            // Populate camera model from completed job payload
            const model: CameraModel = {
              model_type: 'pinhole',
              camera_matrix: pollData.K,
              dist_coeffs: pollData.dist,
              reprojection_error: Number(pollData.rms ?? 0),
              num_poses: pollData.num_poses,
              model_path: pollData.model_path,
              rms: pollData.rms,
            };
            if (pollData.K && pollData.K[0] && pollData.K[1]) {
              model.focal_length = [Number(pollData.K[0][0]), Number(pollData.K[1][1])];
              model.principal_point = [Number(pollData.K[0][2]), Number(pollData.K[1][2])];
            }
            setCameraModelFor(cam, model);
            // Kick off a load to hydrate width/height fields we don't get from the job
            loadModel(cam);
          } else if (pollData.status === 'failed') {
            const handle = fitPollRefs.current[cam];
            if (handle) { clearInterval(handle); fitPollRefs.current[cam] = null; }
          }
        } catch (e) {
          console.error('generate_camera_model poll failed:', e);
        }
      };
      poll();
      fitPollRefs.current[cam] = setInterval(poll, 500);
    } catch (e) {
      setFitJobStatusFor(cam, { status: 'failed', error: String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceId, fiducials, clickedLevel, poseLevels]);

  // ---------- Generate camera model for ALL cameras ----------
  const generateCameraModelAll = useCallback(async () => {
    const per_camera: Record<string, {
      sequence_id: string;
      fiducials: FiducialSet;
      clicked_level: string;
      pose_levels: Record<number, string>;
    }> = {};
    for (const cam of cameraOptions) {
      const sid = sequenceId[cam];
      const fids = fiducials[cam];
      const level = clickedLevel[cam];
      if (!sid || !fids?.origin || !fids?.x_axis || !fids?.y_axis || (level !== 'peak' && level !== 'trough')) {
        console.warn(`Camera ${cam} missing state — cannot run generate_camera_model_all`);
        return;
      }
      per_camera[String(cam)] = {
        sequence_id: sid,
        fiducials: fids,
        clicked_level: level,
        pose_levels: poseLevels[cam] || {},
      };
    }

    setMultiCameraJobStatus({
      status: 'starting',
      processed_cameras: 0,
      total_cameras: cameraOptions.length,
    });

    try {
      const res = await fetch('/backend/calibration/stepped_planar/generate_camera_model_all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ per_camera }),
      });
      const data = await res.json();
      if (!data.job_id) {
        setMultiCameraJobStatus({
          status: 'failed',
          processed_cameras: 0,
          total_cameras: cameraOptions.length,
          error: data.error || 'Failed to start multi-camera job',
        });
        return;
      }
      const jobId = data.job_id;

      const poll = async () => {
        try {
          const pollRes = await fetch(
            `/backend/calibration/stepped_planar/generate_camera_model/job/${jobId}`,
          );
          const pollData = await pollRes.json();
          setMultiCameraJobStatus(pollData);

          if (pollData.status === 'completed' || pollData.status === 'failed') {
            if (multiPollRef.current) { clearInterval(multiPollRef.current); multiPollRef.current = null; }
            if (pollData.status === 'completed') {
              // Hydrate each camera model from disk
              for (const cam of cameraOptions) loadModel(cam);
            }
          }
        } catch (e) {
          console.error('generate_camera_model_all poll failed:', e);
        }
      };
      poll();
      multiPollRef.current = setInterval(poll, 500);
    } catch (e) {
      setMultiCameraJobStatus({
        status: 'failed',
        processed_cameras: 0,
        total_cameras: cameraOptions.length,
        error: String(e),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOptions, sequenceId, fiducials, clickedLevel, poseLevels]);

  // ---------- Load saved camera model for one camera ----------
  const loadModel = useCallback(async (cam: number) => {
    setModelLoadingFor(cam, true);
    setModelLoadErrorFor(cam, null);
    try {
      const res = await fetch(
        `/backend/calibration/stepped_planar/model?source_path_idx=${sourcePathIdx}&camera=${cam}`,
      );
      const data = await res.json();
      if (res.ok && data.exists) {
        setCameraModelFor(cam, data.camera_model);
        setModelLoadErrorFor(cam, null);
      } else {
        setCameraModelFor(cam, null);
        setModelLoadErrorFor(
          cam,
          `No camera model found for Camera ${cam}. Generate a model first.`,
        );
      }
    } catch (e) {
      console.error('Failed to load model:', e);
      setModelLoadErrorFor(cam, `Failed to load model: ${e}`);
    } finally {
      setModelLoadingFor(cam, false);
    }
  }, [sourcePathIdx]);

  // ---------- Auto-load model for the currently active camera ----------
  useEffect(() => {
    if (!configLoadedRef.current) return;
    loadModel(camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, sourcePathIdx]);

  // ---------- Vector calibration ----------
  const calibrateVectors = useCallback(async (
    forAllCameras: boolean = false,
    typeName: string = 'instantaneous',
  ) => {
    try {
      const body: Record<string, unknown> = {
        source_path_idx: sourcePathIdx,
        type_name: typeName,
      };
      if (forAllCameras) body.cameras = cameraOptions;
      else body.camera = camera;

      const res = await fetch('/backend/calibration/vectors/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.job_id) {
        setVectorJobStatus({
          status: 'starting',
          processed_cameras: 0,
          total_cameras: data.cameras?.length || 1,
        });

        const poll = async () => {
          try {
            const pollRes = await fetch(`/backend/calibration/vectors/status/${data.job_id}`);
            const pollData = await pollRes.json();
            setVectorJobStatus(pollData);
            if (pollData.status === 'completed' || pollData.status === 'failed') {
              if (vectorPollRef.current) { clearInterval(vectorPollRef.current); vectorPollRef.current = null; }
            }
          } catch (e) {
            console.error('Vector job poll failed:', e);
          }
        };
        poll();
        vectorPollRef.current = setInterval(poll, 500);
      } else {
        console.error('Failed to start vector calibration:', data.error);
      }
    } catch (e) {
      console.error('Vector calibration error:', e);
    }
  }, [sourcePathIdx, camera, cameraOptions]);

  // ---------- Ensure valid camera selection ----------
  useEffect(() => {
    if (cameraOptions.length > 0 && !cameraOptions.includes(camera)) {
      setCamera(cameraOptions[0]);
    }
  }, [cameraOptions, camera]);

  // ---------- Cleanup on unmount ----------
  useEffect(() => {
    return () => {
      if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
      Object.values(detectPollRefs.current).forEach(h => { if (h) clearInterval(h); });
      Object.values(fitPollRefs.current).forEach(h => { if (h) clearInterval(h); });
      if (multiPollRef.current) clearInterval(multiPollRef.current);
      if (vectorPollRef.current) clearInterval(vectorPollRef.current);
    };
  }, []);

  // ---------- Overlay helpers (same logic as stereo hook) ----------
  const getDetectionOverlayPoints = useCallback((cam: number): { x: number; y: number; color: string }[] => {
    const detection = detectionData[cam];
    if (!detection) return [];
    const points: { x: number; y: number; color: string }[] = [];
    if (detection.level_A && detection.level_B) {
      for (const center of detection.level_A.centers) {
        points.push({ x: center[0], y: center[1], color: 'blue' });
      }
      for (const center of detection.level_B.centers) {
        points.push({ x: center[0], y: center[1], color: 'red' });
      }
    }
    return points;
  }, [detectionData]);

  const getDetectionOverlayLines = useCallback((cam: number): { x1: number; y1: number; x2: number; y2: number; color?: string }[] => {
    const detection = detectionData[cam];
    if (!detection) return [];
    const lines: { x1: number; y1: number; x2: number; y2: number; color?: string }[] = [];
    for (const [levelData, levelName] of [
      [detection.level_A, 'A'] as const,
      [detection.level_B, 'B'] as const,
    ]) {
      if (!levelData?.centers?.length || !levelData?.grid_indices?.length) continue;
      if (levelData.centers.length !== levelData.grid_indices.length) continue;
      const color = levelName === 'A' ? 'rgba(80, 140, 255, 1)' : 'rgba(255, 120, 120, 1)';
      const lookup = new Map<string, number>();
      for (let i = 0; i < levelData.grid_indices.length; i++) {
        lookup.set(`${levelData.grid_indices[i][0]},${levelData.grid_indices[i][1]}`, i);
      }
      for (let i = 0; i < levelData.grid_indices.length; i++) {
        const [col, row] = levelData.grid_indices[i];
        const [x1, y1] = levelData.centers[i];
        const ri = lookup.get(`${col + 1},${row}`);
        if (ri !== undefined) lines.push({ x1, y1, x2: levelData.centers[ri][0], y2: levelData.centers[ri][1], color });
        const di = lookup.get(`${col},${row + 1}`);
        if (di !== undefined) lines.push({ x1, y1, x2: levelData.centers[di][0], y2: levelData.centers[di][1], color });
      }
    }
    return lines;
  }, [detectionData]);

  const getFiducialMarkers = useCallback((cam: number) => {
    const fids = fiducials[cam];
    const markers: { x: number; y: number; color: string; label?: string }[] = [];
    if (fids?.origin) markers.push({ x: fids.origin[0], y: fids.origin[1], color: 'lime', label: 'O' });
    if (fids?.x_axis) markers.push({ x: fids.x_axis[0], y: fids.x_axis[1], color: 'red', label: 'X' });
    if (fids?.y_axis) markers.push({ x: fids.y_axis[0], y: fids.y_axis[1], color: 'blue', label: 'Y' });
    return markers;
  }, [fiducials]);

  // ---------- Fetch per-pose detection for overlay ----------
  const fetchPoseDetection = useCallback(async (cam: number, frameIdx: number) => {
    const seqId = sequenceId[cam];
    if (!seqId) return;
    try {
      const res = await fetch(
        `/backend/calibration/stepped_planar/sequence_pose_detection?sequence_id=${seqId}&frame_idx=${frameIdx}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.blobs) setDetectionDataFor(cam, data);
    } catch (e) {
      console.error('Failed to fetch pose detection:', e);
    }
  }, [sequenceId]);

  // ---------- Identify which level a clicked dot belongs to ----------
  const identifyPoseLevel = useCallback(async (
    cam: number,
    frameIdx: number,
    clickX: number,
    clickY: number,
  ): Promise<string | null> => {
    const seqId = sequenceId[cam];
    if (!seqId) return null;
    try {
      const res = await fetch('/backend/calibration/stepped_planar/identify_pose_level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequence_id: seqId,
          frame_idx: frameIdx,
          click_x: clickX,
          click_y: clickY,
        }),
      });
      const data = await res.json();
      if (!data.level) return null;
      const datumLabel = clickedLevel[cam] || 'peak';
      return data.level === 'A' ? datumLabel : (datumLabel === 'peak' ? 'trough' : 'peak');
    } catch (e) {
      console.error('Failed to identify pose level:', e);
      return null;
    }
  }, [sequenceId, clickedLevel]);

  return {
    // Source selection
    sourcePathIdx,
    setSourcePathIdx,
    camera,
    setCamera,

    // Image config
    imageFormat,
    setImageFormat,
    imageType,
    setImageType,
    numImages,
    setNumImages,
    calibrationSources,
    setCalibrationSources,
    useCameraSubfolders,
    setUseCameraSubfolders,
    cameraSubfolders,
    setCameraSubfolders,

    // Board geometry
    dotSpacingMm,
    setDotSpacingMm,
    stepHeightMm,
    setStepHeightMm,
    boardThicknessMm,
    setBoardThicknessMm,
    dt,
    setDt,

    // Sequence controls
    numCalibrationFrames,
    setNumCalibrationFrames,
    datumFrame,
    setDatumFrame,

    // Model type (fixed "pinhole" but retained for config-shape parity)
    modelType,
    setModelType,

    // Validation
    validation,
    validating,
    validateImages,

    // Per-camera sequence state
    sequenceId,
    sequenceStatus,
    sequencePoses,
    sequenceError,
    detectionProgress,

    // Per-camera fiducials
    fiducials,
    clickedLevel,
    setClickedLevel: setClickedLevelFor,
    poseLevels,
    setPoseLevel: setPoseLevelFor,

    // Per-camera fit + model
    fitJobStatus,
    cameraModel,
    modelLoading,
    modelLoadError,

    // Multi-camera job + vector job
    multiCameraJobStatus,
    isMultiCameraCalibrating:
      multiCameraJobStatus?.status === 'running' ||
      multiCameraJobStatus?.status === 'starting',
    vectorJobStatus,
    isVectorCalibrating:
      vectorJobStatus?.status === 'running' || vectorJobStatus?.status === 'starting',

    // Actions
    detectSequence,
    snapFiducial,
    generateCameraModel,
    generateCameraModelAll,
    loadModel,
    clearCameraState,
    calibrateVectors,
    fetchPoseDetection,
    identifyPoseLevel,

    // Overlay helpers
    getDetectionOverlayPoints,
    getDetectionOverlayLines,
    getFiducialMarkers,

    // Options (passthrough)
    cameraOptions,
    sourcePaths,
  };
}
