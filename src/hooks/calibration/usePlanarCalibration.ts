import { useCallback, useMemo, useState } from 'react';
import { errorMessage, postJson } from '@/lib/api';
import { BoardAdapter, useCalibrationCore } from './useCalibrationCore';
import { CameraValidationResult, FrameDetection, ModelData, WorldFrameClicks, numOrNull } from './shared';

/**
 * Camera model shaped for the planar results card. `model_type` discriminates the pinhole
 * intrinsics block from the single-plane polynomial coefficient block.
 */
export interface CameraModel {
  model_type?: 'pinhole' | 'polynomial';
  camera_matrix?: number[][];
  dist_coeffs?: number[];
  focal_length?: [number, number];
  principal_point?: [number, number];
  coeffs_x?: number[];
  coeffs_y?: number[];
  rms_x_mm?: number;
  rms_y_mm?: number;
  norm?: { x0: number; sx: number; y0: number; sy: number };
  image_width?: number;
  image_height?: number;
  reprojection_error: number;
  num_images_used: number;
}

/** Validation for the selected camera, in the planar card's shape. */
export type ValidationResult = CameraValidationResult;

/** Synchronous-generate status for the planar card. */
export interface JobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  processed_images: number;
  valid_images: number;
  total_images: number;
  error?: string;
  rms_error?: number;
  rms_unit?: 'px' | 'mm';
  num_images_used?: number;
  warnings?: string[];
}

export interface GlobalAlignmentResult {
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
  cameras?: Record<number, { shift_x: number; shift_y: number; source: string }>;
  invert_ux?: boolean;
  reason?: string;
}

export interface MultiCameraJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  processed_cameras: number;
  total_cameras: number;
  /** Cameras whose model was generated; set when the run finishes. */
  succeeded_cameras?: number;
  current_camera?: number;
  processed_images?: number;
  total_images?: number;
  valid_images?: number;
  camera_results?: Record<string, { status: string; rms_error?: number; rms_unit?: 'px' | 'mm'; num_images_used?: number; error?: string; warnings?: string[] }> & {
    global_alignment?: GlobalAlignmentResult;
  };
  elapsed_time?: number;
  error?: string;
}

export type PlanarModelType = 'pinhole' | 'polynomial';

/** Map a mono model/generate response to the card shape (pinhole or polynomial). */
export function toCameraModel(d: ModelData): CameraModel {
  if (d.model_type === 'polynomial') {
    return {
      model_type: 'polynomial',
      coeffs_x: d.coeffs_x, coeffs_y: d.coeffs_y,
      rms_x_mm: d.rms_x_mm, rms_y_mm: d.rms_y_mm,
      norm: { x0: d.x0, sx: d.sx, y0: d.y0, sy: d.sy },
      image_width: d.image_width, image_height: d.image_height,
      reprojection_error: Math.hypot(d.rms_x_mm ?? 0, d.rms_y_mm ?? 0),
      num_images_used: d.num_images_used ?? (d.per_view_rms?.length ?? 1),
    };
  }
  return {
    model_type: 'pinhole',
    camera_matrix: d.camera_matrix,
    dist_coeffs: d.dist_coeffs,
    focal_length: [d.fx, d.fy],
    principal_point: [d.cx, d.cy],
    image_width: d.image_width,
    image_height: d.image_height,
    reprojection_error: d.rms,
    num_images_used: d.num_images_used ?? (d.per_view_rms?.length ?? 0),
  };
}

/** Combined RMS and its unit: pinhole reports px, polynomial a combined mm. */
const respRms = (d: ModelData): number | undefined =>
  d.model_type === 'polynomial' ? Math.hypot(d.rms_x_mm ?? 0, d.rms_y_mm ?? 0) : d.rms;
const respUnit = (d: ModelData): 'px' | 'mm' => (d.model_type === 'polynomial' ? 'mm' : 'px');

/**
 * Mono (planar) calibration for one board: the shared core plus synchronous generate for one
 * or every camera. `modelType` is owned by the board hook because it persists under the
 * board's own `methods` block.
 */
