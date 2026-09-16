import { useState, useEffect, useRef, useCallback } from 'react';
import { ApplyJobStatus, readApplyJobStatus } from '@/lib/applyJob';
import { fetchJson, postJson, errorMessage } from '@/lib/api';
import { clearCalibrationFrameCache, warmCalibrationFrameCache, calibrationViewerRefreshKey } from '@/hooks/useCalibrationImageViewer';

/**
 * Detection data for a single frame (on-demand overlay).
 */
export interface FrameDetection {
  grid_points: [number, number][];
  grid_indices?: [number, number][];
  corner_ids?: number[];
  reprojection_error?: number;
}

/**
 * Camera model shaped for the v1 results card. `model_type` discriminates the
 * pinhole intrinsics block from the single-plane polynomial coefficient block.
 */
export interface CameraModel {
  model_type?: "pinhole" | "polynomial";
  // Pinhole
  camera_matrix?: number[][];
  dist_coeffs?: number[];
  focal_length?: [number, number];
  principal_point?: [number, number];
  // Polynomial (single-plane image-px -> world-mm map)
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

/** World-frame clicks (image-down pixels) defining origin/+X/+Y. */
export interface WorldFrameClicks {
  origin: [number, number];
  x_axis: [number, number];
  y_axis: [number, number];
  origin_mm: [number, number];
}

/**
 * Validation result (matches the calibration /validate shape).
 */
export interface CharucoValidationResult {
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

/**
 * Synchronous-generate status, kept in the v1 `JobStatus` shape so the existing
 * progress/result JSX renders unchanged.
 */
export interface JobStatus {
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  processed_images: number;
  valid_images: number;
  total_images: number;
  error?: string;
  rms_error?: number;
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
  current_camera?: number;
  processed_images?: number;
  total_images?: number;
  valid_images?: number;
  camera_results?: Record<string, { status: string; rms_error?: number; num_images_used?: number; error?: string; warnings?: string[] }> & {
    global_alignment?: GlobalAlignmentResult;
  };
  elapsed_time?: number;
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

/**
 * The per-source settings sidecar shape, as returned by GET
 * `/calibration/settings` and consumed by `applySettings`. Only the fields
 * `validateImages` reads are typed; the rest hydrate through `applySettings`.
 * (Local per hook — the five calibration hooks are deliberate clones.)
 */
interface SidecarSettings {
  image?: {
    image_format?: string;
    image_type?: string;
    n_views?: number | null;
    use_camera_subfolders?: boolean;
    camera_subfolders?: string[];
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
 * ChArUco calibration on the calibration (pinhole, no-coordinate-flip) backend.
 *
 * Mirrors `useDotboardCalibration`: the calibration `generate_model` is synchronous,
 * so we synthesise the v1 `JobStatus`/`MultiCameraJobStatus` around the awaited call.
 * Only the source list + active method persist to `config.calibration`; image
 * config, rig (dt/datum/piv_type) and board params persist to the per-source
 * settings sidecar via GET/POST `/calibration/settings`. The optional world
 * frame is passed as `clicks`. dt and board geometry have NO frontend defaults.
 */
export function useChArUcoCalibration(
  cameraOptions: number[],
  sourcePaths: string[],
) {
  // Source selection
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState(1);

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
  const [datumFrame, setDatumFrame] = useState<string>("1");
  // Camera-model type: pinhole (3D) or polynomial (single-plane). Planar tabs only.
  const [modelType, setModelType] = useState<'pinhole' | 'polynomial'>('pinhole');
  // PIV result type the apply step targets (rig.piv_type, shared across tabs).
  const [pivType, setPivType] = useState<'instantaneous' | 'ensemble'>('instantaneous');

  // Validation
  const [validation, setValidation] = useState<CharucoValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  // The viewer's cache-key namespace. Built in validateImages so there is ONE
  // construction site shared by the warmup and the viewer (see
  // calibrationViewerRefreshKey); empty until the first validate returns.
  const [viewerRefreshKey, setViewerRefreshKey] = useState('');


  // Synchronous generate status (v1 shape)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [multiCameraJobStatus, setMultiCameraJobStatus] = useState<MultiCameraJobStatus | null>(null);
  const [vectorJobStatus, setVectorJobStatus] = useState<ApplyJobStatus | null>(null);
  const [vectorJobId, setVectorJobId] = useState<string | null>(null);

  // Model + on-demand detections (overlay)
  const [cameraModel, setCameraModel] = useState<CameraModel | null>(null);
  const [loadedWorldFrame, setLoadedWorldFrame] = useState<any>(null);
  const [detections, setDetections] = useState<Record<string, FrameDetection>>({});
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  // Set when the sidecar holds detections made under DIFFERENT settings. A muted
  // hint, not detectError: a stale sidecar on tab open is a normal state, and an
  // amber warning on every open would train the user to ignore that channel.
  const [detectionsStale, setDetectionsStale] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

  const configLoadedRef = useRef(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vectorPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
  const datumFrameNum = useCallback(() => parseInt(datumFrame) || 1, [datumFrame]);

  // Validate the image source via calibration (all formats). `fromSettings`
  // carries just-fetched sidecar settings past the stale first-render closure:
  // the mount and path-edit call sites run before their setState commits, so
  // without it the POST would carry pre-hydration placeholders ('' format)
  // and flash a spurious red "Pattern is empty" failure.
  const validateImages = useCallback(async (fromSettings?: SidecarSettings) => {
    setValidating(true);
    // The effective source identity, carrying `fromSettings` past the stale
    // first-render closure exactly as the validate POST does, so the cache key
    // can never describe a different source than the one just validated.
      const effFormat = fromSettings?.image?.image_format ?? imageFormat;
      const effType = fromSettings?.image?.image_type ?? imageType;
      const effUseSubfolders =
        fromSettings?.image?.use_camera_subfolders ?? useCameraSubfolders;
      const effSubfolders = fromSettings?.image?.camera_subfolders ?? cameraSubfolders;
    try {
      const result: CharucoValidationResult = await postJson('/backend/calibration/validate', {
        camera, source_path_idx: sourcePathIdx,
        image_format: effFormat,
        image_type: effType,
        frame_total: fromSettings?.image?.n_views ?? frameTotal(),
      });
      setValidation(result);
      // Built once, here, and handed to both the warmup and the viewer (via the
      // hook's return) so the two cannot land in different key namespaces.
      const refreshKey = calibrationViewerRefreshKey({
        sourcePath: calibrationSources[sourcePathIdx] ?? '',
        imageFormat: effFormat,
        imageType: effType,
        useCameraSubfolders: effUseSubfolders,
        cameraSubfolders: effSubfolders,
        valid: Boolean(result.valid),
      });
      setViewerRefreshKey(refreshKey);
      if (result.valid) {
        // EVERY camera the tab can show, not just the one on screen, so a camera
        // switch is a cache hit instead of a cold decode.
        warmCalibrationFrameCache({
          backendUrl: '/backend',
          cameras: cameraOptions,
          primaryCamera: camera,
          sourcePathIdx,
          refreshKey,
        });
      }
    } catch (e) {
      setValidation({ valid: false, found_count: 0, error: errorMessage(e) });
    } finally {
      setValidating(false);
    }
  }, [camera, sourcePathIdx, imageFormat, imageType, frameTotal, cameraOptions,
      calibrationSources, useCameraSubfolders, cameraSubfolders]);

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
    if (rig.datum_frame != null) setDatumFrame(String(rig.datum_frame));
    if (rig.piv_type === 'instantaneous' || rig.piv_type === 'ensemble') setPivType(rig.piv_type);
    const ch = s.methods?.charuco || {};
    setSquaresH(ch.squares_h == null ? '' : String(ch.squares_h));
    setSquaresV(ch.squares_v == null ? '' : String(ch.squares_v));
    setSquareSize(ch.square_size == null ? '' : String(ch.square_size));
    setMarkerRatio(ch.marker_ratio == null ? '' : String(ch.marker_ratio));
    if (ch.aruco_dict) setArucoDict(ch.aruco_dict);
    setMinCorners(ch.min_corners == null ? '' : String(ch.min_corners));
    if (ch.model_type === 'pinhole' || ch.model_type === 'polynomial') setModelType(ch.model_type);
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
        setModelLoadError(`Failed to load calibration settings: ${data.error ?? 'no settings in response'}`);
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
      setModelLoadError(`Failed to load calibration settings: ${errorMessage(e)}`);
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
          calibration: { calibration_sources: calibrationSources, active: BOARD },
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
              rig: { camera, dt: numOrNull(dt), datum_frame: datumFrameNum(), piv_type: pivType },
              methods: {
                charuco: {
                  squares_h: numOrNull(squaresH),
                  squares_v: numOrNull(squaresV),
                  square_size: numOrNull(squareSize),
                  marker_ratio: numOrNull(markerRatio),
                  aruco_dict: arucoDict,
                  min_corners: numOrNull(minCorners),
                  model_type: modelType,
                },
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
        setCameraModel(null);
        setDetections({});
        setModelLoadError(null);
        loadModelRef.current?.();
        const s = await loadSettings(sourcePathIdx);
        validateImages(s ?? undefined);
      } else {
        validateImages();
      }
    }, 500);
  }, [imageFormat, imageType, frameTotal, calibrationSources, useCameraSubfolders, cameraSubfolders,
      camera, dt, datumFrameNum, pivType, squaresH, squaresV, squareSize, markerRatio, arucoDict,
      minCorners, modelType, sourcePathIdx, loadSettings, validateImages]);

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
    setValidation(v => (v ? { ...v, valid: false, error: undefined } : v));
    setDetectError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePathIdx, imageFormat, imageType, numImages,
      calibrationSources, useCameraSubfolders, cameraSubfolders]);

