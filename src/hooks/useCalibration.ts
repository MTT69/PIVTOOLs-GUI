import { useState, useEffect, useRef, useCallback } from 'react';

export type CalibrationMethod = "scale_factor" | "pinhole" | "stereo";

export interface CalibrationConfig {
  active?: CalibrationMethod;
  scale_factor?: any;
  pinhole?: any;
  stereo?: any;
  [key: string]: any;
}

export interface Config {
  images: { num_images?: number };
  paths: { source_paths?: string[]; camera_numbers?: number[] };
  calibration?: CalibrationConfig;
  [key: string]: any;
}

/**
 * Main calibration hook that manages the overall calibration state and backend synchronization.
 * @param config The calibration section from the global config.
 * @param updateConfig A function to update the global config state.
 */
export function useCalibration(
  config: Config = { images: {}, paths: {} },
  updateConfig: (path: string[], value: any) => void
) {
  // --- State Initialization ---
  const [calibrationConfig, setCalibrationConfig] = useState<CalibrationConfig>(
    config.calibration || {}
  );

  // --- Refs for Debouncing ---
  const saveTimerRef = useRef<number | null>(null);

  // --- Sync with external config changes ---
  useEffect(() => {
    setCalibrationConfig(config.calibration || {});
  }, [config.calibration]);

  // --- Debounced config update ---
  const debouncedUpdateConfig = useCallback((path: string[], value: any) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      updateConfig(path, value);
    }, 500);
  }, [updateConfig]);

  // --- Helper functions ---
  const setActiveMethod = useCallback((method: CalibrationMethod) => {
    debouncedUpdateConfig(["calibration", "active"], method);
  }, [debouncedUpdateConfig]);

  const updateCalibrationConfig = useCallback((method: CalibrationMethod, methodConfig: any) => {
    debouncedUpdateConfig(["calibration", method], methodConfig);
  }, [debouncedUpdateConfig]);

  // --- Get camera options from config ---
  const getCameraOptions = useCallback((): number[] => {
    const camNums = config?.paths?.camera_numbers;
    const imCount = config?.imProperties?.cameraCount;
    let count = 1;
    if (Array.isArray(camNums) && camNums.length > 0) {
      const maxCam = Math.max(...camNums.map(Number));
      count = Math.max(camNums.length, maxCam);
    } else if (typeof camNums === "number" && camNums > 0) {
      count = camNums;
    } else if (typeof imCount === "number" && imCount > 0) {
      count = imCount;
    }
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [config]);

  // --- Get source paths from config ---
  const sourcePaths = config?.paths?.source_paths || [];

  return {
    calibrationConfig,
    activeMethod: calibrationConfig.active || "pinhole",
    setActiveMethod,
    updateCalibrationConfig,
    getCameraOptions,
    sourcePaths,
    config,
    updateConfig: debouncedUpdateConfig,
  };
}