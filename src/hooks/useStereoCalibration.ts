import { useState, useEffect, useRef } from 'react';

export interface StereoConfig {
  source_path_idx?: number;
  camera_pair?: [number, number];
  file_pattern?: string;
  pattern_cols?: number;
  pattern_rows?: number;
  dot_spacing_mm?: number;
  enhance_dots?: boolean;
  asymmetric?: boolean;
  dt?: number;
}

export interface StereoCalibrationState {
  sourcePathIdx: number;
  cameraPair: [number, number];
  filePattern: string;
  patternCols: string;
  patternRows: string;
  dotSpacingMm: string;
  enhanceDots: boolean;
  asymmetric: boolean;
  dt: string;
}

/**
 * Hook for managing stereo calibration state and operations.
 * @param config The stereo section from calibration config.
 * @param updateConfig Function to update the calibration config.
 * @param cameraOptions Array of available camera numbers.
 * @param sourcePaths Array of available source paths.
 * @param imageCount Number of images to process.
 */
export function useStereoCalibration(
  config: StereoConfig = {},
  updateConfig: (path: string[], value: any) => void,
  cameraOptions: number[],
  sourcePaths: string[],
  imageCount: number = 1000
) {
  // --- State Initialization ---
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(config.source_path_idx ?? 0);
  const [cameraPair, setCameraPair] = useState<[number, number]>(config.camera_pair ?? [1, 2]);
  const [filePattern, setFilePattern] = useState<string>(config.file_pattern ?? "planar_calibration_plate_*.tif");
  const [patternCols, setPatternCols] = useState<string>(String(config.pattern_cols ?? 10));
  const [patternRows, setPatternRows] = useState<string>(String(config.pattern_rows ?? 10));
  const [dotSpacingMm, setDotSpacingMm] = useState<string>(String(config.dot_spacing_mm ?? 28.89));
  const [enhanceDots, setEnhanceDots] = useState<boolean>(config.enhance_dots ?? true);
  const [asymmetric, setAsymmetric] = useState<boolean>(config.asymmetric ?? false);
  const [dt, setDt] = useState<string>(String(config.dt ?? 1.0));

  // --- Job management state ---
  const [jobId, setJobId] = useState<string | null>(null);
  const [calibrationResults, setCalibrationResults] = useState<any>(null);
  const [vectorJob, setVectorJob] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [gridImages, setGridImages] = useState<any>(null);
  const [currentGridIndex, setCurrentGridIndex] = useState<number>(1);
  const [vectorPollingActive, setVectorPollingActive] = useState<boolean>(false);
  const [vectorJobId, setVectorJobId] = useState<string | null>(null);
  const [showCompletionMessage, setShowCompletionMessage] = useState<boolean>(false);

  // --- Refs for Debouncing ---
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevConfigRef = useRef<any>(null);

  // --- Sync state with config changes ---
  useEffect(() => {
    setSourcePathIdx(config.source_path_idx ?? 0);
    setCameraPair(config.camera_pair ?? [1, 2]);
    setFilePattern(config.file_pattern ?? "planar_calibration_plate_*.tif");
    setPatternCols(String(config.pattern_cols ?? 10));
    setPatternRows(String(config.pattern_rows ?? 10));
    setDotSpacingMm(String(config.dot_spacing_mm ?? 28.89));
    setEnhanceDots(config.enhance_dots ?? true);
    setAsymmetric(config.asymmetric ?? false);
    setDt(String(config.dt ?? 1.0));
  }, [config]);

  // --- Debounced config updates ---
  useEffect(() => {
    const newConfig = {
      source_path_idx: sourcePathIdx,
      camera_pair: cameraPair,
      file_pattern: filePattern,
      pattern_cols: Number(patternCols),
      pattern_rows: Number(patternRows),
      dot_spacing_mm: Number(dotSpacingMm),
      enhance_dots: enhanceDots,
      asymmetric: asymmetric,
      dt: Number(dt)
    };

    // Only update if config actually changed using deep equality
    if (!prevConfigRef.current || !deepEqual(prevConfigRef.current, newConfig)) {
      prevConfigRef.current = newConfig;

      // Clear existing timer
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      // Debounce the update - only send after 500ms of inactivity
      debounceTimer.current = setTimeout(async () => {
        console.log('Updating stereo config after debounce');
        const payload = {
          calibration: {
            stereo: newConfig,
          },
        };
        try {
          const res = await fetch("/backend/update_config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Failed to save stereo config");
          if (json.updated?.calibration?.stereo) {
            updateConfig(["calibration", "stereo"], json.updated.calibration.stereo);
          }
        } catch (err) {
          console.error("Failed to save stereo config:", err);
        }
      }, 500);
    }

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [sourcePathIdx, cameraPair, filePattern, patternCols, patternRows, dotSpacingMm, enhanceDots, asymmetric, dt, updateConfig]);

  // --- Auto-adjust camera pair when options change ---
  useEffect(() => {
    if (cameraOptions.length >= 2) {
      const needsUpdate =
        cameraPair[0] === cameraPair[1] ||
        !cameraOptions.includes(cameraPair[0]) ||
        !cameraOptions.includes(cameraPair[1]);

      if (needsUpdate) {
        setCameraPair([cameraOptions[0], cameraOptions[1]]);
      }
    }
  }, [cameraOptions, cameraPair]);

  // --- Status hooks ---
  const useStereoCalibrationStatus = (jobId: string | null) => {
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
          const res = await fetch(`/backend/stereo/calibration/status/${jobId}`);
          const data = await res.json();
          if (active) {
            setStatus(data.status || "not_started");
            setDetails(data);
            
            // Stop polling if completed or failed
            if (data.status === "completed" || data.status === "failed" || data.progress >= 100) {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            } else if ((data.status === "running" || data.status === "starting") && !intervalRef.current) {
              // Start polling only if running/starting and not already polling
              intervalRef.current = setInterval(fetchStatus, 500);
            }
          }
        } catch {
          if (active) {
            setStatus("not_started");
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
          }
        }
      };
      
      // Initial fetch
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

  const useStereoVectorStatus = (jobId: string | null) => {
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
          const res = await fetch(`/backend/stereo/calibration/vectors/status/${jobId}`);
          const data = await res.json();
          if (active) {
            setStatus(data.status || "not_started");
            setDetails(data);
            
            // Stop polling if completed or failed
            if (data.status === "completed" || data.status === "failed" || data.progress >= 100) {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            } else if ((data.status === "running" || data.status === "starting") && !intervalRef.current) {
              // Start polling only if running/starting and not already polling
              intervalRef.current = setInterval(fetchStatus, 500);
            }
          }
        } catch {
          if (active) {
            setStatus("not_started");
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
          }
        }
      };
      
      // Initial fetch
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

  // --- Get status ---
  const { status: calibrationStatus, details: calibrationDetails } = useStereoCalibrationStatus(jobId);
  const { status: vectorStatus, details: vectorDetails } = useStereoVectorStatus(vectorJobId);

  // --- Helper functions ---
  const startStereoCalibration = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/backend/stereo/calibration/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera_pair: cameraPair,
          file_pattern: filePattern,
          pattern_cols: Number(patternCols),
          pattern_rows: Number(patternRows),
          dot_spacing_mm: Number(dotSpacingMm),
          enhance_dots: enhanceDots,
          asymmetric: asymmetric,
          dt: Number(dt)
        })
      });
      const result = await response.json();
      if (response.ok) {
        setJobId(result.job_id);
        console.log('Stereo calibration started:', result.job_id);
      } else {
        throw new Error(result.error || 'Failed to start stereo calibration');
      }
    } catch (e: any) {
      console.error('Error starting stereo calibration:', e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const calibrateVectors = async () => {
    setVectorPollingActive(true);
    try {
      const response = await fetch('/backend/stereo/calibration/vectors/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera_pair: cameraPair,
          dt: Number(dt),
          image_count: imageCount
        })
      });
      const result = await response.json();
      if (response.ok) {
        setVectorJobId(result.job_id);
        console.log('Stereo vector calibration started:', result.job_id);
      } else {
        throw new Error(result.error || 'Failed to start stereo vector calibration');
      }
    } catch (e: any) {
      console.error('Error starting stereo vector calibration:', e.message);
      setVectorPollingActive(false);
    }
  };

  // --- Deep equality check ---
  function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  return {
    // State
    sourcePathIdx,
    cameraPair,
    filePattern,
    patternCols,
    patternRows,
    dotSpacingMm,
    enhanceDots,
    asymmetric,
    dt,
    jobId,
    calibrationResults,
    vectorJob,
    isLoading,
    gridImages,
    currentGridIndex,
    vectorPollingActive,
    vectorJobId,
    showCompletionMessage,

    // Setters
    setSourcePathIdx,
    setCameraPair,
    setFilePattern,
    setPatternCols,
    setPatternRows,
    setDotSpacingMm,
    setEnhanceDots,
    setAsymmetric,
    setDt,
    setJobId,
    setCalibrationResults,
    setVectorJob,
    setIsLoading,
    setGridImages,
    setCurrentGridIndex,
    setVectorPollingActive,
    setVectorJobId,
    setShowCompletionMessage,

    // Computed
    calibrationStatus,
    calibrationDetails,
    vectorStatus,
    vectorDetails,
    cameraOptions,
    sourcePaths,
    camera1: cameraPair[0],
    camera2: cameraPair[1],

    // Actions
    startStereoCalibration,
    calibrateVectors,
  };
}