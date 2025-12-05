import { useState, useEffect, useRef } from 'react';

export interface ScaleFactorConfig {
  dt?: number;
  px_per_mm?: number;
  source_path_idx?: number;
}

export interface ScaleFactorCalibrationState {
  dt: string;
  pxPerMm: string;
  sourcePathIdx: number;
  calibrating: boolean;
  scaleFactorJobId: string | null;
}

/**
 * Hook for managing scale factor calibration state and operations.
 * @param config The scale_factor section from calibration config.
 * @param updateConfig Function to update the calibration config.
 * @param cameraOptions Array of available camera numbers.
 * @param sourcePaths Array of available source paths.
 * @param imageCount Number of images to process.
 */
export function useScaleFactorCalibration(
  config: ScaleFactorConfig = {},
  updateConfig: (path: string[], value: any) => void,
  cameraOptions: number[],
  sourcePaths: string[],
  imageCount: number = 1000
) {
  // --- State Initialization ---
  const [dt, setDt] = useState<string>(config.dt !== undefined ? String(config.dt) : "");
  const [pxPerMm, setPxPerMm] = useState<string>(config.px_per_mm !== undefined ? String(config.px_per_mm) : "");
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(config.source_path_idx ?? 0);
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [scaleFactorJobId, setScaleFactorJobId] = useState<string | null>(null);

  // --- Refs for Debouncing ---
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Sync state with config changes ---
  useEffect(() => {
    setDt(config.dt !== undefined ? String(config.dt) : "");
    setPxPerMm(config.px_per_mm !== undefined ? String(config.px_per_mm) : "");
    setSourcePathIdx(config.source_path_idx ?? 0);
  }, [config]);

  // --- Update offsets when camera count changes ---
  useEffect(() => {
    // No offsets to update
  }, [cameraOptions.length]);

  // --- Debounced auto-save ---
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      const dtNum = Number(dt);
      const pxPerMmNum = Number(pxPerMm);
      const valid =
        !isNaN(dtNum) && dt !== "" &&
        !isNaN(pxPerMmNum) && pxPerMm !== "" &&
        Number.isFinite(sourcePathIdx);
      if (valid) {
        const payload = {
          calibration: {
            scale_factor: {
              dt: dtNum,
              px_per_mm: pxPerMmNum,
              source_path_idx: sourcePathIdx,
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
          if (!res.ok) throw new Error(json.error || "Failed to save scale factor");
          if (json.updated?.calibration?.scale_factor) {
            updateConfig(["calibration", "scale_factor"], json.updated.calibration.scale_factor);
          }
        } catch (err) {
          console.error("Failed to save scale factor:", err);
        }
      }
    }, 500);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [dt, pxPerMm, sourcePathIdx, updateConfig]);

  // --- Status hook ---
  const useScaleFactorStatus = (sourcePathIdx: number) => {
    const [status, setStatus] = useState<string>("not_started");

    useEffect(() => {
      // Don't poll - only check status when explicitly needed
      // This prevents unnecessary API calls
      return () => {}; // No-op cleanup
    }, [sourcePathIdx]);
    return status;
  };

  // --- Job status hook ---
  const useScaleFactorJobStatus = (jobId: string | null) => {
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
          const res = await fetch(`/backend/calibration/scale_factor/status/${jobId}`);
          const data = await res.json();
          if (active) {
            setStatus(data.status || "not_started");
            setDetails(data);
            // Stop polling if completed, failed, or progress is 100%
            if (data.status === "completed" || data.status === "failed" || data.progress >= 100) {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            } else if (data.status === "running" || data.status === "starting") {
              // Start polling if running and not already polling
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
      // Initial fetch
      fetchStatus();
      // No initial interval, only start if status indicates running
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
  const status = useScaleFactorStatus(sourcePathIdx);
  const { status: scaleFactorJobStatus, details: scaleFactorJobDetails } = useScaleFactorJobStatus(scaleFactorJobId);

  // --- Calibration function ---
  // Note: dt and px_per_mm are read from config by the backend (saved via auto-save above)
  // Supports single camera or all cameras via forAllCameras parameter
  const calibrateVectors = async (
    forAllCameras: boolean = true,
    selectedCamera: number = cameraOptions[0] || 1,
    typeName: string = 'instantaneous'
  ) => {
    setCalibrating(true);
    try {
      const body: Record<string, unknown> = {
        source_path_idx: sourcePathIdx,
        image_count: imageCount,
        type_name: typeName,
      };

      if (forAllCameras) {
        body.cameras = cameraOptions;
      } else {
        body.camera = selectedCamera;
      }

      const response = await fetch('/backend/calibration/scale_factor/calibrate_vectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (response.ok) {
        console.log(`Scale factor calibration started! Job ID: ${result.job_id}`);
        setScaleFactorJobId(result.job_id);
      } else {
        throw new Error(result.error || "Failed to start scale factor calibration");
      }
    } catch (e: any) {
      console.error(`Error starting scale factor calibration: ${e.message}`);
    } finally {
      setCalibrating(false);
    }
  };

  return {
    // State
    dt,
    pxPerMm,
    sourcePathIdx,
    calibrating,
    scaleFactorJobId,

    // Setters
    setDt,
    setPxPerMm,
    setSourcePathIdx,
    setCalibrating,
    setScaleFactorJobId,

    // Computed
    status,
    scaleFactorJobStatus,
    scaleFactorJobDetails,
    cameraOptions,
    sourcePaths,

    // Actions
    calibrateVectors,
  };
}