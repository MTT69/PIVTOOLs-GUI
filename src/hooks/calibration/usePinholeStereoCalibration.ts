import { useCallback, useMemo, useState } from 'react';
import { errorMessage, postJson } from '@/lib/api';
import { BoardAdapter, useCalibrationCore } from './useCalibrationCore';
import { CameraValidationResult, FrameDetection, ModelData, WorldFrameClicks, numOrNull } from './shared';

/** Per-camera pinhole intrinsics (stereo enrichment). */
export interface CamIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  camera_matrix: number[][];
  dist_coeffs: number[];
  rms: number;
  image_width?: number;
  image_height?: number;
}

/**
 * Stereo model for the results card: two pinhole models plus the relative pose. `cam1`/`cam2`
 * are the RECORD's cameras in solve order — `intrinsics1`/`rms_cam1` belong to `cam1` — which
 * can differ from the pair selected in the tab, so the card must label by these.
 */
export interface StereoModel {
  cam1: number;
  cam2: number;
  intrinsics1: CamIntrinsics;
  intrinsics2: CamIntrinsics;
  rms_cam1: number;
  rms_cam2: number;
  relative_angle_deg: number;
  baseline_distance_mm: number;
  num_image_pairs: number;
  world_frame_mode?: string;
  /** Joint stereoCalibrate reprojection RMS (px) over all shared views; null if unavailable. */
  stereo_rms_px?: number | null;
  /** Cross-camera pose method, e.g. "stereoCalibrate". */
  method?: string;
}

/** Two-camera validation in the stereo card's shape. */
export interface StereoValidationResult {
  valid: boolean;
  cam1: CameraValidationResult;
  cam2: CameraValidationResult;
  matching_count: number;
  error?: string;
}

/** Synchronous stereo generate status for the card. */
export interface StereoJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  stage?: string;
  processed_pairs: number;
  valid_pairs: number;
  total_pairs: number;
  error?: string;
  /** Joint stereo reprojection RMS (px); absent when the solve reports none. */
  stereo_rms_error?: number | null;
  cam1_rms_error?: number;
  cam2_rms_error?: number;
  /** Cameras the per-camera RMS values belong to (solve order). */
  cam1?: number;
  cam2?: number;
  num_pairs_used?: number;
  relative_angle_deg?: number;
}

/** Map a stereo model/generate response; `cams` = the record order the response refers to. */
function toStereoModel(d: ModelData, cams: [number, number]): StereoModel {
  return {
    cam1: cams[0],
    cam2: cams[1],
    intrinsics1: d.intrinsics1,
    intrinsics2: d.intrinsics2,
    rms_cam1: d.rms_cam1,
    rms_cam2: d.rms_cam2,
    relative_angle_deg: d.stereo_angle_deg,
    baseline_distance_mm: d.baseline_mm,
    num_image_pairs: d.num_pairs_used ?? (d.per_view_rms1?.length ?? 0),
    world_frame_mode: d.world_frame_mode,
    stereo_rms_px: d.stereo_rms_px ?? null,
    method: d.method,
  };
}

export interface PinholeStereoOptions {
  /** Send `fix_k2` (radial k2 = 0) for few-view fits; dotboard only. */
  fixK2?: boolean;
}

/**
 * Stereo pinhole calibration (dotboard or ChArUco): the shared core in pair mode plus the
 * synchronous stereo generate. The world frame is defined on the first camera of the pair.
 */