  // Map a calibration mono model/generate response to the v1 card shape. The
  // response's `model_type` selects the pinhole or polynomial mapping.
  const toCameraModel = (d: any): CameraModel => {
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
  };

  // RMS for the v1 JobStatus (pinhole: px; polynomial: combined mm).
  const respRms = (d: any): number | undefined =>
    d.model_type === 'polynomial' ? Math.hypot(d.rms_x_mm ?? 0, d.rms_y_mm ?? 0) : d.rms;

  // Generate the model for one camera (synchronous); optional world-frame clicks.
  const generateOne = useCallback(async (cam: number, clicks?: WorldFrameClicks | null) => {
    return postJson('/backend/calibration/generate_model', {
      stereo: false, camera: cam, source_path_idx: sourcePathIdx, board: BOARD,
      model_type: modelType,
      board_params: boardParams(), datum_frame: datumFrameNum(), frame_total: frameTotal(),
      image_format: imageFormat, image_type: imageType,
      // Generate stamps dt into the model record; empty is omitted so the
      // backend falls to the saved rig.dt or fails loudly (never a default).
      ...(numOrNull(dt) != null ? { dt: numOrNull(dt) } : {}),
      clicks: clicks || undefined,
    });
  }, [sourcePathIdx, modelType, boardParams, datumFrameNum, frameTotal, imageFormat, imageType, dt]);

