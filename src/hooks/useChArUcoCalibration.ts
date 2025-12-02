import { useState, useEffect, useRef } from 'react';

export interface ChArUcoConfig {
  source_path_idx?: number;
  camera?: number;
  file_pattern?: string;
  squares_h?: number;
  squares_v?: number;
  square_size?: number;
  marker_ratio?: number;
  aruco_dict?: string;
  min_corners?: number;
  dt?: number;
}

export interface ChArUcoCalibrationState {
  sourcePathIdx: number;
  camera: number;
  filePattern: string;
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
  const [filePattern, setFilePattern] = useState<string>(config.file_pattern ?? "*.tif");
  const [squaresH, setSquaresH] = useState<string>(config.squares_h !== undefined ? String(config.squares_h) : "10");
  const [squaresV, setSquaresV] = useState<string>(config.squares_v !== undefined ? String(config.squares_v) : "9");
  const [squareSize, setSquareSize] = useState<string>(config.square_size !== undefined ? String(config.square_size) : "0.03");
  const [markerRatio, setMarkerRatio] = useState<string>(config.marker_ratio !== undefined ? String(config.marker_ratio) : "0.5");
  const [arucoDict, setArucoDict] = useState<string>(config.aruco_dict ?? "DICT_4X4_1000");
  const [minCorners, setMinCorners] = useState<string>(config.min_corners !== undefined ? String(config.min_corners) : "6");
  const [dt, setDt] = useState<string>(config.dt !== undefined ? String(config.dt) : "1.0");
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [jobId, setJobId] = useState<string | null>(null);

  // Validation state
  const [validationResult, setValidationResult] = useState<any>(null);
  const [validating, setValidating] = useState<boolean>(false);

  // Detection preview
  const [detectionPreview, setDetectionPreview] = useState<any>(null);
  const [detecting, setDetecting] = useState<boolean>(false);

  // --- Refs for Debouncing ---
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Sync state with config changes ---
  useEffect(() => {
    setSourcePathIdx(config.source_path_idx ?? 0);
    setCamera(config.camera ?? 1);
    setFilePattern(config.file_pattern ?? "*.tif");
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
        !isNaN(dtNum) && dt !== "" &&
        filePattern !== "";

      if (valid) {
        const payload = {
          calibration: {
            charuco: {
              source_path_idx: sourcePathIdx,
              camera: camera,
              file_pattern: filePattern,
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
  }, [sourcePathIdx, camera, filePattern, squaresH, squaresV, squareSize, markerRatio, arucoDict, minCorners, dt, updateConfig]);

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

  // --- Validate images ---
  const validateImages = async () => {
    setValidating(true);
    try {
      const response = await fetch('/backend/calibration/charuco/validate_images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: camera,
          file_pattern: filePattern,
        })
      });
      const result = await response.json();
      setValidationResult(result);
    } catch (e: any) {
      console.error(`Error validating images: ${e.message}`);
      setValidationResult({ valid: false, error: e.message });
    } finally {
      setValidating(false);
    }
  };

  // --- Detect in single image ---
  const detectInImage = async (imageIndex: number = 0) => {
    setDetecting(true);
    try {
      const response = await fetch('/backend/calibration/charuco/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: camera,
          image_index: imageIndex,
          file_pattern: filePattern,
          squares_h: Number(squaresH),
          squares_v: Number(squaresV),
          square_size: Number(squareSize),
          marker_ratio: Number(markerRatio),
          aruco_dict: arucoDict,
        })
      });
      const result = await response.json();
      setDetectionPreview(result);
    } catch (e: any) {
      console.error(`Error detecting ChArUco: ${e.message}`);
      setDetectionPreview({ found: false, error: e.message });
    } finally {
      setDetecting(false);
    }
  };

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
          file_pattern: filePattern,
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
          file_pattern: filePattern,
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

  return {
    // State
    sourcePathIdx,
    camera,
    filePattern,
    squaresH,
    squaresV,
    squareSize,
    markerRatio,
    arucoDict,
    minCorners,
    dt,
    calibrating,
    jobId,
    validationResult,
    validating,
    detectionPreview,
    detecting,

    // Setters
    setSourcePathIdx,
    setCamera,
    setFilePattern,
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
    validateImages,
    detectInImage,
    startCalibration,
    calibrateAllCameras,
  };
}
