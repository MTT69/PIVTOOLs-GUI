import { useState, useEffect, useRef, useCallback } from 'react';

export type CalibrationMethod = "scale_factor" | "pinhole" | "charuco" | "polynomial" | "stereo";

export interface CalibrationConfig {
  active?: CalibrationMethod;
  scale_factor?: any;
  pinhole?: any;
  charuco?: any;
  polynomial?: any;
  stereo?: any;
  [key: string]: any;
}

export interface Config {
  images: { num_images?: number };
  paths: { source_paths?: string[]; camera_numbers?: number[]; camera_count?: number };
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
    // Use camera_numbers array directly if available
    const camNums = config?.paths?.camera_numbers;
    if (Array.isArray(camNums) && camNums.length > 0) {
      return camNums;
    }
    
    // Fallback: use camera_count to generate array [1, 2, ..., count]
    const camCount = config?.paths?.camera_count;
    if (typeof camCount === "number" && camCount > 0) {
      return Array.from({ length: camCount }, (_, i) => i + 1);
    }
    
    // Default to single camera
    return [1];
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