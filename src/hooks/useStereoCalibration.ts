import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Detection data for a single stereo frame (on-demand overlay).
 */
export interface StereoFrameDetection {
  grid_points: [number, number][];
  grid_indices?: [number, number][];
}

/** Per-camera pinhole intrinsics (from calibration stereo enrichment). */
export interface CamIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  camera_matrix: number[][];
  dist_coeffs: number[];
  rms: number;
  image_width?: number;
  image_height?: number;
}

/**
 * Stereo camera model shaped for the results card. calibration stereo fits each
 * camera as DaVis-matching pinhole and derives the pose; it does NOT emit
 * rectification/essential/fundamental matrices, so the card shows the two
 * pinhole models + relative pose (angle / baseline).
 */
export interface StereoModel {
  intrinsics1: CamIntrinsics;
  intrinsics2: CamIntrinsics;
  rms_cam1: number;
  rms_cam2: number;
  relative_angle_deg: number;
  baseline_distance_mm: number;
  num_image_pairs: number;
  world_frame_mode?: string;
}

/** World-frame clicks (image-down pixels) defining origin/+X/+Y on camera 1. */
export interface WorldFrameClicks {
  origin: [number, number];
  x_axis: [number, number];
  y_axis: [number, number];
  origin_mm: [number, number];
}

/**
 * Single-camera validation result (calibration /validate shape).
 */
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
  suggested_pattern?: string;
  suggested_subfolder?: string;
  error?: string;
}

/**
 * Combined stereo validation result (cam1 + cam2 validated separately).
 */
export interface StereoValidationResult {
  valid: boolean;
  cam1: CameraValidationResult;
  cam2: CameraValidationResult;
  matching_count: number | 'container';
  container_format?: boolean;
  error?: string;
}

/**
 * Synchronous-generate status, kept in the v1 `StereoJobStatus` shape so the
 * existing progress/result JSX renders unchanged.
 */
export interface StereoJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  stage?: string;
  processed_pairs: number;
  valid_pairs: number;
  total_pairs: number;
  error?: string;
  stereo_rms_error?: number;
  cam1_rms_error?: number;
  cam2_rms_error?: number;
  num_pairs_used?: number;
  relative_angle_deg?: number;
}

/**
 * Apply/reconstruct job status (calibration apply job).
 */
export interface StereoReconstructJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  processed_frames: number;
  successful_frames: number;
  total_frames: number;
  error?: string;
}

const BOARD = 'dotboard';

/**
 * Stereo dotboard calibration on the calibration (pinhole, no-coordinate-flip)
 * backend. Mirrors `useDotboardCalibration` (synchronous generate, on-demand
 * overlay, config split) for two cameras: each is fitted as DaVis pinhole and the
 * relative pose derived. The world frame is defined on camera 1 only (clicks).
 */
