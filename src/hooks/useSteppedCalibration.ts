import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Stepped (dual-level) board MONO calibration on the calibration backend.
 *
 * This is the v2 port of the legacy `useSteppedPlanarCalibration` hook. The
 * stateful per-pose sequence flow lives on the dedicated stepped blueprint
 * (`/calibration/stepped/*`); everything board-agnostic — validate, saved-model
 * load, figures, apply — uses the SAME generic `/calibration/*` routes the
 * dotboard/charuco tabs use, driven with `board="stepped"`. Board params and the
 * per-camera operator state (clicked level, pose labels, fiducials) persist under
 * `config.calibration.stepped` so a headless CLI run can reproduce the fit.
 *
 * Per-camera flow:
 *  1. POST /calibration/stepped/detect_sequence            (cameras:[cam])  -> sequence_id + job
 *  2. POST /calibration/stepped/snap_fiducial              (origin / x_axis / y_axis)
 *  3. POST /calibration/stepped/identify_pose_level        (label each non-datum pose)
 *  4. POST /calibration/stepped/generate_model             (per-camera spec) -> job
 *  5. GET  /calibration/model?board=stepped                (load saved, generic route)
 */

export interface FiducialSet {
  origin: [number, number] | null;
  x_axis: [number, number] | null;
  y_axis: [number, number] | null;
}

/** One detection level (peak or trough): dot centres + their (col,row) grid indices. */
export interface LevelBlock {
  centers: [number, number][];
  grid_indices?: [number, number][];
  n_points: number;
}

/**
 * One pose's JSON-safe detection (the `_detection_payload` shape from the stepped
 * blueprint): all points + the per-level breakdown for the overlay. The heavy
 * `_`-prefixed diagnostics are stripped server-side and never arrive here.
 */
export interface SteppedDetection {
  ok?: boolean;
  image_points?: [number, number][];
  grid_indices?: [number, number][] | null;
  level_a: LevelBlock | null;
  level_b: LevelBlock | null;
  level_labels?: number[] | null;
  image_size?: [number, number];
}

/** Per-pose summary from the detect-sequence job. */
export interface PoseSummary {
  frame_idx: number;
  is_datum: boolean;
  ok?: boolean;
  n_level_a?: number;
  n_level_b?: number;
  n_points?: number;
  error?: string;
}

/** Camera model shaped for the results card (pinhole or single-view 3D polynomial). */
export interface CameraModel {
  model_type?: 'pinhole' | 'polynomial3d';
  camera_matrix?: number[][];
  dist_coeffs?: number[];
  focal_length?: [number, number];
  principal_point?: [number, number];
  reprojection_error: number;
  num_poses?: number;
  image_width?: number;
  image_height?: number;
  rms?: number;
  plane_rms?: number[];   // per-plane reprojection RMS (px); polynomial3d only
  model_path?: string;
}

export interface ValidationResult {
  valid: boolean;
  found_count: number | 'container';
  expected_count?: number;
  sample_files?: string[];
  first_image_preview?: string;
  image_size?: [number, number];
  camera_path?: string;
  format_detected?: string;
  container_format?: boolean;
  error?: string;
  suggested_pattern?: string;
  suggested_subfolder?: string;
}

/** Job status for the detect + fit jobs (calibration job_manager shape). */
export interface JobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress?: number;
  stage?: string;
  sequence_id?: string;
  frame_indices?: number[];
  datum_frame_idx?: number;
  poses?: Record<string, PoseSummary[]>;
  datum_detection?: Record<string, SteppedDetection>;
  // fit completion
  camera?: number;
  rms?: number;
  fx?: number;
  fy?: number;
  cx?: number;
  cy?: number;
  num_views_used?: number;
  per_view_rms?: number[];
  model_type?: string;
  plane_rms?: number[];
  model_path?: string;
  figures?: string[];
  error?: string;
}

/** Multi-camera fit roll-up + vector-apply job (shared shape with the other tabs). */
export interface MultiCameraJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  processed_cameras: number;
  total_cameras: number;
  current_camera?: number;
  current_camera_progress?: number;
  camera_results?: Record<
    string,
    { status: string; rms?: number; num_poses?: number; model_path?: string; error?: string }
  >;
  error?: string;
}

export type SequenceStatus = 'idle' | 'detecting' | 'ready' | 'error';

const BOARD = 'stepped';

