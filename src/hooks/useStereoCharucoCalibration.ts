import { useCallback, useMemo } from 'react';
import { BoardAdapter } from './calibration/useCalibrationCore';
import { usePinholeStereoCalibration } from './calibration/usePinholeStereoCalibration';
import { SidecarSettings } from './calibration/shared';
import { useCharucoBoard } from './useChArUcoCalibration';

export { ARUCO_DICTS } from './useChArUcoCalibration';
export type { FrameDetection as StereoFrameDetection, WorldFrameClicks } from './calibration/shared';
export type {
  CamIntrinsics, StereoJobStatus, StereoModel, StereoValidationResult,
} from './calibration/usePinholeStereoCalibration';

/**
 * Stereo ChArUco calibration: two pinhole cameras plus their relative pose, on the shared
 * core in pair mode. Board geometry lives in the SHARED `methods.charuco` block (one
 * physical board, mono + stereo). Corner IDs are absolute, so the world frame needs no
 * clicks (the backend's default frame is board-anchored); clicks only refine it.
 */
export function useStereoCharucoCalibration(cameraOptions: number[], sourcePaths: string[]) {
  const b = useCharucoBoard();
  const { readCharuco } = b;

  const readSettings = useCallback((s: SidecarSettings) => {
    readCharuco((s.methods?.charuco ?? {}) as Record<string, unknown>);
  }, [readCharuco]);

  const adapter: BoardAdapter = {
    board: 'charuco',
    readSettings,
    methods: useMemo(() => ({ charuco: b.fields }), [b.fields]),
    boardParams: b.boardParams,
    geometryDiff: b.geometryDiff,
  };

  const s = usePinholeStereoCalibration(adapter, cameraOptions, {});
  const c = s.core;
  const { readCharuco: _r, fields: _f, boardParams: _bp, geometryDiff: _g, ...boardState } = b;

  return {
    ...c,
    ...boardState,
    validation: s.validation,
    stereoModel: s.stereoModel, hasModel: s.stereoModel !== null,
    detectionsCam1: s.detectionsCam1, detectionsCam2: s.detectionsCam2,
    modelLoadError: c.loadError,
    jobStatus: s.jobStatus, isCalibrating: s.isCalibrating, generateStereoModel: s.generateStereoModel,
    reconstructJobStatus: c.applyJob, isReconstructing: c.applyRunning, reconstructVectors: c.startApply,
    sourcePaths,
  };
}