  // Single-camera generate.
  const generateCameraModel = useCallback(async (clicks?: WorldFrameClicks | null) => {
    setJobStatus({ status: 'running', progress: 0, processed_images: 0, valid_images: 0, total_images: frameTotal() });
    try {
      const data = await generateOne(camera, clicks);
      if (data.success) {
        setCameraModel(toCameraModel(data));
        setJobStatus({
          status: 'completed', progress: 100,
          processed_images: frameTotal(), valid_images: data.per_view_rms?.length ?? 0,
          total_images: frameTotal(), rms_error: respRms(data), num_images_used: data.num_images_used,
        });
      } else {
        setJobStatus({ status: 'failed', progress: 0, processed_images: 0, valid_images: 0, total_images: 0, error: data.error });
      }
    } catch (e) {
      setJobStatus({ status: 'failed', progress: 0, processed_images: 0, valid_images: 0, total_images: 0, error: errorMessage(e) });
    }
  }, [camera, frameTotal, generateOne]);

  // All-cameras generate (loops camera_numbers; v1 behaviour).
  const generateCameraModelAll = useCallback(async (clicks?: WorldFrameClicks | null) => {
    const cams = cameraOptions.length ? cameraOptions : [camera];
    const results: Record<string, { status: string; rms_error?: number; num_images_used?: number; error?: string }> = {};
    setMultiCameraJobStatus({ status: 'running', processed_cameras: 0, total_cameras: cams.length });
    for (let i = 0; i < cams.length; i++) {
      const cam = cams[i];
      setMultiCameraJobStatus({ status: 'running', processed_cameras: i, total_cameras: cams.length, current_camera: cam, camera_results: { ...results } });
      try {
        // World frame is defined on camera 1's view; pass clicks only there.
        const data = await generateOne(cam, cam === cams[0] ? clicks : null);
        results[`Camera ${cam}`] = data.success
          ? { status: 'completed', rms_error: respRms(data), num_images_used: data.num_images_used }
          : { status: 'failed', error: data.error };
        if (data.success && cam === camera) setCameraModel(toCameraModel(data));
      } catch (e) {
        results[`Camera ${cam}`] = { status: 'failed', error: errorMessage(e) };
      }
    }
    setMultiCameraJobStatus({ status: 'completed', processed_cameras: cams.length, total_cameras: cams.length, camera_results: results });
  }, [cameraOptions, camera, generateOne]);

