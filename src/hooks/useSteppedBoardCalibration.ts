import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Detection data for a single stepped board frame
 */
export interface SteppedDetection {
  blobs: [number, number][];
  level_A: { centers: [number, number][]; n_points: number; grid_indices?: [number, number][] };
  level_B: { centers: [number, number][]; n_points: number; grid_indices?: [number, number][] };
  image_size: [number, number];
}

/**
 * Fiducial point set for a single camera
 */
export interface FiducialSet {
  origin: [number, number] | null;
  x_axis: [number, number] | null;
  y_axis: [number, number] | null;
}

/**
 * Marker point for overlay rendering
 */
export interface MarkerPoint {
  x: number;
  y: number;
  color: string;
  label?: string;
}

/**
 * Single camera validation result
 */
export interface CameraValidationResult {
  valid: boolean;
  found_count: number | 'container';
  suggested_pattern?: string;
  suggested_subfolder?: string;
  error?: string;
}

/**
 * Combined stereo validation result
 */
export interface StereoValidationResult {
  valid: boolean;
  cam1: CameraValidationResult;
  cam2: CameraValidationResult;
  matching_count: number | 'container';
  error?: string;
}

/**
 * Stereo reconstruction job status
 */
export interface StereoReconstructJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  processed_frames: number;
  successful_frames: number;
  total_frames: number;
  error?: string;
}

/**
 * Stepped board model result
 */
export interface SteppedBoardModelResult {
  status: 'completed' | 'failed';
  error?: string;
  [key: string]: unknown;
}

/**
 * Hook for managing stepped board stereo calibration state and operations.
 *
 * Stepped Board API:
 * - Parameters saved to config.yaml via /backend/calibration/config and /backend/update_config
 * - Detection via /backend/calibrate/stepped_board/detect
 * - Fiducial snapping via /backend/calibrate/stepped_board/snap_fiducial
 * - Model generation via /backend/calibrate/stepped_board/generate_model
 */
