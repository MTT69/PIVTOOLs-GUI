import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, fetchJson, postJson } from '@/lib/api';
import { isApplyJobActive } from '@/lib/applyJob';
import { CalibrationJobFamily, useCalibrationJobs } from '@/contexts/CalibrationJobContext';
import {
  calibrationViewerRefreshKey,
  clearCalibrationFrameCache,
  warmCalibrationFrameCache,
} from '@/hooks/useCalibrationImageViewer';
import { useDebouncedTask } from './useDebouncedTask';
import { useRequestSeq } from './useRequestSeq';
import {
  CalibrationValidation,
  CameraValidationResult,
  DetectionsByCamera,
  FrameDetection,
  ModelData,
  SidecarSettings,
  ViewCount,
  autoViewCountText,
  numOrNull,
  positiveIntOrNull,
} from './shared';

/** Debounce for persisting form edits (sidecar and config pointer). */
const SAVE_DEBOUNCE_MS = 500;
/** Debounce for the stored-detections probe: it loadmats every stored point set. */
const RESTORE_DEBOUNCE_MS = 400;

export type CameraMode = 'mono' | 'pair';

/**
 * What a board contributes to the shared core. Callbacks are read through a ref, so they may
 * be fresh closures every render; `methods` and `boardParams` are compared by value.
 */
export interface BoardAdapter {
  /** Backend `board` key. */
  board: 'dotboard' | 'charuco' | 'stepped';
  /** Hydrate the board's own state from a sidecar settings dict. */
  readSettings: (s: SidecarSettings) => void;
  /** The `methods` blocks this tab persists (backend deep-merges them into the sidecar). */
  methods: Record<string, unknown>;
  /** Request-level board params: only fields the user set (empty fields are omitted). */
  boardParams: Record<string, unknown>;
  /** Human names of form fields that differ from a model's stamped `geometry`. */
  geometryDiff: (geometry: Record<string, unknown>) => string[];
}

export interface CalibrationCoreOptions {
  adapter: BoardAdapter;
  mode: CameraMode;
  cameraOptions: number[];
  /** Overlay detections via restore_detections / detect_views (false for stepped). */
  detections: boolean;
}

const emptyValidation = (error: string): CameraValidationResult => ({ valid: false, found_count: 0, error });

/**
 * The shared skeleton of every calibration tab (planar dotboard/ChArUco, stereo
 * dotboard/ChArUco/stepped). A mono tab is the one-camera case of a pair tab, so state that
 * is per camera (validation, detections) is keyed by camera number.
 *
 * Owns, for the selected calibration source:
 *   - hydration of the form from the per-source settings sidecar, and the debounced save
 *     back. The save writes only the sidecar and, when edited, `calibration_sources`; it never
 *     writes `calibration.active` (only the tab's "Set as Active" button does). Hydration
 *     itself never triggers a save, and a pending save is flushed — not dropped — on source
 *     switch and unmount;
 *   - validation of each camera, the viewer cache key and the frame-cache warmup;
 *   - the saved model (raw backend payload, mapped by the tab) and the stored detections;
 *   - the apply jobs (one per target dataset selection), through `CalibrationJobContext` so
 *     they survive tab switches.
 *
 * Every async read is guarded: a response that a newer request or a source/camera change has
 * superseded is dropped instead of painting another selection's data.
 *
 * n_views is optional: a blank field is persisted as null and sent as `frame_total: null`, so
 * the backend resolves it (settings, then frame-count auto-detect). `frameCount` is the count
 * the UI can show (entered value, else what validation found).
 */
