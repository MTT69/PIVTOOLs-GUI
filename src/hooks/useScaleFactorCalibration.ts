import { useState, useEffect, useRef } from 'react';

export interface ScaleFactorConfig {
  dt?: number;
  px_per_mm?: number;
  x_offset?: number[];
  y_offset?: number[];
}

export interface ScaleFactorCalibrationState {
  dt: string;
  pxPerMm: string;
  xOffsets: string[];
  yOffsets: string[];
  sourcePathIdx: number;
  camera: number;
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
  const [xOffsets, setXOffsets] = useState<string[]>(
    Array.isArray(config.x_offset) ? config.x_offset.map(String) : Array(cameraOptions.length).fill("0")
  );
  const [yOffsets, setYOffsets] = useState<string[]>(
    Array.isArray(config.y_offset) ? config.y_offset.map(String) : Array(cameraOptions.length).fill("0")
  );
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(0);
  const [camera, setCamera] = useState<number>(1);
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [scaleFactorJobId, setScaleFactorJobId] = useState<string | null>(null);

  // --- Refs for Debouncing ---
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Sync state with config changes ---
  useEffect(() => {
    setDt(config.dt !== undefined ? String(config.dt) : "");
    setPxPerMm(config.px_per_mm !== undefined ? String(config.px_per_mm) : "");
    setXOffsets(Array.isArray(config.x_offset) ? config.x_offset.map(String) : Array(cameraOptions.length).fill("0"));
    setYOffsets(Array.isArray(config.y_offset) ? config.y_offset.map(String) : Array(cameraOptions.length).fill("0"));
  }, [config, cameraOptions.length]);

  // --- Update offsets when camera count changes ---
  useEffect(() => {
    setXOffsets(prev => {
      const arr = [...prev];
      while (arr.length < cameraOptions.length) arr.push("0");
      return arr.slice(0, cameraOptions.length);
    });
    setYOffsets(prev => {
      const arr = [...prev];
      while (arr.length < cameraOptions.length) arr.push("0");
      return arr.slice(0, cameraOptions.length);
    });
  }, [cameraOptions.length]);

  // --- Debounced auto-save ---
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      // Only update if all fields are valid numbers
      const dtNum = Number(dt);
      const pxPerMmNum = Number(pxPerMm);
      const xOffsetNums = xOffsets.map(v => Number(v));
      const yOffsetNums = yOffsets.map(v => Number(v));
      const valid =
        !isNaN(dtNum) && dt !== "" &&
        !isNaN(pxPerMmNum) && pxPerMm !== "" &&
        xOffsetNums.every((n, i) => xOffsets[i] !== "" && !isNaN(n)) &&
        yOffsetNums.every((n, i) => yOffsets[i] !== "" && !isNaN(n));
      if (valid) {
        updateConfig(["calibration", "scale_factor"], {
          dt: dtNum,
          px_per_mm: pxPerMmNum,
          x_offset: xOffsetNums,
          y_offset: yOffsetNums,
        });
      }
    }, 500);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [dt, pxPerMm, xOffsets, yOffsets, updateConfig]);

  // --- Status hook ---
  const useScaleFactorStatus = (sourcePathIdx: number, camera: number) => {
    const [status, setStatus] = useState<string>("not_started");
    useEffect(() => {
      let active = true;
      const fetchStatus = async () => {
        try {
          const res = await fetch(`/backend/calibration/status?source_path_idx=${sourcePathIdx}&camera=${camera}&type=scale_factor`);
          const data = await res.json();
          if (active) setStatus(data.status || "not_started");
        } catch {
          if (active) setStatus("not_started");
        }
      };
      fetchStatus();
      const interval = setInterval(fetchStatus, 2000);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [sourcePathIdx, camera]);
    return status;
  };

  // --- Job status hook ---
  const useScaleFactorJobStatus = (jobId: string | null) => {
    const [status, setStatus] = useState<string>("not_started");
    const [details, setDetails] = useState<any>(null);

    useEffect(() => {
      if (!jobId) return;
      let active = true;
      const fetchStatus = async () => {
        try {
          const res = await fetch(`/backend/calibration/scale_factor/status/${jobId}`);
          const data = await res.json();
          if (active) {
            setStatus(data.status || "not_started");
            setDetails(data);
          }
        } catch {
          if (active) setStatus("not_started");
        }
      };
      fetchStatus();
      const interval = setInterval(fetchStatus, 2000);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [jobId]);
    return { status, details };
  };

  // --- Get status ---
  const status = useScaleFactorStatus(sourcePathIdx, camera);
  const { status: scaleFactorJobStatus, details: scaleFactorJobDetails } = useScaleFactorJobStatus(scaleFactorJobId);

  // --- Calibration function ---
  const calibrateVectors = async () => {
    setCalibrating(true);
    try {
      const response = await fetch('/backend/calibration/scale_factor/calibrate_vectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: camera,
          dt: Number(dt),
          px_per_mm: Number(pxPerMm),
          image_count: imageCount,
          x_offset: xOffsets.map(Number),
          y_offset: yOffsets.map(Number),
          type_name: "instantaneous"
        })
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
    xOffsets,
    yOffsets,
    sourcePathIdx,
    camera,
    calibrating,
    scaleFactorJobId,

    // Setters
    setDt,
    setPxPerMm,
    setXOffsets,
    setYOffsets,
    setSourcePathIdx,
    setCamera,
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