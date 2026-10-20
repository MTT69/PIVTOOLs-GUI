import { useCallback, useMemo, useState } from 'react';
import { BoardAdapter } from './calibration/useCalibrationCore';
import { usePinholeStereoCalibration } from './calibration/usePinholeStereoCalibration';
import { SidecarSettings, numOrNull } from './calibration/shared';

export type { FrameDetection as StereoFrameDetection, WorldFrameClicks } from './calibration/shared';
export type {
  CamIntrinsics, StereoJobStatus, StereoModel, StereoValidationResult,
} from './calibration/usePinholeStereoCalibration';

/**
 * Stereo dotboard calibration: two pinhole cameras plus their relative pose, on the shared
 * core in pair mode. Board geometry lives in the SHARED `methods.dotboard` block (one
 * physical board, mono + stereo); `fix_k2` is stored there too.
 */
export function useStereoCalibration(cameraOptions: number[], sourcePaths: string[]) {
  const [dotSpacingMm, setDotSpacingMm] = useState('');
  // Fix radial k2 = 0 for few-view (<3 frame) fits, where k2 is unconstrained and runs away.
  // Defaults ON; hydrated only when a stored value exists (its default is contextual).
  const [fixK2, setFixK2] = useState(true);

  const readSettings = useCallback((s: SidecarSettings) => {
    const dot = (s.methods?.dotboard ?? {}) as Record<string, unknown>;
    setDotSpacingMm(dot.dot_spacing_mm == null ? '' : String(dot.dot_spacing_mm));
    if (dot.fix_k2 !== undefined && dot.fix_k2 !== null) setFixK2(Boolean(dot.fix_k2));
  }, []);

  const adapter: BoardAdapter = {
    board: 'dotboard',
    readSettings,
    methods: useMemo(() => ({ dotboard: { dot_spacing_mm: numOrNull(dotSpacingMm), fix_k2: fixK2 } }),
      [dotSpacingMm, fixK2]),
    boardParams: useMemo(() => {
      const v = numOrNull(dotSpacingMm);
      return v == null ? {} : { dot_spacing_mm: v };
    }, [dotSpacingMm]),
    geometryDiff: (geo) => {
      const v = numOrNull(dotSpacingMm);
      return geo.dot_spacing_mm != null && v != null && Number(geo.dot_spacing_mm) !== v ? ['dot spacing'] : [];
    },
  };

  const s = usePinholeStereoCalibration(adapter, cameraOptions, { fixK2 });
  const c = s.core;

  return {
    ...c,
    validation: s.validation,
    stereoModel: s.stereoModel, hasModel: s.stereoModel !== null,
    detectionsCam1: s.detectionsCam1, detectionsCam2: s.detectionsCam2,
    modelLoadError: c.loadError,
    dotSpacingMm, setDotSpacingMm, fixK2, setFixK2, showFixK2: s.showFixK2,
    jobStatus: s.jobStatus, isCalibrating: s.isCalibrating, generateStereoModel: s.generateStereoModel,
    isReconstructing: c.applyRunning, reconstructVectors: c.startApply,
    sourcePaths,
  };
}