export function useSteppedBoardCalibration(
  cameraOptions: number[],
  sourcePaths: string[],
) {
  // Source selection
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [cam1, setCam1] = useState(1);
  const [cam2, setCam2] = useState(2);

  // Image config (saved to config)
  const [imageFormat, setImageFormat] = useState('calib%05d.tif');
  const [imageType, setImageType] = useState('standard');
  const [numImages, setNumImages] = useState<string>("10");
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);

  // Board params (saved to config.calibration.stepped_board)
  const [dotSpacingMm, setDotSpacingMm] = useState(15);
  const [stepHeightMm, setStepHeightMm] = useState(3);
  const [boardThicknessMm, setBoardThicknessMm] = useState(14.8);
  const [dt, setDt] = useState(1);
  const [stereoConfig, setStereoConfig] = useState<string>('transmission');

  // Detection state
  const [isDetecting, setIsDetecting] = useState(false);
  const [cam1Detection, setCam1Detection] = useState<SteppedDetection | null>(null);
  const [cam2Detection, setCam2Detection] = useState<SteppedDetection | null>(null);

  // Fiducials state
  const [cam1Fiducials, setCam1Fiducials] = useState<FiducialSet>({
    origin: null,
    x_axis: null,
    y_axis: null,
  });
  const [cam2Fiducials, setCam2Fiducials] = useState<FiducialSet>({
    origin: null,
    x_axis: null,
    y_axis: null,
  });
  const [cam1ClickedLevel, setCam1ClickedLevel] = useState<string>('peak');
  const [cam2ClickedLevel, setCam2ClickedLevel] = useState<string>('peak');

  // Validation state
  const [validation, setValidation] = useState<StereoValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Active camera for viewer
  const [activeCam, setActiveCam] = useState<number>(1);

  // Model generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelResult, setModelResult] = useState<SteppedBoardModelResult | null>(null);
  const [hasModel, setHasModel] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);

  // Reconstruction state
  const [reconstructJobId, setReconstructJobId] = useState<string | null>(null);
  const [reconstructJobStatus, setReconstructJobStatus] = useState<StereoReconstructJobStatus | null>(null);

  // Datum controls
  const [datumCamera, setDatumCamera] = useState(1);
  const [datumFrame, setDatumFrame] = useState(1);

  // Detection progress
  const [detectionProgress, setDetectionProgress] = useState(0);
  // Model generation progress
  const [generationProgress, setGenerationProgress] = useState(0);

  // Guard: prevent auto-save from firing before initial config load completes
  const configLoadedRef = useRef(false);
  // Guard: prevent auto-save from persisting cleared fiducials on source/camera change
  const clearingRef = useRef(false);

  // Refs for debouncing and polling
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconstructPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Load calibration image settings
        const calRes = await fetch('/backend/calibration/config');
        if (calRes.ok) {
          const calData = await calRes.json();
          if (calData.image_format) setImageFormat(calData.image_format);
          if (calData.image_type) setImageType(calData.image_type);
          if (calData.num_images) setNumImages(String(calData.num_images));
          if (calData.calibration_sources) setCalibrationSources(calData.calibration_sources);
          if (calData.use_camera_subfolders !== undefined) setUseCameraSubfolders(calData.use_camera_subfolders);
          if (calData.camera_subfolders) setCameraSubfolders(calData.camera_subfolders);
        }

        // Load stepped_board-specific settings
        const cfgRes = await fetch('/backend/config');
        if (cfgRes.ok) {
          const cfgData = await cfgRes.json();
          const stepped_board = cfgData.calibration?.stepped_board || {};
          if (stepped_board.dot_spacing_mm) setDotSpacingMm(stepped_board.dot_spacing_mm);
          if (stepped_board.step_height_mm) setStepHeightMm(stepped_board.step_height_mm);
          if (stepped_board.board_thickness_mm) setBoardThicknessMm(stepped_board.board_thickness_mm);
          if (stepped_board.dt) setDt(stepped_board.dt);
          if (stepped_board.stereo_config) setStereoConfig(stepped_board.stereo_config);
          if (stepped_board.datum_camera) setDatumCamera(stepped_board.datum_camera);
          if (stepped_board.datum_frame) setDatumFrame(stepped_board.datum_frame);
          if (stepped_board.cam1_fiducials) setCam1Fiducials(stepped_board.cam1_fiducials);
          if (stepped_board.cam2_fiducials) setCam2Fiducials(stepped_board.cam2_fiducials);
          if (stepped_board.cam1_clicked_level) setCam1ClickedLevel(stepped_board.cam1_clicked_level);
          if (stepped_board.cam2_clicked_level) setCam2ClickedLevel(stepped_board.cam2_clicked_level);
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
      configLoadedRef.current = true;

      // Run initial validation now that config is loaded on backend
      setValidating(true);
      try {
        const valRes = await fetch('/backend/calibration/stereo/dotboard/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_path_idx: sourcePathIdx, cam1, cam2 }),
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
  }, []);

  // Validate images for both cameras
  const validateImages = useCallback(async () => {
    setValidating(true);
    try {
      // Reuse the stereo dotboard validate endpoint — same per-camera-pair logic
      const res = await fetch('/backend/calibration/stereo/dotboard/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          cam1: cam1,
          cam2: cam2,
        }),
      });

      const data = await res.json();
      setValidation(data);
    } catch (e) {
      console.error('Stepped board validation failed:', e);
      setValidation({
        valid: false,
        cam1: { valid: false, found_count: 0, error: String(e) },
        cam2: { valid: false, found_count: 0, error: String(e) },
        matching_count: 0,
        error: String(e),
      });
    } finally {
      setValidating(false);
    }
  }, [sourcePathIdx, cam1, cam2]);

  // Save config (debounced), then validate after save completes
  const saveConfig = useCallback(() => {
    if (configDebounceRef.current) {
      clearTimeout(configDebounceRef.current);
    }

    configDebounceRef.current = setTimeout(async () => {
      try {
        // Save calibration image settings
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

        // Save stepped_board-specific settings
        await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calibration: {
              stepped_board: {
                dot_spacing_mm: dotSpacingMm,
                step_height_mm: stepHeightMm,
                board_thickness_mm: boardThicknessMm,
                dt: dt,
                camera_pair: [cam1, cam2],
                stereo_config: stereoConfig,
                datum_camera: datumCamera,
                datum_frame: datumFrame,
                cam1_fiducials: cam1Fiducials,
                cam2_fiducials: cam2Fiducials,
                cam1_clicked_level: cam1ClickedLevel,
                cam2_clicked_level: cam2ClickedLevel,
              },
            },
          }),
        });
      } catch (e) {
        console.error('Failed to save config:', e);
      }

      // Validate after save completes so backend has current config
      validateImages();
    }, 500);
  }, [imageFormat, imageType, numImages, calibrationSources, useCameraSubfolders, cameraSubfolders, dotSpacingMm, stepHeightMm, boardThicknessMm, dt, cam1, cam2, stereoConfig, datumCamera, datumFrame, cam1Fiducials, cam2Fiducials, cam1ClickedLevel, cam2ClickedLevel, validateImages]);

  // Auto-save (and validate) when params change (skip until initial config load completes)
  useEffect(() => {
    if (!configLoadedRef.current) return;
    if (clearingRef.current) {
      clearingRef.current = false;
      return;
    }
    saveConfig();
  }, [saveConfig]);

  // Clear pixel-dependent state when source path or cameras change
  useEffect(() => {
    if (!configLoadedRef.current) return;
    clearingRef.current = true;
    // Cancel any pending debounced save so stale fiducials aren't persisted
    if (configDebounceRef.current) {
      clearTimeout(configDebounceRef.current);
      configDebounceRef.current = null;
    }
    const emptyFiducials: FiducialSet = { origin: null, x_axis: null, y_axis: null };
    setCam1Fiducials(emptyFiducials);
    setCam2Fiducials(emptyFiducials);
    setCam1ClickedLevel('peak');
    setCam2ClickedLevel('peak');
    setCam1Detection(null);
    setCam2Detection(null);
    setModelResult(null);
    setHasModel(false);
  }, [sourcePathIdx, cam1, cam2]);

  // Run detection on a single frame (exposed as detectDots for component compat)
  const runDetection = useCallback(async (frameIdx: number = 1) => {
    setIsDetecting(true);
    setDetectionProgress(0);
    try {
      const res = await fetch('/backend/calibrate/stepped_board/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          cam1: cam1,
          cam2: cam2,
          frame_idx: frameIdx,
        }),
      });

      const data = await res.json();
      if (data.job_id) {
        const jobId = data.job_id;

        const pollDetection = async () => {
          try {
            const pollRes = await fetch(`/backend/calibrate/stepped_board/detect/job/${jobId}`);
            const pollData = await pollRes.json();

            if (pollData.progress !== undefined) {
              setDetectionProgress(pollData.progress);
            }

            if (pollData.status === 'completed') {
              if (detectPollRef.current) {
                clearInterval(detectPollRef.current);
                detectPollRef.current = null;
              }
              // Detection results are in pollData.detections (keyed by cam number string)
              const detections = pollData.detections || {};
              if (detections[String(cam1)]) setCam1Detection(detections[String(cam1)]);
              if (detections[String(cam2)]) setCam2Detection(detections[String(cam2)]);
              setDetectionProgress(100);
              setIsDetecting(false);
            } else if (pollData.status === 'failed') {
              if (detectPollRef.current) {
                clearInterval(detectPollRef.current);
                detectPollRef.current = null;
              }
              console.error('Detection failed:', pollData.error);
              setIsDetecting(false);
            }
          } catch (e) {
            console.error('Failed to poll detection status:', e);
          }
        };

        pollDetection();
        detectPollRef.current = setInterval(pollDetection, 500);
      } else {
        console.error('Failed to start detection:', data.error);
        setIsDetecting(false);
      }
    } catch (e) {
      console.error('Failed to start detection:', e);
      setIsDetecting(false);
    }
  }, [sourcePathIdx, cam1, cam2]);

  // Reset fiducials for a given camera or both
  const resetFiducials = useCallback((camera?: number) => {
    const emptyFiducials: FiducialSet = { origin: null, x_axis: null, y_axis: null };
    if (camera === undefined) {
      setCam1Fiducials(emptyFiducials);
      setCam2Fiducials(emptyFiducials);
      setCam1ClickedLevel('peak');
      setCam2ClickedLevel('peak');
    } else if (camera === cam1) {
      setCam1Fiducials(emptyFiducials);
      setCam1ClickedLevel('peak');
    } else {
      setCam2Fiducials(emptyFiducials);
      setCam2ClickedLevel('peak');
    }
  }, [cam1]);

  // Generate stepped board model
  const generateModel = useCallback(async () => {
    setIsGenerating(true);
    setModelResult(null);
    setGenerationProgress(0);
    try {
      const res = await fetch('/backend/calibrate/stepped_board/generate_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          cam1: cam1,
          cam2: cam2,
          frame_idx: 1,
          dot_spacing_mm: dotSpacingMm,
          step_height_mm: stepHeightMm,
          board_thickness_mm: boardThicknessMm,
          dt: dt,
          stereo_config: stereoConfig,
          cam1_fiducials: cam1Fiducials,
          cam2_fiducials: cam2Fiducials,
          cam1_clicked_level: cam1ClickedLevel,
          cam2_clicked_level: cam2ClickedLevel,
        }),
      });

      const data = await res.json();
      if (data.job_id) {
        const jobId = data.job_id;

        // Poll for model generation result
        const pollModel = async () => {
          try {
            const pollRes = await fetch(`/backend/calibrate/stepped_board/generate_model/job/${jobId}`);
            const pollData = await pollRes.json();

            if (pollData.progress !== undefined) {
              setGenerationProgress(pollData.progress);
            }

            if (pollData.status === 'completed') {
              if (modelPollRef.current) {
                clearInterval(modelPollRef.current);
                modelPollRef.current = null;
              }
              setModelResult(pollData);
              setHasModel(true);
              setGenerationProgress(100);
              setIsGenerating(false);
            } else if (pollData.status === 'failed') {
              if (modelPollRef.current) {
                clearInterval(modelPollRef.current);
                modelPollRef.current = null;
              }
              setModelResult(pollData);
              setIsGenerating(false);
            }
          } catch (e) {
            console.error('Failed to poll model generation status:', e);
          }
        };

        // Initial poll
        pollModel();

        // Start polling interval
        modelPollRef.current = setInterval(pollModel, 500);
      } else {
        setModelResult({ status: 'failed', error: data.error || 'Failed to start model generation' });
        setIsGenerating(false);
      }
    } catch (e: any) {
      setModelResult({ status: 'failed', error: e.message || 'Failed to start model generation' });
      setIsGenerating(false);
    }
  }, [sourcePathIdx, cam1, cam2, dotSpacingMm, stepHeightMm, boardThicknessMm, dt, stereoConfig, cam1Fiducials, cam2Fiducials, cam1ClickedLevel, cam2ClickedLevel]);

  // Load saved model from disk
  const loadModel = useCallback(async () => {
    setModelLoading(true);
    setModelLoadError(null);
    try {
      const res = await fetch(
        `/backend/calibrate/stepped_board/model?base_path_idx=${sourcePathIdx}&cam1=${cam1}&cam2=${cam2}`
      );
      const data = await res.json();

      if (res.ok && data.exists) {
        // Map backend response to the format the component expects
        const mapped: SteppedBoardModelResult & Record<string, unknown> = {
          status: 'completed',
          cam1_rms: data[`cam${cam1}`]?.rms_error,
          cam2_rms: data[`cam${cam2}`]?.rms_error,
          cam1_details: data[`cam${cam1}`] ? {
            focal_length: data[`cam${cam1}`].focal_length,
            principal_point: data[`cam${cam1}`].principal_point,
          } : undefined,
          cam2_details: data[`cam${cam2}`] ? {
            focal_length: data[`cam${cam2}`].focal_length,
            principal_point: data[`cam${cam2}`].principal_point,
          } : undefined,
          stereo_rms: data.stereo?.stereo_rms_error,
          relative_angle_deg: data.stereo?.relative_angle_deg,
          baseline_mm: data.stereo?.baseline_mm,
        };
        setModelResult(mapped);
        setHasModel(true);
        setModelLoadError(null);
      } else {
        setModelLoadError(`No saved model found for Cameras ${cam1}-${cam2}. Generate a model first.`);
      }
    } catch (e) {
      console.error('Failed to load stepped board model:', e);
      setModelLoadError(`Failed to load model: ${e}`);
    } finally {
      setModelLoading(false);
    }
  }, [sourcePathIdx, cam1, cam2]);

  // Reconstruct 3D vectors
  const reconstructVectors = useCallback(async (typeName: string = 'instantaneous') => {
    try {
      const res = await fetch('/backend/calibration/stereo/dotboard/reconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          cam1: cam1,
          cam2: cam2,
          type_name: typeName,
        }),
      });
      const data = await res.json();
      if (data.job_id) {
        setReconstructJobId(data.job_id);
        setReconstructJobStatus({ status: 'starting', progress: 0, processed_frames: 0, successful_frames: 0, total_frames: 0 });
      } else {
        console.error('Failed to start reconstruction:', data.error);
      }
    } catch (e) {
      console.error('Failed to start 3D reconstruction:', e);
    }
  }, [sourcePathIdx, cam1, cam2]);

  // Poll reconstruction job status
  useEffect(() => {
    if (!reconstructJobId) {
      if (reconstructPollRef.current) { clearInterval(reconstructPollRef.current); reconstructPollRef.current = null; }
      return;
    }
    const pollStatus = async () => {
      try {
        const res = await fetch(`/backend/calibration/stereo/dotboard/reconstruct/status/${reconstructJobId}`);
        const data = await res.json();
        if (res.ok) {
          setReconstructJobStatus(data);
          if (data.status === 'completed' || data.status === 'failed') {
            if (reconstructPollRef.current) { clearInterval(reconstructPollRef.current); reconstructPollRef.current = null; }
          }
        }
      } catch (e) { console.error('Failed to poll reconstruction status:', e); }
    };
    pollStatus();
    reconstructPollRef.current = setInterval(pollStatus, 500);
    return () => { if (reconstructPollRef.current) { clearInterval(reconstructPollRef.current); reconstructPollRef.current = null; } };
  }, [reconstructJobId]);

  // Overlay helper: get detection overlay points for a camera
  const getDetectionOverlayPoints = useCallback((camera: number): { x: number; y: number; color: string }[] => {
    const detection = camera === cam1 ? cam1Detection : cam2Detection;
    if (!detection) return [];

    const points: { x: number; y: number; color: string }[] = [];

    // Level A dots are blue, Level B dots are red
    if (detection.level_A && detection.level_B) {
      for (const center of detection.level_A.centers) {
        points.push({ x: center[0], y: center[1], color: 'blue' });
      }
      for (const center of detection.level_B.centers) {
        points.push({ x: center[0], y: center[1], color: 'red' });
      }
    }

    return points;
  }, [cam1, cam1Detection, cam2Detection]);

  // Overlay helper: get grid network lines for a camera (two sets, one per level)
  const getDetectionOverlayLines = useCallback((camera: number): { x1: number; y1: number; x2: number; y2: number; color?: string }[] => {
    const detection = camera === cam1 ? cam1Detection : cam2Detection;
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
  }, [cam1, cam1Detection, cam2Detection]);

  // Overlay helper: get fiducial markers for a camera
  const getFiducialMarkers = useCallback((camera: number): MarkerPoint[] => {
    const fiducials = camera === cam1 ? cam1Fiducials : cam2Fiducials;
    const markers: MarkerPoint[] = [];

    if (fiducials.origin) {
      markers.push({ x: fiducials.origin[0], y: fiducials.origin[1], color: 'lime', label: 'O' });
    }
    if (fiducials.x_axis) {
      markers.push({ x: fiducials.x_axis[0], y: fiducials.x_axis[1], color: 'red', label: 'X' });
    }
    if (fiducials.y_axis) {
      markers.push({ x: fiducials.y_axis[0], y: fiducials.y_axis[1], color: 'blue', label: 'Y' });
    }

    return markers;
  }, [cam1, cam1Fiducials, cam2Fiducials]);

  // Ensure valid camera selections (cam1 and cam2 must be different)
  useEffect(() => {
    if (cameraOptions.length >= 2) {
      if (!cameraOptions.includes(cam1)) {
        setCam1(cameraOptions[0]);
      }
      if (!cameraOptions.includes(cam2)) {
        setCam2(cameraOptions[1]);
      }
      if (cam1 === cam2 && cameraOptions.length >= 2) {
        const otherOptions = cameraOptions.filter(c => c !== cam1);
        if (otherOptions.length > 0) {
          setCam2(otherOptions[0]);
        }
      }
    }
  }, [cameraOptions, cam1, cam2]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
      if (validationDebounceRef.current) clearTimeout(validationDebounceRef.current);
      if (detectPollRef.current) clearInterval(detectPollRef.current);
      if (modelPollRef.current) clearInterval(modelPollRef.current);
      if (reconstructPollRef.current) clearInterval(reconstructPollRef.current);
    };
  }, []);

  // Computed: fiducials as Record<camNum, {origin, plusX, plusY}> for component compat
  const fiducials: Record<number, { origin: [number, number] | null; plusX: [number, number] | null; plusY: [number, number] | null }> = {
    [cam1]: { origin: cam1Fiducials.origin, plusX: cam1Fiducials.x_axis, plusY: cam1Fiducials.y_axis },
    [cam2]: { origin: cam2Fiducials.origin, plusX: cam2Fiducials.x_axis, plusY: cam2Fiducials.y_axis },
  };

  // setFiducial(camId, pointName, coords) for component compat
  const setFiducial = useCallback((camId: number, pointName: string, coords: [number, number]) => {
    const keyMap: Record<string, keyof FiducialSet> = { origin: 'origin', plusX: 'x_axis', plusY: 'y_axis' };
    const key = keyMap[pointName] || pointName;
    if (camId === cam1) {
      setCam1Fiducials(prev => ({ ...prev, [key]: coords }));
    } else {
      setCam2Fiducials(prev => ({ ...prev, [key]: coords }));
    }
  }, [cam1]);

  // clickedLevel as Record<camNum, level> for component compat
  const clickedLevel: Record<number, string> = {
    [cam1]: cam1ClickedLevel,
    [cam2]: cam2ClickedLevel,
  };

  // setClickedLevel(camId, level) for component compat
  const setClickedLevel = useCallback((camId: number, level: string) => {
    if (camId === cam1) {
      setCam1ClickedLevel(level);
    } else {
      setCam2ClickedLevel(level);
    }
  }, [cam1]);

  // Computed: detection stats per camera for component compat
  const detectionStats: Record<number, { nBlobs: number; nLevelA: number; nLevelB: number } | null> = {
    [cam1]: cam1Detection ? {
      nBlobs: cam1Detection.blobs.length,
      nLevelA: cam1Detection.level_A.n_points,
      nLevelB: cam1Detection.level_B.n_points,
    } : null,
    [cam2]: cam2Detection ? {
      nBlobs: cam2Detection.blobs.length,
      nLevelA: cam2Detection.level_A.n_points,
      nLevelB: cam2Detection.level_B.n_points,
    } : null,
  };

  return {
    // Source selection
    sourcePathIdx,
    setSourcePathIdx,
    cam1,
    setCam1,
    cam2,
    setCam2,

    // Active camera for viewer
    activeCam,
    setActiveCam,

    // Image config
    imageFormat,
    setImageFormat,
    imageType,
    setImageType,
    numImages,
    setNumImages,
    // Calibration source config
    calibrationSources,
    setCalibrationSources,
    useCameraSubfolders,
    setUseCameraSubfolders,
    cameraSubfolders,
    setCameraSubfolders,

    // Validation
    validation,
    validating,

    // Board params
    dotSpacingMm,
    setDotSpacingMm,
    stepHeightMm,
    setStepHeightMm,
    boardThicknessMm,
    setBoardThicknessMm,
    dt,
    setDt,
    stereoConfig,
    setStereoConfig,

    // Detection (component-compat aliases)
    detecting: isDetecting,
    detectionProgress,
    detectionStats,
    detectDots: () => runDetection(1),

    // Fiducials (component-compat shape)
    fiducials,
    setFiducial,
    resetFiducials,
    clickedLevel,
    setClickedLevel,

    // Model generation (component-compat aliases)
    generating: isGenerating,
    generationProgress,
    generatePinholeModels: generateModel,
    modelResults: modelResult,
    hasModel,
    loadModel,
    modelLoading,
    modelLoadError,

    // Reconstruction
    reconstructVectors,
    reconstructJobStatus,
    isReconstructing: reconstructJobStatus?.status === 'running' || reconstructJobStatus?.status === 'starting',

    // Datum controls
    datumCamera,
    setDatumCamera,
    datumFrame,
    setDatumFrame,

    // Overlay helpers
    getDetectionOverlayPoints,
    getDetectionOverlayLines,
    getFiducialMarkers,
  };
}
