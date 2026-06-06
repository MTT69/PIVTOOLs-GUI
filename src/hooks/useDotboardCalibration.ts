import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Detection data for a single frame (on-demand overlay).
 */
export interface FrameDetection {
  grid_points: [number, number][];
  grid_indices?: [number, number][];
  reprojection_error?: number;
}

/**
 * Camera model shaped for the v1 results card. `model_type` discriminates the
 * pinhole intrinsics block from the single-plane polynomial coefficient block.
 */
export interface CameraModel {
  model_type?: "pinhole" | "polynomial";
  // Pinhole
  camera_matrix?: number[][];
  dist_coeffs?: number[];
  focal_length?: [number, number];
  principal_point?: [number, number];
  // Polynomial (single-plane image-px -> world-mm map)
  coeffs_x?: number[];
  coeffs_y?: number[];
  rms_x_mm?: number;
  rms_y_mm?: number;
  norm?: { x0: number; sx: number; y0: number; sy: number };
  image_width?: number;
  image_height?: number;
  reprojection_error: number;
  num_images_used: number;
}

/** World-frame clicks (image-down pixels) defining origin/+X/+Y + origin world mm. */
export interface WorldFrameClicks {
  origin: [number, number];
  x_axis: [number, number];
  y_axis: [number, number];
  origin_mm: [number, number];
}

/**
 * Validation result (matches the calibration2 /validate shape, which is the same
 * `validate_calibration_images` result the v1 GUI consumed).
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
 * Synchronous-generate status, kept in the v1 `JobStatus` shape so the existing
 * progress/result JSX renders unchanged.
 */
export interface JobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  processed_images: number;
  valid_images: number;
  total_images: number;
  error?: string;
  rms_error?: number;
  num_images_used?: number;
  warnings?: string[];
}

export interface GlobalAlignmentResult {
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
  cameras?: Record<number, { shift_x: number; shift_y: number; source: string }>;
  invert_ux?: boolean;
  reason?: string;
}

export interface MultiCameraJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  processed_cameras: number;
  total_cameras: number;
  current_camera?: number;
  current_camera_progress?: number;
  processed_images?: number;
  total_images?: number;
  valid_images?: number;
  camera_results?: Record<string, { status: string; rms_error?: number; num_images_used?: number; error?: string; warnings?: string[] }> & {
    global_alignment?: GlobalAlignmentResult;
  };
  camera_progress?: Record<number, { current: number; total: number; message?: string }>;
  elapsed_time?: number;
  error?: string;
}

const BOARD = 'dotboard';

/**
 * Dotboard calibration on the calibration2 (pinhole, no-coordinate-flip) backend.
 *
 * The return interface is preserved from the v1 hook so the original
 * DotboardCalibration card UI renders unchanged. calibration2's `generate_model`
 * is synchronous, so we synthesise the v1 `JobStatus` around the awaited call.
 * Image-source config persists to `config.calibration`; board params to
 * `config.calibration2.dotboard`. The optional world frame is passed as `clicks`.
 */