  // Load the saved model for the current camera (auto-called on mount/view change).
  const loadModel = useCallback(async () => {
    setModelLoading(true);
    setModelLoadError(null);
    try {
      const data = await fetchJson(`/backend/calibration/model?stereo=0&board=${BOARD}&camera=${camera}&source_path_idx=${sourcePathIdx}`);
      if (data.exists) {
        setCameraModel(toCameraModel(data));
        setLoadedWorldFrame(data.world_frame ?? null);
        // Seed geometry from the model itself (self-describing sidecar) rather than config.
        // Absent on legacy records -> keep current panel values. square_size is metres.
        const geo = data.geometry;
        if (geo) {
          if (geo.squares_h !== undefined) setSquaresH(String(geo.squares_h));
          if (geo.squares_v !== undefined) setSquaresV(String(geo.squares_v));
          if (geo.square_size_m !== undefined) setSquareSize(String(geo.square_size_m));
          if (geo.marker_ratio !== undefined) setMarkerRatio(String(geo.marker_ratio));
          if (geo.aruco_dict) setArucoDict(geo.aruco_dict);
          if (geo.min_corners !== undefined) setMinCorners(String(geo.min_corners));
          if (geo.model_type === 'pinhole' || geo.model_type === 'polynomial') setModelType(geo.model_type);
        }
        return data;
      }
      // No model yet is the normal first-use state — not an error. Restore any world-frame
      // picks the sidecar kept (inputs.mat) so a deleted model can be regenerated without
      // re-clicking; null when none were stored.
      setCameraModel(null);
      setLoadedWorldFrame(data?.world_frame ?? null);
      return null;
    } catch (e) {
      setModelLoadError(`Failed to load model: ${e}`);
      return null;
    } finally {
      setModelLoading(false);
    }
  }, [sourcePathIdx, camera]);
  loadModelRef.current = loadModel;

  // Auto-load the saved model on mount (once config is loaded) and on camera/source change.
  useEffect(() => {
    if (!configLoaded) return;
    setCameraModel(null);
    setDetections({});
    setModelLoadError(null);
    loadedSourcePathRef.current = calibrationSources[sourcePathIdx] ?? '';
    loadModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, camera, sourcePathIdx]);

