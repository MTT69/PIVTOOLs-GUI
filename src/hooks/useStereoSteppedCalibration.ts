import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, fetchJson, postJson } from '@/lib/api';
import { BoardAdapter, useCalibrationCore } from './calibration/useCalibrationCore';
import { useRequestSeq } from './calibration/useRequestSeq';
import { CameraValidationResult, SidecarSettings, numOrNull } from './calibration/shared';

/**
 * Stepped (dual-level) board STEREO calibration.
 *
 * ONE detected pose sequence covers BOTH cameras (`detect_sequence` with `cameras:[cam1, cam2]`),
 * cached server-side under a single `sequence_id`. The stereo fit is one `generate_model` call
 * with a per-camera spec map and a `stereo_config` ('auto'|'same_side'|'transmission'). The
 * board-agnostic parts — settings, validation, saved model, 3C reconstruct — are the shared
 * core (`useCalibrationCore`, pair mode, no detect_views overlay).
 *
 * Shared board geometry persists under `methods.stepped`; stereo-only selections
 * (stereo_config, model_type, fix_k2) under `methods.stepped_stereo`. Per-camera clicks
 * (fiducials, clicked level, pose labels) live in the detection sidecar inputs.mat: they are
 * restored by restoreSequence and saved as they are picked, tagged with the sidecar's
 * `detection_stamp` so a save can never attach clicks to detections they were not made on.
 *
 * Flow:
 *  1. POST /calibration/stepped/detect_sequence       -> sequence_id + job (+ detection_stamp)
 *  2. POST /calibration/stepped/snap_fiducial          (origin/+X/+Y per camera)
 *  3. POST /calibration/stepped/identify_pose_level    (label each non-datum pose)
 *  4. POST /calibration/stepped/generate_model         -> job
 *  5. GET  /calibration/model?stereo=1&board=stepped   (saved model, core)
 *  6. POST /calibration/apply (stereo:true)            (reconstruct, core)
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

/**
 * Stereo model for the results card. `cam1`/`cam2` are the record's cameras in solve order;
 * `intrinsics1`, `rms_cam1`, `plane_rms_cam1` belong to `cam1`.
 */
export interface StereoModel {
  cam1: number;
  cam2: number;
  model_type?: 'pinhole' | 'polynomial3d';
  rms_cam1?: number;
  rms_cam2?: number;
  intrinsics1?: CamIntrinsics;
  intrinsics2?: CamIntrinsics;
  num_pairs_used?: number;
  per_view_rms1?: number[];
  per_view_rms2?: number[];
  plane_rms_cam1?: number[];
  plane_rms_cam2?: number[];
  world_frame_mode?: string;
  // Baseline / relative angle are pinhole-only (a polynomial pair has no extrinsic pose).
  relative_angle_deg?: number | null;
  baseline_mm?: number | null;
  model_path?: string;
  // Resolved same-side / transmission — returned by generate_model only, not the load route.
  stereo_config?: string;
  method?: string;
}

/** Two-camera validation roll-up. */
export interface StereoValidation {
  cam1: CameraValidationResult | null;
  cam2: CameraValidationResult | null;
  valid: boolean;
}

/** Job status for the detect + fit jobs (calibration job_manager shape). */
export interface JobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress?: number;
  stage?: string;
  sequence_id?: string;
  detection_stamp?: string;
  frame_indices?: number[];
  datum_frame_idx?: number;
  poses?: Record<string, PoseSummary[]>;
  datum_detection?: Record<string, SteppedDetection>;
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
  intrinsics1?: CamIntrinsics;
  intrinsics2?: CamIntrinsics;
  method?: string;
  assumed_poses?: Record<string, number[]>;
  model_path?: string;
  figures?: string[];
  error?: string;
}

export type SequenceStatus = 'idle' | 'detecting' | 'ready' | 'error';
export type StereoConfig = 'auto' | 'same_side' | 'transmission';
type Level = 'peak' | 'trough';

