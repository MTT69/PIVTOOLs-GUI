import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Detection data for a single stereo frame
 */
export interface StereoFrameDetection {
  grid_points: [number, number][];
}

/**
 * Stereo camera model from calibration
 */
export interface StereoModel {
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
 * Stereo calibration job status
 */
export interface StereoJobStatus {
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
export interface StereoReconstructJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  processed_frames: number;
  successful_frames: number;
  total_frames: number;
  elapsed_time?: number;
  error?: string;
}

/**
 * Hook for managing stereo dotboard calibration state and operations.
 *
 * Stereo API:
 * - Parameters saved to config.yaml via /backend/calibration/config and /backend/update_config
 * - Validation via /backend/calibration/stereo/dotboard/validate
 * - Calibration via /backend/calibration/stereo/dotboard/generate_model
 * - Model loading via /backend/calibration/stereo/dotboard/model
 * - 3D reconstruction via /backend/calibration/stereo/dotboard/reconstruct
 */
export function useStereoCalibration(
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
  const [numImages, setNumImages] = useState(10);
  const [subfolder, setSubfolder] = useState('');
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);
  const [pathOrder, setPathOrder] = useState('camera_first');

  // Grid params (saved to config.calibration.stereo_dotboard)
  const [patternCols, setPatternCols] = useState(10);
  const [patternRows, setPatternRows] = useState(10);
  const [dotSpacingMm, setDotSpacingMm] = useState(28.89);
  const [enhanceDots, setEnhanceDots] = useState(true);
  const [dt, setDt] = useState(1.0);

  // Validation state
  const [validation, setValidation] = useState<StereoValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Calibration job tracking
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<StereoJobStatus | null>(null);

  // Reconstruction job tracking
  const [reconstructJobId, setReconstructJobId] = useState<string | null>(null);
  const [reconstructJobStatus, setReconstructJobStatus] = useState<StereoReconstructJobStatus | null>(null);

  // Model and detections
  const [stereoModel, setStereoModel] = useState<StereoModel | null>(null);
  const [detectionsCam1, setDetectionsCam1] = useState<Record<string, StereoFrameDetection>>({});
  const [detectionsCam2, setDetectionsCam2] = useState<Record<string, StereoFrameDetection>>({});
  const [modelLoading, setModelLoading] = useState(false);

  // Overlay toggle
  const [showOverlay, setShowOverlay] = useState(true);

  // Active camera for image viewer
  const [activeCam, setActiveCam] = useState<number>(1);

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
          if (calData.num_images) setNumImages(calData.num_images);
          if (calData.subfolder !== undefined) setSubfolder(calData.subfolder);
          if (calData.use_camera_subfolders !== undefined) setUseCameraSubfolders(calData.use_camera_subfolders);
          if (calData.camera_subfolders) setCameraSubfolders(calData.camera_subfolders);
          if (calData.path_order) setPathOrder(calData.path_order);
        }

        // Load stereo_dotboard-specific settings
        const cfgRes = await fetch('/backend/config');
        if (cfgRes.ok) {
          const cfgData = await cfgRes.json();
          const stereo_dotboard = cfgData.calibration?.stereo_dotboard || {};
          if (stereo_dotboard.pattern_cols) setPatternCols(stereo_dotboard.pattern_cols);
          if (stereo_dotboard.pattern_rows) setPatternRows(stereo_dotboard.pattern_rows);
          if (stereo_dotboard.dot_spacing_mm) setDotSpacingMm(stereo_dotboard.dot_spacing_mm);
          if (stereo_dotboard.enhance_dots !== undefined) setEnhanceDots(stereo_dotboard.enhance_dots);
          if (stereo_dotboard.dt) setDt(stereo_dotboard.dt);
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
    };
    loadConfig();
  }, []);

  // Save config (debounced)
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
            num_images: numImages,
            subfolder: subfolder,
            use_camera_subfolders: useCameraSubfolders,
            camera_subfolders: cameraSubfolders,
            path_order: pathOrder,
          }),
        });

        // Save stereo_dotboard-specific settings
        await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calibration: {
              stereo_dotboard: {
                pattern_cols: patternCols,
                pattern_rows: patternRows,
                dot_spacing_mm: dotSpacingMm,
                enhance_dots: enhanceDots,
                dt: dt,
              },
            },
          }),
        });
      } catch (e) {
        console.error('Failed to save config:', e);
      }
    }, 500);
  }, [imageFormat, imageType, numImages, subfolder, useCameraSubfolders, cameraSubfolders, pathOrder, patternCols, patternRows, dotSpacingMm, enhanceDots, dt]);

  // Auto-save when params change
  useEffect(() => {
    saveConfig();
  }, [saveConfig]);

  // Validate images for both cameras (debounced)
  const validateImages = useCallback(async () => {
    if (validationDebounceRef.current) {
      clearTimeout(validationDebounceRef.current);
    }

    validationDebounceRef.current = setTimeout(async () => {
      setValidating(true);
      try {
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
        console.error('Stereo validation failed:', e);
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
    }, 500);
  }, [sourcePathIdx, cam1, cam2]);

  // Auto-validate on param changes
  useEffect(() => {
    validateImages();
  }, [validateImages, imageFormat, numImages, subfolder, imageType, useCameraSubfolders, cameraSubfolders, pathOrder]);

  // Generate stereo model
  const generateStereoModel = useCallback(async () => {
    try {
      const res = await fetch('/backend/calibration/stereo/dotboard/generate_model', {
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
        console.error('Failed to start stereo job:', data.error);
      }
    } catch (e) {
      console.error('Failed to start stereo calibration:', e);
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
        const res = await fetch(`/backend/calibration/stereo/dotboard/job/${jobId}`);
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
        console.error('Failed to poll stereo job status:', e);
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

  // Load saved stereo model
  const loadModel = useCallback(async () => {
    setModelLoading(true);
    try {
      const res = await fetch(
        `/backend/calibration/stereo/dotboard/model?source_path_idx=${sourcePathIdx}&cam1=${cam1}&cam2=${cam2}`
      );
      const data = await res.json();

      if (res.ok && data.exists) {
        setStereoModel(data.stereo_model);
        setDetectionsCam1(data.detections_cam1 || {});
        setDetectionsCam2(data.detections_cam2 || {});
        console.log(`Loaded stereo model with ${Object.keys(data.detections_cam1 || {}).length} cam1 detections, ${Object.keys(data.detections_cam2 || {}).length} cam2 detections`);
      } else {
        console.log('No saved stereo model found');
        setStereoModel(null);
        setDetectionsCam1({});
        setDetectionsCam2({});
      }
    } catch (e) {
      console.error('Failed to load stereo model:', e);
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
        const res = await fetch(`/backend/calibration/stereo/dotboard/reconstruct/status/${reconstructJobId}`);
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
    subfolder,
    setSubfolder,
    useCameraSubfolders,
    setUseCameraSubfolders,
    cameraSubfolders,
    setCameraSubfolders,
    pathOrder,
    setPathOrder,

    // Grid params
    patternCols,
    setPatternCols,
    patternRows,
    setPatternRows,
    dotSpacingMm,
    setDotSpacingMm,
    enhanceDots,
    setEnhanceDots,
    dt,
    setDt,

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