  // Load the detections already stored in inputs.mat instead of re-detecting.
  // The overlay a tab paints when it opens is a READ: the points were written by
  // the last Detect Dots or solve, and the backend returns them only while its
  // det_key still matches the current board geometry, format and view count.
  const restoreDetections = useCallback(async () => {
    try {
      const data = await postJson('/backend/calibration/restore_detections', {
        camera, source_path_idx: sourcePathIdx, board: BOARD,
        board_params: boardParams(), image_format: imageFormat, image_type: imageType,
        frame_total: frameTotal(),
      });
      if (data.exists && data.fresh) {
        const mine = data.by_camera?.[String(camera)];
        const next: Record<string, FrameDetection> = {};
        for (const [f, v] of Object.entries((mine?.frames ?? {}) as Record<string, any>)) {
          next[Number(f)] = { grid_points: v.image_points, grid_indices: v.grid_indices };
        }
        setDetections(next);
        setDetectionsStale(null);
        return;
      }
      // Stale or absent: blank overlay. Points under a mismatched det_key must
      // never be drawn -- generate_model would refuse to reuse them, so the
      // overlay would misrepresent what Generate is about to solve.
      setDetections({});
      setDetectionsStale(
        data.exists && !data.fresh ? `Saved dots were detected with different settings${data.stored?.n_views ? ` (${data.stored.n_views} views)` : ''}. Press Detect Dots to re-detect.` : null,
      );
    } catch (e) {
      // A probe that fires on every tab open must never surface as an error.
      console.error('restore_detections failed:', e);
      setDetections({});
      setDetectionsStale(null);
    }
  }, [camera, sourcePathIdx, boardParams, imageFormat, imageType, frameTotal]);

  // The overlay is only valid for the inputs that produced it: an image format / type or
  // board-geometry edit changes what Detect Dots returns (and its det_key), so the drawn
  // dots go stale the moment the edit lands. Camera / source clears live in the effect above.
  useEffect(() => {
    if (!configLoaded) return;
    setDetections({});
    setDetectError(null);
    // Debounced: the probe loadmats every stored point set, so without this a
    // keystroke in the geometry field would fire one full sidecar read each.
    const t = setTimeout(() => { void restoreDetections(); }, 400);
    return () => clearTimeout(t);
    // viewerRefreshKey is a dependency on purpose. Every validate rebuilds it with
    // the source PATH folded in, and an in-place edit of the path at the same
    // index changes none of restoreDetections' own inputs -- without this the
    // previous folder's dots stayed drawn on the new folder's images. Keying on
    // the validate result also orders the restore after the debounced config
    // save, which the backend needs because it resolves the source by index.
  }, [configLoaded, restoreDetections, viewerRefreshKey]);

  // On-demand board detection for the overlay on a given frame.
  const detectFrame = useCallback(async (frame: number) => {
    try {
      const data = await postJson('/backend/calibration/detect_frame', {
        camera, source_path_idx: sourcePathIdx, frame, board: BOARD,
        board_params: boardParams(), image_format: imageFormat, image_type: imageType,
      });
      if (data.success) {
        setDetections(prev => ({
          ...prev,
          [frame]: { grid_points: data.image_points, grid_indices: data.grid_indices },
        }));
        setDetectError(null);
      } else {
        setDetectError(data.error || `No board detected on frame ${frame}`);
      }
    } catch (e) {
      setDetectError(`Detection failed on frame ${frame}: ${errorMessage(e)}`);
    }
  }, [camera, sourcePathIdx, boardParams, imageFormat, imageType]);

  // Detect every calibration view in one round-trip (pinhole "Detect Markers" — the
  // overlay then shows the full set the bundle fit uses). Replaces the detections map.
  const detectAllViews = useCallback(async () => {
    setDetecting(true);
    try {
      const data = await postJson('/backend/calibration/detect_views', {
        camera, source_path_idx: sourcePathIdx, board: BOARD,
        board_params: boardParams(), image_format: imageFormat, image_type: imageType,
        frame_total: frameTotal(),
      });
      if (data.success) {
        const mine = data.by_camera[String(camera)];
        const next: Record<string, FrameDetection> = {};
        for (const [f, v] of Object.entries(mine.frames as Record<string, any>)) {
          next[Number(f)] = { grid_points: v.image_points, grid_indices: v.grid_indices };
        }
        setDetections(next);
        // The backend wrote these detections into inputs.mat for Generate; say so when it
        // could not (an unloadable view or a read-only source) -- Generate then re-detects.
        setDetectError(
          mine.n_detected === 0 ? 'No board detected in any view'
          : data.persisted ? null : `Detected, but not saved for Generate: ${data.persist_skipped}`);
      } else {
        setDetectError(data.error || 'Detection failed');
      }
    } catch (e) {
      setDetectError(`Detection failed: ${errorMessage(e)}`);
    } finally {
      setDetecting(false);
    }
  }, [camera, sourcePathIdx, boardParams, imageFormat, imageType, frameTotal]);

