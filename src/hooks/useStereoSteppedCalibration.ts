import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Stepped (dual-level) board STEREO calibration on the calibration2 backend.
 *
 * The v2 port of the legacy `useSteppedBoardCalibration` hook. ONE detected pose
 * sequence covers BOTH cameras (`detect_sequence` with `cameras:[cam1, cam2]`),
 * cached server-side under a single `sequence_id`. The stereo fit is one
 * `generate_model` call with a per-camera spec map and a `stereo_config`
 * ('auto'|'same_side'|'transmission') — the backend derives same-side vs
 * transmission from the two clicked frames' relative handedness + per-camera
 * levels (S3 rule). Everything board-agnostic — validate, saved-model load,
 * figures, 3C reconstruct — uses the SAME generic `/calibration2/*` routes the
 * stereo-dotboard tab uses (the stereo model dir is board-agnostic, so
 * `board="stepped"` is inert on those routes but kept for consistency).
 *
 * Shared physical board geometry persists under `config.calibration2.stepped`
 * (read by both stepped tabs). Stereo-only operator state (per-camera fiducials,
 * clicked level, pose labels, stereo_config) persists under a SEPARATE
 * `config.calibration2.stepped_stereo` block so the mono and stereo tabs never
 * clobber each other's per-camera maps (`update_config` deep-merges).
 *
 * Flow:
 *  1. POST /calibration2/stepped/detect_sequence       (cameras:[cam1,cam2]) -> sequence_id + job
 *  2. POST /calibration2/stepped/snap_fiducial          (origin/+X/+Y per camera = 6 steps)
 *  3. POST /calibration2/stepped/identify_pose_level    (label each non-datum pose, both cameras)
 *  4. POST /calibration2/stepped/generate_model         (stereo:true, cameras:{cam1,cam2}) -> job
 *  5. GET  /calibration2/model?stereo=1&board=stepped   (load saved stereo model)
 *  6. POST /calibration2/apply (stereo:true)            (reconstruct 3C vectors)
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

/** One pose's JSON-safe detection (the `_detection_payload` shape). */
export interface SteppedDetection {
  ok?: boolean;
  image_points?: [number, number][];
  grid_indices?: [number, number][] | null;
  level_a: LevelBlock | null;
  level_b: LevelBlock | null;
  level_labels?: number[] | null;
  image_size?: [number, number];
}

/** Per-pose summary from the detect-sequence job (one list per camera). */
export interface PoseSummary {
  frame_idx: number;
  is_datum: boolean;
  ok?: boolean;
  n_level_a?: number;
  n_level_b?: number;
  n_points?: number;
  error?: string;
}

/** Per-camera pinhole intrinsics block (the `_intrinsics` shape from views.py). */
export interface CamIntrinsics {
  fx?: number;
  fy?: number;
  cx?: number;
  cy?: number;
  camera_matrix?: number[][];
  dist_coeffs?: number[];
  rms?: number;
  image_width?: number;
  image_height?: number;
}

/** Stereo model shaped for the results card (loaded model + generate roll-up). */
export interface StereoModel {
  model_type?: 'pinhole' | 'polynomial3d';
  rms_cam1?: number;
  rms_cam2?: number;
  intrinsics1?: CamIntrinsics;
  intrinsics2?: CamIntrinsics;
  num_pairs_used?: number;
  per_view_rms1?: number[];
  per_view_rms2?: number[];
  // Per-plane reprojection RMS (px); polynomial3d only.
  plane_rms_cam1?: number[];
  plane_rms_cam2?: number[];
  world_frame_mode?: string;
  // Baseline / relative angle are pinhole-only (a polynomial pair has no extrinsic
  // pose); null for polynomial3d, shown as "n/a".
  relative_angle_deg?: number | null;
  baseline_mm?: number | null;
  model_path?: string;
  // Resolved same-side / transmission — only returned by generate_model, NOT by
  // the load route. Captured at generate time and shown read-only.
  stereo_config?: string;
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

/** Two-camera validation roll-up. */
export interface StereoValidation {
  cam1: ValidationResult | null;
  cam2: ValidationResult | null;
  valid: boolean;
}

/** Job status for the detect + fit jobs (calibration2 job_manager shape). */
export interface JobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress?: number;
  stage?: string;
  sequence_id?: string;
  frame_indices?: number[];
  datum_frame_idx?: number;
  poses?: Record<string, PoseSummary[]>;
  datum_detection?: Record<string, SteppedDetection>;
  // stereo fit completion
  stereo?: boolean;
  model_type?: string;
  rms_cam1?: number;
  rms_cam2?: number;
  per_view_rms1?: number[];
  per_view_rms2?: number[];
  plane_rms_cam1?: number[];
  plane_rms_cam2?: number[];
  num_pairs_used?: number;
  stereo_config?: string;
  baseline_mm?: number | null;
  relative_angle_deg?: number | null;
  model_path?: string;
  figures?: string[];
  error?: string;
}

