import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Detection data for a single stereo ChArUco frame
 */
export interface StereoCharucoFrameDetection {
  grid_points: [number, number][];
  grid_indices?: [number, number][];
  corner_ids?: number[];
}

/**
 * Stereo camera model from ChArUco calibration
 */
export interface StereoCharucoModel {
  // Camera 1 intrinsics
  camera_matrix_1: number[][];
  dist_coeffs_1: number[];
  focal_length_1: [number, number];
  principal_point_1: [number, number];
  // Camera 2 intrinsics
  camera_matrix_2: number[][];
  dist_coeffs_2: number[];
  focal_length_2: [number, number];
  principal_point_2: [number, number];
  // Stereo geometry
  rotation_matrix: number[][];
  translation_vector: number[];
  essential_matrix: number[][];
  fundamental_matrix: number[][];
  // Rectification
  rectification_R1: number[][];
  rectification_R2: number[][];
  projection_P1: number[][];
  projection_P2: number[][];
  disparity_to_depth_Q: number[][];
  // Quality metrics
  stereo_rms_error: number;
  cam1_rms_error: number;
  cam2_rms_error: number;
  relative_angle_deg: number;
  num_image_pairs: number;
  baseline_distance_mm: number;
}

/**
 * Single camera validation result
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
 * Combined stereo validation result
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
 * Stereo ChArUco calibration job status
 */
export interface StereoCharucoJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  stage?: string;
  processed_pairs: number;
  valid_pairs: number;
  total_pairs: number;
  elapsed_time?: number;
  estimated_remaining?: number;
  error?: string;
  // Completed data
  stereo_rms_error?: number;
  cam1_rms_error?: number;
  cam2_rms_error?: number;
  num_pairs_used?: number;
  relative_angle_deg?: number;
}

/**
 * Stereo reconstruction job status
 */
export interface StereoCharucoReconstructJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  processed_frames: number;
  successful_frames: number;
  total_frames: number;
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
 * Hook for managing stereo ChArUco calibration state and operations.
 *
 * Stereo ChArUco API:
 * - Parameters saved to config.yaml via /backend/calibration/config and /backend/update_config
 * - Validation via /backend/calibration/stereo/charuco/validate
 * - Calibration via /backend/calibration/stereo/charuco/generate_model
 * - Model loading via /backend/calibration/stereo/charuco/model
 * - 3D reconstruction via /backend/calibration/stereo/charuco/reconstruct
 */
