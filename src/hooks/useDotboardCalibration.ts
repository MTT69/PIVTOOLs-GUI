import { useCallback, useMemo, useState } from 'react';
import { BoardAdapter } from './calibration/useCalibrationCore';
import { PlanarModelType, usePlanarCalibration } from './calibration/usePlanarCalibration';
import { SidecarSettings, numOrNull } from './calibration/shared';

export type { FrameDetection, WorldFrameClicks } from './calibration/shared';
export type { CameraModel, JobStatus, MultiCameraJobStatus, ValidationResult } from './calibration/usePlanarCalibration';

const BOARD = 'dotboard';

/**
 * Planar dotboard calibration. Board geometry (dot spacing) and the model type persist under
 * the sidecar's shared `methods.dotboard` block; everything else is the shared core
 * (`useCalibrationCore`). Dot spacing and dt have no frontend default: empty stays empty and
 * generate fails loudly.
 */
export function useDotboardCalibration(cameraOptions: number[], sourcePaths: string[]) {
  const [dotSpacingMm, setDotSpacingMm] = useState('');
  const [modelType, setModelType] = useState<PlanarModelType>('pinhole');

  const readSettings = useCallback((s: SidecarSettings) => {
    const dot = (s.methods?.dotboard ?? {}) as Record<string, unknown>;
    setDotSpacingMm(dot.dot_spacing_mm == null ? '' : String(dot.dot_spacing_mm));
    if (dot.model_type === 'pinhole' || dot.model_type === 'polynomial') setModelType(dot.model_type);
  }, []);

  const adapter: BoardAdapter = {
    board: BOARD,
    readSettings,
    methods: useMemo(() => ({ dotboard: { dot_spacing_mm: numOrNull(dotSpacingMm), model_type: modelType } }),
      [dotSpacingMm, modelType]),
    boardParams: useMemo(() => {
      const v = numOrNull(dotSpacingMm);
      return v == null ? {} : { dot_spacing_mm: v };
    }, [dotSpacingMm]),
    geometryDiff: (geo) => {
      const diff: string[] = [];
      const v = numOrNull(dotSpacingMm);
      if (geo.dot_spacing_mm != null && v != null && Number(geo.dot_spacing_mm) !== v) diff.push('dot spacing');
      if (geo.model_type != null && geo.model_type !== modelType) diff.push('model type');
      return diff;
    },
  };

  const p = usePlanarCalibration(adapter, modelType, cameraOptions);
  const c = p.core;

  return {
    ...c,
    validation: p.validation,
    cameraModel: p.cameraModel, hasModel: p.cameraModel !== null,
    detections: p.detections, detectFrame: p.detectFrame,
    modelLoadError: c.loadError,
    dotSpacingMm, setDotSpacingMm, modelType, setModelType,
    jobStatus: p.jobStatus, isCalibrating: p.isCalibrating,
    multiCameraJobStatus: p.multiCameraJobStatus, isMultiCameraCalibrating: p.isMultiCameraCalibrating,
    generateCameraModel: p.generateCameraModel, generateCameraModelAll: p.generateCameraModelAll,
    vectorJobStatus: c.applyJob, isVectorCalibrating: c.applyRunning,
    calibrateVectors: c.startApply,
    sourcePaths,
  };
}