export function useStereoCalibration(
  cameraOptions: number[],
  sourcePaths: string[],
) {
  // Source selection
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [cam1, setCam1] = useState(1);
  const [cam2, setCam2] = useState(2);
  const [activeCam, setActiveCam] = useState<number>(1);

  // Image config (persists to config.calibration)
  const [imageFormat, setImageFormat] = useState('calib%05d.tif');
  const [imageType, setImageType] = useState('standard');
  const [numImages, setNumImages] = useState<string>("10");
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);

  // Board params (persist to config.calibration.dotboard)
  const [dotSpacingMm, setDotSpacingMm] = useState(28.89);
  const [dt, setDt] = useState(1.0);
  const [datumFrame, setDatumFrame] = useState(1);

  // Validation
  const [validation, setValidation] = useState<StereoValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Synchronous generate status (v1 shape)
  const [jobStatus, setJobStatus] = useState<StereoJobStatus | null>(null);

  // Apply (reconstruct) job tracking
  const [reconstructJobId, setReconstructJobId] = useState<string | null>(null);
  const [reconstructJobStatus, setReconstructJobStatus] = useState<StereoReconstructJobStatus | null>(null);

  // Model + on-demand detections (overlay)
  const [stereoModel, setStereoModel] = useState<StereoModel | null>(null);
  const [loadedWorldFrame, setLoadedWorldFrame] = useState<any>(null);
  const [detectionsCam1, setDetectionsCam1] = useState<Record<string, StereoFrameDetection>>({});
  const [detectionsCam2, setDetectionsCam2] = useState<Record<string, StereoFrameDetection>>({});
  const [modelLoading, setModelLoading] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);

  const configLoadedRef = useRef(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconstructPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const boardParams = useCallback(() => ({ dot_spacing_mm: dotSpacingMm }), [dotSpacingMm]);
  const frameTotal = useCallback(() => parseInt(numImages) || 10, [numImages]);

  // Validate one camera via calibration (all formats).
  const validateOne = useCallback(async (cam: number): Promise<CameraValidationResult> => {
    const res = await fetch('/backend/calibration/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera: cam, source_path_idx: sourcePathIdx,
        image_format: imageFormat, image_type: imageType, frame_total: frameTotal(),
      }),
    });
    return res.json();
  }, [sourcePathIdx, imageFormat, imageType, frameTotal]);

  // Validate both cameras and combine into the stereo shape.
  const validateImages = useCallback(async () => {
    setValidating(true);
    try {
      const [v1, v2] = await Promise.all([validateOne(cam1), validateOne(cam2)]);
      const count = (v: CameraValidationResult) =>
        v.found_count === 'container' ? Infinity : Number(v.found_count) || 0;
      const matching = v1.found_count === 'container' || v2.found_count === 'container'
        ? 'container'
        : Math.min(count(v1), count(v2));
      setValidation({
        valid: !!(v1.valid && v2.valid),
        cam1: v1, cam2: v2,
        matching_count: matching as number | 'container',
        error: v1.error || v2.error,
      });
    } catch (e) {
      const err: CameraValidationResult = { valid: false, found_count: 0, error: String(e) };
      setValidation({ valid: false, cam1: err, cam2: err, matching_count: 0, error: String(e) });
    } finally {
      setValidating(false);
    }
  }, [cam1, cam2, validateOne]);

  // Load config on mount, then validate.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/backend/config');
        if (res.ok) {
          const cfg = await res.json();
          const cal = cfg.calibration || {};
          if (cal.image_format) setImageFormat(cal.image_format);
          if (cal.image_type) setImageType(cal.image_type);
          if (cal.n_views ?? cal.num_images) setNumImages(String(cal.n_views ?? cal.num_images));
          if (cal.calibration_sources !== undefined) setCalibrationSources(cal.calibration_sources);
          if (cal.use_camera_subfolders !== undefined) setUseCameraSubfolders(cal.use_camera_subfolders);
          if (cal.camera_subfolders !== undefined) setCameraSubfolders(cal.camera_subfolders);
          const c2 = cfg.calibration || {};
          if (c2.dotboard?.dot_spacing_mm) setDotSpacingMm(c2.dotboard.dot_spacing_mm);
          if (c2.dt) setDt(c2.dt);
          if (c2.datum_frame) setDatumFrame(c2.datum_frame);
          if (c2.camera_pair && c2.camera_pair.length >= 2) {
            setCam1(c2.camera_pair[0]); setCam2(c2.camera_pair[1]);
          }
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
      configLoadedRef.current = true;
      setConfigLoaded(true);
      validateImages();
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist config (debounced), then validate.
  const saveConfig = useCallback(() => {
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
    configDebounceRef.current = setTimeout(async () => {
      try {
        await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calibration: {
              image_format: imageFormat,
              image_type: imageType,
              n_views: frameTotal(),
              calibration_sources: calibrationSources,
              use_camera_subfolders: useCameraSubfolders,
              camera_subfolders: cameraSubfolders,
              active: 'stereo_dotboard', dt, datum_frame: datumFrame,
              camera_pair: [cam1, cam2],
              dotboard: { dot_spacing_mm: dotSpacingMm },
            },
          }),
        });
      } catch (e) {
        console.error('Failed to save config:', e);
      }
      validateImages();
    }, 500);
  }, [imageFormat, imageType, frameTotal, calibrationSources, useCameraSubfolders, cameraSubfolders, dt, datumFrame, dotSpacingMm, cam1, cam2, validateImages]);

  useEffect(() => {
    if (!configLoadedRef.current) return;
    saveConfig();
  }, [saveConfig]);

  // Map a calibration stereo model/generate response to the card shape.
  const toStereoModel = (d: any): StereoModel => ({
    intrinsics1: d.intrinsics1,
    intrinsics2: d.intrinsics2,
    rms_cam1: d.rms_cam1,
    rms_cam2: d.rms_cam2,
    relative_angle_deg: d.stereo_angle_deg,
    baseline_distance_mm: d.baseline_mm,
    num_image_pairs: d.num_pairs_used ?? (d.per_view_rms1?.length ?? 0),
    world_frame_mode: d.world_frame_mode,
  });

  // Generate the stereo model (synchronous); optional world-frame clicks on cam1.
  const generateStereoModel = useCallback(async (clicks?: WorldFrameClicks | null) => {
    setJobStatus({ status: 'running', progress: 0, processed_pairs: 0, valid_pairs: 0, total_pairs: frameTotal(), stage: 'calibrating' });
    try {
      const res = await fetch('/backend/calibration/generate_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stereo: true, camera_pair: [cam1, cam2], source_path_idx: sourcePathIdx, board: BOARD,
          board_params: boardParams(), datum_frame: datumFrame, frame_total: frameTotal(),
          image_format: imageFormat, image_type: imageType,
          clicks: clicks || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStereoModel(toStereoModel(data));
        setJobStatus({
          status: 'completed', progress: 100,
          processed_pairs: frameTotal(), valid_pairs: data.num_pairs_used ?? 0, total_pairs: frameTotal(),
          stereo_rms_error: data.rms_cam1, cam1_rms_error: data.rms_cam1, cam2_rms_error: data.rms_cam2,
          num_pairs_used: data.num_pairs_used, relative_angle_deg: data.stereo_angle_deg,
        });
      } else {
        setJobStatus({ status: 'failed', progress: 0, processed_pairs: 0, valid_pairs: 0, total_pairs: 0, error: data.error });
      }
    } catch (e) {
      setJobStatus({ status: 'failed', progress: 0, processed_pairs: 0, valid_pairs: 0, total_pairs: 0, error: String(e) });
    }
  }, [cam1, cam2, sourcePathIdx, boardParams, datumFrame, frameTotal, imageFormat, imageType]);

  // Load the saved stereo model for the current pair (auto-called on mount/view change).
  const loadModel = useCallback(async () => {
    setModelLoading(true);
    try {
      const res = await fetch(`/backend/calibration/model?stereo=1&board=${BOARD}&camera_pair=${cam1},${cam2}&source_path_idx=${sourcePathIdx}`);
      const data = await res.json();
      if (res.ok && data.exists) {
        setStereoModel(toStereoModel(data));
        setLoadedWorldFrame(data.world_frame ?? null);
        return data;
      }
      setStereoModel(null);
      setLoadedWorldFrame(null);
      return null;
    } catch (e) {
      console.error('Failed to load stereo model:', e);
      return null;
    } finally {
      setModelLoading(false);
    }
  }, [sourcePathIdx, cam1, cam2]);

  // Persist the picked world frame (cam1) to config.yaml (calibration.<board>.world_frame).
  const persistWorldFrame = useCallback(async (p: WorldFrameClicks | null) => {
    if (!p) return;
    try {
      await fetch('/backend/update_config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calibration: { [BOARD]: { world_frame: {
            origin: p.origin, x_axis: p.x_axis, y_axis: p.y_axis, origin_mm: p.origin_mm,
          } } },
        }),
      });
    } catch (e) {
      // Non-authoritative (the stereo model holds the world frame), but don't fail silently.
      console.warn('persistWorldFrame failed:', e);
    }
  }, []);

  // Auto-load the saved model on mount (once config is loaded) and on pair/source change.
  useEffect(() => {
    if (!configLoaded) return;
    setStereoModel(null);
    setDetectionsCam1({});
    setDetectionsCam2({});
    loadModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, cam1, cam2, sourcePathIdx]);

  // On-demand board detection for the overlay on a given frame of the active camera.
  const detectFrame = useCallback(async (frame: number, cam: number) => {
    try {
      const res = await fetch('/backend/calibration/detect_frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera: cam, source_path_idx: sourcePathIdx, frame, board: BOARD,
          board_params: boardParams(), image_format: imageFormat, image_type: imageType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const entry = { grid_points: data.image_points, grid_indices: data.grid_indices };
        const setter = cam === cam1 ? setDetectionsCam1 : setDetectionsCam2;
        setter(prev => ({ ...prev, [frame]: entry }));
        setDetectError(null);
      } else {
        setDetectError(data.error || `No board detected on Cam${cam} frame ${frame}`);
      }
    } catch (e) {
      setDetectError(`Detection failed on Cam${cam} frame ${frame}: ${String(e)}`);
    }
  }, [cam1, sourcePathIdx, boardParams, imageFormat, imageType]);

  // Apply the stereo calibration to PIV vectors over selected base paths (Phase D backend).
  const reconstructVectors = useCallback(async (
    typeName: string = 'instantaneous',
    activePaths?: number[],
  ) => {
    setReconstructJobStatus({ status: 'starting', progress: 0, processed_frames: 0, successful_frames: 0, total_frames: 0 });
    try {
      const res = await fetch('/backend/calibration/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stereo: true, board: BOARD, source_path_idx: sourcePathIdx,
          camera_pair: [cam1, cam2], type_name: typeName, dt,
          // Omit active_paths → backend applies to all configured base paths.
          ...(activePaths ? { active_paths: activePaths } : {}),
        }),
      });
      const data = await res.json();
      if (data.job_id) setReconstructJobId(data.job_id);
      else setReconstructJobStatus({ status: 'failed', progress: 0, processed_frames: 0, successful_frames: 0, total_frames: 0, error: data.error });
    } catch (e) {
      setReconstructJobStatus({ status: 'failed', progress: 0, processed_frames: 0, successful_frames: 0, total_frames: 0, error: String(e) });
    }
  }, [sourcePathIdx, cam1, cam2, dt]);

  // Poll apply job.
  useEffect(() => {
    if (!reconstructJobId) {
      if (reconstructPollRef.current) { clearInterval(reconstructPollRef.current); reconstructPollRef.current = null; }
      return;
    }
    const poll = async () => {
      try {
        const res = await fetch(`/backend/calibration/apply/status/${reconstructJobId}`);
        const data = await res.json();
        if (res.ok) {
          setReconstructJobStatus({
            status: data.status, progress: data.progress ?? 0,
            processed_frames: data.processed ?? 0, successful_frames: data.processed ?? 0,
            total_frames: data.total ?? 0, error: data.error,
          });
          if (data.status === 'completed' || data.status === 'failed') {
            if (reconstructPollRef.current) { clearInterval(reconstructPollRef.current); reconstructPollRef.current = null; }
          }
        }
      } catch (e) {
        // best-effort polling
      }
    };
    poll();
    reconstructPollRef.current = setInterval(poll, 700);
    return () => { if (reconstructPollRef.current) clearInterval(reconstructPollRef.current); };
  }, [reconstructJobId]);

  // Ensure valid camera selections (cam1 and cam2 must differ).
  useEffect(() => {
    if (cameraOptions.length >= 2) {
      if (!cameraOptions.includes(cam1)) setCam1(cameraOptions[0]);
      if (!cameraOptions.includes(cam2)) setCam2(cameraOptions[1]);
      if (cam1 === cam2) {
        const other = cameraOptions.filter(c => c !== cam1);
        if (other.length > 0) setCam2(other[0]);
      }
    }
  }, [cameraOptions, cam1, cam2]);

  // Keep activeCam within the pair.
  useEffect(() => {
    if (activeCam !== cam1 && activeCam !== cam2) setActiveCam(cam1);
  }, [cam1, cam2, activeCam]);

  useEffect(() => () => {
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
    if (reconstructPollRef.current) clearInterval(reconstructPollRef.current);
  }, []);

  return {
    sourcePathIdx, setSourcePathIdx, cam1, setCam1, cam2, setCam2,
    activeCam, setActiveCam,
    imageFormat, setImageFormat, imageType, setImageType, numImages, setNumImages,
    calibrationSources, setCalibrationSources, useCameraSubfolders, setUseCameraSubfolders,
    cameraSubfolders, setCameraSubfolders,
    dotSpacingMm, setDotSpacingMm, dt, setDt, datumFrame, setDatumFrame,
    validation, validating, validateImages,
    jobStatus, isCalibrating: jobStatus?.status === 'running' || jobStatus?.status === 'starting',
    reconstructJobStatus, isReconstructing: reconstructJobStatus?.status === 'running' || reconstructJobStatus?.status === 'starting',
    stereoModel, detectionsCam1, detectionsCam2, modelLoading, detectError, hasModel: stereoModel !== null,
    loadedWorldFrame, persistWorldFrame,
    showOverlay, setShowOverlay,
    generateStereoModel, loadModel, reconstructVectors, detectFrame,
    cameraOptions, sourcePaths,
  };
}
