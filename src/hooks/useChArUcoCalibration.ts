import { useState, useEffect, useRef, useCallback } from 'react';

export interface ChArUcoConfig {
  source_path_idx?: number;
  camera?: number;
  // file_pattern removed - uses unified calibration.image_format
  squares_h?: number;
  squares_v?: number;
  square_size?: number;
  marker_ratio?: number;
  aruco_dict?: string;
  min_corners?: number;
  dt?: number;
  model_type?: string;
}

/**
 * Detection data for a single frame
 */
export interface FrameDetection {
  grid_points: [number, number][];
  grid_indices?: [number, number][];
  corner_ids?: number[];
  reprojection_error?: number;
}

/**
 * Camera model from ChArUco calibration
 */
export interface CameraModel {
  camera_matrix: number[][];
  dist_coeffs: number[];
  focal_length: [number, number];
  principal_point: [number, number];
  reprojection_error: number;
  num_images_used: number;
  rvecs?: number[][];
  tvecs?: number[][];
  dot_spacing_mm?: number;
}

export interface ChArUcoCalibrationState {
  sourcePathIdx: number;
  camera: number;
  // filePattern removed - uses unified calibration.image_format
  squaresH: string;
  squaresV: string;
  squareSize: string;
  markerRatio: string;
  arucoDict: string;
  minCorners: string;
  dt: string;
  calibrating: boolean;
  jobId: string | null;
}

/**
 * Validation result for a single camera
 */
export interface CharucoValidationResult {
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
 * Multi-camera job status
 */
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
  camera_results?: Record<string, { status: string; error?: string }> & {
    global_alignment?: GlobalAlignmentResult;
  };
  camera_progress?: Record<number, { current: number; total: number; message?: string }>;
  elapsed_time?: number;
  error?: string;
}

// Available ArUco dictionaries
export const ARUCO_DICTS = [
  "DICT_4X4_50",
  "DICT_4X4_100",
  "DICT_4X4_250",
  "DICT_4X4_1000",
  "DICT_5X5_50",
  "DICT_5X5_100",
  "DICT_5X5_250",
  "DICT_5X5_1000",
  "DICT_6X6_50",
  "DICT_6X6_100",
  "DICT_6X6_250",
  "DICT_6X6_1000",
];

/**
 * Hook for managing ChArUco board calibration state and operations.
 * Self-contained: fetches config from backend, manages all state internally.
 * @param cameraOptions Array of available camera numbers.
 * @param sourcePaths Array of available source paths.
 */
