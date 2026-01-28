import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Detection data for a single frame
 */
export interface FrameDetection {
  grid_points: [number, number][];
  reprojection_error?: number;
}

/**
 * Camera model from calibration
 */
export interface CameraModel {
  camera_matrix: number[][];
  dist_coeffs: number[];
  focal_length: [number, number];
  principal_point: [number, number];
  reprojection_error: number;
  num_images_used: number;
}

/**
 * Validation result from backend
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
}

/**
 * Job status from backend
 */
export interface JobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  processed_images: number;
  valid_images: number;
  total_images: number;
  elapsed_time?: number;
  estimated_remaining?: number;
  error?: string;
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

/**
 * Hook for managing dotboard calibration state and operations.
 *
 * Simplified API:
 * - Parameters are saved to config.yaml via /backend/calibration/config
 * - Validation via /backend/calibration/dotboard/validate
 * - Calibration via /backend/calibration/dotboard/generate_model
 * - Model loading via /backend/calibration/dotboard/model
 */
export function useDotboardCalibration(
  cameraOptions: number[],
  sourcePaths: string[],
) {
  // Source selection
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState(1);

  // Image config (saved to config)
  const [imageFormat, setImageFormat] = useState('calib%05d.tif');
  const [imageType, setImageType] = useState('standard');
  const [numImages, setNumImages] = useState(10);
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);

  // Grid params (saved to config)
  // NOTE: patternCols and patternRows removed - grid is auto-detected
  const [dotSpacingMm, setDotSpacingMm] = useState(28.89);
  const [enhanceDots, setEnhanceDots] = useState(true);
  const [dt, setDt] = useState(1.0);
  const [datumFrame, setDatumFrame] = useState(1); // Which frame defines world origin

  // Validation state
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Job tracking
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);

  // Model and detections
  const [cameraModel, setCameraModel] = useState<CameraModel | null>(null);
  const [detections, setDetections] = useState<Record<string, FrameDetection>>({});
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);

  // Overlay toggle
  const [showOverlay, setShowOverlay] = useState(true);

  // Multi-camera job tracking
  const [multiCameraJobId, setMultiCameraJobId] = useState<string | null>(null);
  const [multiCameraJobStatus, setMultiCameraJobStatus] = useState<MultiCameraJobStatus | null>(null);

  // Vector calibration job tracking
  const [vectorJobId, setVectorJobId] = useState<string | null>(null);
  const [vectorJobStatus, setVectorJobStatus] = useState<MultiCameraJobStatus | null>(null);

  // Refs for debouncing and polling
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const multiCameraPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
          if (calData.num_images) setNumImages(calData.num_images);
          if (calData.calibration_sources !== undefined) setCalibrationSources(calData.calibration_sources);
          if (calData.use_camera_subfolders !== undefined) setUseCameraSubfolders(calData.use_camera_subfolders);
          if (calData.camera_subfolders !== undefined) setCameraSubfolders(calData.camera_subfolders);
        }

        // Load dotboard-specific settings
        const cfgRes = await fetch('/backend/config');
        if (cfgRes.ok) {
          const cfgData = await cfgRes.json();
          const dotboard = cfgData.calibration?.dotboard || {};
          // NOTE: pattern_cols and pattern_rows no longer needed - auto-detected
          if (dotboard.dot_spacing_mm) setDotSpacingMm(dotboard.dot_spacing_mm);
          if (dotboard.enhance_dots !== undefined) setEnhanceDots(dotboard.enhance_dots);
          if (dotboard.dt) setDt(dotboard.dt);
          if (dotboard.datum_frame) setDatumFrame(dotboard.datum_frame);
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
            calibration_sources: calibrationSources,
            use_camera_subfolders: useCameraSubfolders,
            camera_subfolders: cameraSubfolders,
          }),
        });

        // Save dotboard-specific settings
        // NOTE: pattern_cols and pattern_rows no longer saved - auto-detected
        await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calibration: {
              dotboard: {
                dot_spacing_mm: dotSpacingMm,
                enhance_dots: enhanceDots,
                dt: dt,
                datum_frame: datumFrame,
              },
            },
          }),
        });
      } catch (e) {
        console.error('Failed to save config:', e);
      }
    }, 500);
  }, [imageFormat, imageType, numImages, calibrationSources, useCameraSubfolders, cameraSubfolders, dotSpacingMm, enhanceDots, dt, datumFrame]);

  // Auto-save when params change
  useEffect(() => {
    saveConfig();
  }, [saveConfig]);

  // Validate images (debounced)
  const validateImages = useCallback(async () => {
    if (validationDebounceRef.current) {
      clearTimeout(validationDebounceRef.current);
    }

    validationDebounceRef.current = setTimeout(async () => {
      setValidating(true);
      try {
        const res = await fetch('/backend/calibration/dotboard/validate', {
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
    }, 500);
  }, [sourcePathIdx, camera]);

  // Auto-validate on param changes
  useEffect(() => {
    validateImages();
  }, [validateImages, imageFormat, numImages, calibrationSources, imageType, useCameraSubfolders, cameraSubfolders]);

  // Generate camera model
  const generateCameraModel = useCallback(async () => {
    try {
      const res = await fetch('/backend/calibration/dotboard/generate_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: camera,
        }),
      });

      const data = await res.json();
      if (data.job_id) {
        setJobId(data.job_id);
        setJobStatus({ status: 'starting', progress: 0, processed_images: 0, valid_images: 0, total_images: 0 });
      } else {
        console.error('Failed to start job:', data.error);
      }
    } catch (e) {
      console.error('Failed to start calibration:', e);
    }
  }, [sourcePathIdx, camera]);

  // Poll job status
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
        const res = await fetch(`/backend/calibration/dotboard/job/${jobId}`);
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
        console.error('Failed to poll job status:', e);
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

  // Load saved model
  const loadModel = useCallback(async () => {
    setModelLoading(true);
    setModelLoadError(null);
    try {
      const res = await fetch(
        `/backend/calibration/dotboard/model?source_path_idx=${sourcePathIdx}&camera=${camera}`
      );
      const data = await res.json();

      if (res.ok && data.exists) {
        setCameraModel(data.camera_model);
        setDetections(data.detections || {});
        setModelLoadError(null);
        console.log(`Loaded model with ${Object.keys(data.detections || {}).length} detections`);
      } else {
        console.log('No saved model found');
        setCameraModel(null);
        setDetections({});
        setModelLoadError(`No camera model found for Camera ${camera}. Generate a model first.`);
      }
    } catch (e) {
      console.error('Failed to load model:', e);
      setModelLoadError(`Failed to load model: ${e}`);
    } finally {
      setModelLoading(false);
    }
  }, [sourcePathIdx, camera]);

  // Generate camera model for all cameras
  const generateCameraModelAll = useCallback(async () => {
    try {
      const res = await fetch('/backend/calibration/dotboard/generate_model_all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
        }),
      });

      const data = await res.json();
      if (data.job_id) {
        setMultiCameraJobId(data.job_id);
        setMultiCameraJobStatus({
          status: 'starting',
          processed_cameras: 0,
          total_cameras: data.cameras?.length || 0,
        });
      } else {
        console.error('Failed to start multi-camera job:', data.error);
      }
    } catch (e) {
      console.error('Failed to start multi-camera calibration:', e);
    }
  }, [sourcePathIdx]);

  // Vector calibration for single or all cameras
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

  // Ensure valid camera selection
  useEffect(() => {
    if (cameraOptions.length > 0 && !cameraOptions.includes(camera)) {
      setCamera(cameraOptions[0]);
    }
  }, [cameraOptions, camera]);

  // Poll multi-camera job status
  useEffect(() => {
    if (!multiCameraJobId) {
      if (multiCameraPollRef.current) {
        clearInterval(multiCameraPollRef.current);
        multiCameraPollRef.current = null;
      }
      return;
    }

    const pollStatus = async () => {
      try {
        const res = await fetch(`/backend/calibration/dotboard/job/${multiCameraJobId}`);
        const data = await res.json();

        if (res.ok) {
          setMultiCameraJobStatus(data);

          if (data.status === 'completed' || data.status === 'failed') {
            if (multiCameraPollRef.current) {
              clearInterval(multiCameraPollRef.current);
              multiCameraPollRef.current = null;
            }
            // Reload model after completion
            if (data.status === 'completed') {
              setTimeout(() => loadModel(), 500);
            }
          }
        }
      } catch (e) {
        console.error('Failed to poll multi-camera job status:', e);
      }
    };

    pollStatus();
    multiCameraPollRef.current = setInterval(pollStatus, 500);

    return () => {
      if (multiCameraPollRef.current) {
        clearInterval(multiCameraPollRef.current);
        multiCameraPollRef.current = null;
      }
    };
  }, [multiCameraJobId, loadModel]);

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
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (multiCameraPollRef.current) clearInterval(multiCameraPollRef.current);
      if (vectorPollRef.current) clearInterval(vectorPollRef.current);
    };
  }, []);

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

    // Grid params (pattern cols/rows auto-detected)
    dotSpacingMm,
    setDotSpacingMm,
    enhanceDots,
    setEnhanceDots,
    dt,
    setDt,
    datumFrame,
    setDatumFrame,

    // Validation
    validation,
    validating,
    validateImages,

    // Single camera job tracking
    jobId,
    jobStatus,
    isCalibrating: jobStatus?.status === 'running' || jobStatus?.status === 'starting',

    // Multi-camera job tracking
    multiCameraJobId,
    multiCameraJobStatus,
    isMultiCameraCalibrating: multiCameraJobStatus?.status === 'running' || multiCameraJobStatus?.status === 'starting',

    // Vector calibration job tracking
    vectorJobId,
    vectorJobStatus,
    isVectorCalibrating: vectorJobStatus?.status === 'running' || vectorJobStatus?.status === 'starting',

    // Model and detections
    cameraModel,
    detections,
    modelLoading,
    modelLoadError,
    hasModel: cameraModel !== null,

    // Overlay toggle
    showOverlay,
    setShowOverlay,

    // Actions
    generateCameraModel,
    generateCameraModelAll,
    loadModel,
    calibrateVectors,

    // Options (passthrough)
    cameraOptions,
    sourcePaths,
  };
}
