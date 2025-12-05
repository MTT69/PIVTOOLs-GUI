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
}

/**
 * Detection data for a single frame
 */
export interface FrameDetection {
  grid_points: [number, number][];
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
 * Multi-camera job status
 */
export interface MultiCameraJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  processed_cameras: number;
  total_cameras: number;
  current_camera?: number;
  camera_results?: Record<number, { status: string; error?: string }>;
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
 * @param config The charuco section from calibration config.
 * @param updateConfig Function to update the calibration config.
 * @param cameraOptions Array of available camera numbers.
 * @param sourcePaths Array of available source paths.
 */
export function useChArUcoCalibration(
  config: ChArUcoConfig = {},
  updateConfig: (path: string[], value: any) => void,
  cameraOptions: number[],
  sourcePaths: string[]
) {
  // --- State Initialization ---
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(config.source_path_idx ?? 0);
  const [camera, setCamera] = useState<number>(config.camera ?? 1);
  // Note: filePattern removed - uses unified calibration.image_format from config via backend
  const [squaresH, setSquaresH] = useState<string>(config.squares_h !== undefined ? String(config.squares_h) : "10");
  const [squaresV, setSquaresV] = useState<string>(config.squares_v !== undefined ? String(config.squares_v) : "9");
  const [squareSize, setSquareSize] = useState<string>(config.square_size !== undefined ? String(config.square_size) : "0.03");
  const [markerRatio, setMarkerRatio] = useState<string>(config.marker_ratio !== undefined ? String(config.marker_ratio) : "0.5");
  const [arucoDict, setArucoDict] = useState<string>(config.aruco_dict ?? "DICT_4X4_1000");
  const [minCorners, setMinCorners] = useState<string>(config.min_corners !== undefined ? String(config.min_corners) : "6");
  const [dt, setDt] = useState<string>(config.dt !== undefined ? String(config.dt) : "1.0");
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [jobId, setJobId] = useState<string | null>(null);

  // Note: validationResult and validating state removed - use usePinholeValidation hook in component instead

  // Camera model and detections (like pinhole)
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

  // --- Refs for Debouncing ---
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vectorPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Sync state with config changes ---
  useEffect(() => {
    setSourcePathIdx(config.source_path_idx ?? 0);
    setCamera(config.camera ?? 1);
    // Note: filePattern removed - uses unified calibration.image_format
    setSquaresH(config.squares_h !== undefined ? String(config.squares_h) : "10");
    setSquaresV(config.squares_v !== undefined ? String(config.squares_v) : "9");
    setSquareSize(config.square_size !== undefined ? String(config.square_size) : "0.03");
    setMarkerRatio(config.marker_ratio !== undefined ? String(config.marker_ratio) : "0.5");
    setArucoDict(config.aruco_dict ?? "DICT_4X4_1000");
    setMinCorners(config.min_corners !== undefined ? String(config.min_corners) : "6");
    setDt(config.dt !== undefined ? String(config.dt) : "1.0");
  }, [config]);

  // --- Debounced auto-save ---
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
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

      if (valid) {
        // Note: file_pattern is NOT saved here - it's managed by the unified
        // calibration.image_format setting via CalibrationImageConfig
        const payload = {
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
            },
          },
        };
        try {
          const res = await fetch("/backend/update_config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Failed to save charuco config");
          if (json.updated?.calibration?.charuco) {
            updateConfig(["calibration", "charuco"], json.updated.calibration.charuco);
          }
        } catch (err) {
          console.error("Failed to save charuco config:", err);
        }
      }
    }, 500);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [sourcePathIdx, camera, squaresH, squaresV, squareSize, markerRatio, arucoDict, minCorners, dt, updateConfig]);

  // --- Job status hook ---
  const useJobStatus = (jobId: string | null) => {
    const [status, setStatus] = useState<string>("not_started");
    const [details, setDetails] = useState<any>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

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
      const fetchStatus = async () => {
        try {
          const res = await fetch(`/backend/calibration/charuco/status/${jobId}`);
          const data = await res.json();
          if (active) {
            setStatus(data.status || "not_started");
            setDetails(data);
            if (data.status === "completed" || data.status === "failed" || data.progress >= 100) {
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

  // Note: validateImages function removed - use usePinholeValidation hook in component instead
  // The unified validation endpoint at /backend/calibration/validate_images uses config.calibration.image_format

  // Note: detectInImage function removed - use overlay from saved model instead

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
          // file_pattern removed - backend uses unified calibration.image_format from config
          squares_h: Number(squaresH),
          squares_v: Number(squaresV),
          square_size: Number(squareSize),
          marker_ratio: Number(markerRatio),
          aruco_dict: arucoDict,
          min_corners: Number(minCorners),
          dt: Number(dt),
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
          // file_pattern removed - backend uses unified calibration.image_format from config
          squares_h: Number(squaresH),
          squares_v: Number(squaresV),
          square_size: Number(squareSize),
          marker_ratio: Number(markerRatio),
          aruco_dict: arucoDict,
          min_corners: Number(minCorners),
          dt: Number(dt),
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
        const detectionsMap: Record<string, FrameDetection> = {};
        if (data.frames) {
          for (const frame of data.frames) {
            detectionsMap[String(frame.frame_index)] = {
              // Map corners to grid_points for CalibrationImageViewer compatibility
              grid_points: frame.corners || [],
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
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (vectorPollRef.current) clearInterval(vectorPollRef.current);
    };
  }, []);

  // Note: Reactive validation useEffect removed - use usePinholeValidation hook in component instead

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

    // Model and detections (like pinhole)
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