/** Reconstruct (apply) job roll-up. */
export interface ReconstructJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress?: number;
  processed_frames?: number;
  total_frames?: number;
  error?: string;
}

export type SequenceStatus = 'idle' | 'detecting' | 'ready' | 'error';
export type StereoConfig = 'auto' | 'same_side' | 'transmission';

const BOARD = 'stepped';
const EMPTY_FIDUCIALS: FiducialSet = { origin: null, x_axis: null, y_axis: null };

export function useStereoSteppedCalibration(
  cameraOptions: number[],
  sourcePaths: string[],
) {
  // ---------- Source + camera-pair selection ----------
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [cam1, setCam1] = useState(1);
  const [cam2, setCam2] = useState(2);
  const [activeCam, setActiveCam] = useState(1);

  // ---------- Image config (persists to config.calibration) ----------
  const [imageFormat, setImageFormat] = useState('calib%05d.tif');
  const [imageType, setImageType] = useState('standard');
  const [numImages, setNumImages] = useState<string>('10');
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);

  // ---------- Board geometry + dt (persists to config.calibration2.stepped) ----------
  const [dotSpacingMm, setDotSpacingMm] = useState(28.89);
  const [stepHeightMm, setStepHeightMm] = useState(3.0);
  const [boardThicknessMm, setBoardThicknessMm] = useState(14.8);
  const [dt, setDt] = useState(1.0);

  // ---------- Sequence-mode controls ----------
  const [numCalibrationFrames, setNumCalibrationFrames] = useState<number>(10);
  const [datumFrame, setDatumFrame] = useState<number>(1);

  // ---------- Stereo geometry classification ----------
  const [stereoConfig, setStereoConfig] = useState<StereoConfig>('auto');

  // ---------- Model family ('pinhole' or single-view 'polynomial3d') ----------
  const [modelType, setModelType] = useState<'pinhole' | 'polynomial3d'>('pinhole');

  // ---------- Validation (both cameras) ----------
  const [validation, setValidation] = useState<StereoValidation | null>(null);
  const [validating, setValidating] = useState(false);

  // ---------- Single shared sequence (both cameras) ----------
  const [sequenceId, setSequenceId] = useState<string | null>(null);
  const [sequenceStatus, setSequenceStatus] = useState<SequenceStatus>('idle');
  const [sequenceError, setSequenceError] = useState<string | null>(null);
  const [detectionProgress, setDetectionProgress] = useState<number>(0);
  // Per-camera pose summaries from the one sequence.
  const [sequencePoses, setSequencePosesMap] = useState<Record<number, PoseSummary[] | null>>({});

  // ---------- Per-camera fiducials + clicked level ----------
  const [fiducials, setFiducialsMap] = useState<Record<number, FiducialSet>>({});
  const [clickedLevel, setClickedLevelMap] = useState<Record<number, 'peak' | 'trough'>>({});

  // ---------- Per-camera, per-pose peak/trough labels ----------
  const [poseLevels, setPoseLevelsMap] = useState<Record<number, Record<number, string>>>({});

  // ---------- Per-camera detection overlay ----------
  const [detectionData, setDetectionDataMap] = useState<Record<number, SteppedDetection | null>>({});
  const setDetectionDataFor = (cam: number, d: SteppedDetection | null) =>
    setDetectionDataMap(prev => ({ ...prev, [cam]: d }));

  // ---------- Stereo fit job + loaded model ----------
  const [fitJobStatus, setFitJobStatus] = useState<JobStatus | null>(null);
  const [stereoModel, setStereoModel] = useState<StereoModel | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);

  // ---------- Reconstruct (apply) job ----------
  const [reconstructJobStatus, setReconstructJobStatus] = useState<ReconstructJobStatus | null>(null);
  const [reconstructJobId, setReconstructJobId] = useState<string | null>(null);

  // ---------- Refs ----------
  const configLoadedRef = useRef(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollHandles = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const reconstructPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------- Per-camera setters ----------
  const setSequencePosesFor = (cam: number, v: PoseSummary[] | null) =>
    setSequencePosesMap(prev => ({ ...prev, [cam]: v }));
  const setFiducialFor = (cam: number, which: keyof FiducialSet, value: [number, number]) =>
    setFiducialsMap(prev => {
      const existing = prev[cam] ?? { ...EMPTY_FIDUCIALS };
      return { ...prev, [cam]: { ...existing, [which]: value } };
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

  const frameTotal = useCallback(() => parseInt(numImages) || 10, [numImages]);

  // Board geometry overrides sent to the stepped detector.
  const boardParams = useCallback(() => ({
    dot_spacing_mm: dotSpacingMm,
    step_height_mm: stepHeightMm,
    board_thickness_mm: boardThicknessMm,
  }), [dotSpacingMm, stepHeightMm, boardThicknessMm]);

  // ---------- Generic job poller (detect + fit) ----------
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

  // ---------- Validate one camera (calibration2, all formats) ----------
  const validateOne = useCallback(async (cam: number): Promise<ValidationResult> => {
    try {
      const res = await fetch('/backend/calibration2/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera: cam, source_path_idx: sourcePathIdx,
          image_format: imageFormat, image_type: imageType, frame_total: frameTotal(),
        }),
      });
      return await res.json();
    } catch (e) {
      return { valid: false, found_count: 0, error: String(e) };
    }
  }, [sourcePathIdx, imageFormat, imageType, frameTotal]);

  // ---------- Validate both cameras of the pair ----------
  const validateImages = useCallback(async () => {
    setValidating(true);
    try {
      const [v1, v2] = await Promise.all([validateOne(cam1), validateOne(cam2)]);
      setValidation({ cam1: v1, cam2: v2, valid: Boolean(v1.valid && v2.valid) });
    } finally {
      setValidating(false);
    }
  }, [validateOne, cam1, cam2]);

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
          if (cal.num_images) setNumImages(String(cal.num_images));
          if (cal.calibration_sources !== undefined) setCalibrationSources(cal.calibration_sources);
          if (cal.use_camera_subfolders !== undefined) setUseCameraSubfolders(cal.use_camera_subfolders);
          if (cal.camera_subfolders !== undefined) setCameraSubfolders(cal.camera_subfolders);

          const c2 = cfg.calibration2 || {};
          const sp = c2.stepped || {};
          if (sp.dot_spacing_mm) setDotSpacingMm(sp.dot_spacing_mm);
          if (sp.step_height_mm) setStepHeightMm(sp.step_height_mm);
          if (sp.board_thickness_mm) setBoardThicknessMm(sp.board_thickness_mm);
          if (sp.num_calibration_frames) setNumCalibrationFrames(sp.num_calibration_frames);
          if (c2.dt) setDt(c2.dt);
          if (c2.datum_frame) setDatumFrame(c2.datum_frame);
          if (Array.isArray(c2.camera_pair) && c2.camera_pair.length >= 2) {
            setCam1(Number(c2.camera_pair[0]));
            setCam2(Number(c2.camera_pair[1]));
            setActiveCam(Number(c2.camera_pair[0]));
          }

          // Stereo-only operator state lives in its own block (no mono clobber).
          const ss = c2.stepped_stereo || {};
          if (ss.stereo_config === 'auto' || ss.stereo_config === 'same_side' || ss.stereo_config === 'transmission') {
            setStereoConfig(ss.stereo_config);
          }
          if (ss.model_type === 'pinhole' || ss.model_type === 'polynomial3d') setModelType(ss.model_type);
          if (ss.clicked_level && typeof ss.clicked_level === 'object') {
            const parsed: Record<number, 'peak' | 'trough'> = {};
            for (const [k, v] of Object.entries(ss.clicked_level)) {
              if (v === 'peak' || v === 'trough') parsed[Number(k)] = v;
            }
            setClickedLevelMap(parsed);
          }
          if (ss.pose_levels && typeof ss.pose_levels === 'object') {
            const parsed: Record<number, Record<number, string>> = {};
            for (const [camKey, inner] of Object.entries(ss.pose_levels)) {
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
          if (ss.fiducials && typeof ss.fiducials === 'object') {
            const parsed: Record<number, FiducialSet> = {};
            for (const [camKey, fset] of Object.entries(ss.fiducials)) {
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
              num_images: frameTotal(),
              calibration_sources: calibrationSources,
              use_camera_subfolders: useCameraSubfolders,
              camera_subfolders: cameraSubfolders,
            },
            calibration2: {
              active: 'stereo_stepped', dt, datum_frame: datumFrame,
              camera_pair: [cam1, cam2],
              // Shared physical board geometry (read by both stepped tabs).
              stepped: {
                dot_spacing_mm: dotSpacingMm,
                step_height_mm: stepHeightMm,
                board_thickness_mm: boardThicknessMm,
                num_calibration_frames: numCalibrationFrames,
              },
              // Stereo-only operator state.
              stepped_stereo: {
                stereo_config: stereoConfig,
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
    cam1, cam2, numCalibrationFrames, stereoConfig, modelType, clickedLevel, poseLevels, fiducials,
    validateImages,
  ]);

  useEffect(() => {
    if (!configLoadedRef.current) return;
    saveConfig();
  }, [saveConfig]);

  // Clear the sequence state when source or the pair changes (stale pixels).
  useEffect(() => {
    if (!configLoadedRef.current) return;
    setSequenceId(null);
    setSequenceStatus('idle');
    setSequencePosesMap({});
    setSequenceError(null);
    setDetectionProgress(0);
    setDetectionDataMap({});
    setFitJobStatus(null);
    pollHandles.current.forEach(h => clearInterval(h));
    pollHandles.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePathIdx, cam1, cam2]);

  // Keep cam1 != cam2; keep activeCam within the pair.
  useEffect(() => {
    if (cam1 === cam2) {
      const other = cameraOptions.filter(c => c !== cam1);
      if (other.length > 0) setCam2(other[0]);
    }
  }, [cam1, cam2, cameraOptions]);

  useEffect(() => {
    if (activeCam !== cam1 && activeCam !== cam2) setActiveCam(cam1);
  }, [activeCam, cam1, cam2]);

  // ---------- Detect the shared pose sequence (both cameras) ----------
  const detect = useCallback(async () => {
    if (numCalibrationFrames < 1) {
      setSequenceError('Number of frames must be >= 1');
      return;
    }
    if (datumFrame < 1 || datumFrame > numCalibrationFrames) {
      setSequenceError(`Datum frame ${datumFrame} is outside [1, ${numCalibrationFrames}]`);
      return;
    }
    setSequenceStatus('detecting');
    setSequenceError(null);
    setSequencePosesMap({});
    setSequenceId(null);
    setDetectionProgress(0);

    try {
      const res = await fetch('/backend/calibration2/stepped/detect_sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          cameras: [cam1, cam2],
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
        setSequenceStatus('error');
        setSequenceError(data.error || 'Failed to start sequence detection');
        return;
      }
      const done = await pollJob(
        `/backend/calibration2/stepped/detect_sequence/status/${data.job_id}`,
        (d) => { if (d.progress !== undefined) setDetectionProgress(d.progress); },
      );
      if (done.status === 'failed') {
        setSequenceStatus('error');
        setSequenceError(done.error || 'Sequence detection failed');
        return;
      }
      setSequenceId(done.sequence_id ?? null);
      for (const cam of [cam1, cam2]) {
        const poses = (done.poses?.[String(cam)] || []) as PoseSummary[];
        setSequencePosesFor(cam, poses);
        const datumDet = done.datum_detection?.[String(cam)];
        if (datumDet) setDetectionDataFor(cam, datumDet);
      }
      // Seed only each camera's datum pose label; non-datum poses start unverified.
      setPoseLevelsMap(prev => {
        const next = { ...prev };
        for (const cam of [cam1, cam2]) {
          const datum = clickedLevel[cam] || 'peak';
          next[cam] = { ...(next[cam] || {}), [datumFrame]: datum };
        }
        return next;
      });
      setDetectionProgress(100);
      setSequenceStatus('ready');
    } catch (e) {
      setSequenceStatus('error');
      setSequenceError(String(e));
    }
  }, [sourcePathIdx, cam1, cam2, numCalibrationFrames, datumFrame, boardParams, imageFormat, imageType, pollJob, clickedLevel]);

  // ---------- Snap a fiducial click against a camera's datum pose ----------
  const snapFiducial = useCallback(
    async (
      cam: number,
      which: 'origin' | 'x_axis' | 'y_axis',
      clickX: number,
      clickY: number,
    ): Promise<{ snapped_x: number; snapped_y: number } | null> => {
      if (!sequenceId) {
        setSequenceError('No sequence detected. Detect the sequence first.');
        return null;
      }
      try {
        const res = await fetch('/backend/calibration2/stepped/snap_fiducial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sequence_id: sequenceId, camera: cam, click_x: clickX, click_y: clickY }),
        });
        const data = await res.json();
        if (data.snapped_x !== undefined && data.snapped_y !== undefined) {
          const sx = data.snapped_x as number;
          const sy = data.snapped_y as number;
          setFiducialFor(cam, which, [sx, sy]);
          return { snapped_x: sx, snapped_y: sy };
        }
        console.error('snap_fiducial failed:', data.error);
        setFiducialFor(cam, which, [clickX, clickY]);
        return null;
      } catch (e) {
        console.error('snap_fiducial error:', e);
        setFiducialFor(cam, which, [clickX, clickY]);
        return null;
      }
    },
    [sequenceId],
  );

  // ---------- Build a complete {frame_idx: peak|trough} map for a camera ----------
  // Covers EVERY detected frame (generate requires a label per frame); the datum +
  // any unlabelled/failed pose default to the datum face (inert for failed
  // detections, which the calibrator skips).
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

  // ---------- Generate the stereo model (one fit, both cameras) ----------
  const generateModel = useCallback(async () => {
    if (!sequenceId) {
      setFitJobStatus({ status: 'failed', error: 'No sequence detected.' });
      return;
    }
    for (const cam of [cam1, cam2]) {
      const fids = fiducials[cam];
      const level = clickedLevel[cam];
      if (!fids?.origin || !fids?.x_axis || !fids?.y_axis) {
        setFitJobStatus({ status: 'failed', error: `Set all three fiducials for Cam ${cam}.` });
        return;
      }
      if (level !== 'peak' && level !== 'trough') {
        setFitJobStatus({ status: 'failed', error: `Select the clicked level for Cam ${cam}.` });
        return;
      }
    }

    setFitJobStatus({ status: 'starting', progress: 0 });
    try {
      const res = await fetch('/backend/calibration2/stepped/generate_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequence_id: sequenceId,
          stereo: true,
          stereo_config: stereoConfig,
          model_type: modelType,
          cameras: {
            [String(cam1)]: {
              fiducials: fiducials[cam1],
              clicked_level: clickedLevel[cam1],
              pose_levels: buildPoseLevels(cam1),
            },
            [String(cam2)]: {
              fiducials: fiducials[cam2],
              clicked_level: clickedLevel[cam2],
              pose_levels: buildPoseLevels(cam2),
            },
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.job_id) {
        setFitJobStatus({ status: 'failed', error: data.error || 'Failed to start model generation.' });
        return;
      }
      const done = await pollJob(
        `/backend/calibration2/stepped/generate_model/status/${data.job_id}`,
        (d) => setFitJobStatus(d),
      );
      setFitJobStatus(done);
      if (done.status === 'completed') {
        // The load route does NOT return the resolved same-side/transmission, so
        // seed the card from the generate payload, then hydrate the persistent
        // fields (intrinsics, world frame) from the saved .mat.
        setStereoModel({
          model_type: done.model_type === 'polynomial3d' ? 'polynomial3d' : 'pinhole',
          rms_cam1: done.rms_cam1,
          rms_cam2: done.rms_cam2,
          per_view_rms1: done.per_view_rms1,
          per_view_rms2: done.per_view_rms2,
          plane_rms_cam1: done.plane_rms_cam1,
          plane_rms_cam2: done.plane_rms_cam2,
          num_pairs_used: done.num_pairs_used,
          relative_angle_deg: done.relative_angle_deg ?? null,
          baseline_mm: done.baseline_mm ?? null,
          stereo_config: done.stereo_config,
          model_path: done.model_path,
        });
        loadModel(done.stereo_config);
      }
    } catch (e) {
      setFitJobStatus({ status: 'failed', error: String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceId, cam1, cam2, fiducials, clickedLevel, stereoConfig, modelType, buildPoseLevels, pollJob]);

  // ---------- Load the saved stereo model (generic calibration2 route) ----------
  // `resolvedConfig` (if given) carries the resolved same-side/transmission from a
  // just-completed generate — the load route does not return it.
  const loadModel = useCallback(async (resolvedConfig?: string) => {
    setModelLoading(true);
    setModelLoadError(null);
    try {
      const res = await fetch(
        `/backend/calibration2/model?stereo=1&board=${BOARD}&camera_pair=${cam1},${cam2}&source_path_idx=${sourcePathIdx}`,
      );
      const data = await res.json();
      if (res.ok && data.exists) {
        setStereoModel(prev => ({
          model_type: data.model_type === 'polynomial3d' ? 'polynomial3d' : 'pinhole',
          rms_cam1: data.rms_cam1,
          rms_cam2: data.rms_cam2,
          intrinsics1: data.intrinsics1,
          intrinsics2: data.intrinsics2,
          num_pairs_used: data.num_pairs_used,
          per_view_rms1: data.per_view_rms1,
          per_view_rms2: data.per_view_rms2,
          plane_rms_cam1: data.plane_rms_cam1,
          plane_rms_cam2: data.plane_rms_cam2,
          world_frame_mode: data.world_frame_mode,
          relative_angle_deg: data.stereo_angle_deg ?? null,
          baseline_mm: data.baseline_mm ?? null,
          model_path: data.model_path,
          // Keep a resolved config from the generate step if the load route omits it.
          stereo_config: resolvedConfig ?? prev?.stereo_config,
        }));
        setModelLoadError(null);
      } else {
        // No model yet is the normal first-use state — not an error.
        if (!resolvedConfig) setStereoModel(null);
      }
    } catch (e) {
      console.error('Failed to load stereo model:', e);
      setModelLoadError(`Failed to load model: ${e}`);
    } finally {
      setModelLoading(false);
    }
  }, [cam1, cam2, sourcePathIdx]);

  // ---------- Auto-load the saved model on pair/source change ----------
  useEffect(() => {
    if (!configLoaded) return;
    loadModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, cam1, cam2, sourcePathIdx]);

  // ---------- Reconstruct 3C vectors (generic calibration2 apply) ----------
  const reconstructVectors = useCallback(async (
    typeName: string = 'instantaneous',
    activePaths?: number[],
  ) => {
    setReconstructJobStatus({ status: 'starting', progress: 0 });
    try {
      const res = await fetch('/backend/calibration2/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stereo: true, board: BOARD, source_path_idx: sourcePathIdx,
          camera_pair: [cam1, cam2], type_name: typeName, dt,
          ...(activePaths ? { active_paths: activePaths } : {}),
        }),
      });
      const data = await res.json();
      if (data.job_id) setReconstructJobId(data.job_id);
      else setReconstructJobStatus({ status: 'failed', error: data.error || 'Failed to start reconstruction.' });
    } catch (e) {
      setReconstructJobStatus({ status: 'failed', error: String(e) });
    }
  }, [sourcePathIdx, cam1, cam2, dt]);

  // Poll the reconstruct job.
  useEffect(() => {
    if (!reconstructJobId) {
      if (reconstructPollRef.current) { clearInterval(reconstructPollRef.current); reconstructPollRef.current = null; }
      return;
    }
    const poll = async () => {
      try {
        const res = await fetch(`/backend/calibration2/apply/status/${reconstructJobId}`);
        const data = await res.json();
        if (res.ok) {
          setReconstructJobStatus({
            status: data.status, progress: data.progress,
            processed_frames: data.processed, total_frames: data.total, error: data.error,
          });
          if (data.status === 'completed' || data.status === 'failed') {
            if (reconstructPollRef.current) { clearInterval(reconstructPollRef.current); reconstructPollRef.current = null; }
          }
        }
      } catch {
        // best-effort polling
      }
    };
    poll();
    reconstructPollRef.current = setInterval(poll, 700);
    return () => { if (reconstructPollRef.current) clearInterval(reconstructPollRef.current); };
  }, [reconstructJobId]);

  // ---------- Per-pose detection fetch (overlay on frame change) ----------
  const fetchPoseDetection = useCallback(async (cam: number, frameIdx: number) => {
    if (!sequenceId) return;
    try {
      const res = await fetch(
        `/backend/calibration2/stepped/sequence_pose_detection?sequence_id=${sequenceId}&camera=${cam}&frame_idx=${frameIdx}`,
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
    if (!sequenceId) return null;
    try {
      const res = await fetch('/backend/calibration2/stepped/identify_pose_level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence_id: sequenceId, camera: cam, frame_idx: frameIdx, click_x: clickX, click_y: clickY }),
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

  // ---------- Overlay helpers (per camera) ----------
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

  // ---------- Cleanup on unmount ----------
  useEffect(() => () => {
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
    pollHandles.current.forEach(h => clearInterval(h));
    pollHandles.current.clear();
    if (reconstructPollRef.current) clearInterval(reconstructPollRef.current);
  }, []);

  return {
    // Source + pair selection
    sourcePathIdx, setSourcePathIdx, cam1, setCam1, cam2, setCam2, activeCam, setActiveCam,

    // Image config
    imageFormat, setImageFormat, imageType, setImageType, numImages, setNumImages,
    calibrationSources, setCalibrationSources, useCameraSubfolders, setUseCameraSubfolders,
    cameraSubfolders, setCameraSubfolders,

    // Board geometry
    dotSpacingMm, setDotSpacingMm, stepHeightMm, setStepHeightMm,
    boardThicknessMm, setBoardThicknessMm, dt, setDt,

    // Sequence controls
    numCalibrationFrames, setNumCalibrationFrames, datumFrame, setDatumFrame,

    // Stereo geometry classification
    stereoConfig, setStereoConfig,
    modelType, setModelType,

    // Validation
    validation, validating, validateImages,

    // Sequence state
    sequenceId, sequenceStatus, sequencePoses, sequenceError, detectionProgress,

    // Per-camera fiducials + levels
    fiducials, clickedLevel, setClickedLevel: setClickedLevelFor,
    poseLevels, setPoseLevel: setPoseLevelFor,

    // Stereo fit + model
    fitJobStatus, stereoModel, modelLoading, modelLoadError,
    isGenerating: fitJobStatus?.status === 'running' || fitJobStatus?.status === 'starting',

    // Reconstruct
    reconstructJobStatus,
    isReconstructing:
      reconstructJobStatus?.status === 'running' || reconstructJobStatus?.status === 'starting',

    // Actions
    detect, snapFiducial, generateModel, loadModel, reconstructVectors,
    fetchPoseDetection, identifyPoseLevel,

    // Overlay helpers
    getDetectionOverlayPoints, getDetectionOverlayLines,

    // Options (passthrough)
    cameraOptions, sourcePaths,
  };
}