export function usePlanarCalibration(
  adapter: BoardAdapter,
  modelType: PlanarModelType,
  cameraOptions: number[],
) {
  const core = useCalibrationCore({ adapter, mode: 'mono', cameraOptions, detections: true });
  const { camera, sourcePathIdx, datumFrame, nViews, frameCount, imageFormat, imageType, dt } = core;
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [multiCameraJobStatus, setMultiCameraJobStatus] = useState<MultiCameraJobStatus | null>(null);
  const boardParamsKey = JSON.stringify(adapter.boardParams);

  const generateOne = useCallback(async (cam: number, clicks?: WorldFrameClicks | null) => {
    const dtVal = numOrNull(dt);
    return postJson('/backend/calibration/generate_model', {
      stereo: false, camera: cam, source_path_idx: sourcePathIdx, board: adapter.board,
      model_type: modelType,
      board_params: JSON.parse(boardParamsKey), datum_frame: datumFrame, frame_total: nViews,
      image_format: imageFormat, image_type: imageType,
      // dt is stamped into the model; empty is omitted so the backend uses the saved rig.dt
      // or fails loudly (never a default).
      ...(dtVal != null ? { dt: dtVal } : {}),
      clicks: clicks || undefined,
    });
  }, [dt, sourcePathIdx, adapter.board, modelType, boardParamsKey, datumFrame, nViews, imageFormat, imageType]);

  const generateCameraModel = useCallback(async (clicks?: WorldFrameClicks | null) => {
    const total = frameCount ?? 0;
    setJobStatus({ status: 'running', progress: 0, processed_images: 0, valid_images: 0, total_images: total });
    try {
      const data = await generateOne(camera, clicks);
      if (data.success) {
        core.setGeneratedModel(data);
        core.noteViewCount(data);
        setJobStatus({
          status: 'completed', progress: 100,
          processed_images: total, valid_images: data.per_view_rms?.length ?? 0, total_images: total,
          rms_error: respRms(data), rms_unit: respUnit(data), num_images_used: data.num_images_used,
        });
      } else {
        setJobStatus({ status: 'failed', progress: 0, processed_images: 0, valid_images: 0, total_images: 0, error: data.error });
      }
    } catch (e) {
      setJobStatus({ status: 'failed', progress: 0, processed_images: 0, valid_images: 0, total_images: 0, error: errorMessage(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, frameCount, generateOne, core.setGeneratedModel, core.noteViewCount]);

  // Every camera in turn; the world frame is defined on the first camera's view only.
  const generateCameraModelAll = useCallback(async (clicks?: WorldFrameClicks | null) => {
    const cams = cameraOptions.length ? cameraOptions : [camera];
    const results: NonNullable<MultiCameraJobStatus['camera_results']> = {};
    setMultiCameraJobStatus({ status: 'running', processed_cameras: 0, total_cameras: cams.length });
    for (let i = 0; i < cams.length; i++) {
      const cam = cams[i];
      setMultiCameraJobStatus({ status: 'running', processed_cameras: i, total_cameras: cams.length, current_camera: cam, camera_results: { ...results } });
      try {
        const data = await generateOne(cam, cam === cams[0] ? clicks : null);
        results[`Camera ${cam}`] = data.success
          ? { status: 'completed', rms_error: respRms(data), rms_unit: respUnit(data), num_images_used: data.num_images_used }
          : { status: 'failed', error: data.error };
        if (data.success && cam === camera) {
          core.setGeneratedModel(data);
          core.noteViewCount(data);
        }
      } catch (e) {
        results[`Camera ${cam}`] = { status: 'failed', error: errorMessage(e) };
      }
    }
    const succeeded = Object.values(results).filter(r => r.status === 'completed').length;
    setMultiCameraJobStatus({
      status: 'completed', processed_cameras: cams.length, total_cameras: cams.length,
      succeeded_cameras: succeeded, camera_results: results,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOptions, camera, generateOne, core.setGeneratedModel, core.noteViewCount]);

  const cameraModel = useMemo(() => (core.modelData ? toCameraModel(core.modelData) : null), [core.modelData]);
  const detections: Record<number, FrameDetection> = core.detections[camera] ?? {};
  const validation: ValidationResult | null = core.validation
    ? (core.validation.cameras[camera] ?? null)
    : null;

  return {
    core,
    validation,
    cameraModel,
    detections,
    detectFrame: (frame: number) => core.detectFrame(frame, camera),
    jobStatus,
    isCalibrating: jobStatus?.status === 'running' || jobStatus?.status === 'starting',
    multiCameraJobStatus,
    isMultiCameraCalibrating: multiCameraJobStatus?.status === 'running' || multiCameraJobStatus?.status === 'starting',
    generateCameraModel,
    generateCameraModelAll,
  };
}