  // Apply the calibration to PIV vectors over selected base paths (Phase D backend).
  const calibrateVectors = useCallback(async (
    _forAllCameras: boolean = true,
    typeName: string = 'instantaneous',
    activePaths?: number[],
  ) => {
    setVectorJobStatus({ status: 'starting', progress: 0, processed_units: 0, total_units: 0 });
    try {
      const data = await postJson('/backend/calibration/apply', {
        stereo: false, board: BOARD, source_path_idx: sourcePathIdx,
        type_name: typeName,
        // Empty dt is omitted: apply falls back to the model-stamped dt.
        ...(numOrNull(dt) != null ? { dt: numOrNull(dt) } : {}),
        // Omit active_paths → backend applies to all configured base paths.
        ...(activePaths ? { active_paths: activePaths } : {}),
      });
      if (data.job_id) setVectorJobId(data.job_id);
      else setVectorJobStatus({ status: 'failed', progress: 0, processed_units: 0, total_units: 0, error: data.error });
    } catch (e) {
      setVectorJobStatus({ status: 'failed', progress: 0, processed_units: 0, total_units: 0, error: errorMessage(e) });
    }
  }, [sourcePathIdx, dt]);

  // Poll apply job.
  useEffect(() => {
    if (!vectorJobId) {
      if (vectorPollRef.current) { clearInterval(vectorPollRef.current); vectorPollRef.current = null; }
      return;
    }
    const poll = async () => {
      try {
        const data = await fetchJson(`/backend/calibration/apply/status/${vectorJobId}`);
        setVectorJobStatus(readApplyJobStatus(data));
        if (data.status === 'completed' || data.status === 'failed') {
          if (vectorPollRef.current) { clearInterval(vectorPollRef.current); vectorPollRef.current = null; }
        }
      } catch (e) {
        setVectorJobStatus({ status: 'failed', progress: 0, processed_units: 0, total_units: 0, error: errorMessage(e) });
        if (vectorPollRef.current) { clearInterval(vectorPollRef.current); vectorPollRef.current = null; }
      }
    };
    poll();
    vectorPollRef.current = setInterval(poll, 700);
    return () => { if (vectorPollRef.current) clearInterval(vectorPollRef.current); };
  }, [vectorJobId]);

  // Keep the selected camera valid.
  useEffect(() => {
    if (cameraOptions.length > 0 && !cameraOptions.includes(camera)) {
      setCamera(cameraOptions[0]);
    }
  }, [cameraOptions, camera]);

  useEffect(() => () => {
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
    if (vectorPollRef.current) clearInterval(vectorPollRef.current);
  }, []);

  return {
    sourcePathIdx, setSourcePathIdx, camera, setCamera,
    imageFormat, setImageFormat, imageType, setImageType, numImages, setNumImages,
    calibrationSources, setCalibrationSources, useCameraSubfolders, setUseCameraSubfolders,
    cameraSubfolders, setCameraSubfolders,
    squaresH, setSquaresH, squaresV, setSquaresV, squareSize, setSquareSize,
    markerRatio, setMarkerRatio, arucoDict, setArucoDict, minCorners, setMinCorners,
    dt, setDt, datumFrame, setDatumFrame,
    modelType, setModelType, pivType, setPivType,
    validation, validating, validateImages, viewerRefreshKey,
    restoreDetections, detectionsStale,
    jobStatus, isCalibrating: jobStatus?.status === 'running' || jobStatus?.status === 'starting',
    multiCameraJobStatus, isMultiCameraCalibrating: multiCameraJobStatus?.status === 'running' || multiCameraJobStatus?.status === 'starting',
    vectorJobStatus, isVectorCalibrating: vectorJobStatus?.status === 'running' || vectorJobStatus?.status === 'starting',
    cameraModel, detections, modelLoading, modelLoadError, detectError, detecting, hasModel: cameraModel !== null,
    loadedWorldFrame,
    showOverlay, setShowOverlay,
    generateCameraModel, generateCameraModelAll, loadModel, calibrateVectors, detectFrame, detectAllViews,
    cameraOptions, sourcePaths,
  };
}