export function useCalibrationCore({ adapter, mode, cameraOptions, detections: withDetections }: CalibrationCoreOptions) {
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  // ---------- Selection ----------
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState(1);
  const [cam1, setCam1] = useState(1);
  const [cam2, setCam2] = useState(2);
  const [activeCam, setActiveCam] = useState(1);
  const cameras = useMemo(() => (mode === 'mono' ? [camera] : [cam1, cam2]), [mode, camera, cam1, cam2]);
  const camerasKey = cameras.join(',');

  // ---------- Form (hydrated from the sidecar; initial values are placeholders only) ----------
  const [imageFormat, setImageFormat] = useState('');
  const [imageType, setImageType] = useState('standard');
  // '' = unset: the backend resolves the count (settings, then auto-detect).
  const [numImages, setNumImages] = useState('');
  // Sidecar image.zero_based_indexing: the first FILE is numbered 0 (frames stay 1-based).
  const [zeroBasedIndexing, setZeroBasedIndexing] = useState(false);
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);
  const [dt, setDt] = useState('');
  const [datumFrame, setDatumFrame] = useState(1);
  const [interpolator, setInterpolator] = useState<'cubic' | 'lanczos'>('lanczos');
  const [pivType, setPivType] = useState<'instantaneous' | 'ensemble'>('instantaneous');

  // ---------- Status ----------
  const [configLoaded, setConfigLoaded] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [validation, setValidation] = useState<CalibrationValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [viewerRefreshKey, setViewerRefreshKey] = useState('');
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [loadedWorldFrame, setLoadedWorldFrame] = useState<any>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionsByCamera>({});
  const [detectionsStale, setDetectionsStale] = useState<string | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  // The view count the backend last resolved (detect_views / restore_detections / generate)
  // for the current inputs; null until one reports or after an input change.
  const [backendViewCount, setBackendViewCount] = useState<ViewCount | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  // Bumped whenever the source, its path or the cameras change: model + detections reload.
  const [sourceEpoch, setSourceEpoch] = useState(0);
  // Bumped after each hydration so the hydrated form becomes the save baseline.
  const [hydrationTick, setHydrationTick] = useState(0);

  // ---------- Refs ----------
  const configLoadedRef = useRef(false);
  // The form may be saved only into the source it was hydrated from.
  const settingsReadyRef = useRef(false);
  // The source directory the form/model belong to; differs from the list during a path edit.
  const loadedSourcePathRef = useRef('');
  // Last persisted (or hydrated) settings payload; a save fires only when the form differs.
  const savedPayloadRef = useRef<string | null>(null);
  // Bumped per hydration; a save that completes after a newer hydration must not move the baseline.
  const hydrationGenRef = useRef(0);
  // calibration_sources is written only once it was read successfully (never [] on failure).
  const sourcesLoadedRef = useRef(false);
  const savedSourcesRef = useRef<string | null>(null);

  const settingsSeq = useRequestSeq();
  const validateSeq = useRequestSeq();
  const modelSeq = useRequestSeq();
  const detectionsSeq = useRequestSeq();
  const settingsSave = useDebouncedTask(SAVE_DEBOUNCE_MS);
  const sourcesSave = useDebouncedTask(SAVE_DEBOUNCE_MS);

  const boardParamsKey = JSON.stringify(adapter.boardParams);
  const nViews = positiveIntOrNull(numImages);
  const frameCount: number | null = nViews
    ?? (validation && validation.matching_count > 0 ? validation.matching_count : null);

  // Identity of everything a detection depends on; a response issued under another
  // identity belongs to a different selection and is dropped.
  const detectContext = `${sourcePathIdx}|${camerasKey}|${boardParamsKey}|${imageFormat}|${imageType}|${zeroBasedIndexing}|${viewerRefreshKey}`;
  const detectContextRef = useRef(detectContext);
  detectContextRef.current = detectContext;

  // ---------- Settings payload (what the sidecar save writes) ----------
  const settingsPayload = useMemo(() => JSON.stringify({
    image: {
      image_format: imageFormat,
      image_type: imageType,
      n_views: nViews,
      zero_based_indexing: zeroBasedIndexing,
      use_camera_subfolders: useCameraSubfolders,
      camera_subfolders: cameraSubfolders,
    },
    rig: mode === 'mono'
      ? { camera, dt: numOrNull(dt), datum_frame: datumFrame, piv_type: pivType }
      : { camera_pair: [cam1, cam2], dt: numOrNull(dt), datum_frame: datumFrame, interpolator, piv_type: pivType },
    methods: adapter.methods,
  }), [imageFormat, imageType, nViews, zeroBasedIndexing, useCameraSubfolders, cameraSubfolders, mode, camera,
      cam1, cam2, dt, datumFrame, interpolator, pivType, adapter.methods]);

  // ---------- Hydration ----------
  const applySettings = useCallback((s: SidecarSettings) => {
    const img = s.image || {};
    setImageFormat(img.image_format ?? '');
    if (img.image_type) setImageType(img.image_type);
    setNumImages(img.n_views == null ? '' : String(img.n_views));
    setZeroBasedIndexing(Boolean(img.zero_based_indexing));
    setUseCameraSubfolders(Boolean(img.use_camera_subfolders));
    setCameraSubfolders(Array.isArray(img.camera_subfolders) ? img.camera_subfolders : []);
    const rig = s.rig || {};
    setDt(rig.dt == null ? '' : String(rig.dt));
    if (rig.datum_frame != null) setDatumFrame(Number(rig.datum_frame));
    if (rig.piv_type === 'instantaneous' || rig.piv_type === 'ensemble') setPivType(rig.piv_type);
    if (mode === 'pair') {
      if (rig.interpolator === 'cubic' || rig.interpolator === 'lanczos') setInterpolator(rig.interpolator);
      if (Array.isArray(rig.camera_pair) && rig.camera_pair.length >= 2) {
        setCam1(Number(rig.camera_pair[0]));
        setCam2(Number(rig.camera_pair[1]));
        setActiveCam(Number(rig.camera_pair[0]));
      }
    }
    adapterRef.current.readSettings(s);
  }, [mode]);

  /**
   * Fetch and apply one source's sidecar (the server seeds it when absent; GET never writes).
   * Returns the settings so the caller can validate against them before state commits.
   * On failure the save guard stays CLOSED: the form still holds another source's values.
   */
  const loadSettings = useCallback(async (idx: number): Promise<SidecarSettings | null> => {
    settingsReadyRef.current = false;
    const token = settingsSeq.next();
    try {
      const data = await fetchJson(`/backend/calibration/settings?source_path_idx=${idx}`);
      if (!settingsSeq.isCurrent(token)) return null;
      if (!data.settings) {
        setSettingsError(`Failed to load calibration settings: ${data.error ?? 'no settings in response'}`);
        return null;
      }
      applySettings(data.settings);
      hydrationGenRef.current += 1;
      setHydrationTick(t => t + 1);
      setSettingsError(null);
      settingsReadyRef.current = true;
      return data.settings as SidecarSettings;
    } catch (e) {
      if (!settingsSeq.isCurrent(token)) return null;
      setSettingsError(`Failed to load calibration settings: ${errorMessage(e)}`);
      return null;
    }
  }, [applySettings, settingsSeq]);

  // ---------- Validation ----------
  const validateImages = useCallback(async (fromSettings?: SidecarSettings | null) => {
    const token = validateSeq.next();
    setValidating(true);
    // Mount and path-edit call sites run before hydration commits, so the just-fetched
    // settings carry the effective source identity past this closure's stale state.
    const img = fromSettings?.image;
    const effFormat = img?.image_format ?? imageFormat;
    const effType = img?.image_type ?? imageType;
    const effZeroBased = img?.zero_based_indexing ?? zeroBasedIndexing;
    const effUseSubfolders = img?.use_camera_subfolders ?? useCameraSubfolders;
    const effSubfolders = img?.camera_subfolders ?? cameraSubfolders;
    const effNViews = fromSettings ? (img?.n_views ?? null) : nViews;
    const pair = fromSettings?.rig?.camera_pair;
    const cams = mode === 'pair' && Array.isArray(pair) && pair.length >= 2
      ? [Number(pair[0]), Number(pair[1])]
      : cameras;
    try {
      const results = await Promise.all(cams.map(async cam => {
        try {
          const r: CameraValidationResult = await postJson('/backend/calibration/validate', {
            camera: cam, source_path_idx: sourcePathIdx,
            image_format: effFormat, image_type: effType, frame_total: effNViews,
          });
          return r;
        } catch (e) {
          return emptyValidation(errorMessage(e));
        }
      }));
      if (!validateSeq.isCurrent(token)) return;
      const byCam: Record<number, CameraValidationResult> = {};
      cams.forEach((cam, i) => { byCam[cam] = results[i]; });
      // Views are paired by index, so with n_views left blank unequal per-camera counts are
      // an error (same rule as the backend's pair count), never the smaller of the two.
      const counts = results.map(r => r.found_count);
      const countMismatch = mode === 'pair' && effNViews == null && results.every(r => r.valid)
        && counts.some(n => n !== counts[0]);
      const result: CalibrationValidation = {
        valid: results.every(r => r.valid) && !countMismatch,
        cameras: byCam,
        matching_count: countMismatch ? 0 : Math.min(...counts),
        error: countMismatch
          ? `Camera ${cams[0]} has ${counts[0]} views, camera ${cams[1]} has ${counts[1]} -- `
            + 'calibration pairs views by index, so the counts must match'
          : results.find(r => r.error)?.error,
      };
      setValidation(result);
      // One construction site for the viewer's cache namespace, shared by the warmup.
      const refreshKey = calibrationViewerRefreshKey({
        sourcePath: calibrationSources[sourcePathIdx] ?? '',
        imageFormat: effFormat,
        imageType: effType,
        zeroBasedIndexing: effZeroBased,
        useCameraSubfolders: effUseSubfolders,
        cameraSubfolders: effSubfolders,
        valid: result.valid,
      });
      setViewerRefreshKey(refreshKey);
      if (result.valid) {
        warmCalibrationFrameCache({
          backendUrl: '/backend',
          // Mono tabs can show any camera; a pair tab shows its two.
          cameras: mode === 'mono' ? cameraOptions : cams,
          primaryCamera: cams[0],
          sourcePathIdx,
          refreshKey,
        });
      }
    } finally {
      if (validateSeq.isCurrent(token)) setValidating(false);
    }
  }, [validateSeq, imageFormat, imageType, zeroBasedIndexing, useCameraSubfolders, cameraSubfolders, nViews,
      mode, cameras, sourcePathIdx, calibrationSources, cameraOptions]);
  const validateRef = useRef(validateImages);
  validateRef.current = validateImages;

  // ---------- Mount: source list, first source's settings, validation ----------
  useEffect(() => {
    const load = async () => {
      let sources: string[] = [];
      try {
        const cal = (await fetchJson('/backend/config')).calibration || {};
        sources = Array.isArray(cal.calibration_sources) ? cal.calibration_sources : [];
        setCalibrationSources(sources);
        savedSourcesRef.current = JSON.stringify(sources);
        sourcesLoadedRef.current = true;
        setSourcesError(null);
      } catch (e) {
        setSourcesError(`Failed to load calibration sources: ${errorMessage(e)}. Edits to the source list are not saved until the page is reloaded.`);
      }
      const s = await loadSettings(0);
      loadedSourcePathRef.current = sources[0] ?? '';
      configLoadedRef.current = true;
      setConfigLoaded(true);
      void validateRef.current(s);
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Source switch: flush the old source's pending save, hydrate the new one ----------
  useEffect(() => {
    if (!configLoadedRef.current) return;
    settingsSave.flush();
    loadedSourcePathRef.current = calibrationSources[sourcePathIdx] ?? '';
    void (async () => {
      const s = await loadSettings(sourcePathIdx);
      void validateRef.current(s);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePathIdx]);

  // ---------- Model / detections context changes ----------
  useEffect(() => {
    if (!configLoadedRef.current) return;
    setSourceEpoch(e => e + 1);
  }, [sourcePathIdx, camerasKey]);

  // ---------- Save baseline: the hydrated form is what the sidecar already holds ----------
  // Declared before the save effect so both see the same render's payload.
  useEffect(() => {
    if (hydrationTick > 0) savedPayloadRef.current = settingsPayload;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrationTick]);

  // ---------- Debounced sidecar save (user edits only) ----------
  useEffect(() => {
    if (!configLoaded || !settingsReadyRef.current) return;
    if (settingsPayload === savedPayloadRef.current) return;
    // Mid path-edit the form belongs to the old directory; the reload rehydrates instead.
    if ((calibrationSources[sourcePathIdx] ?? '') !== loadedSourcePathRef.current) return;
    const idx = sourcePathIdx;
    const payload = settingsPayload;
    const gen = hydrationGenRef.current;
    settingsSave.schedule(async (followUp) => {
      try {
        const sent = JSON.parse(payload);
        const res = await postJson('/backend/calibration/settings', { source_path_idx: idx, settings: sent });
        // The backend prunes camera_subfolders to the camera count and echoes the stored
        // list; adopt it so the next save does not re-send the stale entries.
        const stored = res.settings?.image?.camera_subfolders;
        if (!Array.isArray(stored)) {
          throw new Error('settings save response carries no image.camera_subfolders');
        }
        const sentSubfolders = JSON.stringify(sent.image.camera_subfolders);
        const adopted = JSON.stringify(stored) === sentSubfolders
          ? payload
          : JSON.stringify({ ...sent, image: { ...sent.image, camera_subfolders: stored } });
        if (gen === hydrationGenRef.current) {
          savedPayloadRef.current = adopted;
          // Only over the list that was sent: an edit made while the save was in flight wins.
          if (adopted !== payload) setCameraSubfolders(prev => (JSON.stringify(prev) === sentSubfolders ? stored : prev));
        }
        if (followUp) setSettingsError(null);
      } catch (e) {
        if (followUp) setSettingsError(`Failed to save calibration settings: ${errorMessage(e)}`);
        return;
      }
      // Validation reads subfolders and 0/1 indexing from the persisted sidecar, so
      // re-validate after a save.
      if (followUp) void validateRef.current();
    });
  }, [settingsPayload, configLoaded, calibrationSources, sourcePathIdx, settingsSave]);

  // ---------- Debounced config-pointer save (calibration_sources only) ----------
  useEffect(() => {
    if (!sourcesLoadedRef.current) return;
    const sourcesJson = JSON.stringify(calibrationSources);
    if (sourcesJson === savedSourcesRef.current) return;
    const idx = sourcePathIdx;
    sourcesSave.schedule(async (followUp) => {
      try {
        await postJson('/backend/update_config', { calibration: { calibration_sources: JSON.parse(sourcesJson) } });
        savedSourcesRef.current = sourcesJson;
        if (followUp) setSourcesError(null);
      } catch (e) {
        if (followUp) setSourcesError(`Failed to save calibration sources: ${errorMessage(e)}`);
        return;
      }
      if (!followUp) return;
      // In-place edit of the selected source path: the backend now resolves this index to
      // the new directory, so rehydrate settings, model and detections from it.
      const currentPath = (JSON.parse(sourcesJson) as string[])[idx] ?? '';
      if (currentPath !== loadedSourcePathRef.current) {
        loadedSourcePathRef.current = currentPath;
        const s = await loadSettings(idx);
        void validateRef.current(s);
        setSourceEpoch(e => e + 1);
      }
    });
  }, [calibrationSources, sourcePathIdx, sourcesSave, loadSettings]);

  // ---------- Pending-validation state the instant a validation input changes ----------
  // The backend resolves validation from the PERSISTED sidecar, so without this a previous
  // source's error would linger until the debounced save and re-validate land.
  useEffect(() => {
    if (!configLoadedRef.current) return;
    setValidating(true);
    // Frame URLs carry none of these inputs, so cached frames would be stale.
    clearCalibrationFrameCache();
    setValidation(v => (v ? {
      ...v,
      valid: false,
      error: undefined,
      cameras: Object.fromEntries(Object.entries(v.cameras).map(([k, r]) => [k, { ...r, valid: false, error: undefined }])),
    } : v));
    setDetectError(null);
    setBackendViewCount(null);
  }, [sourcePathIdx, imageFormat, imageType, numImages, zeroBasedIndexing, calibrationSources, useCameraSubfolders,
      cameraSubfolders]);

  // ---------- Saved model ----------
  const modelUrl = mode === 'mono'
    ? `/backend/calibration/model?stereo=0&board=${adapter.board}&camera=${camera}&source_path_idx=${sourcePathIdx}`
    : `/backend/calibration/model?stereo=1&board=${adapter.board}&camera_pair=${cam1},${cam2}&source_path_idx=${sourcePathIdx}`;
  const loadModel = useCallback(async (): Promise<ModelData | null> => {
    const token = modelSeq.next();
    setModelLoading(true);
    setModelLoadError(null);
    try {
      const data = await fetchJson(modelUrl);
      if (!modelSeq.isCurrent(token)) return null;
      // No model yet is the normal first-use state. The sidecar may still hold world-frame
      // picks (inputs.mat) so a deleted model can be re-solved without re-clicking.
      setModelData(data.exists ? data : null);
      setLoadedWorldFrame(data?.world_frame ?? null);
      return data.exists ? data : null;
    } catch (e) {
      if (!modelSeq.isCurrent(token)) return null;
      setModelData(null);
      setModelLoadError(`Failed to load model: ${errorMessage(e)}`);
      return null;
    } finally {
      if (modelSeq.isCurrent(token)) setModelLoading(false);
    }
  }, [modelSeq, modelUrl]);

  /**
   * Show a freshly generated model at once, then reload the saved record: generate responses
   * carry no stamped `geometry`/world frame, and the record is what Apply will use.
   */
  const setGeneratedModel = useCallback((data: ModelData) => {
    setModelLoadError(null);
    setModelData(data);
    void loadModel();
  }, [loadModel]);

  useEffect(() => {
    if (!configLoaded) return;
    setModelData(null);
    setDetections({});
    setDetectionsStale(null);
    setBackendViewCount(null);
    detectionsSeq.invalidate();
    void loadModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, sourceEpoch]);

  // ---------- Stored detections ----------
  const detectionBody = useCallback(() => ({
    ...(mode === 'mono' ? { camera } : { stereo: true, camera_pair: [cam1, cam2] }),
    source_path_idx: sourcePathIdx, board: adapterRef.current.board,
    board_params: JSON.parse(boardParamsKey), image_format: imageFormat, image_type: imageType,
    frame_total: nViews,
  }), [mode, camera, cam1, cam2, sourcePathIdx, boardParamsKey, imageFormat, imageType, nViews]);

  const framesFrom = (byCamera: any, cam: number): Record<number, FrameDetection> => {
    const out: Record<number, FrameDetection> = {};
    for (const [f, v] of Object.entries((byCamera?.[String(cam)]?.frames ?? {}) as Record<string, any>)) {
      out[Number(f)] = { grid_points: v.image_points, grid_indices: v.grid_indices };
    }
    return out;
  };

  /**
   * Read the detections already stored in inputs.mat. The backend returns them only while
   * their det_key matches the current geometry, format and view count; stale points are never
   * drawn because Generate would refuse to reuse them.
   */
  const restoreDetections = useCallback(async () => {
    const token = detectionsSeq.next();
    try {
      const data = await postJson('/backend/calibration/restore_detections', detectionBody());
      if (!detectionsSeq.isCurrent(token)) return;
      if (data.exists) setBackendViewCount({ n: data.frame_total, source: data.frame_total_source });
      if (data.exists && data.fresh) {
        const next: DetectionsByCamera = {};
        for (const cam of cameras) next[cam] = framesFrom(data.by_camera, cam);
        setDetections(next);
        setDetectionsStale(null);
        return;
      }
      setDetections({});
      setDetectionsStale(data.exists && !data.fresh
        ? `Saved detections were made with different settings${data.stored?.n_views ? ` (${data.stored.n_views} views)` : ''}. Detect again to refresh them.`
        : null);
      // Nothing to restore because the view count could not be resolved (e.g. unequal
      // per-camera counts): say why rather than show a silently blank overlay.
      if (!data.exists && data.error) setDetectError(data.error);
    } catch (e) {
      if (!detectionsSeq.isCurrent(token)) return;
      // A non-2xx here is a real fault (e.g. an unreadable inputs.mat), not "nothing saved".
      setDetections({});
      setDetectionsStale(null);
      setDetectError(`Could not read saved detections: ${errorMessage(e)}`);
    }
  }, [detectionsSeq, detectionBody, cameras]);

  // Overlay is valid only for the inputs that produced it. viewerRefreshKey is a dependency
  // on purpose: it folds in the source path (in-place edits) and orders the probe after the
  // debounced save, since the backend resolves the source by index.
  useEffect(() => {
    if (!configLoaded || !withDetections) return;
    setDetections({});
    setDetectError(null);
    const t = setTimeout(() => { void restoreDetections(); }, RESTORE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [configLoaded, withDetections, restoreDetections, viewerRefreshKey]);

  /** Detect the board on one frame of one camera and merge it into the overlay. */
  const detectFrame = useCallback(async (frame: number, cam: number) => {
    const context = detectContextRef.current;
    try {
      const data = await postJson('/backend/calibration/detect_frame', {
        camera: cam, source_path_idx: sourcePathIdx, frame, board: adapterRef.current.board,
        board_params: JSON.parse(boardParamsKey), image_format: imageFormat, image_type: imageType,
      });
      if (detectContextRef.current !== context) return;
      if (data.success) {
        setDetections(prev => ({
          ...prev,
          [cam]: { ...(prev[cam] ?? {}), [frame]: { grid_points: data.image_points, grid_indices: data.grid_indices } },
        }));
        setDetectError(null);
      } else {
        setDetectError(data.error || `No board detected on Cam${cam} frame ${frame}`);
      }
    } catch (e) {
      if (detectContextRef.current !== context) return;
      setDetectError(`Detection failed on Cam${cam} frame ${frame}: ${errorMessage(e)}`);
    }
  }, [sourcePathIdx, boardParamsKey, imageFormat, imageType]);

  /** Detect every view of every camera in one round-trip; replaces the overlay. */
  const detectAllViews = useCallback(async () => {
    const token = detectionsSeq.next();
    setDetecting(true);
    setDetections({});
    try {
      const data = await postJson('/backend/calibration/detect_views', detectionBody());
      if (!detectionsSeq.isCurrent(token)) return;
      if (!data.success) {
        setDetectError(data.error || 'Detection failed');
        return;
      }
      setBackendViewCount({ n: data.frame_total, source: data.frame_total_source });
      const next: DetectionsByCamera = {};
      const errs: string[] = [];
      for (const cam of cameras) {
        next[cam] = framesFrom(data.by_camera, cam);
        if (data.by_camera?.[String(cam)]?.n_detected === 0) errs.push(`No board detected on Cam${cam}`);
      }
      setDetections(next);
      setDetectionsStale(null);
      // The backend persists these for Generate; say so when it could not.
      if (!data.persisted) errs.push(`Detected, but not saved for Generate: ${data.persist_skipped}`);
      setDetectError(errs.length ? errs.join('; ') : null);
    } catch (e) {
      if (!detectionsSeq.isCurrent(token)) return;
      setDetectError(`Detection failed: ${errorMessage(e)}`);
    } finally {
      if (detectionsSeq.isCurrent(token)) setDetecting(false);
    }
  }, [detectionsSeq, detectionBody, cameras]);

  /** Record the view count a generate response resolved (`frame_total` + its source). */
  const noteViewCount = useCallback((data: { frame_total: number; frame_total_source: string }) => {
    setBackendViewCount({ n: data.frame_total, source: data.frame_total_source });
  }, []);

  /**
   * The count a blank n_views resolves to: the backend's last resolution, else what
   * validation found when every camera agrees. The validation fallback is labelled by the
   * format, since validate counts .set entries / .cine frames for containers.
   */
  const autoViewCount = useMemo((): ViewCount | null => {
    if (nViews != null) return null;
    if (backendViewCount) return backendViewCount;
    if (!validation || validating) return null;
    const counts = cameras.map(c => validation.cameras[c]?.found_count ?? 0);
    if (counts.some(n => n <= 0 || n !== counts[0])) return null;
    const source = imageType === 'lavision_set' ? '.set index' : imageType === 'cine' ? '.cine header' : 'files';
    return { n: counts[0], source };
  }, [nViews, backendViewCount, validation, validating, cameras, imageType]);

  /**
   * The validate hint "Files start at X but the start index is Y": `suggested_zero_based` of
   * the first camera that reports one, for the First Frame Number control's switch button.
   */
  const suggestedZeroBased = useMemo((): boolean | null => {
    if (!validation || validating) return null;
    for (const cam of cameras) {
      const s = validation.cameras[cam]?.suggested_zero_based;
      if (s != null) return s;
    }
    return null;
  }, [validation, validating, cameras]);

  // ---------- Camera selection invariants ----------
  useEffect(() => {
    if (mode !== 'mono') return;
    if (cameraOptions.length > 0 && !cameraOptions.includes(camera)) setCamera(cameraOptions[0]);
  }, [mode, cameraOptions, camera]);

  useEffect(() => {
    if (mode !== 'pair' || cameraOptions.length < 2) return;
    if (!cameraOptions.includes(cam1)) setCam1(cameraOptions[0]);
    if (!cameraOptions.includes(cam2)) setCam2(cameraOptions[1]);
    if (cam1 === cam2) {
      const other = cameraOptions.filter(c => c !== cam1);
      if (other.length > 0) setCam2(other[0]);
    }
  }, [mode, cameraOptions, cam1, cam2]);

  useEffect(() => {
    if (mode === 'pair' && activeCam !== cam1 && activeCam !== cam2) setActiveCam(cam1);
  }, [mode, activeCam, cam1, cam2]);

  // ---------- Camera subfolders: addressed by camera number (backend reads subfolders[camera-1]) ----------
  const setSubfolderFor = useCallback((cam: number, value: string) => {
    setCameraSubfolders(prev => {
      const next = [...prev];
      while (next.length < cam) next.push('');
      next[cam - 1] = value;
      return next;
    });
  }, []);

  /**
   * Apply subfolder suggestions by camera number: `byCamera` when given, else each validated
   * camera's own `suggested_subfolder`. Cameras without a suggestion are untouched.
   */
  const applySubfolderSuggestions = useCallback((byCamera?: Record<number, string>) => {
    const source: Record<number, string> = byCamera ?? Object.fromEntries(
      Object.entries(validation?.cameras ?? {})
        .filter(([, r]) => r.suggested_subfolder)
        .map(([cam, r]) => [Number(cam), r.suggested_subfolder as string]));
    const suggestions = Object.entries(source).map(([cam, sub]) => [Number(cam), sub] as const);
    if (suggestions.length === 0) return;
    setUseCameraSubfolders(true);
    setCameraSubfolders(prev => {
      const next = [...prev];
      for (const [cam, sub] of suggestions) {
        while (next.length < cam) next.push('');
        next[cam - 1] = sub;
      }
      return next;
    });
  }, [validation]);

  // ---------- Changed since generate ----------
  const changedSinceGenerate = useMemo((): string[] => {
    const geo = modelData?.geometry;
    if (!geo || typeof geo !== 'object') return [];
    const diff = adapterRef.current.geometryDiff(geo);
    if (geo.datum_frame != null && Number(geo.datum_frame) !== datumFrame) diff.push('datum frame');
    if (modelData?.n_views != null && nViews != null && Number(modelData.n_views) !== nViews) diff.push('number of images');
    return diff;
    // adapter.methods carries the board fields geometryDiff reads.
  }, [modelData, datumFrame, nViews, adapter.methods]);

  // ---------- Apply (persistent job) ----------
  const jobs = useCalibrationJobs();
  const applyFamily: CalibrationJobFamily = useMemo(() => ({
    board: mode === 'mono' ? adapter.board : `stereo_${adapter.board}`,
    sourcePathIdx,
    cameras: mode === 'mono' ? [] : [cam1, cam2],
  }), [mode, adapter.board, sourcePathIdx, cam1, cam2]);
  const applyJobs = jobs.jobsFor(applyFamily);

  /**
   * Apply the saved model to `datasets` (indices into `paths.base_paths`). Always sent as an
   * explicit `active_paths`, so the request states what it applies to.
   */
  const startApply = useCallback(async (typeName: string, datasets: number[]) => {
    const dtVal = numOrNull(dt);
    const sorted = [...datasets].sort((a, b) => a - b);
    await jobs.startApply({ ...applyFamily, datasets: sorted }, {
      stereo: mode === 'pair', board: adapter.board, source_path_idx: sourcePathIdx,
      ...(mode === 'pair' ? { camera_pair: [cam1, cam2], interpolator } : {}),
      type_name: typeName,
      // Empty dt is omitted: apply falls back to the model-stamped dt.
      ...(dtVal != null ? { dt: dtVal } : {}),
      active_paths: sorted,
    });
  }, [jobs, applyFamily, mode, adapter.board, sourcePathIdx, cam1, cam2, interpolator, dt]);

  const cancelApply = useCallback(
    (datasets: number[]) => jobs.cancelApply({ ...applyFamily, datasets }), [jobs, applyFamily]);

  return {
    // selection
    sourcePathIdx, setSourcePathIdx, camera, setCamera, cam1, setCam1, cam2, setCam2,
    activeCam, setActiveCam, cameras, cameraOptions,
    // form
    imageFormat, setImageFormat, imageType, setImageType, numImages, setNumImages,
    zeroBasedIndexing, setZeroBasedIndexing, suggestedZeroBased,
    calibrationSources, setCalibrationSources, useCameraSubfolders, setUseCameraSubfolders,
    cameraSubfolders, setCameraSubfolders, setSubfolderFor, applySubfolderSuggestions,
    dt, setDt, datumFrame, setDatumFrame, interpolator, setInterpolator, pivType, setPivType,
    nViews, frameCount, autoViewCountText: autoViewCountText(autoViewCount), noteViewCount,
    // status
    configLoaded, sourceEpoch,
    loadError: sourcesError ?? settingsError ?? modelLoadError,
    validation, validating, validateImages, viewerRefreshKey,
    modelData, setGeneratedModel, loadedWorldFrame, modelLoading, loadModel, changedSinceGenerate,
    detections, detectionsStale, detectError, setDetectError, detecting, showOverlay, setShowOverlay,
    restoreDetections, detectFrame, detectAllViews,
    // apply
    applyJobs, applyRunning: applyJobs.some(j => isApplyJobActive(j.status)),
    startApply, cancelApply,
  };
}

export type CalibrationCore = ReturnType<typeof useCalibrationCore>;