export function usePinholeStereoCalibration(
  adapter: BoardAdapter,
  cameraOptions: number[],
  { fixK2 }: PinholeStereoOptions,
) {
  const core = useCalibrationCore({ adapter, mode: 'pair', cameraOptions, detections: true });
  const { cam1, cam2, sourcePathIdx, datumFrame, nViews, frameCount, imageFormat, imageType, dt } = core;
  const [jobStatus, setJobStatus] = useState<StereoJobStatus | null>(null);
  const boardParamsKey = JSON.stringify(adapter.boardParams);
  // fix_k2 matters only below 3 views; unknown count -> not applied (the fit is not few-view
  // as far as the UI can tell, and the backend never defaults it on).
  const fewViews = frameCount != null && frameCount < 3;

  const generateStereoModel = useCallback(async (
    clicks?: WorldFrameClicks | null,
    opts?: { forceRedetect?: boolean },
  ) => {
    const total = frameCount ?? 0;
    const pair: [number, number] = [cam1, cam2];
    const dtVal = numOrNull(dt);
    setJobStatus({ status: 'running', progress: 0, processed_pairs: 0, valid_pairs: 0, total_pairs: total, stage: 'calibrating' });
    try {
      const data = await postJson('/backend/calibration/generate_model', {
        stereo: true, camera_pair: pair, source_path_idx: sourcePathIdx, board: adapter.board,
        board_params: JSON.parse(boardParamsKey), datum_frame: datumFrame, frame_total: nViews,
        image_format: imageFormat, image_type: imageType,
        ...(fixK2 !== undefined ? { fix_k2: fixK2 && fewViews } : {}),
        // dt is stamped into the model; empty is omitted (saved rig.dt or a loud failure).
        ...(dtVal != null ? { dt: dtVal } : {}),
        clicks: clicks || undefined,
        force_redetect: opts?.forceRedetect || undefined,
      });
      if (data.success) {
        // The generate response is in request order and carries no camera fields.
        core.setGeneratedModel({ ...data, cam1: pair[0], cam2: pair[1] });
        core.noteViewCount(data);
        setJobStatus({
          status: 'completed', progress: 100,
          processed_pairs: total, valid_pairs: data.num_pairs_used ?? 0, total_pairs: total,
          stereo_rms_error: data.stereo_rms_px ?? null,
          cam1_rms_error: data.rms_cam1, cam2_rms_error: data.rms_cam2, cam1: pair[0], cam2: pair[1],
          num_pairs_used: data.num_pairs_used, relative_angle_deg: data.stereo_angle_deg,
        });
      } else {
        setJobStatus({ status: 'failed', progress: 0, processed_pairs: 0, valid_pairs: 0, total_pairs: 0, error: data.error });
      }
    } catch (e) {
      setJobStatus({ status: 'failed', progress: 0, processed_pairs: 0, valid_pairs: 0, total_pairs: 0, error: errorMessage(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameCount, cam1, cam2, dt, sourcePathIdx, adapter.board, boardParamsKey, datumFrame, nViews,
      imageFormat, imageType, fixK2, fewViews, core.setGeneratedModel, core.noteViewCount]);

  const stereoModel = useMemo(() => {
    const d = core.modelData;
    if (!d) return null;
    // GET /calibration/model returns the record's own cam1/cam2 (record_pair).
    return toStereoModel(d, [Number(d.cam1), Number(d.cam2)]);
  }, [core.modelData]);

  const validation: StereoValidationResult | null = useMemo(() => {
    const v = core.validation;
    if (!v) return null;
    const missing: CameraValidationResult = { valid: false, found_count: 0 };
    return {
      valid: v.valid,
      cam1: v.cameras[cam1] ?? missing,
      cam2: v.cameras[cam2] ?? missing,
      matching_count: v.matching_count,
      error: v.error,
    };
  }, [core.validation, cam1, cam2]);

  const detectionsCam1: Record<number, FrameDetection> = core.detections[cam1] ?? {};
  const detectionsCam2: Record<number, FrameDetection> = core.detections[cam2] ?? {};

  return {
    core,
    validation,
    stereoModel,
    detectionsCam1,
    detectionsCam2,
    jobStatus,
    isCalibrating: jobStatus?.status === 'running' || jobStatus?.status === 'starting',
    generateStereoModel,
    showFixK2: fewViews,
  };
}