const BOARD = 'stepped';
const EMPTY_FIDUCIALS: FiducialSet = { origin: null, x_axis: null, y_axis: null };
/** Poll period for the detect + fit jobs. */
const JOB_POLL_MS = 500;
/** Debounce for persisting clicks to the sidecar as they are picked. */
const CLICK_SAVE_DEBOUNCE_MS = 400;

const isStereoConfig = (v: unknown): v is StereoConfig =>
  v === 'auto' || v === 'same_side' || v === 'transmission';
const flipLevel = (l: string): string => (l === 'peak' ? 'trough' : l === 'trough' ? 'peak' : l);

export function useStereoSteppedCalibration(cameraOptions: number[], sourcePaths: string[]) {
  // ---------- Board geometry + stereo selections (sidecar methods blocks) ----------
  const [dotSpacingMm, setDotSpacingMm] = useState('');
  const [stepHeightMm, setStepHeightMm] = useState('');
  const [boardThicknessMm, setBoardThicknessMm] = useState('');
  const [stereoConfig, setStereoConfig] = useState<StereoConfig>('auto');
  const [modelType, setModelType] = useState<'pinhole' | 'polynomial3d'>('pinhole');
  // Fix radial k2 = 0 for few-view (<3 frame) pinhole fits. Defaults ON; hydrated only when
  // a stored value exists (its default is contextual).
  const [fixK2, setFixK2] = useState(true);

  const readSettings = useCallback((s: SidecarSettings) => {
    const sp = (s.methods?.stepped ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (v == null ? '' : String(v));
    setDotSpacingMm(str(sp.dot_spacing_mm));
    setStepHeightMm(str(sp.step_height_mm));
    setBoardThicknessMm(str(sp.board_thickness_mm));
    const ss = (s.methods?.stepped_stereo ?? {}) as Record<string, unknown>;
    if (isStereoConfig(ss.stereo_config)) setStereoConfig(ss.stereo_config);
    if (ss.model_type === 'pinhole' || ss.model_type === 'polynomial3d') setModelType(ss.model_type);
    if (ss.fix_k2 !== undefined && ss.fix_k2 !== null) setFixK2(Boolean(ss.fix_k2));
  }, []);

  const boardParams = useMemo(() => {
    const p: Record<string, unknown> = {};
    const ds = numOrNull(dotSpacingMm); if (ds != null) p.dot_spacing_mm = ds;
    const sh = numOrNull(stepHeightMm); if (sh != null) p.step_height_mm = sh;
    const bt = numOrNull(boardThicknessMm); if (bt != null) p.board_thickness_mm = bt;
    return p;
  }, [dotSpacingMm, stepHeightMm, boardThicknessMm]);

  const adapter: BoardAdapter = {
    board: BOARD,
    readSettings,
    methods: useMemo(() => ({
      // Shared physical board geometry (read by every stepped tab).
      stepped: {
        dot_spacing_mm: numOrNull(dotSpacingMm),
        step_height_mm: numOrNull(stepHeightMm),
        board_thickness_mm: numOrNull(boardThicknessMm),
      },
      // Stereo-only selections. Clicks are NOT settings (they live in inputs.mat).
      stepped_stereo: { stereo_config: stereoConfig, model_type: modelType, fix_k2: fixK2 },
    }), [dotSpacingMm, stepHeightMm, boardThicknessMm, stereoConfig, modelType, fixK2]),
    boardParams,
    geometryDiff: (geo) => {
      const diff: string[] = [];
      const cmp = (key: string, form: string, label: string) => {
        const v = numOrNull(form);
        if (geo[key] != null && v != null && Number(geo[key]) !== v) diff.push(label);
      };
      cmp('dot_spacing_mm', dotSpacingMm, 'dot spacing');
      cmp('step_height_mm', stepHeightMm, 'step height');
      cmp('board_thickness_mm', boardThicknessMm, 'board thickness');
      if (geo.model_type != null && geo.model_type !== modelType) diff.push('model type');
      return diff;
    },
  };

  const core = useCalibrationCore({ adapter, mode: 'pair', cameraOptions, detections: false });
  const { cam1, cam2, sourcePathIdx, datumFrame, frameCount, imageFormat, imageType, dt, configLoaded, sourceEpoch } = core;

  // ---------- Sequence + per-camera click state ----------
  const [sequenceId, setSequenceId] = useState<string | null>(null);
  const [detectionStamp, setDetectionStamp] = useState<string | null>(null);
  const [sequenceStatus, setSequenceStatus] = useState<SequenceStatus>('idle');
  const [sequenceError, setSequenceError] = useState<string | null>(null);
  const [detectionProgress, setDetectionProgress] = useState(0);
  const [sequencePoses, setSequencePosesMap] = useState<Record<number, PoseSummary[] | null>>({});
  const [fiducials, setFiducialsMap] = useState<Record<number, FiducialSet>>({});
  const [clickedLevel, setClickedLevelMap] = useState<Record<number, Level>>({});
  const [poseLevels, setPoseLevelsMap] = useState<Record<number, Record<number, string>>>({});
  const [detectionData, setDetectionDataMap] = useState<Record<number, SteppedDetection | null>>({});
  const [fitJobStatus, setFitJobStatus] = useState<JobStatus | null>(null);
  // A persisted detection sidecar lets the user regenerate without re-detecting or re-clicking.
  const [hasSidecar, setHasSidecar] = useState(false);
  // Resolved same-side / transmission from the last generate (the load route omits it).
  const [resolvedStereoConfig, setResolvedStereoConfig] = useState<string | null>(null);
  // Set when a click save was refused because the sidecar's detections changed underneath.
  const [clicksSaveError, setClicksSaveError] = useState<string | null>(null);
  // True once the user picked something since the last restore/detect: only user picks are saved.
  const [clicksDirty, setClicksDirty] = useState(false);

  const pollHandles = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const pollGen = useRef(0);
  const restoreSeq = useRequestSeq();
  // Identity of the pose a detection-overlay fetch was issued for.
  const sequenceIdRef = useRef(sequenceId);
  sequenceIdRef.current = sequenceId;

  const setDetectionDataFor = (cam: number, d: SteppedDetection | null) =>
    setDetectionDataMap(prev => ({ ...prev, [cam]: d }));

  const stopPolls = useCallback(() => {
    pollGen.current += 1;  // in-flight polls of the old generation never resolve
    pollHandles.current.forEach(h => clearInterval(h));
    pollHandles.current.clear();
  }, []);

  /** Clear everything that belongs to one source + pair: sequence, overlay AND clicks. */
  const resetSourceState = useCallback(() => {
    stopPolls();
    restoreSeq.invalidate();
    setSequenceId(null);
    setDetectionStamp(null);
    setSequenceStatus('idle');
    setSequencePosesMap({});
    setSequenceError(null);
    setDetectionProgress(0);
    setDetectionDataMap({});
    setFitJobStatus(null);
    setFiducialsMap({});
    setClickedLevelMap({});
    setPoseLevelsMap({});
    setHasSidecar(false);
    setResolvedStereoConfig(null);
    setClicksSaveError(null);
    setClicksDirty(false);
  }, [stopPolls, restoreSeq]);

  // ---------- Generic job poller (detect + fit) ----------
  const pollJob = useCallback(
    (statusUrl: string, onUpdate?: (d: JobStatus) => void): Promise<JobStatus> =>
      new Promise<JobStatus>((resolve) => {
        const gen = pollGen.current;
        let handle: ReturnType<typeof setInterval> | null = null;
        const finish = (d: JobStatus) => {
          if (handle) { clearInterval(handle); pollHandles.current.delete(handle); }
          // A source/pair change bumped pollGen: a stale result must not resurrect cleared state.
          if (pollGen.current !== gen) return;
          resolve(d);
        };
        const tick = async () => {
          try {
            const d = await fetchJson<JobStatus>(statusUrl);
            if (pollGen.current !== gen) return;
            onUpdate?.(d);
            if (d.status === 'completed' || d.status === 'failed') finish(d);
          } catch (e) {
            finish({ status: 'failed', error: errorMessage(e) });
          }
        };
        handle = setInterval(tick, JOB_POLL_MS);
        pollHandles.current.add(handle);
        void tick();
      }),
    [],
  );

  // ---------- Per-camera click setters (user picks mark the clicks dirty) ----------
  const setFiducialFor = (cam: number, which: keyof FiducialSet, value: [number, number]) => {
    setFiducialsMap(prev => ({ ...prev, [cam]: { ...(prev[cam] ?? EMPTY_FIDUCIALS), [which]: value } }));
    setClicksDirty(true);
  };

  // Pose labels are derived from the detector's stable A/B membership relative to the datum
  // face (identifyPoseLevel maps A -> datum face). Changing the datum face therefore inverts
  // every existing label for that camera, which is exactly what re-identifying would give.
  const setClickedLevelFor = (cam: number, level: Level) => {
    const previous = clickedLevel[cam];
    setClickedLevelMap(prev => ({ ...prev, [cam]: level }));
    if (previous && previous !== level) {
      setPoseLevelsMap(prev => {
        const inner: Record<number, string> = {};
        for (const [k, v] of Object.entries(prev[cam] ?? {})) inner[Number(k)] = flipLevel(v);
        return { ...prev, [cam]: inner };
      });
    }
    setClicksDirty(true);
  };

  const setPoseLevelFor = (cam: number, frameIdx: number, level: string) => {
    setPoseLevelsMap(prev => ({ ...prev, [cam]: { ...(prev[cam] ?? {}), [frameIdx]: level } }));
    setClicksDirty(true);
  };

  // ---------- Detect the shared pose sequence (both cameras) ----------
  const detect = useCallback(async () => {
    if (frameCount == null) {
      setSequenceError('Number of images is unknown: enter it, or fix validation so the image count is found.');
      return;
    }
    if (datumFrame < 1 || datumFrame > frameCount) {
      setSequenceError(`Datum frame ${datumFrame} is outside [1, ${frameCount}]`);
      return;
    }
    const pair = [cam1, cam2];
    setSequenceStatus('detecting');
    setSequenceError(null);
    setSequencePosesMap({});
    setSequenceId(null);
    setDetectionStamp(null);
    setDetectionProgress(0);
    setClicksSaveError(null);
    try {
      const data = await postJson('/backend/calibration/stepped/detect_sequence', {
        source_path_idx: sourcePathIdx,
        cameras: pair,
        num_frames: frameCount,
        start_frame_idx: 1,
        datum_frame_idx: datumFrame,
        board_params: boardParams,
        image_format: imageFormat,
        image_type: imageType,
      });
      if (!data.job_id) {
        setSequenceStatus('error');
        setSequenceError(data.error || 'Failed to start sequence detection');
        return;
      }
      const done = await pollJob(
        `/backend/calibration/stepped/detect_sequence/status/${data.job_id}`,
        (d) => { if (d.progress !== undefined) setDetectionProgress(d.progress); },
      );
      if (done.status === 'failed') {
        setSequenceStatus('error');
        setSequenceError(done.error || 'Sequence detection failed');
        return;
      }
      setSequenceId(done.sequence_id ?? null);
      setDetectionStamp(done.detection_stamp ?? null);
      for (const cam of pair) {
        setSequencePosesMap(prev => ({ ...prev, [cam]: (done.poses?.[String(cam)] || []) as PoseSummary[] }));
        const datumDet = done.datum_detection?.[String(cam)];
        if (datumDet) setDetectionDataFor(cam, datumDet);
      }
      // New detections: every non-datum pose must be verified again (the datum pose's label
      // comes from the clicked face). Fiducials are kept: they are dot positions on the datum
      // image, which a re-detect of the same images does not move.
      setPoseLevelsMap({});
      setDetectionProgress(100);
      setSequenceStatus('ready');
      setHasSidecar(true);  // detect_sequence persisted the detections to the sidecar
      setClicksDirty(true); // the cleared labels must reach the sidecar
    } catch (e) {
      setSequenceStatus('error');
      setSequenceError(errorMessage(e));
    }
  }, [frameCount, datumFrame, cam1, cam2, sourcePathIdx, boardParams, imageFormat, imageType, pollJob]);

  // ---------- Snap a fiducial click against a camera's datum pose ----------
  const snapFiducial = useCallback(async (
    cam: number,
    which: 'origin' | 'x_axis' | 'y_axis',
    clickX: number,
    clickY: number,
  ): Promise<{ snapped_x: number; snapped_y: number } | null> => {
    if (!sequenceId) {
      setSequenceError('No sequence detected. Detect the sequence first.');
      return null;
    }
    const issuedFor = sequenceId;
    try {
      const data = await postJson('/backend/calibration/stepped/snap_fiducial', {
        sequence_id: sequenceId, camera: cam, click_x: clickX, click_y: clickY,
      });
      if (sequenceIdRef.current !== issuedFor) return null;
      if (data.snapped_x !== undefined && data.snapped_y !== undefined) {
        const sx = data.snapped_x as number;
        const sy = data.snapped_y as number;
        setFiducialFor(cam, which, [sx, sy]);
        setSequenceError(null);
        return { snapped_x: sx, snapped_y: sy };
      }
      // No detected dot near the click: keep the previous fiducial (a raw click would feed an
      // un-snapped pixel into the world frame).
      setSequenceError(data.error || `Cam ${cam}: could not snap to a detected dot — click on a dot.`);
      return null;
    } catch (e) {
      if (sequenceIdRef.current !== issuedFor) return null;
      setSequenceError(errorMessage(e));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceId]);

  // ---------- A complete {frame_idx: peak|trough} map for a camera, or null ----------
  // Every usable (ok, non-datum) pose must be verified; an unverified one makes the caller
  // refuse to generate rather than silently mislabel poses.
  const buildPoseLevels = useCallback((cam: number): Record<number, string> | null => {
    const poses = sequencePoses[cam] || [];
    const labels = poseLevels[cam] || {};
    const datum = clickedLevel[cam];
    if (!datum) return null;
    const out: Record<number, string> = {};
    for (const p of poses) {
      if (p.is_datum) { out[p.frame_idx] = datum; continue; }
      const label = labels[p.frame_idx];
      if (label !== undefined) out[p.frame_idx] = label;
      else if (!p.ok) out[p.frame_idx] = datum;  // failed detection: placeholder, skipped by the calibrator
      else return null;
    }
    return out;
  }, [sequencePoses, poseLevels, clickedLevel]);

  // ---------- Generate the stereo model (one fit, both cameras) ----------
  // Live sequence: the spec carries the current clicks + verified labels. No live sequence but a
  // sidecar: the backend restores detections AND saved clicks from inputs.mat.
  const generateModel = useCallback(async () => {
    const live = Boolean(sequenceId);
    if (!live && !hasSidecar) {
      setFitJobStatus({ status: 'failed', error: 'No detected sequence — detect first.' });
      return;
    }
    const pair: [number, number] = [cam1, cam2];
    const dtVal = numOrNull(dt);
    const fixK2Sent = fixK2 && frameCount != null && frameCount < 3 && modelType === 'pinhole';
    let body: Record<string, unknown>;
    if (live) {
      const specs: Record<string, unknown> = {};
      for (const cam of pair) {
        const fids = fiducials[cam];
        if (!fids?.origin || !fids?.x_axis || !fids?.y_axis) {
          setFitJobStatus({ status: 'failed', error: `Set all three fiducials for Cam ${cam}.` });
          return;
        }
        if (clickedLevel[cam] !== 'peak' && clickedLevel[cam] !== 'trough') {
          setFitJobStatus({ status: 'failed', error: `Select the clicked level for Cam ${cam}.` });
          return;
        }
        const built = buildPoseLevels(cam);
        if (built === null) {
          setFitJobStatus({ status: 'failed', error: `Cam ${cam}: some poses are not verified. `
            + 'Verify every pose (click a peak/trough dot on each) before generating.' });
          return;
        }
        specs[String(cam)] = { fiducials: fids, clicked_level: clickedLevel[cam], pose_levels: built };
      }
      body = {
        sequence_id: sequenceId, stereo: true, stereo_config: stereoConfig, model_type: modelType,
        fix_k2: fixK2Sent,
        ...(dtVal != null ? { dt: dtVal } : {}),
        cameras: specs,
      };
    } else {
      body = {
        stereo: true, camera_pair: pair, source_path_idx: sourcePathIdx,
        stereo_config: stereoConfig, model_type: modelType, fix_k2: fixK2Sent,
        ...(dtVal != null ? { dt: dtVal } : {}),
      };
    }

    setFitJobStatus({ status: 'starting', progress: 0 });
    try {
      const data = await postJson('/backend/calibration/stepped/generate_model', body);
      if (!data.job_id) {
        setFitJobStatus({ status: 'failed', error: data.error || 'Failed to start model generation.' });
        return;
      }
      const done = await pollJob(
        `/backend/calibration/stepped/generate_model/status/${data.job_id}`,
        (d) => setFitJobStatus(d),
      );
      setFitJobStatus(done);
      if (done.status === 'completed') {
        // The fit is in the live sequence's camera order (= the requested pair). The core
        // shows it now and reloads the saved record (world frame, stamped geometry).
        core.setGeneratedModel({ ...done, stereo_angle_deg: done.relative_angle_deg, cam1: pair[0], cam2: pair[1] });
        setResolvedStereoConfig(done.stereo_config ?? null);
        setHasSidecar(true);
      }
    } catch (e) {
      setFitJobStatus({ status: 'failed', error: errorMessage(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceId, hasSidecar, cam1, cam2, dt, fixK2, frameCount, modelType, fiducials, clickedLevel,
      buildPoseLevels, stereoConfig, sourcePathIdx, pollJob, core.setGeneratedModel]);

  // ---------- Restore the sidecar sequence + clicks (replaces, never merges) ----------
  const restoreSequence = useCallback(async () => {
    const token = restoreSeq.next();
    const pair = [cam1, cam2];
    try {
      const data = await fetchJson(
        `/backend/calibration/stepped/restore_sequence?camera_pair=${cam1},${cam2}&source_path_idx=${sourcePathIdx}`,
      );
      if (!restoreSeq.isCurrent(token)) return;
      if (!data?.exists) {
        setHasSidecar(false);
        return;
      }
      const poses: Record<number, PoseSummary[]> = {};
      const overlay: Record<number, SteppedDetection | null> = {};
      const fidMap: Record<number, FiducialSet> = {};
      const lvlMap: Record<number, Level> = {};
      const poseMap: Record<number, Record<number, string>> = {};
      const clicks = (data.clicks || {}) as Record<string, {
        fiducials?: Record<string, [number, number]>;
        clicked_level?: string;
        pose_levels?: Record<string, string>;
      }>;
      for (const cam of pair) {
        poses[cam] = (data.poses?.[String(cam)] || []) as PoseSummary[];
        const datumDet = data.datum_detection?.[String(cam)];
        overlay[cam] = datumDet?.ok ? (datumDet as SteppedDetection) : null;
        const c = clicks[String(cam)];
        if (!c) continue;
        if (c.fiducials) {
          fidMap[cam] = {
            origin: c.fiducials.origin ?? null,
            x_axis: c.fiducials.x_axis ?? null,
            y_axis: c.fiducials.y_axis ?? null,
          };
        }
        if (c.clicked_level === 'peak' || c.clicked_level === 'trough') lvlMap[cam] = c.clicked_level;
        if (c.pose_levels) {
          const inner: Record<number, string> = {};
          for (const [k, v] of Object.entries(c.pose_levels)) inner[Number(k)] = String(v);
          poseMap[cam] = inner;
        }
      }
      setHasSidecar(true);
      setSequenceId(data.sequence_id ?? null);
      setDetectionStamp(data.detection_stamp ?? null);
      setSequencePosesMap(poses);
      setDetectionDataMap(overlay);
      setFiducialsMap(fidMap);
      setClickedLevelMap(lvlMap);
      setPoseLevelsMap(poseMap);
      if (isStereoConfig(data.stereo_config)) setStereoConfig(data.stereo_config);
      setClicksSaveError(null);
      setClicksDirty(false);
      setSequenceStatus('ready');
    } catch (e) {
      if (!restoreSeq.isCurrent(token)) return;
      setHasSidecar(false);
      setSequenceError(`Failed to restore the saved detection sequence: ${errorMessage(e)}`);
    }
  }, [restoreSeq, cam1, cam2, sourcePathIdx]);

  // Source / pair / path change: drop every per-source value, then read the new sidecar.
  useEffect(() => {
    if (!configLoaded) return;
    resetSourceState();
    void restoreSequence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, sourceEpoch]);

  // ---------- Persist user picks to the sidecar (debounced, flushed on unmount) ----------
  const clickSaveRef = useRef<{ timer: ReturnType<typeof setTimeout>; run: () => void } | null>(null);
  useEffect(() => {
    if (!clicksDirty || !sequenceId || clicksSaveError) return;
    const pair = [cam1, cam2];
    const cameras: Record<string, unknown> = {};
    for (const cam of pair) {
      const f = fiducials[cam];
      cameras[String(cam)] = {
        fiducials: f ? { origin: f.origin, x_axis: f.x_axis, y_axis: f.y_axis } : {},
        clicked_level: clickedLevel[cam] ?? null,
        pose_levels: poseLevels[cam] ?? {},
      };
    }
    const body = {
      camera_pair: pair, source_path_idx: sourcePathIdx, cameras,
      stereo_config: stereoConfig, detection_stamp: detectionStamp,
    };
    const run = () => {
      clickSaveRef.current = null;
      postJson('/backend/calibration/stepped/inputs/save', body)
        .then(res => {
          if (res?.stale || res?.saved === false) {
            setClicksSaveError(res.error || 'Clicks not saved: the saved detections changed. Restore or re-detect.');
          } else {
            setClicksDirty(false);
          }
        })
        .catch(e => setClicksSaveError(`Clicks not saved: ${errorMessage(e)}`));
    };
    if (clickSaveRef.current) clearTimeout(clickSaveRef.current.timer);
    clickSaveRef.current = { timer: setTimeout(run, CLICK_SAVE_DEBOUNCE_MS), run };
  }, [clicksDirty, sequenceId, clicksSaveError, fiducials, clickedLevel, poseLevels, stereoConfig,
      detectionStamp, cam1, cam2, sourcePathIdx]);

  // A pending click save belongs to the source it was made on: flush it before a source
  // change resets the state, and on unmount.
  useEffect(() => () => {
    const pending = clickSaveRef.current;
    if (pending) { clearTimeout(pending.timer); pending.run(); }
  }, [sourceEpoch]);

  useEffect(() => () => stopPolls(), [stopPolls]);

  // ---------- Per-pose detection fetch (overlay on frame change) ----------
  const fetchPoseDetection = useCallback(async (cam: number, frameIdx: number) => {
    if (!sequenceId) return;
    const issuedFor = sequenceId;
    try {
      const data = await fetchJson<SteppedDetection>(
        `/backend/calibration/stepped/sequence_pose_detection?sequence_id=${sequenceId}&camera=${cam}&frame_idx=${frameIdx}`,
      );
      if (sequenceIdRef.current !== issuedFor) return;
      if (data.ok) setDetectionDataFor(cam, data);
    } catch (e) {
      if (sequenceIdRef.current !== issuedFor) return;
      setSequenceError(`Failed to fetch the detection for Cam ${cam} frame ${frameIdx}: ${errorMessage(e)}`);
    }
  }, [sequenceId]);

  // ---------- Identify which level a clicked dot belongs to ----------
  const identifyPoseLevel = useCallback(async (
    cam: number, frameIdx: number, clickX: number, clickY: number,
  ): Promise<string | null> => {
    if (!sequenceId) return null;
    const datumLabel = clickedLevel[cam];
    if (!datumLabel) {
      setSequenceError(`Select the clicked level for Cam ${cam} before verifying poses.`);
      return null;
    }
    const issuedFor = sequenceId;
    try {
      const data = await postJson('/backend/calibration/stepped/identify_pose_level', {
        sequence_id: sequenceId, camera: cam, frame_idx: frameIdx, click_x: clickX, click_y: clickY,
      });
      if (sequenceIdRef.current !== issuedFor || !data.level) return null;
      return data.level === 'A' ? datumLabel : flipLevel(datumLabel);
    } catch (e) {
      if (sequenceIdRef.current !== issuedFor) return null;
      setSequenceError(`Failed to identify the level: ${errorMessage(e)}`);
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

  // ---------- Model + validation in the card's shapes ----------
  const stereoModel: StereoModel | null = useMemo(() => {
    const d = core.modelData;
    if (!d) return null;
    return {
      cam1: Number(d.cam1),
      cam2: Number(d.cam2),
      model_type: d.model_type === 'polynomial3d' ? 'polynomial3d' : 'pinhole',
      rms_cam1: d.rms_cam1,
      rms_cam2: d.rms_cam2,
      intrinsics1: d.intrinsics1,
      intrinsics2: d.intrinsics2,
      num_pairs_used: d.num_pairs_used,
      per_view_rms1: d.per_view_rms1,
      per_view_rms2: d.per_view_rms2,
      plane_rms_cam1: d.plane_rms_cam1,
      plane_rms_cam2: d.plane_rms_cam2,
      world_frame_mode: d.world_frame_mode,
      relative_angle_deg: d.stereo_angle_deg ?? null,
      baseline_mm: d.baseline_mm ?? null,
      model_path: d.model_path,
      method: d.method,
      stereo_config: d.stereo_config ?? resolvedStereoConfig ?? undefined,
    };
  }, [core.modelData, resolvedStereoConfig]);

  const validation: StereoValidation | null = core.validation
    ? { cam1: core.validation.cameras[cam1] ?? null, cam2: core.validation.cameras[cam2] ?? null, valid: core.validation.valid }
    : null;

  return {
    ...core,
    validation,
    modelLoadError: core.loadError,
    // Board geometry + selections
    dotSpacingMm, setDotSpacingMm, stepHeightMm, setStepHeightMm, boardThicknessMm, setBoardThicknessMm,
    stereoConfig, setStereoConfig, modelType, setModelType,
    fixK2, setFixK2, showFixK2: frameCount != null && frameCount < 3 && modelType === 'pinhole',
    // Sequence state
    sequenceId, sequenceStatus, sequencePoses, sequenceError, detectionProgress, clicksSaveError,
    // Per-camera fiducials + levels
    fiducials, clickedLevel, setClickedLevel: setClickedLevelFor, poseLevels, setPoseLevel: setPoseLevelFor,
    // Stereo fit + model
    fitJobStatus, stereoModel, hasSidecar,
    isGenerating: fitJobStatus?.status === 'running' || fitJobStatus?.status === 'starting',
    // Reconstruct
    reconstructJobStatus: core.applyJob, isReconstructing: core.applyRunning, reconstructVectors: core.startApply,
    // Actions
    detect, snapFiducial, generateModel, restoreSequence, fetchPoseDetection, identifyPoseLevel,
    // Overlay helpers
    getDetectionOverlayPoints, getDetectionOverlayLines,
    sourcePaths,
  };
}
