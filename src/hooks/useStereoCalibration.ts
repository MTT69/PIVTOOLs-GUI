import { useState, useEffect, useRef, useCallback } from 'react';
import { ApplyJobStatus, readApplyJobStatus } from '@/lib/applyJob';
import { fetchJson, postJson, errorMessage } from '@/lib/api';
import { clearCalibrationFrameCache, warmCalibrationFrameCache, stereoViewerRefreshKey } from '@/hooks/useCalibrationImageViewer';

/**
 * Detection data for a single stereo frame (on-demand overlay).
 */
export interface StereoFrameDetection {
  grid_points: [number, number][];
  grid_indices?: [number, number][];
}

/** Per-camera pinhole intrinsics (from calibration stereo enrichment). */
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
 * Stereo camera model shaped for the results card. calibration stereo fits each
 * camera as DaVis-matching pinhole and derives the pose; it does NOT emit
 * rectification/essential/fundamental matrices, so the card shows the two
 * pinhole models + relative pose (angle / baseline).
 */
export interface StereoModel {
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

/** World-frame clicks (image-down pixels) defining origin/+X/+Y on camera 1. */
export interface WorldFrameClicks {
  origin: [number, number];
  x_axis: [number, number];
  y_axis: [number, number];
  origin_mm: [number, number];
}

/**
 * Single-camera validation result (calibration /validate shape).
 */
export interface CameraValidationResult {
  valid: boolean;
  found_count: number | 'container';
  expected_count?: number;
  sample_files?: string[];
  first_image_preview?: string;
  image_size?: [number, number];
  camera_path?: string;
  format_detected?: string;
  container_format?: boolean;
  suggested_pattern?: string;
  suggested_subfolder?: string;
  error?: string;
}

/**
 * Combined stereo validation result (cam1 + cam2 validated separately).
 */
export interface StereoValidationResult {
  valid: boolean;
  cam1: CameraValidationResult;
  cam2: CameraValidationResult;
  matching_count: number | 'container';
  container_format?: boolean;
  error?: string;
}

/**
 * Synchronous-generate status, kept in the v1 `StereoJobStatus` shape so the
 * existing progress/result JSX renders unchanged.
 */
export interface StereoJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  stage?: string;
  processed_pairs: number;
  valid_pairs: number;
  total_pairs: number;
  error?: string;
  stereo_rms_error?: number;
  cam1_rms_error?: number;
  cam2_rms_error?: number;
  num_pairs_used?: number;
  relative_angle_deg?: number;
}

const BOARD = 'dotboard';

/**
 * The per-source settings sidecar shape, as returned by GET
 * `/calibration/settings` and consumed by `applySettings`. Only the fields
 * `validateImages`/`validateOne` read are typed; the rest hydrate through
 * `applySettings`. (Local per hook — the five calibration hooks are
 * deliberate clones.)
 */
interface SidecarSettings {
  image?: {
    image_format?: string;
    image_type?: string;
    n_views?: number | null;
  };
  rig?: {
    camera_pair?: [number, number];
  };
}

/** Parse a numeric form field; null when empty/invalid (the field is unset). */
const numOrNull = (s: string): number | null => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

/**
 * Stereo dotboard calibration on the calibration (pinhole, no-coordinate-flip)
 * backend. Mirrors `useDotboardCalibration` (synchronous generate, on-demand
 * overlay, settings-sidecar persistence) for two cameras: each is fitted as
 * DaVis pinhole and the relative pose derived. The world frame is defined on
 * camera 1 only (clicks). Board geometry lives in the SHARED `methods.dotboard`
 * block (one physical board, mono + stereo).
 */