export function useSteppedCalibration(
  cameraOptions: number[],
  sourcePaths: string[],
) {
  // ---------- Source selection ----------
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState(1);

  // ---------- Image config (persists to config.calibration) ----------
  const [imageFormat, setImageFormat] = useState('calib%05d.tif');
  const [imageType, setImageType] = useState('standard');
  const [numImages, setNumImages] = useState<string>('10');
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);

  // ---------- Board geometry + dt (persists to config.calibration.stepped) ----------
  const [dotSpacingMm, setDotSpacingMm] = useState(28.89);
  const [stepHeightMm, setStepHeightMm] = useState(3.0);
  const [boardThicknessMm, setBoardThicknessMm] = useState(14.8);
  const [dt, setDt] = useState(1.0);

  // ---------- Sequence-mode controls ----------
  const [numCalibrationFrames, setNumCalibrationFrames] = useState<number>(10);
  const [datumFrame, setDatumFrame] = useState<number>(1);

  // Model family: 'pinhole' (multi-view) or 'polynomial3d' (single datum view, the
  // DaVis poly model — fits the two physical levels of one view).
  const [modelType, setModelType] = useState<'pinhole' | 'polynomial3d'>('pinhole');

  // ---------- Validation ----------
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // ---------- Per-camera sequence state ----------
  const [sequenceId, setSequenceIdMap] = useState<Record<number, string | null>>({});
  const [sequenceStatus, setSequenceStatusMap] = useState<Record<number, SequenceStatus>>({});
  const [sequencePoses, setSequencePosesMap] = useState<Record<number, PoseSummary[] | null>>({});
  const [sequenceError, setSequenceErrorMap] = useState<Record<number, string | null>>({});
  const [detectionProgress, setDetectionProgressMap] = useState<Record<number, number>>({});

  // ---------- Per-camera fiducials + clicked level ----------
  const [fiducials, setFiducialsMap] = useState<Record<number, FiducialSet>>({});
  const [clickedLevel, setClickedLevelMap] = useState<Record<number, 'peak' | 'trough'>>({});

  // ---------- Per-camera, per-pose peak/trough labels ----------
  const [poseLevels, setPoseLevelsMap] = useState<Record<number, Record<number, string>>>({});

  // ---------- Per-camera detection overlay ----------
  const [detectionData, setDetectionDataMap] = useState<Record<number, SteppedDetection | null>>({});
  const setDetectionDataFor = (cam: number, d: SteppedDetection | null) =>
    setDetectionDataMap(prev => ({ ...prev, [cam]: d }));

  // ---------- Per-camera fit job + camera model ----------
  const [fitJobStatus, setFitJobStatusMap] = useState<Record<number, JobStatus | null>>({});
  const [cameraModel, setCameraModelMap] = useState<Record<number, CameraModel | null>>({});
  const [modelLoading, setModelLoading] = useState<Record<number, boolean>>({});
  const [modelLoadError, setModelLoadError] = useState<Record<number, string | null>>({});

  // ---------- Multi-camera + vector jobs ----------
  const [multiCameraJobStatus, setMultiCameraJobStatus] = useState<MultiCameraJobStatus | null>(null);
  const [vectorJobStatus, setVectorJobStatus] = useState<MultiCameraJobStatus | null>(null);
  const [vectorJobId, setVectorJobId] = useState<string | null>(null);

  // ---------- Refs ----------
  const configLoadedRef = useRef(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollHandles = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const vectorPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------- Per-camera setters ----------
  const setSequenceIdFor = (cam: number, v: string | null) =>
    setSequenceIdMap(prev => ({ ...prev, [cam]: v }));
  const setSequenceStatusFor = (cam: number, v: SequenceStatus) =>
    setSequenceStatusMap(prev => ({ ...prev, [cam]: v }));
  const setSequencePosesFor = (cam: number, v: PoseSummary[] | null) =>
    setSequencePosesMap(prev => ({ ...prev, [cam]: v }));
  const setSequenceErrorFor = (cam: number, v: string | null) =>
    setSequenceErrorMap(prev => ({ ...prev, [cam]: v }));
  const setDetectionProgressFor = (cam: number, v: number) =>
    setDetectionProgressMap(prev => ({ ...prev, [cam]: v }));
  const setFiducialsFor = (
    cam: number,
    update: FiducialSet | ((prev: FiducialSet) => FiducialSet),
  ) =>
    setFiducialsMap(prev => {
      const existing = prev[cam] ?? { origin: null, x_axis: null, y_axis: null };
      const next = typeof update === 'function' ? update(existing) : update;
      return { ...prev, [cam]: next };
    });
  // Picking the datum face propagates to every existing per-pose label for this
  // camera — pick the datum level, have it carry to every pose, override as needed.
  const setClickedLevelFor = (cam: number, level: 'peak' | 'trough') => {
    setClickedLevelMap(prev => ({ ...prev, [cam]: level }));
    setPoseLevelsMap(prev => {
      const existing = prev[cam] || {};
      const next: Record<number, string> = {};
      for (const k of Object.keys(existing)) next[Number(k)] = level;
      return { ...prev, [cam]: next };
    });
  };
  const setPoseLevelFor = (cam: number, frameIdx: number, level: string) =>
    setPoseLevelsMap(prev => ({
      ...prev,
      [cam]: { ...(prev[cam] || {}), [frameIdx]: level },
    }));
  const setFitJobStatusFor = (cam: number, v: JobStatus | null) =>
    setFitJobStatusMap(prev => ({ ...prev, [cam]: v }));
  const setCameraModelFor = (cam: number, v: CameraModel | null) =>
    setCameraModelMap(prev => ({ ...prev, [cam]: v }));
  const setModelLoadingFor = (cam: number, v: boolean) =>
    setModelLoading(prev => ({ ...prev, [cam]: v }));
  const setModelLoadErrorFor = (cam: number, v: string | null) =>
    setModelLoadError(prev => ({ ...prev, [cam]: v }));

  const frameTotal = useCallback(() => parseInt(numImages) || 10, [numImages]);

  // Board geometry overrides sent to the stepped detector.
  const boardParams = useCallback(() => ({
    dot_spacing_mm: dotSpacingMm,
    step_height_mm: stepHeightMm,
    board_thickness_mm: boardThicknessMm,
  }), [dotSpacingMm, stepHeightMm, boardThicknessMm]);

  // ---------- Generic job poller (detect + fit) ----------
  // Polls `${statusUrl}` every 500ms, calling onUpdate each tick, resolving with
  // the final payload on completed/failed. Handles are tracked for unmount cleanup.
  const pollJob = useCallback(
    (statusUrl: string, onUpdate?: (d: JobStatus) => void): Promise<JobStatus> =>
      new Promise<JobStatus>((resolve) => {
        let handle: ReturnType<typeof setInterval> | null = null;
        const finish = (d: JobStatus) => {
          if (handle) { clearInterval(handle); pollHandles.current.delete(handle); }
          resolve(d);
        };
        const tick = async () => {
          try {
            const r = await fetch(statusUrl);
            const d = (await r.json()) as JobStatus;
            onUpdate?.(d);
            if (d.status === 'completed' || d.status === 'failed') { finish(d); return; }
          } catch (e) {
            console.error('job poll failed:', e);
          }
        };
        handle = setInterval(tick, 500);
        pollHandles.current.add(handle);
        tick();
      }),
    [],
  );

  // ---------- Map a calibration model/generate response to the card shape ----------
  const toCameraModel = (d: JobStatus & Record<string, any>): CameraModel => ({
    model_type: d.model_type === 'polynomial3d' ? 'polynomial3d' : 'pinhole',
    camera_matrix: d.camera_matrix,
    dist_coeffs: d.dist_coeffs,
    focal_length: d.fx != null && d.fy != null ? [Number(d.fx), Number(d.fy)] : undefined,
    principal_point: d.cx != null && d.cy != null ? [Number(d.cx), Number(d.cy)] : undefined,
    reprojection_error: Number(d.rms ?? 0),
    num_poses: d.num_images_used ?? d.num_views_used ?? (d.per_view_rms?.length ?? undefined),
    image_width: d.image_width,
    image_height: d.image_height,
    rms: d.rms,
    plane_rms: d.plane_rms,
    model_path: d.model_path,
  });

  // ---------- Validate the image source (calibration, all formats) ----------
  const validateImages = useCallback(async () => {
    setValidating(true);
    try {
      const res = await fetch('/backend/calibration/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera, source_path_idx: sourcePathIdx,
          image_format: imageFormat, image_type: imageType, frame_total: frameTotal(),
        }),
      });
      setValidation(await res.json());
    } catch (e) {
      setValidation({ valid: false, found_count: 0, error: String(e) });
    } finally {
      setValidating(false);
    }
  }, [camera, sourcePathIdx, imageFormat, imageType, frameTotal]);

  // ---------- Load config on mount ----------
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/backend/config');
        if (res.ok) {
          const cfg = await res.json();
          const cal = cfg.calibration || {};
          if (cal.image_format) setImageFormat(cal.image_format);
          if (cal.image_type) setImageType(cal.image_type);
          if (cal.n_views ?? cal.num_images) setNumImages(String(cal.n_views ?? cal.num_images));
          if (cal.calibration_sources !== undefined) setCalibrationSources(cal.calibration_sources);
          if (cal.use_camera_subfolders !== undefined) setUseCameraSubfolders(cal.use_camera_subfolders);
          if (cal.camera_subfolders !== undefined) setCameraSubfolders(cal.camera_subfolders);

          const c2 = cfg.calibration || {};
          const sp = c2.stepped || {};
          if (sp.dot_spacing_mm) setDotSpacingMm(sp.dot_spacing_mm);
          if (sp.step_height_mm) setStepHeightMm(sp.step_height_mm);
          if (sp.board_thickness_mm) setBoardThicknessMm(sp.board_thickness_mm);
          if (sp.model_type === 'pinhole' || sp.model_type === 'polynomial3d') setModelType(sp.model_type);
          if (c2.dt) setDt(c2.dt);
          if (c2.datum_frame) setDatumFrame(c2.datum_frame);
          if (sp.num_calibration_frames) setNumCalibrationFrames(sp.num_calibration_frames);
          // Per-camera operator state (needed for headless CLI reproduction).
          if (sp.clicked_level && typeof sp.clicked_level === 'object') {
            const parsed: Record<number, 'peak' | 'trough'> = {};
            for (const [k, v] of Object.entries(sp.clicked_level)) {
              if (v === 'peak' || v === 'trough') parsed[Number(k)] = v;
            }
            setClickedLevelMap(parsed);
          }
          if (sp.pose_levels && typeof sp.pose_levels === 'object') {
            const parsed: Record<number, Record<number, string>> = {};
            for (const [camKey, inner] of Object.entries(sp.pose_levels)) {
              if (inner && typeof inner === 'object') {
                const innerParsed: Record<number, string> = {};
                for (const [fk, fv] of Object.entries(inner as Record<string, unknown>)) {
                  innerParsed[Number(fk)] = String(fv);
                }
                parsed[Number(camKey)] = innerParsed;
              }
            }
            setPoseLevelsMap(parsed);
          }
          if (sp.fiducials && typeof sp.fiducials === 'object') {
            const parsed: Record<number, FiducialSet> = {};
            for (const [camKey, fset] of Object.entries(sp.fiducials)) {
              if (fset && typeof fset === 'object') parsed[Number(camKey)] = fset as FiducialSet;
            }
            setFiducialsMap(parsed);
          }
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
      configLoadedRef.current = true;
      setConfigLoaded(true);
      validateImages();
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Save config (debounced) ----------
  const saveConfig = useCallback(() => {
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
    configDebounceRef.current = setTimeout(async () => {
      try {
        await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calibration: {
              image_format: imageFormat,
              image_type: imageType,
              n_views: frameTotal(),
              calibration_sources: calibrationSources,
              use_camera_subfolders: useCameraSubfolders,
              camera_subfolders: cameraSubfolders,
              active: BOARD, dt, datum_frame: datumFrame,
              stepped: {
                dot_spacing_mm: dotSpacingMm,
                step_height_mm: stepHeightMm,
                board_thickness_mm: boardThicknessMm,
                num_calibration_frames: numCalibrationFrames,
                model_type: modelType,
                clicked_level: clickedLevel,
                pose_levels: poseLevels,
                fiducials,
              },
            },
          }),
        });
      } catch (e) {
        console.error('Failed to save config:', e);
      }
      validateImages();
    }, 500);
  }, [
    imageFormat, imageType, frameTotal, calibrationSources, useCameraSubfolders,
    cameraSubfolders, dotSpacingMm, stepHeightMm, boardThicknessMm, dt, datumFrame,
    numCalibrationFrames, modelType, clickedLevel, poseLevels, fiducials, validateImages,
  ]);

  useEffect(() => {
    if (!configLoadedRef.current) return;
    saveConfig();
  }, [saveConfig]);

  // Clear ALL per-camera sequence state when the source path changes (stale pixels).
  useEffect(() => {
    if (!configLoadedRef.current) return;
    setSequenceIdMap({});
    setSequenceStatusMap({});
    setSequencePosesMap({});
    setSequenceErrorMap({});
    setDetectionProgressMap({});
    setDetectionDataMap({});
    setFitJobStatusMap({});
    pollHandles.current.forEach(h => clearInterval(h));
    pollHandles.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePathIdx]);

  // ---------- Detect a pose sequence for one camera ----------
  const detectSequence = useCallback(async (cam: number) => {
    if (numCalibrationFrames < 1) {
      setSequenceErrorFor(cam, 'Number of frames must be >= 1');
      return;
    }
    if (datumFrame < 1 || datumFrame > numCalibrationFrames) {
      setSequenceErrorFor(cam, `Datum frame ${datumFrame} is outside [1, ${numCalibrationFrames}]`);
      return;
    }
    setSequenceStatusFor(cam, 'detecting');
    setSequenceErrorFor(cam, null);
    setSequencePosesFor(cam, null);
    setSequenceIdFor(cam, null);
    setDetectionProgressFor(cam, 0);

    try {
      const res = await fetch('/backend/calibration/stepped/detect_sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          cameras: [cam],
          num_frames: numCalibrationFrames,
          start_frame_idx: 1,
          datum_frame_idx: datumFrame,
          board_params: boardParams(),
          image_format: imageFormat,
          image_type: imageType,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.job_id) {
        setSequenceStatusFor(cam, 'error');
        setSequenceErrorFor(cam, data.error || 'Failed to start sequence detection');
        return;
      }
      const done = await pollJob(
        `/backend/calibration/stepped/detect_sequence/status/${data.job_id}`,
        (d) => { if (d.progress !== undefined) setDetectionProgressFor(cam, d.progress); },
      );
      if (done.status === 'failed') {
        setSequenceStatusFor(cam, 'error');
        setSequenceErrorFor(cam, done.error || 'Sequence detection failed');
        return;
      }
      setSequenceIdFor(cam, done.sequence_id ?? null);
      const poses = (done.poses?.[String(cam)] || []) as PoseSummary[];
      setSequencePosesFor(cam, poses);
      // Seed only the datum pose's label; non-datum poses start unverified.
      setPoseLevelsMap(prev => {
        const currentCam = prev[cam] || {};
        const datum = clickedLevel[cam] || 'peak';
        return { ...prev, [cam]: { ...currentCam, [datumFrame]: datum } };
      });
      const datumDet = done.datum_detection?.[String(cam)];
      if (datumDet) setDetectionDataFor(cam, datumDet);
      setDetectionProgressFor(cam, 100);
      setSequenceStatusFor(cam, 'ready');
    } catch (e) {
      setSequenceStatusFor(cam, 'error');
      setSequenceErrorFor(cam, String(e));
    }
  }, [sourcePathIdx, numCalibrationFrames, datumFrame, boardParams, imageFormat, imageType, pollJob, clickedLevel]);

  // ---------- Snap a fiducial click against the datum pose ----------
  const snapFiducial = useCallback(
    async (
      cam: number,
      which: 'origin' | 'x_axis' | 'y_axis',
      clickX: number,
      clickY: number,
    ): Promise<{ snapped_x: number; snapped_y: number } | null> => {
      const sid = sequenceId[cam];
      if (!sid) {
        setSequenceErrorFor(cam, 'No sequence detected. Detect the sequence first.');
        return null;
      }
      try {
        const res = await fetch('/backend/calibration/stepped/snap_fiducial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sequence_id: sid, camera: cam, click_x: clickX, click_y: clickY }),
        });
        const data = await res.json();
        if (data.snapped_x !== undefined && data.snapped_y !== undefined) {
          const sx = data.snapped_x as number;
          const sy = data.snapped_y as number;
          setFiducialsFor(cam, prev => ({ ...prev, [which]: [sx, sy] }));
          return { snapped_x: sx, snapped_y: sy };
        }
        console.error('snap_fiducial failed:', data.error);
        setFiducialsFor(cam, prev => ({ ...prev, [which]: [clickX, clickY] }));
        return null;
      } catch (e) {
        console.error('snap_fiducial error:', e);
        setFiducialsFor(cam, prev => ({ ...prev, [which]: [clickX, clickY] }));
        return null;
      }
    },
    [sequenceId],
  );

  // ---------- Build a complete {frame_idx: peak|trough} map for a camera ----------
  // Covers EVERY detected frame (the generate route requires a label per frame);
  // the datum + any unlabelled/failed pose default to the datum face (inert for
  // failed detections, which the calibrator skips).
  const buildPoseLevels = useCallback((cam: number): Record<number, string> => {
    const poses = sequencePoses[cam] || [];
    const labels = poseLevels[cam] || {};
    const datum = clickedLevel[cam] || 'peak';
    const out: Record<number, string> = {};
    for (const p of poses) {
      out[p.frame_idx] = p.is_datum ? datum : (labels[p.frame_idx] ?? datum);
    }
    return out;
  }, [sequencePoses, poseLevels, clickedLevel]);

  // ---------- POST generate_model for one camera + poll to completion ----------
  const runGenerateJob = useCallback(
    async (cam: number, onUpdate?: (d: JobStatus) => void): Promise<JobStatus> => {
      const sid = sequenceId[cam];
      const fids = fiducials[cam];
      const level = clickedLevel[cam];
      if (!sid) return { status: 'failed', error: 'No sequence detected for this camera.' };
      if (!fids?.origin || !fids?.x_axis || !fids?.y_axis) {
        return { status: 'failed', error: 'Set all three fiducials (origin, +X, +Y) first.' };
      }
      if (level !== 'peak' && level !== 'trough') {
        return { status: 'failed', error: "Select the clicked level ('peak' or 'trough') first." };
      }
      const res = await fetch('/backend/calibration/stepped/generate_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequence_id: sid,
          stereo: false,
          model_type: modelType,
          cameras: {
            [String(cam)]: {
              fiducials: { origin: fids.origin, x_axis: fids.x_axis, y_axis: fids.y_axis },
              clicked_level: level,
              pose_levels: buildPoseLevels(cam),
            },
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.job_id) {
        return { status: 'failed', error: data.error || 'Failed to start model generation.' };
      }
      return pollJob(`/backend/calibration/stepped/generate_model/status/${data.job_id}`, onUpdate);
    },
    [sequenceId, fiducials, clickedLevel, buildPoseLevels, pollJob, modelType],
  );

  // ---------- Generate model for one camera ----------
  const generateCameraModel = useCallback(async (cam: number) => {
    setFitJobStatusFor(cam, { status: 'starting', progress: 0 });
    const done = await runGenerateJob(cam, (d) => setFitJobStatusFor(cam, d));
    setFitJobStatusFor(cam, done);
    if (done.status === 'completed') {
      // Partial model from the job payload, then hydrate the rest (camera matrix,
      // image size, world frame) from the saved .mat.
      setCameraModelFor(cam, toCameraModel(done));
      loadModel(cam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runGenerateJob]);

  // ---------- Generate model for ALL cameras (sequential) ----------
  const generateCameraModelAll = useCallback(async () => {
    const cams = cameraOptions.length ? cameraOptions : [camera];
    const results: NonNullable<MultiCameraJobStatus['camera_results']> = {};
    setMultiCameraJobStatus({ status: 'running', processed_cameras: 0, total_cameras: cams.length });
    for (let i = 0; i < cams.length; i++) {
      const cam = cams[i];
      setMultiCameraJobStatus({
        status: 'running', processed_cameras: i, total_cameras: cams.length,
        current_camera: cam, camera_results: { ...results },
      });
      const done = await runGenerateJob(cam);
      if (done.status === 'completed') {
        results[`Camera ${cam}`] = {
          status: 'completed', rms: done.rms, num_poses: done.num_views_used, model_path: done.model_path,
        };
        loadModel(cam);
      } else {
        results[`Camera ${cam}`] = { status: 'failed', error: done.error };
      }
    }
    setMultiCameraJobStatus({
      status: 'completed', processed_cameras: cams.length, total_cameras: cams.length, camera_results: results,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOptions, camera, runGenerateJob]);

  // ---------- Load the saved model for one camera (generic calibration route) ----------
  const loadModel = useCallback(async (cam: number) => {
    setModelLoadingFor(cam, true);
    setModelLoadErrorFor(cam, null);
    try {
      const res = await fetch(
        `/backend/calibration/model?stereo=0&board=${BOARD}&camera=${cam}&source_path_idx=${sourcePathIdx}`,
      );
      const data = await res.json();
      if (res.ok && data.exists) {
        setCameraModelFor(cam, toCameraModel(data));
        setModelLoadErrorFor(cam, null);
      } else {
        // No model yet is the normal first-use state — not an error.
        setCameraModelFor(cam, null);
      }
    } catch (e) {
      console.error('Failed to load model:', e);
      setModelLoadErrorFor(cam, `Failed to load model: ${e}`);
    } finally {
      setModelLoadingFor(cam, false);
    }
  }, [sourcePathIdx]);

  // ---------- Auto-load the saved model for the active camera ----------
  useEffect(() => {
    if (!configLoaded) return;
    loadModel(camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, camera, sourcePathIdx]);

  // ---------- Apply the model to PIV vectors (generic calibration route) ----------
  const calibrateVectors = useCallback(async (
    _forAllCameras: boolean = true,
    typeName: string = 'instantaneous',
    activePaths?: number[],
  ) => {
    setVectorJobStatus({ status: 'starting', processed_cameras: 0, total_cameras: cameraOptions.length || 1 });
    try {
      const res = await fetch('/backend/calibration/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stereo: false, board: BOARD, source_path_idx: sourcePathIdx, type_name: typeName, dt,
          ...(activePaths ? { active_paths: activePaths } : {}),
        }),
      });
      const data = await res.json();
      if (data.job_id) setVectorJobId(data.job_id);
      else setVectorJobStatus({ status: 'failed', processed_cameras: 0, total_cameras: 0, error: data.error });
    } catch (e) {
      setVectorJobStatus({ status: 'failed', processed_cameras: 0, total_cameras: 0, error: String(e) });
    }
  }, [sourcePathIdx, dt, cameraOptions]);

  // Poll the apply job.
  useEffect(() => {
    if (!vectorJobId) {
      if (vectorPollRef.current) { clearInterval(vectorPollRef.current); vectorPollRef.current = null; }
      return;
    }
    const poll = async () => {
      try {
        const res = await fetch(`/backend/calibration/apply/status/${vectorJobId}`);
        const data = await res.json();
        if (res.ok) {
          setVectorJobStatus({
            status: data.status, processed_cameras: data.processed ?? 0, total_cameras: data.total ?? 1,
            error: data.error,
          });
          if (data.status === 'completed' || data.status === 'failed') {
            if (vectorPollRef.current) { clearInterval(vectorPollRef.current); vectorPollRef.current = null; }
          }
        }
      } catch {
        // best-effort polling
      }
    };
    poll();
    vectorPollRef.current = setInterval(poll, 700);
    return () => { if (vectorPollRef.current) clearInterval(vectorPollRef.current); };
  }, [vectorJobId]);

  // ---------- Per-pose detection fetch (overlay on frame change) ----------
  const fetchPoseDetection = useCallback(async (cam: number, frameIdx: number) => {
    const sid = sequenceId[cam];
    if (!sid) return;
    try {
      const res = await fetch(
        `/backend/calibration/stepped/sequence_pose_detection?sequence_id=${sid}&camera=${cam}&frame_idx=${frameIdx}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as SteppedDetection;
      if (data.ok) setDetectionDataFor(cam, data);
    } catch (e) {
      console.error('Failed to fetch pose detection:', e);
    }
  }, [sequenceId]);

  // ---------- Identify which level a clicked dot belongs to ----------
  const identifyPoseLevel = useCallback(async (
    cam: number,
    frameIdx: number,
    clickX: number,
    clickY: number,
  ): Promise<string | null> => {
    const sid = sequenceId[cam];
    if (!sid) return null;
    try {
      const res = await fetch('/backend/calibration/stepped/identify_pose_level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence_id: sid, camera: cam, frame_idx: frameIdx, click_x: clickX, click_y: clickY }),
      });
      const data = await res.json();
      if (!data.level) return null;
      const datumLabel = clickedLevel[cam] || 'peak';
      return data.level === 'A' ? datumLabel : (datumLabel === 'peak' ? 'trough' : 'peak');
    } catch (e) {
      console.error('Failed to identify pose level:', e);
      return null;
    }
  }, [sequenceId, clickedLevel]);

  // ---------- Overlay helpers ----------
  const getDetectionOverlayPoints = useCallback((cam: number): { x: number; y: number; color: string }[] => {
    const det = detectionData[cam];
    if (!det) return [];
    const points: { x: number; y: number; color: string }[] = [];
    for (const c of det.level_a?.centers || []) points.push({ x: c[0], y: c[1], color: 'blue' });
    for (const c of det.level_b?.centers || []) points.push({ x: c[0], y: c[1], color: 'red' });
    return points;
  }, [detectionData]);

  const getDetectionOverlayLines = useCallback((cam: number): { x1: number; y1: number; x2: number; y2: number; color?: string }[] => {
    const det = detectionData[cam];
    if (!det) return [];
    const lines: { x1: number; y1: number; x2: number; y2: number; color?: string }[] = [];
    for (const [block, name] of [[det.level_a, 'A'] as const, [det.level_b, 'B'] as const]) {
      if (!block?.centers?.length || !block?.grid_indices?.length) continue;
      if (block.centers.length !== block.grid_indices.length) continue;
      const color = name === 'A' ? 'rgba(80, 140, 255, 1)' : 'rgba(255, 120, 120, 1)';
      const lookup = new Map<string, number>();
      for (let i = 0; i < block.grid_indices.length; i++) {
        lookup.set(`${block.grid_indices[i][0]},${block.grid_indices[i][1]}`, i);
      }
      for (let i = 0; i < block.grid_indices.length; i++) {
        const [col, row] = block.grid_indices[i];
        const [x1, y1] = block.centers[i];
        const ri = lookup.get(`${col + 1},${row}`);
        if (ri !== undefined) lines.push({ x1, y1, x2: block.centers[ri][0], y2: block.centers[ri][1], color });
        const di = lookup.get(`${col},${row + 1}`);
        if (di !== undefined) lines.push({ x1, y1, x2: block.centers[di][0], y2: block.centers[di][1], color });
      }
    }
    return lines;
  }, [detectionData]);

  const getFiducialMarkers = useCallback((cam: number) => {
    const fids = fiducials[cam];
    const markers: { x: number; y: number; color: string; label?: string }[] = [];
    if (fids?.origin) markers.push({ x: fids.origin[0], y: fids.origin[1], color: 'lime', label: 'O' });
    if (fids?.x_axis) markers.push({ x: fids.x_axis[0], y: fids.x_axis[1], color: 'red', label: 'X' });
    if (fids?.y_axis) markers.push({ x: fids.y_axis[0], y: fids.y_axis[1], color: 'blue', label: 'Y' });
    return markers;
  }, [fiducials]);

  // ---------- Keep the selected camera valid ----------
  useEffect(() => {
    if (cameraOptions.length > 0 && !cameraOptions.includes(camera)) {
      setCamera(cameraOptions[0]);
    }
  }, [cameraOptions, camera]);

  // ---------- Cleanup on unmount ----------
  useEffect(() => () => {
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
    pollHandles.current.forEach(h => clearInterval(h));
    pollHandles.current.clear();
    if (vectorPollRef.current) clearInterval(vectorPollRef.current);
  }, []);

  return {
    // Source selection
    sourcePathIdx, setSourcePathIdx, camera, setCamera,

    // Image config
    imageFormat, setImageFormat, imageType, setImageType, numImages, setNumImages,
    calibrationSources, setCalibrationSources, useCameraSubfolders, setUseCameraSubfolders,
    cameraSubfolders, setCameraSubfolders,

    // Board geometry
    dotSpacingMm, setDotSpacingMm, stepHeightMm, setStepHeightMm,
    boardThicknessMm, setBoardThicknessMm, dt, setDt,

    // Sequence controls
    numCalibrationFrames, setNumCalibrationFrames, datumFrame, setDatumFrame,

    // Model type (fixed pinhole, retained for config-shape parity)
    modelType, setModelType,

    // Validation
    validation, validating, validateImages,

    // Per-camera sequence state
    sequenceId, sequenceStatus, sequencePoses, sequenceError, detectionProgress,

    // Per-camera fiducials + levels
    fiducials, clickedLevel, setClickedLevel: setClickedLevelFor,
    poseLevels, setPoseLevel: setPoseLevelFor,

    // Per-camera fit + model
    fitJobStatus, cameraModel, modelLoading, modelLoadError,

    // Multi-camera + vector jobs
    multiCameraJobStatus,
    isMultiCameraCalibrating:
      multiCameraJobStatus?.status === 'running' || multiCameraJobStatus?.status === 'starting',
    vectorJobStatus,
    isVectorCalibrating:
      vectorJobStatus?.status === 'running' || vectorJobStatus?.status === 'starting',

    // Actions
    detectSequence, snapFiducial, generateCameraModel, generateCameraModelAll, loadModel,
    calibrateVectors, fetchPoseDetection, identifyPoseLevel,

    // Overlay helpers
    getDetectionOverlayPoints, getDetectionOverlayLines, getFiducialMarkers,

    // Options (passthrough)
    cameraOptions, sourcePaths,
  };
}