export function useDotboardCalibration(
  cameraOptions: number[],
  sourcePaths: string[],
) {
  // Source selection
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState(1);

  // Image config (persists to config.calibration)
  const [imageFormat, setImageFormat] = useState('calib%05d.tif');
  const [imageType, setImageType] = useState('standard');
  const [numImages, setNumImages] = useState<string>("10");
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);

  // Board params (persist to config.calibration2)
  const [dotSpacingMm, setDotSpacingMm] = useState(28.89);
  const [dt, setDt] = useState(1.0);
  const [datumFrame, setDatumFrame] = useState(1);
  // Camera-model type: pinhole (3D) or polynomial (single-plane). Planar tabs only.
  const [modelType, setModelType] = useState<'pinhole' | 'polynomial'>('pinhole');

  // Validation
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Synchronous generate status (v1 shape)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [multiCameraJobStatus, setMultiCameraJobStatus] = useState<MultiCameraJobStatus | null>(null);
  const [vectorJobStatus, setVectorJobStatus] = useState<MultiCameraJobStatus | null>(null);
  const [vectorJobId, setVectorJobId] = useState<string | null>(null);

  // Model + on-demand detections (overlay)
  const [cameraModel, setCameraModel] = useState<CameraModel | null>(null);
  const [loadedWorldFrame, setLoadedWorldFrame] = useState<any>(null);
  const [detections, setDetections] = useState<Record<string, FrameDetection>>({});
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);

  const configLoadedRef = useRef(false);
  // State (not just the ref) so effects re-run once config finishes loading on mount.
  const [configLoaded, setConfigLoaded] = useState(false);
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vectorPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const boardParams = useCallback(() => ({ dot_spacing_mm: dotSpacingMm }), [dotSpacingMm]);

  const frameTotal = useCallback(() => parseInt(numImages) || 10, [numImages]);

  // Validate the image source via calibration2 (all formats).
  const validateImages = useCallback(async () => {
    setValidating(true);
    try {
      const res = await fetch('/backend/calibration2/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera, source_path_idx: sourcePathIdx,
          image_format: imageFormat, image_type: imageType, frame_total: frameTotal(),
        }),
      });
      setValidation(await res.json());
    } catch (e) {
      setValidation({ valid: false, found_count: 0, error: String(e) });
    } finally {
      setValidating(false);
    }
  }, [camera, sourcePathIdx, imageFormat, imageType, frameTotal]);

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
          if (c2.dotboard?.model_type === 'polynomial' || c2.dotboard?.model_type === 'pinhole') setModelType(c2.dotboard.model_type);
          if (c2.dt) setDt(c2.dt);
          if (c2.datum_frame) setDatumFrame(c2.datum_frame);
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
              active: BOARD, dt, datum_frame: datumFrame,
              dotboard: { dot_spacing_mm: dotSpacingMm, model_type: modelType },
            },
          }),
        });
      } catch (e) {
        console.error('Failed to save config:', e);
      }
      validateImages();
    }, 500);
  }, [imageFormat, imageType, frameTotal, calibrationSources, useCameraSubfolders, cameraSubfolders, dt, datumFrame, dotSpacingMm, modelType, validateImages]);

  useEffect(() => {
    if (!configLoadedRef.current) return;
    saveConfig();
  }, [saveConfig]);

  // Map a calibration2 mono model/generate response to the v1 card shape. The
  // response's `model_type` selects the pinhole or polynomial mapping.
  const toCameraModel = (d: any): CameraModel => {
    if (d.model_type === 'polynomial') {
      return {
        model_type: 'polynomial',
        coeffs_x: d.coeffs_x, coeffs_y: d.coeffs_y,
        rms_x_mm: d.rms_x_mm, rms_y_mm: d.rms_y_mm,
        norm: { x0: d.x0, sx: d.sx, y0: d.y0, sy: d.sy },
        image_width: d.image_width, image_height: d.image_height,
        reprojection_error: Math.hypot(d.rms_x_mm ?? 0, d.rms_y_mm ?? 0),
        num_images_used: d.num_images_used ?? (d.per_view_rms?.length ?? 1),
      };
    }
    return {
      model_type: 'pinhole',
      camera_matrix: d.camera_matrix,
      dist_coeffs: d.dist_coeffs,
      focal_length: [d.fx, d.fy],
      principal_point: [d.cx, d.cy],
      image_width: d.image_width,
      image_height: d.image_height,
      reprojection_error: d.rms,
      num_images_used: d.num_images_used ?? (d.per_view_rms?.length ?? 0),
    };
  };

  // RMS for the v1 JobStatus (pinhole: px; polynomial: combined mm).
  const respRms = (d: any): number | undefined =>
    d.model_type === 'polynomial' ? Math.hypot(d.rms_x_mm ?? 0, d.rms_y_mm ?? 0) : d.rms;

  // Generate the model for one camera (synchronous); optional world-frame clicks.
  const generateOne = useCallback(async (cam: number, clicks?: WorldFrameClicks | null) => {
    const res = await fetch('/backend/calibration2/generate_model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stereo: false, camera: cam, source_path_idx: sourcePathIdx, board: BOARD,
        model_type: modelType,
        board_params: boardParams(), datum_frame: datumFrame, frame_total: frameTotal(),
        image_format: imageFormat, image_type: imageType,
        clicks: clicks || undefined,
      }),
    });
    return res.json();
  }, [sourcePathIdx, modelType, boardParams, datumFrame, frameTotal, imageFormat, imageType]);

  // Single-camera generate.
  const generateCameraModel = useCallback(async (clicks?: WorldFrameClicks | null) => {
    setJobStatus({ status: 'running', progress: 0, processed_images: 0, valid_images: 0, total_images: frameTotal() });
    try {
      const data = await generateOne(camera, clicks);
      if (data.success) {
        setCameraModel(toCameraModel(data));
        setJobStatus({
          status: 'completed', progress: 100,
          processed_images: frameTotal(), valid_images: data.per_view_rms?.length ?? 0,
          total_images: frameTotal(), rms_error: respRms(data), num_images_used: data.num_images_used,
        });
      } else {
        setJobStatus({ status: 'failed', progress: 0, processed_images: 0, valid_images: 0, total_images: 0, error: data.error });
      }
    } catch (e) {
      setJobStatus({ status: 'failed', progress: 0, processed_images: 0, valid_images: 0, total_images: 0, error: String(e) });
    }
  }, [camera, frameTotal, generateOne]);

  // All-cameras generate (loops camera_numbers; v1 behaviour).
  const generateCameraModelAll = useCallback(async (clicks?: WorldFrameClicks | null) => {
    const cams = cameraOptions.length ? cameraOptions : [camera];
    const results: Record<string, { status: string; rms_error?: number; num_images_used?: number; error?: string }> = {};
    setMultiCameraJobStatus({ status: 'running', processed_cameras: 0, total_cameras: cams.length });
    for (let i = 0; i < cams.length; i++) {
      const cam = cams[i];
      setMultiCameraJobStatus({ status: 'running', processed_cameras: i, total_cameras: cams.length, current_camera: cam, camera_results: { ...results } });
      try {
        // World frame is defined on camera 1's view; pass clicks only there.
        const data = await generateOne(cam, cam === cams[0] ? clicks : null);
        results[`Camera ${cam}`] = data.success
          ? { status: 'completed', rms_error: respRms(data), num_images_used: data.num_images_used }
          : { status: 'failed', error: data.error };
        if (data.success && cam === camera) setCameraModel(toCameraModel(data));
      } catch (e) {
        results[`Camera ${cam}`] = { status: 'failed', error: String(e) };
      }
    }
    setMultiCameraJobStatus({ status: 'completed', processed_cameras: cams.length, total_cameras: cams.length, camera_results: results });
  }, [cameraOptions, camera, generateOne]);

  // Load the saved model for the current camera (auto-called on mount/view change).
  // Returns the model data (or null) and captures the saved world frame for restore.
  const loadModel = useCallback(async () => {
    setModelLoading(true);
    setModelLoadError(null);
    try {
      const res = await fetch(`/backend/calibration2/model?stereo=0&board=${BOARD}&camera=${camera}&source_path_idx=${sourcePathIdx}`);
      const data = await res.json();
      if (res.ok && data.exists) {
        setCameraModel(toCameraModel(data));
        setLoadedWorldFrame(data.world_frame ?? null);
        return data;
      }
      // No model yet is the normal first-use state — not an error.
      setCameraModel(null);
      setLoadedWorldFrame(null);
      return null;
    } catch (e) {
      setModelLoadError(`Failed to load model: ${e}`);
      return null;
    } finally {
      setModelLoading(false);
    }
  }, [sourcePathIdx, camera]);

  // Persist the picked world frame to config.yaml (calibration2.<board>.world_frame).
  // recursive_update deep-merges, so this never clobbers the board params.
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
      // Non-authoritative (model.mat holds the world frame), but don't fail silently.
      console.warn('persistWorldFrame failed:', e);
    }
  }, []);

  // Auto-load the saved model on mount (once config is loaded) and on camera/source change.
  useEffect(() => {
    if (!configLoaded) return;
    setCameraModel(null);
    setDetections({});
    setModelLoadError(null);
    loadModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, camera, sourcePathIdx]);

  // On-demand board detection for the overlay on a given frame.
  const detectFrame = useCallback(async (frame: number) => {
    try {
      const res = await fetch('/backend/calibration2/detect_frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera, source_path_idx: sourcePathIdx, frame, board: BOARD,
          board_params: boardParams(), image_format: imageFormat, image_type: imageType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setDetections(prev => ({
          ...prev,
          [frame]: { grid_points: data.image_points, grid_indices: data.grid_indices },
        }));
        setDetectError(null);
      } else {
        setDetectError(data.error || `No board detected on frame ${frame}`);
      }
    } catch (e) {
      setDetectError(`Detection failed on frame ${frame}: ${String(e)}`);
    }
  }, [camera, sourcePathIdx, boardParams, imageFormat, imageType]);

  // Apply the calibration to PIV vectors over selected base paths (Phase D backend).
  const calibrateVectors = useCallback(async (
    _forAllCameras: boolean = true,
    typeName: string = 'instantaneous',
    activePaths?: number[],
  ) => {
    setVectorJobStatus({ status: 'starting', processed_cameras: 0, total_cameras: cameraOptions.length || 1 });
    try {
      const res = await fetch('/backend/calibration2/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stereo: false, board: BOARD, source_path_idx: sourcePathIdx,
          type_name: typeName, dt,
          // Omit active_paths → backend applies to all configured base paths.
          ...(activePaths ? { active_paths: activePaths } : {}),
        }),
      });
      const data = await res.json();
      if (data.job_id) setVectorJobId(data.job_id);
      else setVectorJobStatus({ status: 'failed', processed_cameras: 0, total_cameras: 0, error: data.error });
    } catch (e) {
      setVectorJobStatus({ status: 'failed', processed_cameras: 0, total_cameras: 0, error: String(e) });
    }
  }, [sourcePathIdx, dt, cameraOptions]);

  // Poll apply job.
  useEffect(() => {
    if (!vectorJobId) {
      if (vectorPollRef.current) { clearInterval(vectorPollRef.current); vectorPollRef.current = null; }
      return;
    }
    const poll = async () => {
      try {
        const res = await fetch(`/backend/calibration2/apply/status/${vectorJobId}`);
        const data = await res.json();
        if (res.ok) {
          setVectorJobStatus({
            status: data.status, processed_cameras: data.processed ?? 0, total_cameras: data.total ?? 1,
            error: data.error,
          });
          if (data.status === 'completed' || data.status === 'failed') {
            if (vectorPollRef.current) { clearInterval(vectorPollRef.current); vectorPollRef.current = null; }
          }
        }
      } catch (e) {
        // best-effort polling
      }
    };
    poll();
    vectorPollRef.current = setInterval(poll, 700);
    return () => { if (vectorPollRef.current) clearInterval(vectorPollRef.current); };
  }, [vectorJobId]);

  // Keep the selected camera valid.
  useEffect(() => {
    if (cameraOptions.length > 0 && !cameraOptions.includes(camera)) {
      setCamera(cameraOptions[0]);
    }
  }, [cameraOptions, camera]);

  useEffect(() => () => {
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
    if (vectorPollRef.current) clearInterval(vectorPollRef.current);
  }, []);

  return {
    sourcePathIdx, setSourcePathIdx, camera, setCamera,
    imageFormat, setImageFormat, imageType, setImageType, numImages, setNumImages,
    calibrationSources, setCalibrationSources, useCameraSubfolders, setUseCameraSubfolders,
    cameraSubfolders, setCameraSubfolders,
    dotSpacingMm, setDotSpacingMm, dt, setDt, datumFrame, setDatumFrame,
    modelType, setModelType,
    validation, validating, validateImages,
    jobStatus, isCalibrating: jobStatus?.status === 'running' || jobStatus?.status === 'starting',
    multiCameraJobStatus, isMultiCameraCalibrating: multiCameraJobStatus?.status === 'running' || multiCameraJobStatus?.status === 'starting',
    vectorJobStatus, isVectorCalibrating: vectorJobStatus?.status === 'running' || vectorJobStatus?.status === 'starting',
    cameraModel, detections, modelLoading, modelLoadError, detectError, hasModel: cameraModel !== null,
    loadedWorldFrame, persistWorldFrame,
    showOverlay, setShowOverlay,
    generateCameraModel, generateCameraModelAll, loadModel, calibrateVectors, detectFrame,
    cameraOptions, sourcePaths,
  };
}
