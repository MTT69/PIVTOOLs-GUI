import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Detection data for a single stereo ChArUco frame (on-demand overlay).
 */
export interface StereoCharucoFrameDetection {
  grid_points: [number, number][];
  grid_indices?: [number, number][];
  corner_ids?: number[];
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
 * Stereo ChArUco model shaped for the results card. calibration fits each camera
 * as DaVis pinhole and derives the pose (no rectification/essential matrices).
 */
export interface StereoCharucoModel {
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

export interface StereoValidationResult {
  valid: boolean;
  cam1: CameraValidationResult;
  cam2: CameraValidationResult;
  matching_count: number | 'container';
  container_format?: boolean;
  error?: string;
}

export interface StereoCharucoJobStatus {
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

export interface StereoCharucoReconstructJobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  processed_frames: number;
  successful_frames: number;
  total_frames: number;
  error?: string;
}

// Available ArUco dictionaries
export const ARUCO_DICTS = [
  "DICT_4X4_50",
  "DICT_4X4_100",
  "DICT_4X4_250",
  "DICT_4X4_1000",
  "DICT_5X5_50",
  "DICT_5X5_100",
  "DICT_5X5_250",
  "DICT_5X5_1000",
  "DICT_6X6_50",
  "DICT_6X6_100",
  "DICT_6X6_250",
  "DICT_6X6_1000",
];

const BOARD = 'charuco';

/** Parse a numeric form field; null when empty/invalid (the field is unset). */
const numOrNull = (s: string): number | null => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

/**
 * Stereo ChArUco calibration on the calibration (pinhole, no-coordinate-flip)
 * backend. Mirrors `useStereoCalibration`: synchronous generate, two-camera
 * validate, on-demand overlay, world frame on camera 1. Board params persist to
 * the SHARED `methods.charuco` block of the per-source settings sidecar.
 */
export function useStereoCharucoCalibration(
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

  // Board params (persist to the settings sidecar) — strings for inputs; board
  // geometry (squares/size) and dt have NO default: empty = unset, fail loud.
  const [squaresH, setSquaresH] = useState<string>('');
  const [squaresV, setSquaresV] = useState<string>('');
  const [squareSize, setSquareSize] = useState<string>('');  // meters
  const [markerRatio, setMarkerRatio] = useState<string>('');
  const [arucoDict, setArucoDict] = useState<string>("DICT_4X4_1000");
  const [minCorners, setMinCorners] = useState<string>('');
  const [dt, setDt] = useState<string>('');
  const [interpolator, setInterpolator] = useState<'cubic' | 'lanczos'>('lanczos');
  const [datumFrame, setDatumFrame] = useState(1);
  // PIV result type the apply step targets (rig.piv_type, shared across tabs).
  const [pivType, setPivType] = useState<'instantaneous' | 'ensemble'>('instantaneous');

  // Validation
  const [validation, setValidation] = useState<StereoValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Synchronous generate status (v1 shape)
  const [jobStatus, setJobStatus] = useState<StereoCharucoJobStatus | null>(null);

  // Apply (reconstruct) job tracking
  const [reconstructJobId, setReconstructJobId] = useState<string | null>(null);
  const [reconstructJobStatus, setReconstructJobStatus] = useState<StereoCharucoReconstructJobStatus | null>(null);

  // Model + on-demand detections (overlay)
  const [stereoModel, setStereoModel] = useState<StereoCharucoModel | null>(null);
  const [loadedWorldFrame, setLoadedWorldFrame] = useState<any>(null);
  const [detectionsCam1, setDetectionsCam1] = useState<Record<string, StereoCharucoFrameDetection>>({});
  const [detectionsCam2, setDetectionsCam2] = useState<Record<string, StereoCharucoFrameDetection>>({});
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

  // Request-level board params: only fields the user has actually set. Empty
  // fields are OMITTED so the backend falls through to the sidecar value, and a
  // missing value everywhere raises the actionable geometry error.
  const boardParams = useCallback(() => {
    const p: Record<string, unknown> = {};
    const sh = numOrNull(squaresH); if (sh != null) p.squares_h = sh;
    const sv = numOrNull(squaresV); if (sv != null) p.squares_v = sv;
    const ss = numOrNull(squareSize); if (ss != null) p.square_size = ss;
    const mr = numOrNull(markerRatio); if (mr != null) p.marker_ratio = mr;
    if (arucoDict) p.aruco_dict = arucoDict;
    const mc = numOrNull(minCorners); if (mc != null) p.min_corners = mc;
    return p;
  }, [squaresH, squaresV, squareSize, markerRatio, arucoDict, minCorners]);

  const frameTotal = useCallback(() => parseInt(numImages) || 10, [numImages]);

  // Validate one camera via calibration (all formats).
  const validateOne = useCallback(async (cam: number): Promise<CameraValidationResult> => {
    const res = await fetch('/backend/calibration/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera: cam, source_path_idx: sourcePathIdx,
        image_format: imageFormat, image_type: imageType, frame_total: frameTotal(),
      }),
    });
    return res.json();
  }, [sourcePathIdx, imageFormat, imageType, frameTotal]);

  const validateImages = useCallback(async () => {
    setValidating(true);
    try {
      const [v1, v2] = await Promise.all([validateOne(cam1), validateOne(cam2)]);
      const count = (v: CameraValidationResult) =>
        v.found_count === 'container' ? Infinity : Number(v.found_count) || 0;
      const matching = v1.found_count === 'container' || v2.found_count === 'container'
        ? 'container'
        : Math.min(count(v1), count(v2));
      setValidation({
        valid: !!(v1.valid && v2.valid),
        cam1: v1, cam2: v2,
        matching_count: matching as number | 'container',
        error: v1.error || v2.error,
      });
    } catch (e) {
      const err: CameraValidationResult = { valid: false, found_count: 0, error: String(e) };
      setValidation({ valid: false, cam1: err, cam2: err, matching_count: 0, error: String(e) });
    } finally {
      setValidating(false);
    }
  }, [cam1, cam2, validateOne]);

  // Hydrate the form from a loaded (or server-seeded) settings dict. Every field
  // is present in the response (template + seed) — no frontend fallback defaults.
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
    const ch = s.methods?.charuco || {};
    setSquaresH(ch.squares_h == null ? '' : String(ch.squares_h));
    setSquaresV(ch.squares_v == null ? '' : String(ch.squares_v));
    setSquareSize(ch.square_size == null ? '' : String(ch.square_size));
    setMarkerRatio(ch.marker_ratio == null ? '' : String(ch.marker_ratio));
    if (ch.aruco_dict) setArucoDict(ch.aruco_dict);
    setMinCorners(ch.min_corners == null ? '' : String(ch.min_corners));
  }, []);

  // Fetch the per-source settings sidecar (server seeds when absent; GET never
  // writes) and hydrate the form.
  const loadSettings = useCallback(async (idx: number) => {
    settingsReadyRef.current = false;
    const seq = ++settingsSeqRef.current;
    try {
      const res = await fetch(`/backend/calibration/settings?source_path_idx=${idx}`);
      const data = await res.json();
      if (seq !== settingsSeqRef.current) return;  // superseded by a newer load
      if (!res.ok || !data.settings) {
        // Guard stays CLOSED: the form still holds another source's values and
        // an open guard would let the debounced save write them into THIS
        // source's sidecar. Surface the failure instead of console-only.
        setDetectError(`Failed to load calibration settings: ${data.error ?? res.status}`);
        return;
      }
      applySettings(data.settings);
      // A save scheduled before/during hydration captured the OLD form —
      // cancel it; the hydrated state commit reschedules a fresh one.
      if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
      settingsReadyRef.current = true;
    } catch (e) {
      if (seq !== settingsSeqRef.current) return;
      setDetectError(`Failed to load calibration settings: ${String(e)}`);
    }
  }, [applySettings]);

  // Load the source list (config pointer) + the initial source's settings on mount,
  // then validate.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/backend/config');
        if (res.ok) {
          const cal = (await res.json()).calibration || {};
          if (cal.calibration_sources !== undefined) setCalibrationSources(cal.calibration_sources);
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
      await loadSettings(0);
      configLoadedRef.current = true;
      setConfigLoaded(true);
      validateImages();
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
        await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calibration: { calibration_sources: calibrationSources, active: 'stereo_charuco' },
          }),
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
          await fetch('/backend/calibration/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
                  charuco: {
                    squares_h: numOrNull(squaresH),
                    squares_v: numOrNull(squaresV),
                    square_size: numOrNull(squareSize),
                    marker_ratio: numOrNull(markerRatio),
                    aruco_dict: arucoDict,
                    min_corners: numOrNull(minCorners),
                  },
                },
              },
            }),
          });
        } catch (e) {
          console.error('Failed to save calibration settings:', e);
        }
      }
      if (pathEdited) {
        // In-place edit of the current source path: clear the stale model/overlay
        // and rehydrate model + settings from the new directory.
        loadedSourcePathRef.current = currentPath;
        setStereoModel(null);
        setDetectionsCam1({});
        setDetectionsCam2({});
        loadModelRef.current?.();
        loadSettings(sourcePathIdx);
      }
      validateImages();
    }, 500);
  }, [imageFormat, imageType, frameTotal, calibrationSources, useCameraSubfolders, cameraSubfolders,
      dt, datumFrame, interpolator, pivType, squaresH, squaresV, squareSize, markerRatio, arucoDict,
      minCorners, cam1, cam2, sourcePathIdx, loadSettings, validateImages]);

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

  const toStereoModel = (d: any): StereoCharucoModel => ({
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
      const res = await fetch('/backend/calibration/generate_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stereo: true, camera_pair: [cam1, cam2], source_path_idx: sourcePathIdx, board: BOARD,
          board_params: boardParams(), datum_frame: datumFrame, frame_total: frameTotal(),
          image_format: imageFormat, image_type: imageType,
          // Generate stamps dt into the model record; empty is omitted so the
          // backend falls to the saved rig.dt or fails loudly (never a default).
          ...(numOrNull(dt) != null ? { dt: numOrNull(dt) } : {}),
          clicks: clicks || undefined,
          force_redetect: opts?.forceRedetect || undefined,
        }),
      });
      const data = await res.json();
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
      setJobStatus({ status: 'failed', progress: 0, processed_pairs: 0, valid_pairs: 0, total_pairs: 0, error: String(e) });
    }
  }, [cam1, cam2, sourcePathIdx, boardParams, datumFrame, frameTotal, imageFormat, imageType, dt]);

  // Load the saved stereo model for the current pair (auto-called on mount/view change).
  const loadModel = useCallback(async () => {
    setModelLoading(true);
    try {
      const res = await fetch(`/backend/calibration/model?stereo=1&board=${BOARD}&camera_pair=${cam1},${cam2}&source_path_idx=${sourcePathIdx}`);
      const data = await res.json();
      if (res.ok && data.exists) {
        setStereoModel(toStereoModel(data));
        setLoadedWorldFrame(data.world_frame ?? null);
        // Seed geometry from the model (self-describing sidecar) rather than config.
        const geo = data.geometry;
        if (geo) {
          if (geo.squares_h !== undefined) setSquaresH(String(geo.squares_h));
          if (geo.squares_v !== undefined) setSquaresV(String(geo.squares_v));
          if (geo.square_size_m !== undefined) setSquareSize(String(geo.square_size_m));
          if (geo.marker_ratio !== undefined) setMarkerRatio(String(geo.marker_ratio));
          if (geo.aruco_dict) setArucoDict(geo.aruco_dict);
          if (geo.min_corners !== undefined) setMinCorners(String(geo.min_corners));
        }
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

  // On-demand board detection for the overlay on a given frame of a camera.
  const detectFrame = useCallback(async (frame: number, cam: number) => {
    try {
      const res = await fetch('/backend/calibration/detect_frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera: cam, source_path_idx: sourcePathIdx, frame, board: BOARD,
          board_params: boardParams(), image_format: imageFormat, image_type: imageType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const entry = { grid_points: data.image_points, grid_indices: data.grid_indices };
        const setter = cam === cam1 ? setDetectionsCam1 : setDetectionsCam2;
        setter(prev => ({ ...prev, [frame]: entry }));
        setDetectError(null);
      } else {
        setDetectError(data.error || `No board detected on Cam${cam} frame ${frame}`);
      }
    } catch (e) {
      setDetectError(`Detection failed on Cam${cam} frame ${frame}: ${String(e)}`);
    }
  }, [cam1, sourcePathIdx, boardParams, imageFormat, imageType]);

  // Detect every calibration view for BOTH cameras (stereo is pinhole-only, so "Detect
  // Markers" always shows the full set). One `detecting` flag spans both cameras so the
  // button can't re-enable mid-sequence. Replaces each cam's detections map.
  const detectAllViews = useCallback(async () => {
    setDetecting(true);
    const errs: string[] = [];
    try {
      for (const cam of [cam1, cam2]) {
        try {
          const res = await fetch('/backend/calibration/detect_views', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              camera: cam, source_path_idx: sourcePathIdx, board: BOARD,
              board_params: boardParams(), image_format: imageFormat, image_type: imageType,
              frame_total: frameTotal(),
            }),
          });
          const data = await res.json();
          if (data.success) {
            const next: Record<string, StereoCharucoFrameDetection> = {};
            for (const [f, v] of Object.entries(data.frames as Record<string, any>)) {
              next[Number(f)] = { grid_points: v.image_points, grid_indices: v.grid_indices };
            }
            (cam === cam1 ? setDetectionsCam1 : setDetectionsCam2)(next);
            if (data.n_detected === 0) errs.push(`No board detected on Cam${cam}`);
          } else {
            errs.push(`Cam${cam}: ${data.error || 'detection failed'}`);
          }
        } catch (e) {
          errs.push(`Cam${cam}: ${String(e)}`);
        }
      }
      setDetectError(errs.length ? errs.join('; ') : null);
    } finally {
      setDetecting(false);
    }
  }, [cam1, cam2, sourcePathIdx, boardParams, imageFormat, imageType, frameTotal]);

  // Apply the stereo calibration to PIV vectors over selected base paths (Phase D backend).
  const reconstructVectors = useCallback(async (
    typeName: string = 'instantaneous',
    activePaths?: number[],
  ) => {
    setReconstructJobStatus({ status: 'starting', progress: 0, processed_frames: 0, successful_frames: 0, total_frames: 0 });
    try {
      const res = await fetch('/backend/calibration/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stereo: true, board: BOARD, source_path_idx: sourcePathIdx,
          camera_pair: [cam1, cam2], type_name: typeName, interpolator,
          // Empty dt is omitted: apply falls back to the model-stamped dt.
          ...(numOrNull(dt) != null ? { dt: numOrNull(dt) } : {}),
          // Omit active_paths → backend applies to all configured base paths.
          ...(activePaths ? { active_paths: activePaths } : {}),
        }),
      });
      const data = await res.json();
      if (data.job_id) setReconstructJobId(data.job_id);
      else setReconstructJobStatus({ status: 'failed', progress: 0, processed_frames: 0, successful_frames: 0, total_frames: 0, error: data.error });
    } catch (e) {
      setReconstructJobStatus({ status: 'failed', progress: 0, processed_frames: 0, successful_frames: 0, total_frames: 0, error: String(e) });
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
        const res = await fetch(`/backend/calibration/apply/status/${reconstructJobId}`);
        const data = await res.json();
        if (res.ok) {
          setReconstructJobStatus({
            status: data.status, progress: data.progress ?? 0,
            processed_frames: data.processed ?? 0, successful_frames: data.processed ?? 0,
            total_frames: data.total ?? 0, error: data.error,
          });
          if (data.status === 'completed' || data.status === 'failed') {
            if (reconstructPollRef.current) { clearInterval(reconstructPollRef.current); reconstructPollRef.current = null; }
          }
        }
      } catch (e) {
        // best-effort polling
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
    squaresH, setSquaresH, squaresV, setSquaresV, squareSize, setSquareSize,
    markerRatio, setMarkerRatio, arucoDict, setArucoDict, minCorners, setMinCorners,
    dt, setDt, datumFrame, setDatumFrame,
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