export function useStereoCharucoCalibration(
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

  // ChArUco board params (saved to config.calibration.stereo_charuco)
  const [squaresH, setSquaresH] = useState(10);
  const [squaresV, setSquaresV] = useState(9);
  const [squareSize, setSquareSize] = useState(0.03);
  const [markerRatio, setMarkerRatio] = useState(0.5);
  const [arucoDict, setArucoDict] = useState('DICT_4X4_1000');
  const [minCorners, setMinCorners] = useState(6);
  const [dt, setDt] = useState(1.0);
  const [datumCamera, setDatumCamera] = useState(1); // Which camera defines coordinate system origin
  const [datumFrame, setDatumFrame] = useState(1); // Which calibration image defines world origin

  // Validation state
  const [validation, setValidation] = useState<StereoValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Calibration job tracking
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<StereoCharucoJobStatus | null>(null);

  // Reconstruction job tracking
  const [reconstructJobId, setReconstructJobId] = useState<string | null>(null);
  const [reconstructJobStatus, setReconstructJobStatus] = useState<StereoCharucoReconstructJobStatus | null>(null);

  // Model and detections (with corner_ids for ChArUco)
  const [stereoModel, setStereoModel] = useState<StereoCharucoModel | null>(null);
  const [detectionsCam1, setDetectionsCam1] = useState<Record<string, StereoCharucoFrameDetection>>({});
  const [detectionsCam2, setDetectionsCam2] = useState<Record<string, StereoCharucoFrameDetection>>({});
  const [modelLoading, setModelLoading] = useState(false);

  // Overlay toggle
  const [showOverlay, setShowOverlay] = useState(true);

  // Active camera for image viewer
  const [activeCam, setActiveCam] = useState<number>(1);

  // Guard: prevent auto-save from firing before initial config load completes
  const configLoadedRef = useRef(false);

  // Refs for debouncing and polling
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

        // Load ChArUco-specific settings from charuco section
        const cfgRes = await fetch('/backend/config');
        if (cfgRes.ok) {
          const cfgData = await cfgRes.json();
          const charuco = cfgData.calibration?.charuco || {};
          if (charuco.squares_h) setSquaresH(charuco.squares_h);
          if (charuco.squares_v) setSquaresV(charuco.squares_v);
          if (charuco.square_size) setSquareSize(charuco.square_size);
          if (charuco.marker_ratio) setMarkerRatio(charuco.marker_ratio);
          if (charuco.aruco_dict) setArucoDict(charuco.aruco_dict);
          if (charuco.min_corners) setMinCorners(charuco.min_corners);
          if (charuco.dt) setDt(charuco.dt);
          // Load stereo-specific params from stereo_charuco section
          const stereo_charuco = cfgData.calibration?.stereo_charuco || {};
          if (stereo_charuco.datum_camera) setDatumCamera(stereo_charuco.datum_camera);
          if (stereo_charuco.datum_frame) setDatumFrame(stereo_charuco.datum_frame);
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
      configLoadedRef.current = true;

      // Run initial validation
      setValidating(true);
      try {
        const valRes = await fetch('/backend/calibration/stereo/charuco/validate', {
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
      const res = await fetch('/backend/calibration/stereo/charuco/validate', {
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
      console.error('Stereo ChArUco validation failed:', e);
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

        // Save ChArUco-specific settings
        await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calibration: {
              charuco: {
                squares_h: squaresH,
                squares_v: squaresV,
                square_size: squareSize,
                marker_ratio: markerRatio,
                aruco_dict: arucoDict,
                min_corners: minCorners,
                dt: dt,
              },
              stereo_charuco: {
                datum_camera: datumCamera,
                datum_frame: datumFrame,
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
  }, [imageFormat, imageType, numImages, calibrationSources, useCameraSubfolders, cameraSubfolders, squaresH, squaresV, squareSize, markerRatio, arucoDict, minCorners, dt, datumCamera, datumFrame, validateImages]);

  // Auto-save (and validate) when params change (skip until initial config load completes)
  useEffect(() => {
    if (!configLoadedRef.current) return;
    saveConfig();
  }, [saveConfig]);

  // Generate stereo ChArUco model
  const generateStereoModel = useCallback(async () => {
    try {
      const res = await fetch('/backend/calibration/stereo/charuco/generate_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          cam1: cam1,
          cam2: cam2,
        }),
      });

      const data = await res.json();
      if (data.job_id) {
        setJobId(data.job_id);
        setJobStatus({
          status: 'starting',
          progress: 0,
          processed_pairs: 0,
          valid_pairs: 0,
          total_pairs: 0,
        });
      } else {
        console.error('Failed to start stereo ChArUco job:', data.error);
      }
    } catch (e) {
      console.error('Failed to start stereo ChArUco calibration:', e);
    }
  }, [sourcePathIdx, cam1, cam2]);

  // Poll calibration job status
  useEffect(() => {
    if (!jobId) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const pollStatus = async () => {
      try {
        const res = await fetch(`/backend/calibration/stereo/charuco/job/${jobId}`);
        const data = await res.json();

        if (res.ok) {
          setJobStatus(data);

          // Stop polling if completed or failed
          if (data.status === 'completed' || data.status === 'failed') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }

            // Auto-load model on completion
            if (data.status === 'completed') {
              setTimeout(() => loadModel(), 500);
            }
          }
        }
      } catch (e) {
        console.error('Failed to poll stereo ChArUco job status:', e);
      }
    };

    // Initial poll
    pollStatus();

    // Start polling interval
    pollIntervalRef.current = setInterval(pollStatus, 500);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [jobId]);

  // Load saved stereo ChArUco model
  const loadModel = useCallback(async () => {
    setModelLoading(true);
    try {
      const res = await fetch(
        `/backend/calibration/stereo/charuco/model?source_path_idx=${sourcePathIdx}&cam1=${cam1}&cam2=${cam2}`
      );
      const data = await res.json();

      if (res.ok && data.exists) {
        setStereoModel(data.stereo_model);

        // Derive grid_indices from corner_ids for grid line rendering
        // ChArUco corner IDs are linearized: id = row * innerCols + col
        const innerCols = squaresH - 1;
        const enrichDetections = (
          detections: Record<string, StereoCharucoFrameDetection>
        ): Record<string, StereoCharucoFrameDetection> => {
          if (!detections || innerCols <= 0) return detections;
          const result: Record<string, StereoCharucoFrameDetection> = {};
          for (const [key, det] of Object.entries(detections)) {
            result[key] = {
              ...det,
              grid_indices: det.corner_ids
                ? det.corner_ids.map((id: number) => {
                    const col = id % innerCols;
                    const row = Math.floor(id / innerCols);
                    return [col, row] as [number, number];
                  })
                : undefined,
            };
          }
          return result;
        };

        setDetectionsCam1(enrichDetections(data.detections_cam1 || {}));
        setDetectionsCam2(enrichDetections(data.detections_cam2 || {}));
        console.log(`Loaded stereo ChArUco model with ${Object.keys(data.detections_cam1 || {}).length} cam1 detections, ${Object.keys(data.detections_cam2 || {}).length} cam2 detections`);
      } else {
        console.log('No saved stereo ChArUco model found');
        setStereoModel(null);
        setDetectionsCam1({});
        setDetectionsCam2({});
      }
    } catch (e) {
      console.error('Failed to load stereo ChArUco model:', e);
    } finally {
      setModelLoading(false);
    }
  }, [sourcePathIdx, cam1, cam2, squaresH]);

  // Reconstruct 3D vectors
  const reconstructVectors = useCallback(async (typeName: string = 'instantaneous') => {
    try {
      const res = await fetch('/backend/calibration/stereo/charuco/reconstruct', {
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
        setReconstructJobStatus({
          status: 'starting',
          progress: 0,
          processed_frames: 0,
          successful_frames: 0,
          total_frames: 0,
        });
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
      if (reconstructPollRef.current) {
        clearInterval(reconstructPollRef.current);
        reconstructPollRef.current = null;
      }
      return;
    }

    const pollStatus = async () => {
      try {
        const res = await fetch(`/backend/calibration/stereo/charuco/reconstruct/status/${reconstructJobId}`);
        const data = await res.json();

        if (res.ok) {
          setReconstructJobStatus(data);

          if (data.status === 'completed' || data.status === 'failed') {
            if (reconstructPollRef.current) {
              clearInterval(reconstructPollRef.current);
              reconstructPollRef.current = null;
            }
          }
        }
      } catch (e) {
        console.error('Failed to poll reconstruction status:', e);
      }
    };

    pollStatus();
    reconstructPollRef.current = setInterval(pollStatus, 500);

    return () => {
      if (reconstructPollRef.current) {
        clearInterval(reconstructPollRef.current);
        reconstructPollRef.current = null;
      }
    };
  }, [reconstructJobId]);

  // Ensure valid camera selections (cam1 and cam2 must be different)
  useEffect(() => {
    if (cameraOptions.length >= 2) {
      if (!cameraOptions.includes(cam1)) {
        setCam1(cameraOptions[0]);
      }
      if (!cameraOptions.includes(cam2)) {
        setCam2(cameraOptions[1]);
      }
      // If same camera selected, adjust cam2
      if (cam1 === cam2 && cameraOptions.length >= 2) {
        const otherOptions = cameraOptions.filter(c => c !== cam1);
        if (otherOptions.length > 0) {
          setCam2(otherOptions[0]);
        }
      }
    }
  }, [cameraOptions, cam1, cam2]);

  // Update activeCam when cam1/cam2 changes
  useEffect(() => {
    if (activeCam !== cam1 && activeCam !== cam2) {
      setActiveCam(cam1);
    }
  }, [cam1, cam2, activeCam]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
      if (validationDebounceRef.current) clearTimeout(validationDebounceRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (reconstructPollRef.current) clearInterval(reconstructPollRef.current);
    };
  }, []);

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
    calibrationSources,
    setCalibrationSources,
    useCameraSubfolders,
    setUseCameraSubfolders,
    cameraSubfolders,
    setCameraSubfolders,

    // ChArUco board params
    squaresH,
    setSquaresH,
    squaresV,
    setSquaresV,
    squareSize,
    setSquareSize,
    markerRatio,
    setMarkerRatio,
    arucoDict,
    setArucoDict,
    minCorners,
    setMinCorners,
    dt,
    setDt,
    datumCamera,
    setDatumCamera,
    datumFrame,
    setDatumFrame,

    // Validation
    validation,
    validating,
    validateImages,

    // Calibration job tracking
    jobId,
    jobStatus,
    isCalibrating: jobStatus?.status === 'running' || jobStatus?.status === 'starting',

    // Reconstruction job tracking
    reconstructJobId,
    reconstructJobStatus,
    isReconstructing: reconstructJobStatus?.status === 'running' || reconstructJobStatus?.status === 'starting',

    // Model and detections
    stereoModel,
    detectionsCam1,
    detectionsCam2,
    modelLoading,
    hasModel: stereoModel !== null,

    // Overlay toggle
    showOverlay,
    setShowOverlay,

    // Actions
    generateStereoModel,
    loadModel,
    reconstructVectors,

    // Options (passthrough)
    cameraOptions,
    sourcePaths,
  };
}
