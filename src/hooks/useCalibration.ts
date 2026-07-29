import { useMemo } from 'react';

export interface Config {
  images: { num_images?: number };
  paths: { source_paths?: string[]; camera_numbers?: number[]; camera_count?: number };
  [key: string]: any;
}

/**
 * Shared derivations for the calibration tab shell: the configured camera list
 * and source paths. Calibration state itself lives in the per-source settings
 * sidecar (each board tab's hook talks to GET/POST /calibration/settings); the
 * per-method config writers that used to live here died with the sidecar
 * migration.
 */
export function useCalibration(config: Config = { images: {}, paths: {} }) {
  // Memoised on the underlying config fields — a stable identity matters
  // because useGlobalCoordinates' pair-merge effect depends on it, and a fresh
  // array every parent render would re-fire that effect continuously.
  const cameraOptions = useMemo((): number[] => {
    const camNums = config?.paths?.camera_numbers;
    if (Array.isArray(camNums) && camNums.length > 0) return camNums;
    const camCount = config?.paths?.camera_count;
    if (typeof camCount === 'number' && camCount > 0) {
      return Array.from({ length: camCount }, (_, i) => i + 1);
    }
    return [1];
  }, [config?.paths?.camera_numbers, config?.paths?.camera_count]);

  const sourcePaths = config?.paths?.source_paths || [];

  return { cameraOptions, sourcePaths };
}