export function useStereoCalibration(
  cameraOptions: number[],
  sourcePaths: string[],
) {
  // Source selection
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [cam1, setCam1] = useState(1);
  const [cam2, setCam2] = useState(2);
  const [activeCam, setActiveCam] = useState<number>(1);

  // Image config (persists to the per-source settings sidecar; initial values are
  // pre-hydration placeholders only — the server-seeded GET is authoritative)
  const [imageFormat, setImageFormat] = useState('');
  const [imageType, setImageType] = useState('standard');
  // '' = unset: n_views is optional (backend frame-count auto-detect); the
  // frameTotal() 10-fallback is UI-only and never persisted.
  const [numImages, setNumImages] = useState<string>('');
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);

  // Board params + rig (persist to the settings sidecar). dt and dot spacing are
  // strings with NO default — empty means unset and generate fails loudly.
  const [dotSpacingMm, setDotSpacingMm] = useState<string>('');
  const [dt, setDt] = useState<string>('');
  const [interpolator, setInterpolator] = useState<'cubic' | 'lanczos'>('lanczos');
  const [datumFrame, setDatumFrame] = useState(1);
  // Fix radial k2 = 0 for few-view (<3 frame) fits, where k2 is unconstrained and
  // runs away (degenerate focal/angle). Defaults ON; only sent when <3 frames.
  // Context-dependent, so it is NOT templated server-side — hydrated only when a
  // stored value exists, and pinned on the first save.
  const [fixK2, setFixK2] = useState(true);
  // PIV result type the apply step targets (rig.piv_type, shared across tabs).
  const [pivType, setPivType] = useState<'instantaneous' | 'ensemble'>('instantaneous');

  // Validation
  const [validation, setValidation] = useState<StereoValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Synchronous generate status (v1 shape)
  const [jobStatus, setJobStatus] = useState<StereoJobStatus | null>(null);

  // Apply (reconstruct) job tracking
  const [reconstructJobId, setReconstructJobId] = useState<string | null>(null);
  const [reconstructJobStatus, setReconstructJobStatus] = useState<ApplyJobStatus | null>(null);

  // Model + on-demand detections (overlay)
  const [stereoModel, setStereoModel] = useState<StereoModel | null>(null);
  const [loadedWorldFrame, setLoadedWorldFrame] = useState<any>(null);
  const [detectionsCam1, setDetectionsCam1] = useState<Record<string, StereoFrameDetection>>({});
  const [detectionsCam2, setDetectionsCam2] = useState<Record<string, StereoFrameDetection>>({});
  const [modelLoading, setModelLoading] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

  const configLoadedRef = useRef(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconstructPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The source directory the displayed model/overlay belongs to. Lets saveConfig
  // detect an in-place path edit (same index, new string) and reload after persist.
  const loadedSourcePathRef = useRef<string>('');
  // Latest loadModel — the debounced saveConfig reloads through this ref because
  // loadModel is defined below it (can't be a saveConfig dependency).
  const loadModelRef = useRef<(() => Promise<unknown>) | null>(null);
  // False while the form is (re)hydrating from a source's sidecar. The debounced
  // save must never write the form into a source it wasn't hydrated from.
  const settingsReadyRef = useRef(false);
  // Monotonic settings-load sequence; a stale response must not overwrite a newer load.
  const settingsSeqRef = useRef(0);

  // Request-level board params: an empty field is OMITTED so the backend falls
  // through to the sidecar value (missing everywhere raises the geometry error).
  const boardParams = useCallback(() => {
    const v = numOrNull(dotSpacingMm);
    return v == null ? {} : { dot_spacing_mm: v };
  }, [dotSpacingMm]);
  const frameTotal = useCallback(() => parseInt(numImages) || 10, [numImages]);

  // Validate one camera via calibration (all formats). `fromSettings` carries
  // just-fetched sidecar settings past the stale first-render closure.
  const validateOne = useCallback(async (cam: number, fromSettings?: SidecarSettings): Promise<CameraValidationResult> => {
    return postJson('/backend/calibration/validate', {
      camera: cam, source_path_idx: sourcePathIdx,
      image_format: fromSettings?.image?.image_format ?? imageFormat,
      image_type: fromSettings?.image?.image_type ?? imageType,
      frame_total: fromSettings?.image?.n_views ?? frameTotal(),
    });
  }, [sourcePathIdx, imageFormat, imageType, frameTotal]);

  // Validate both cameras and combine into the stereo shape. On the mount and
  // path-edit call sites the camera-pair state is also pre-hydration, so the
  // pair comes from `fromSettings.rig.camera_pair` when supplied.
  const validateImages = useCallback(async (fromSettings?: SidecarSettings) => {
    setValidating(true);
    try {
      const pair = fromSettings?.rig?.camera_pair;
      const [c1, c2] = Array.isArray(pair) && pair.length >= 2
        ? [Number(pair[0]), Number(pair[1])]
        : [cam1, cam2];
      const [v1, v2] = await Promise.all([validateOne(c1, fromSettings), validateOne(c2, fromSettings)]);
      const count = (v: CameraValidationResult) =>
        v.found_count === 'container' ? Infinity : Number(v.found_count) || 0;
      const matching = v1.found_count === 'container' || v2.found_count === 'container'
        ? 'container'
        : Math.min(count(v1), count(v2));
      const result: StereoValidationResult = {
        valid: !!(v1.valid && v2.valid),
        cam1: v1, cam2: v2,
        matching_count: matching as number | 'container',
        error: v1.error || v2.error,
      };
      setValidation(result);
      if (result.valid) {
        // Fill the shared frame cache for both cameras before the viewer is opened.
        warmCalibrationFrameCache({
          backendUrl: '/backend', cameras: [c1, c2], sourcePathIdx,
          refreshKey: stereoViewerRefreshKey(result),
        });
      }
    } catch (e) {
      const err: CameraValidationResult = { valid: false, found_count: 0, error: errorMessage(e) };
      setValidation({ valid: false, cam1: err, cam2: err, matching_count: 0, error: errorMessage(e) });
    } finally {
      setValidating(false);
    }
  }, [cam1, cam2, validateOne]);

  // Hydrate the form from a loaded (or server-seeded) settings dict. fix_k2 is
  // hydrated only when explicitly stored — its default is contextual (ON here).
  const applySettings = useCallback((s: any) => {
    const img = s.image || {};
    setImageFormat(img.image_format ?? '');
    if (img.image_type) setImageType(img.image_type);
    setNumImages(img.n_views == null ? '' : String(img.n_views));
    setUseCameraSubfolders(Boolean(img.use_camera_subfolders));
    if (Array.isArray(img.camera_subfolders)) setCameraSubfolders(img.camera_subfolders);
    const rig = s.rig || {};
    setDt(rig.dt == null ? '' : String(rig.dt));
    if (rig.datum_frame != null) setDatumFrame(Number(rig.datum_frame));
    if (rig.interpolator === 'cubic' || rig.interpolator === 'lanczos') setInterpolator(rig.interpolator);
    if (rig.piv_type === 'instantaneous' || rig.piv_type === 'ensemble') setPivType(rig.piv_type);
    if (Array.isArray(rig.camera_pair) && rig.camera_pair.length >= 2) {
      setCam1(Number(rig.camera_pair[0]));
      setCam2(Number(rig.camera_pair[1]));
    }
    const dot = s.methods?.dotboard || {};
    setDotSpacingMm(dot.dot_spacing_mm == null ? '' : String(dot.dot_spacing_mm));
    if (dot.fix_k2 !== undefined && dot.fix_k2 !== null) setFixK2(Boolean(dot.fix_k2));
  }, []);

  // Fetch the per-source settings sidecar (server seeds when absent; GET never
  // writes) and hydrate the form. Returns the fetched settings so callers can
  // validate against them immediately (setState from applySettings has not
  // committed yet in this closure); null on any failure.
  const loadSettings = useCallback(async (idx: number): Promise<SidecarSettings | null> => {
    settingsReadyRef.current = false;
    const seq = ++settingsSeqRef.current;
    try {
      const data = await fetchJson(`/backend/calibration/settings?source_path_idx=${idx}`);
      if (seq !== settingsSeqRef.current) return null;  // superseded by a newer load
      if (!data.settings) {
        // Guard stays CLOSED: the form still holds another source's values and
        // an open guard would let the debounced save write them into THIS
        // source's sidecar. Surface the failure instead of console-only.
        setDetectError(`Failed to load calibration settings: ${data.error ?? 'no settings in response'}`);
        return null;
      }
      applySettings(data.settings);
      // A save scheduled before/during hydration captured the OLD form —
      // cancel it; the hydrated state commit reschedules a fresh one.
      if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
      settingsReadyRef.current = true;
      return data.settings as SidecarSettings;
    } catch (e) {
      if (seq !== settingsSeqRef.current) return null;
      setDetectError(`Failed to load calibration settings: ${errorMessage(e)}`);
      return null;
    }
  }, [applySettings]);

  // Load the source list (config pointer) + the initial source's settings on mount,
  // then validate.
  useEffect(() => {
    const load = async () => {
      try {
        const cal = (await fetchJson('/backend/config')).calibration || {};
        if (cal.calibration_sources !== undefined) setCalibrationSources(cal.calibration_sources);
      } catch (e) {
        console.error('Failed to load config:', e);
      }
      const s = await loadSettings(0);
      configLoadedRef.current = true;
      setConfigLoaded(true);
      validateImages(s ?? undefined);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rehydrate from the newly selected source's sidecar (settings are per-source).
  useEffect(() => {
    if (!configLoadedRef.current) return;
    loadSettings(sourcePathIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePathIdx]);

  // Persist (debounced): pointer keys to config.yaml, everything else to the
  // per-source settings sidecar. Then validate.
  const saveConfig = useCallback(() => {
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
    configDebounceRef.current = setTimeout(async () => {
      try {
        await postJson('/backend/update_config', {
          calibration: { calibration_sources: calibrationSources, active: 'stereo_dotboard' },
        });
      } catch (e) {
        console.error('Failed to save config:', e);
      }
      const currentPath = calibrationSources[sourcePathIdx] ?? '';
      const pathEdited = configLoadedRef.current && currentPath !== loadedSourcePathRef.current;
      // Sidecars are per-source: never write the form into a source it wasn't
      // hydrated from (mid source-switch or mid path-edit) — rehydrate instead.
      if (!pathEdited && settingsReadyRef.current) {
        try {
          await postJson('/backend/calibration/settings', {
            source_path_idx: sourcePathIdx,
            settings: {
              image: {
                image_format: imageFormat,
                image_type: imageType,
                // null when unset (dt idiom) — never persist the UI fallback
                n_views: numOrNull(numImages) != null ? parseInt(numImages) : null,
                use_camera_subfolders: useCameraSubfolders,
                camera_subfolders: cameraSubfolders,
              },
              rig: {
                camera_pair: [cam1, cam2],
                dt: numOrNull(dt),
                datum_frame: datumFrame,
                interpolator,
                piv_type: pivType,
              },
              methods: {
                dotboard: { dot_spacing_mm: numOrNull(dotSpacingMm), fix_k2: fixK2 },
              },
            },
          });
        } catch (e) {
          console.error('Failed to save calibration settings:', e);
        }
      }
      if (pathEdited) {
        // In-place edit of the current source path: clear the stale model/overlay
        // and rehydrate model + settings from the new directory. Validate with
        // the freshly fetched settings: this closure's state still holds the
        // OLD source's values.
        loadedSourcePathRef.current = currentPath;
        setStereoModel(null);
        setDetectionsCam1({});
        setDetectionsCam2({});
        loadModelRef.current?.();
        const s = await loadSettings(sourcePathIdx);
        validateImages(s ?? undefined);
      } else {
        validateImages();
      }
    }, 500);
  }, [imageFormat, imageType, frameTotal, calibrationSources, useCameraSubfolders, cameraSubfolders,
      dt, datumFrame, interpolator, pivType, dotSpacingMm, fixK2, cam1, cam2, sourcePathIdx,
      loadSettings, validateImages]);

  useEffect(() => {
    if (!configLoadedRef.current) return;
    saveConfig();
  }, [saveConfig]);

  // Clear stale validation/detection errors the instant a validation-relevant input changes,
  // and enter a pending state. Validation is resolved by the backend from the PERSISTED config
  // (by index, not the request), so without this the error from a PREVIOUS source / format /
  // subfolder lingers on screen until the debounced re-validate returns — and `detectError`
  // (only ever touched by a detect call) would otherwise never clear at all.
  useEffect(() => {
    if (!configLoadedRef.current) return;
    setValidating(true);
    // The frame URL carries none of these inputs (the backend reads them from the
    // sidecar), so cached frames keyed on the unchanged camera path would be stale.
    clearCalibrationFrameCache();
    setValidation(v => (v ? {
      ...v,
      valid: false,
      error: undefined,
      cam1: v.cam1 ? { ...v.cam1, valid: false, error: undefined } : v.cam1,
      cam2: v.cam2 ? { ...v.cam2, valid: false, error: undefined } : v.cam2,
    } : v));
    setDetectError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePathIdx, imageFormat, imageType, numImages, cam1, cam2,
      calibrationSources, useCameraSubfolders, cameraSubfolders]);

  // Map a calibration stereo model/generate response to the card shape.
  const toStereoModel = (d: any): StereoModel => ({
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
  });

  // Generate the stereo model (synchronous); optional world-frame clicks on cam1.
  const generateStereoModel = useCallback(async (clicks?: WorldFrameClicks | null, opts?: { forceRedetect?: boolean }) => {
    setJobStatus({ status: 'running', progress: 0, processed_pairs: 0, valid_pairs: 0, total_pairs: frameTotal(), stage: 'calibrating' });
    try {
      const data = await postJson('/backend/calibration/generate_model', {
        stereo: true, camera_pair: [cam1, cam2], source_path_idx: sourcePathIdx, board: BOARD,
        board_params: boardParams(), datum_frame: datumFrame, frame_total: frameTotal(),
        image_format: imageFormat, image_type: imageType,
        fix_k2: fixK2 && frameTotal() < 3,
        // Generate stamps dt into the model record; empty is omitted so the
        // backend falls to the saved rig.dt or fails loudly (never a default).
        ...(numOrNull(dt) != null ? { dt: numOrNull(dt) } : {}),
        clicks: clicks || undefined,
        force_redetect: opts?.forceRedetect || undefined,
      });
      if (data.success) {
        setStereoModel(toStereoModel(data));
        setJobStatus({
          status: 'completed', progress: 100,
          processed_pairs: frameTotal(), valid_pairs: data.num_pairs_used ?? 0, total_pairs: frameTotal(),
          stereo_rms_error: data.rms_cam1, cam1_rms_error: data.rms_cam1, cam2_rms_error: data.rms_cam2,
          num_pairs_used: data.num_pairs_used, relative_angle_deg: data.stereo_angle_deg,
        });
      } else {
        setJobStatus({ status: 'failed', progress: 0, processed_pairs: 0, valid_pairs: 0, total_pairs: 0, error: data.error });
      }
    } catch (e) {
      setJobStatus({ status: 'failed', progress: 0, processed_pairs: 0, valid_pairs: 0, total_pairs: 0, error: errorMessage(e) });
    }
  }, [cam1, cam2, sourcePathIdx, boardParams, datumFrame, frameTotal, imageFormat, imageType, fixK2, dt]);

  // Load the saved stereo model for the current pair (auto-called on mount/view change).
  const loadModel = useCallback(async () => {
    setModelLoading(true);
    try {
      const data = await fetchJson(`/backend/calibration/model?stereo=1&board=${BOARD}&camera_pair=${cam1},${cam2}&source_path_idx=${sourcePathIdx}`);
      if (data.exists) {
        setStereoModel(toStereoModel(data));
        setLoadedWorldFrame(data.world_frame ?? null);
        // Seed geometry from the model (self-describing sidecar) rather than config.
        if (data.geometry?.dot_spacing_mm) setDotSpacingMm(String(data.geometry.dot_spacing_mm));
        return data;
      }
      // Restore any world-frame picks the sidecar kept (inputs.mat) so a deleted model can be
      // regenerated without re-clicking; null when none were stored.
      setStereoModel(null);
      setLoadedWorldFrame(data?.world_frame ?? null);
      return null;
    } catch (e) {
      console.error('Failed to load stereo model:', e);
      return null;
    } finally {
      setModelLoading(false);
    }
  }, [sourcePathIdx, cam1, cam2]);
  loadModelRef.current = loadModel;

  // Auto-load the saved model on mount (once config is loaded) and on pair/source change.
  useEffect(() => {
    if (!configLoaded) return;
    setStereoModel(null);
    setDetectionsCam1({});
    setDetectionsCam2({});
    loadedSourcePathRef.current = calibrationSources[sourcePathIdx] ?? '';
    loadModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, cam1, cam2, sourcePathIdx]);

  // The overlay is only valid for the inputs that produced it: an image format / type or
  // board-geometry edit changes what Detect Dots returns (and its det_key), so the drawn
  // dots go stale the moment the edit lands. Camera / source clears live in the effect above.
  useEffect(() => {
    if (!configLoaded) return;
    setDetectionsCam1({});
    setDetectionsCam2({});
    setDetectError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageFormat, imageType, dotSpacingMm]);

  // On-demand board detection for the overlay on a given frame of the active camera.
  const detectFrame = useCallback(async (frame: number, cam: number) => {
    try {
      const data = await postJson('/backend/calibration/detect_frame', {
        camera: cam, source_path_idx: sourcePathIdx, frame, board: BOARD,
        board_params: boardParams(), image_format: imageFormat, image_type: imageType,
      });
      if (data.success) {
        const entry = { grid_points: data.image_points, grid_indices: data.grid_indices };
        const setter = cam === cam1 ? setDetectionsCam1 : setDetectionsCam2;
        setter(prev => ({ ...prev, [frame]: entry }));
        setDetectError(null);
      } else {
        setDetectError(data.error || `No board detected on Cam${cam} frame ${frame}`);
      }
    } catch (e) {
      setDetectError(`Detection failed on Cam${cam} frame ${frame}: ${errorMessage(e)}`);
    }
  }, [cam1, sourcePathIdx, boardParams, imageFormat, imageType]);

  // Detect every calibration view for BOTH cameras (stereo is pinhole-only, so "Detect
  // Dots" always shows the full set). One `detecting` flag spans both cameras so the
  // button can't re-enable mid-sequence. Replaces each cam's detections map.
  const detectAllViews = useCallback(async () => {
    setDetecting(true);
    // Both overlays clear before the call: the pair is detected and persisted as ONE set
    // (the stereo sidecar holds both cameras under one det_key), so a failure must never
    // leave cam1 fresh and cam2 stale.
    setDetectionsCam1({});
    setDetectionsCam2({});
    try {
      const data = await postJson('/backend/calibration/detect_views', {
        stereo: true, camera_pair: [cam1, cam2], source_path_idx: sourcePathIdx, board: BOARD,
        board_params: boardParams(), image_format: imageFormat, image_type: imageType,
        frame_total: frameTotal(),
      });
      if (data.success) {
        const errs: string[] = [];
        for (const cam of [cam1, cam2]) {
          const mine = data.by_camera[String(cam)];
          const next: Record<string, StereoFrameDetection> = {};
          for (const [f, v] of Object.entries(mine.frames as Record<string, any>)) {
            next[Number(f)] = { grid_points: v.image_points, grid_indices: v.grid_indices };
          }
          (cam === cam1 ? setDetectionsCam1 : setDetectionsCam2)(next);
          if (mine.n_detected === 0) errs.push(`No board detected on Cam${cam}`);
        }
        // The backend wrote the pair into inputs.mat for Generate; say so when it could not.
        if (!data.persisted) errs.push(`Detected, but not saved for Generate: ${data.persist_skipped}`);
        setDetectError(errs.length ? errs.join('; ') : null);
      } else {
        setDetectError(data.error || 'Detection failed');
      }
    } catch (e) {
      setDetectError(`Detection failed: ${errorMessage(e)}`);
    } finally {
      setDetecting(false);
    }
  }, [cam1, cam2, sourcePathIdx, boardParams, imageFormat, imageType, frameTotal]);

  // Apply the stereo calibration to PIV vectors over selected base paths (Phase D backend).
  const reconstructVectors = useCallback(async (
    typeName: string = 'instantaneous',
    activePaths?: number[],
  ) => {
    setReconstructJobStatus({ status: 'starting', progress: 0, processed_units: 0, total_units: 0 });
    try {
      const data = await postJson('/backend/calibration/apply', {
        stereo: true, board: BOARD, source_path_idx: sourcePathIdx,
        camera_pair: [cam1, cam2], type_name: typeName, interpolator,
        // Empty dt is omitted: apply falls back to the model-stamped dt.
        ...(numOrNull(dt) != null ? { dt: numOrNull(dt) } : {}),
        // Omit active_paths → backend applies to all configured base paths.
        ...(activePaths ? { active_paths: activePaths } : {}),
      });
      if (data.job_id) setReconstructJobId(data.job_id);
      else setReconstructJobStatus({ status: 'failed', progress: 0, processed_units: 0, total_units: 0, error: data.error });
    } catch (e) {
      setReconstructJobStatus({ status: 'failed', progress: 0, processed_units: 0, total_units: 0, error: errorMessage(e) });
    }
  }, [sourcePathIdx, cam1, cam2, dt, interpolator]);

  // Poll apply job.
  useEffect(() => {
    if (!reconstructJobId) {
      if (reconstructPollRef.current) { clearInterval(reconstructPollRef.current); reconstructPollRef.current = null; }
      return;
    }
    const poll = async () => {
      try {
        const data = await fetchJson(`/backend/calibration/apply/status/${reconstructJobId}`);
        setReconstructJobStatus(readApplyJobStatus(data));
        if (data.status === 'completed' || data.status === 'failed') {
          if (reconstructPollRef.current) { clearInterval(reconstructPollRef.current); reconstructPollRef.current = null; }
        }
      } catch (e) {
        setReconstructJobStatus({ status: 'failed', progress: 0, processed_units: 0, total_units: 0, error: errorMessage(e) });
        if (reconstructPollRef.current) { clearInterval(reconstructPollRef.current); reconstructPollRef.current = null; }
      }
    };
    poll();
    reconstructPollRef.current = setInterval(poll, 700);
    return () => { if (reconstructPollRef.current) clearInterval(reconstructPollRef.current); };
  }, [reconstructJobId]);

  // Ensure valid camera selections (cam1 and cam2 must differ).
  useEffect(() => {
    if (cameraOptions.length >= 2) {
      if (!cameraOptions.includes(cam1)) setCam1(cameraOptions[0]);
      if (!cameraOptions.includes(cam2)) setCam2(cameraOptions[1]);
      if (cam1 === cam2) {
        const other = cameraOptions.filter(c => c !== cam1);
        if (other.length > 0) setCam2(other[0]);
      }
    }
  }, [cameraOptions, cam1, cam2]);

  // Keep activeCam within the pair.
  useEffect(() => {
    if (activeCam !== cam1 && activeCam !== cam2) setActiveCam(cam1);
  }, [cam1, cam2, activeCam]);

  useEffect(() => () => {
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
    if (reconstructPollRef.current) clearInterval(reconstructPollRef.current);
  }, []);

  return {
    sourcePathIdx, setSourcePathIdx, cam1, setCam1, cam2, setCam2,
    activeCam, setActiveCam,
    imageFormat, setImageFormat, imageType, setImageType, numImages, setNumImages,
    calibrationSources, setCalibrationSources, useCameraSubfolders, setUseCameraSubfolders,
    cameraSubfolders, setCameraSubfolders,
    dotSpacingMm, setDotSpacingMm, dt, setDt, datumFrame, setDatumFrame,
    fixK2, setFixK2, showFixK2: frameTotal() < 3,
    pivType, setPivType,
    validation, validating, validateImages,
    jobStatus, isCalibrating: jobStatus?.status === 'running' || jobStatus?.status === 'starting',
    reconstructJobStatus, isReconstructing: reconstructJobStatus?.status === 'running' || reconstructJobStatus?.status === 'starting',
    stereoModel, detectionsCam1, detectionsCam2, modelLoading, detectError, detecting, hasModel: stereoModel !== null,
    loadedWorldFrame,
    showOverlay, setShowOverlay,
    generateStereoModel, loadModel, reconstructVectors, interpolator, setInterpolator, detectFrame, detectAllViews,
    cameraOptions, sourcePaths,
  };
}