export function useChArUcoCalibration(
  cameraOptions: number[],
  sourcePaths: string[]
) {
  // --- State Initialization ---
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(0);
  const [camera, setCamera] = useState<number>(1);
  const [squaresH, setSquaresH] = useState<string>("10");
  const [squaresV, setSquaresV] = useState<string>("9");
  const [squareSize, setSquareSize] = useState<string>("0.03");
  const [markerRatio, setMarkerRatio] = useState<string>("0.5");
  const [arucoDict, setArucoDict] = useState<string>("DICT_4X4_1000");
  const [minCorners, setMinCorners] = useState<string>("6");
  const [dt, setDt] = useState<string>("1.0");
  const [modelType, setModelType] = useState<string>("pinhole");
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [jobId, setJobId] = useState<string | null>(null);

  // Image config (saved to config)
  const [imageFormat, setImageFormat] = useState('calib%05d.tif');
  const [imageType, setImageType] = useState('standard');
  const [numImages, setNumImages] = useState<string>("10");
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);

  // Validation state
  const [validation, setValidation] = useState<CharucoValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Camera model and detections (like dotboard)
  const [cameraModel, setCameraModel] = useState<CameraModel | null>(null);
  const [detections, setDetections] = useState<Record<string, FrameDetection>>({});
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);

  // Overlay toggle
  const [showOverlay, setShowOverlay] = useState(true);

  // Load results state (kept for backwards compat)
  const [loadingResults, setLoadingResults] = useState<boolean>(false);
  const [calibrationResults, setCalibrationResults] = useState<any>(null);

  // Vector calibration job tracking
  const [vectorJobId, setVectorJobId] = useState<string | null>(null);
  const [vectorJobStatus, setVectorJobStatus] = useState<MultiCameraJobStatus | null>(null);

  // Guard: prevent auto-save/validate from firing before initial config load completes
  const configLoadedRef = useRef(false);

  // --- Refs for Debouncing ---
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vectorPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          if (calData.calibration_sources !== undefined) setCalibrationSources(calData.calibration_sources);
          if (calData.use_camera_subfolders !== undefined) setUseCameraSubfolders(calData.use_camera_subfolders);
          if (calData.camera_subfolders !== undefined) setCameraSubfolders(calData.camera_subfolders);
        }

        // Load charuco-specific settings
        const cfgRes = await fetch('/backend/config');
        if (cfgRes.ok) {
          const cfgData = await cfgRes.json();
          const charuco = cfgData.calibration?.charuco || {};
          if (charuco.source_path_idx !== undefined) setSourcePathIdx(charuco.source_path_idx);
          if (charuco.camera !== undefined) setCamera(charuco.camera);
          if (charuco.squares_h !== undefined) setSquaresH(String(charuco.squares_h));
          if (charuco.squares_v !== undefined) setSquaresV(String(charuco.squares_v));
          if (charuco.square_size !== undefined) setSquareSize(String(charuco.square_size));
          if (charuco.marker_ratio !== undefined) setMarkerRatio(String(charuco.marker_ratio));
          if (charuco.aruco_dict) setArucoDict(charuco.aruco_dict);
          if (charuco.min_corners !== undefined) setMinCorners(String(charuco.min_corners));
          if (charuco.dt !== undefined) setDt(String(charuco.dt));
          if (charuco.model_type) setModelType(charuco.model_type);
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
      configLoadedRef.current = true;

      // Run initial validation
      setValidating(true);
      try {
        const valRes = await fetch('/backend/calibration/validate_images', {
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
  }, []);

  // Validate images
  const validateImages = useCallback(async () => {
    setValidating(true);
    try {
      const res = await fetch('/backend/calibration/validate_images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: camera,
        }),
      });

      const data = await res.json();
      setValidation(data);
    } catch (e) {
      console.error('Validation failed:', e);
      setValidation({
        valid: false,
        found_count: 0,
        error: String(e),
      });
    } finally {
      setValidating(false);
    }
  }, [sourcePathIdx, camera]);

  // Save config (debounced), then validate after save completes
  const saveConfig = useCallback(() => {
    if (configDebounceRef.current) {
      clearTimeout(configDebounceRef.current);
    }

    configDebounceRef.current = setTimeout(async () => {
      const squaresHNum = Number(squaresH);
      const squaresVNum = Number(squaresV);
      const squareSizeNum = Number(squareSize);
      const markerRatioNum = Number(markerRatio);
      const minCornersNum = Number(minCorners);
      const dtNum = Number(dt);

      const valid =
        !isNaN(squaresHNum) && squaresH !== "" &&
        !isNaN(squaresVNum) && squaresV !== "" &&
        !isNaN(squareSizeNum) && squareSize !== "" &&
        !isNaN(markerRatioNum) && markerRatio !== "" &&
        !isNaN(minCornersNum) && minCorners !== "" &&
        !isNaN(dtNum) && dt !== "";

      if (!valid) return;

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

        // Save charuco-specific settings
        await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calibration: {
              charuco: {
                source_path_idx: sourcePathIdx,
                camera: camera,
                squares_h: squaresHNum,
                squares_v: squaresVNum,
                square_size: squareSizeNum,
                marker_ratio: markerRatioNum,
                aruco_dict: arucoDict,
                min_corners: minCornersNum,
                dt: dtNum,
                model_type: modelType,
              },
            },
          }),
        });
      } catch (err) {
        console.error("Failed to save charuco config:", err);
      }

      // Validate after save completes so backend has current config
      validateImages();
    }, 500);
  }, [imageFormat, imageType, numImages, calibrationSources, useCameraSubfolders, cameraSubfolders, sourcePathIdx, camera, squaresH, squaresV, squareSize, markerRatio, arucoDict, minCorners, dt, modelType, validateImages]);

  // Auto-save (and validate) when params change (skip until initial config load completes)
  useEffect(() => {
    if (!configLoadedRef.current) return;
    saveConfig();
  }, [saveConfig]);

  // --- Job status hook ---
  const useJobStatus = (jobId: string | null) => {
    const [status, setStatus] = useState<string>("not_started");
    const [details, setDetails] = useState<any>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const pollStartTimeRef = useRef<number>(0);
    const MAX_POLL_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

    useEffect(() => {
      if (!jobId) {
        setStatus("not_started");
        setDetails(null);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }
      let active = true;
      pollStartTimeRef.current = Date.now();
      const fetchStatus = async () => {
        try {
          const res = await fetch(`/backend/calibration/charuco/status/${jobId}`);
          const data = await res.json();
          if (active) {
            setStatus(data.status || "not_started");
            setDetails(data);
            // Safety timeout: stop polling if exceeded max duration
            if (Date.now() - pollStartTimeRef.current > MAX_POLL_DURATION_MS) {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              setStatus("error");
              return;
            }
            // Stop polling only on terminal status (not progress >= 100)
            if (data.status === "completed" || data.status === "failed") {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            } else if (data.status === "running" || data.status === "starting") {
              if (!intervalRef.current) {
                intervalRef.current = setInterval(fetchStatus, 500);
              }
            }
          }
        } catch {
          if (active) setStatus("not_started");
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      };
      fetchStatus();
      return () => {
        active = false;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }, [jobId]);
    return { status, details };
  };

  const { status: jobStatus, details: jobDetails } = useJobStatus(jobId);

  // --- Start calibration ---
  const startCalibration = async () => {
    setCalibrating(true);
    try {
      const response = await fetch('/backend/calibration/charuco/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: camera,
          model_type: modelType,
        })
      });
      const result = await response.json();
      if (response.ok) {
        console.log(`ChArUco calibration started! Job ID: ${result.job_id}`);
        setJobId(result.job_id);
      } else {
        throw new Error(result.error || "Failed to start ChArUco calibration");
      }
    } catch (e: any) {
      console.error(`Error starting ChArUco calibration: ${e.message}`);
    } finally {
      setCalibrating(false);
    }
  };

  // --- Calibrate all cameras ---
  const calibrateAllCameras = async () => {
    setCalibrating(true);
    try {
      const response = await fetch('/backend/calibration/charuco/calibrate_all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          model_type: modelType,
        })
      });
      const result = await response.json();
      if (response.ok) {
        console.log(`ChArUco calibration started for all cameras! Job ID: ${result.job_id}`);
        setJobId(result.job_id);
      } else {
        throw new Error(result.error || "Failed to start ChArUco calibration");
      }
    } catch (e: any) {
      console.error(`Error starting ChArUco calibration: ${e.message}`);
    } finally {
      setCalibrating(false);
    }
  };

  // --- Vector calibration for single or all cameras ---
  const calibrateVectors = useCallback(async (
    forAllCameras: boolean = false,
    typeName: string = 'instantaneous'
  ) => {
    try {
      const body: Record<string, unknown> = {
        source_path_idx: sourcePathIdx,
        type_name: typeName,
      };

      if (forAllCameras) {
        body.cameras = cameraOptions;
      } else {
        body.camera = camera;
      }

      const res = await fetch('/backend/calibration/vectors/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.job_id) {
        setVectorJobId(data.job_id);
        setVectorJobStatus({
          status: 'starting',
          processed_cameras: 0,
          total_cameras: data.cameras?.length || 1,
        });
      } else {
        console.error('Failed to start vector calibration:', data.error);
      }
    } catch (e) {
      console.error('Vector calibration error:', e);
    }
  }, [sourcePathIdx, camera, cameraOptions]);

  // --- Load saved camera model and detections ---
  const loadModel = useCallback(async () => {
    setModelLoading(true);
    setLoadingResults(true);
    setModelLoadError(null);
    try {
      const res = await fetch(
        `/backend/calibration/charuco/load_results?source_path_idx=${sourcePathIdx}&camera=${camera}`
      );
      const data = await res.json();

      if (res.ok && data.exists) {
        // Set camera model
        setCameraModel(data.camera_model);

        // Convert frames array to detections record
        // Backend returns: frames: [{ frame_index, corners, corner_ids }, ...]
        // Also returns: board: { squares_h, squares_v, ... }
        const board = data.board;
        const innerCols = (board?.squares_h ?? 1) - 1;
        const detectionsMap: Record<string, FrameDetection> = {};
        if (data.frames) {
          for (const frame of data.frames) {
            // Derive grid_indices from corner_ids for grid line rendering
            // ChArUco corner IDs are linearized: id = row * innerCols + col
            const grid_indices = (frame.corner_ids && innerCols > 0)
              ? frame.corner_ids.map((id: number) => {
                  const col = id % innerCols;
                  const row = Math.floor(id / innerCols);
                  return [col, row] as [number, number];
                })
              : undefined;

            detectionsMap[String(frame.frame_index)] = {
              // Map corners to grid_points for CalibrationImageViewer compatibility
              grid_points: frame.corners || [],
              grid_indices,
              corner_ids: frame.corner_ids,
            };
          }
        }
        setDetections(detectionsMap);

        // Also set calibrationResults for backwards compatibility
        setCalibrationResults(data);
        setModelLoadError(null);

        console.log(`Loaded ChArUco model with ${Object.keys(detectionsMap).length} detections`);
        return true;
      } else {
        console.log('No saved ChArUco calibration results found');
        setCameraModel(null);
        setDetections({});
        setModelLoadError(`No camera model found for Camera ${camera}. Generate a model first.`);
        return false;
      }
    } catch (e: any) {
      console.error(`Error loading ChArUco calibration: ${e.message}`);
      setModelLoadError(`Failed to load model: ${e.message}`);
      return false;
    } finally {
      setModelLoading(false);
      setLoadingResults(false);
    }
  }, [sourcePathIdx, camera]);

  // Auto-load model after calibration completes
  useEffect(() => {
    if (jobStatus === 'completed') {
      // Small delay to ensure backend has finished writing files
      const timer = setTimeout(() => {
        loadModel();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [jobStatus, loadModel]);

  // Poll vector job status
  useEffect(() => {
    if (!vectorJobId) {
      if (vectorPollRef.current) {
        clearInterval(vectorPollRef.current);
        vectorPollRef.current = null;
      }
      return;
    }

    const pollStatus = async () => {
      try {
        const res = await fetch(`/backend/calibration/vectors/status/${vectorJobId}`);
        const data = await res.json();

        if (res.ok) {
          setVectorJobStatus(data);

          if (data.status === 'completed' || data.status === 'failed') {
            if (vectorPollRef.current) {
              clearInterval(vectorPollRef.current);
              vectorPollRef.current = null;
            }
          }
        }
      } catch (e) {
        console.error('Failed to poll vector job status:', e);
      }
    };

    pollStatus();
    vectorPollRef.current = setInterval(pollStatus, 500);

    return () => {
      if (vectorPollRef.current) {
        clearInterval(vectorPollRef.current);
        vectorPollRef.current = null;
      }
    };
  }, [vectorJobId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
      if (validationDebounceRef.current) clearTimeout(validationDebounceRef.current);
      if (vectorPollRef.current) clearInterval(vectorPollRef.current);
    };
  }, []);

  return {
    // State
    sourcePathIdx,
    camera,
    squaresH,
    squaresV,
    squareSize,
    markerRatio,
    arucoDict,
    minCorners,
    dt,
    calibrating,
    jobId,
    loadingResults,
    calibrationResults,

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

    // Validation
    validation,
    validating,

    // Model and detections (like dotboard)
    cameraModel,
    detections,
    modelLoading,
    modelLoadError,
    hasModel: cameraModel !== null,

    // Overlay toggle
    showOverlay,
    setShowOverlay,

    // Vector calibration job tracking
    vectorJobId,
    vectorJobStatus,
    isVectorCalibrating: vectorJobStatus?.status === 'running' || vectorJobStatus?.status === 'starting',

    // Setters
    setSourcePathIdx,
    setCamera,
    setSquaresH,
    setSquaresV,
    setSquareSize,
    setMarkerRatio,
    setArucoDict,
    setMinCorners,
    setDt,
    modelType,
    setModelType,

    // Computed
    jobStatus,
    jobDetails,
    cameraOptions,
    sourcePaths,

    // Actions
    startCalibration,
    calibrateAllCameras,
    loadModel,
    calibrateVectors,
  };
}
