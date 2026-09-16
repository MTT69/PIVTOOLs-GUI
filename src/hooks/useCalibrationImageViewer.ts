import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchJson, errorMessage } from '@/lib/api';

/**
 * One decoded calibration frame as the `/calibration/frame` route serves it.
 */
export interface CalibrationFrame {
  image: string;
  stats: {
    min: number;
    max: number;
    mean: number;
    vmin_pct: number;
    vmax_pct: number;
  };
  width: number;
  height: number;
  /** Frames available at this camera/source, as reported by the backend. */
  frameCount: number;
}

export type CalibrationViewerImageFormat = 'jpeg' | 'png';

/**
 * The viewer's initial image settings.
 *
 * `DEFAULT_VIEWER_IMAGE_FORMAT` is exported so `warmCalibrationFrameCache`
 * fetches under the SAME cache key the viewer looks up on its first paint — a
 * warmup under a different format would be silently useless.
 *
 * `DEFAULT_VIEWER_AUTO_LIMITS` is only the initial state of the viewer's
 * Auto-scale toggle. It is NOT part of the cache key or the URL: the calibration
 * route returns the same bytes either way (see `frameUrl`).
 */
export const DEFAULT_VIEWER_IMAGE_FORMAT: CalibrationViewerImageFormat = 'jpeg';
export const DEFAULT_VIEWER_AUTO_LIMITS = true;

// ---------------------------------------------------------------------------
// Module-scope frame cache, shared by every viewer instance.
//
// Radix Tabs unmounts inactive tab content, so a per-mount buffer died on every
// tab switch and refetched frame 1 (+ its prefetch window) on the way back. The
// cache key carries every setting that changes what a frame LOOKS like: source,
// camera, frame, jpeg/png, and the tab's refreshKey (the source-level identity —
// see calibrationViewerRefreshKey). A source or setup change simply stops
// matching; the hooks also clear the cache outright when a validation-relevant
// input changes (see the calibration hooks' "clear stale validation" effects).
// ---------------------------------------------------------------------------

/** Byte budget on the base64 payloads. PNG entries at 4872x3248 run 10+ MB. */
const FRAME_CACHE_MAX_BYTES = 80 * 1024 * 1024;
/** Secondary cap so many small JPEG frames cannot grow the Map without bound. */
const FRAME_CACHE_MAX_ENTRIES = 40;
/**
 * Frames per camera fetched by the post-validation warmup.
 *
 * Five, not twelve: the warmup now covers EVERY camera rather than only the one
 * on screen, and the viewer prefetches +/-PREFETCH_WINDOW as the user navigates,
 * so a deep per-camera warm mostly bought frames nobody looked at while the
 * server decoded them one at a time.
 */
const WARMUP_FRAME_LIMIT = 5;
/** Parallel warmup fetches — the backend decodes each frame on request. */
const WARMUP_CONCURRENCY = 2;
/** Frames ahead of the current one that a mounted viewer prefetches. */
const PREFETCH_WINDOW = 3;

// Insertion order doubles as LRU order: a hit re-inserts the entry.
const frameCache = new Map<string, CalibrationFrame>();
let frameCacheBytes = 0;
// In-flight fetches by cache key, so a viewer mounting mid-warmup joins the
// pending request for frame 1 instead of issuing a duplicate.
const inFlight = new Map<string, Promise<CalibrationFrame>>();
// One warmup at a time: a new warmup (or a cache clear) aborts the previous one.
let warmupController: AbortController | null = null;
// Bumped by clearCalibrationFrameCache(). A fetch started before a clear still
// resolves for its caller but must not land in the cache: its bytes belong to
// the sidecar settings the clear retired, under a key the new settings may reuse.
let cacheGeneration = 0;

function frameCacheKey(
  sourcePathIdx: number,
  camera: number,
  frameIdx: number,
  imageFormat: CalibrationViewerImageFormat,
  refreshKey: string | undefined,
): string {
  // No autoLimits: the calibration route ignores it and the bytes are identical
  // either way, so keeping it here only split the cache in half.
  return `${sourcePathIdx}-${camera}-${frameIdx}-${imageFormat}-${refreshKey || ''}`;
}

// calibration serves every board/geometry from one JSON frame endpoint (a
// stereo "frame" is just camera N's frame), so the URL never branches on the
// calibration type — only the camera number differs.
function frameUrl(
  backendUrl: string,
  sourcePathIdx: number,
  camera: number,
  frameIdx: number,
  imageFormat: CalibrationViewerImageFormat,
): string {
  // auto_limits is deliberately absent: `frame_json` never read it. It always
  // encodes the same image and always returns vmin_pct/vmax_pct, and the window
  // is applied client-side by ZoomableCanvas. (The PIV route in app.py DOES
  // honour the flag -- it gates whether the stats are computed at all -- which
  // is presumably where this was copied from.)
  return `${backendUrl}/calibration/frame?camera=${camera}&idx=${frameIdx}&source_path_idx=${sourcePathIdx}&format=${imageFormat}`;
}

function cacheGet(key: string): CalibrationFrame | undefined {
  const entry = frameCache.get(key);
  if (entry) {
    frameCache.delete(key);
    frameCache.set(key, entry);
  }
  return entry;
}

function cachePut(key: string, entry: CalibrationFrame): void {
  const previous = frameCache.get(key);
  if (previous) {
    frameCacheBytes -= previous.image.length;
    frameCache.delete(key);
  }
  frameCache.set(key, entry);
  frameCacheBytes += entry.image.length;
  while (
    frameCache.size > 1 &&
    (frameCacheBytes > FRAME_CACHE_MAX_BYTES || frameCache.size > FRAME_CACHE_MAX_ENTRIES)
  ) {
    const oldestKey = frameCache.keys().next().value as string;
    const oldest = frameCache.get(oldestKey)!;
    frameCacheBytes -= oldest.image.length;
    frameCache.delete(oldestKey);
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/**
 * Resolve one frame: cache hit, else join the in-flight fetch for the same key,
 * else fetch it. Rejects with the fetch error (AbortError when `signal` fires).
 *
 * A joined fetch belongs to another caller; if THAT caller aborts, the joiner
 * fetches for itself rather than failing on someone else's cancellation.
 */
async function loadFrame(key: string, url: string, signal?: AbortSignal): Promise<CalibrationFrame> {
  const hit = cacheGet(key);
  if (hit) return hit;

  const pending = inFlight.get(key);
  if (pending) {
    try {
      return await pending;
    } catch (e) {
      if (signal?.aborted || !isAbortError(e)) throw e;
    }
  }

  const generation = cacheGeneration;
  const request = (async () => {
    const json = await fetchJson(url, { signal });
    const entry: CalibrationFrame = {
      image: json.image,
      stats: json.stats,
      width: json.width,
      height: json.height,
      frameCount: json.frame_count,
    };
    if (generation === cacheGeneration) cachePut(key, entry);
    return entry;
  })();
  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }
}

/**
 * Drop every cached frame, abort a running warmup, and retire every fetch still in
 * flight (its result is delivered to its caller but never cached). Called by the calibration
 * hooks when a validation-relevant input changes (source path, image format /
 * type, camera subfolders): the frame URL carries none of those — the backend
 * reads them from the sidecar — so a stale entry would otherwise be served for
 * as long as the camera path in its key stayed the same.
 */
export function clearCalibrationFrameCache(): void {
  cacheGeneration += 1;
  warmupController?.abort();
  warmupController = null;
  frameCache.clear();
  frameCacheBytes = 0;
  // Pending requests predate the clear: later callers must not join them.
  inFlight.clear();
}

/**
 * What makes a source's frames look the way they do — deliberately WITHOUT the
 * camera.
 */
export interface CalibrationViewerSource {
  /** `calibrationSources[sourcePathIdx]`, so an in-place path edit re-keys. */
  sourcePath: string;
  imageFormat: string;
  imageType: string;
  useCameraSubfolders: boolean;
  cameraSubfolders: string[];
  valid: boolean;
}

/**
 * The viewer `refreshKey`: everything the frame URL does NOT carry.
 *
 * The backend reads image format, type and camera subfolders from the source's
 * settings sidecar, so two frames at the same URL can be different pixels after
 * such an edit. Those inputs live here; `sourcePathIdx`, `camera`, `frameIdx`,
 * and `imageFormat` (jpeg/png) is already a separate field of `frameCacheKey`,
 * so repeating them would only split entries.
 *
 * CAMERA-INDEPENDENT ON PURPOSE. This used to be `${validation.camera_path}-...`,
 * and `camera_path` is built per camera, so the key changed on every camera
 * switch and re-keyed the whole cache — the entries were still in memory but no
 * longer reachable. Dropping `camera` from the hooks' `clearCalibrationFrameCache`
 * dependency arrays does nothing on its own while that is true.
 *
 * Carrying every invalidating input here also makes the cache self-invalidating,
 * so correctness no longer depends on an effect firing in the right order — the
 * same reasoning as the vector viewer's prefetch key (day-one gotcha #6).
 *
 * Each hook builds this ONCE and hands the result to both
 * `warmCalibrationFrameCache` and its component's `CalibrationImageViewer`, so
 * the warm and the read cannot land in different namespaces.
 */
export function calibrationViewerRefreshKey(source: CalibrationViewerSource): string {
  // Subfolders only reach the resolved path when the flag is on, so an edit to a
  // disabled list must not re-key.
  const subfolders = source.useCameraSubfolders ? source.cameraSubfolders.join('|') : '';
  return [
    source.sourcePath,
    source.imageFormat,
    source.imageType,
    String(source.useCameraSubfolders),
    subfolders,
    String(source.valid),
  ].join('~');
}

export interface WarmCalibrationFrameCacheArgs {
  backendUrl: string;
  /** Every camera the tab's viewer can show, not only the one on screen. */
  cameras: number[];
  /** The camera actually on screen. Its frames are fetched first. */
  primaryCamera: number;
  sourcePathIdx: number;
  /** Exactly what the tab's viewer will receive — build it with the helper above. */
  refreshKey: string;
}

/**
 * Fill the shared cache right after a source validates, before the user opens
 * the viewer. Frame 1 of every camera goes first (its response carries the
 * frame count), then frames 2..WARMUP_FRAME_LIMIT round-robin across cameras
 * at WARMUP_CONCURRENCY. Fetches under the viewer's default image settings.
 *
 * A failed frame is logged and skipped: the viewer fetches it on demand, and a
 * warmup must never surface an error the validation itself did not.
 */
export function warmCalibrationFrameCache({
  backendUrl, cameras, primaryCamera, sourcePathIdx, refreshKey,
}: WarmCalibrationFrameCacheArgs): void {
  warmupController?.abort();
  const controller = new AbortController();
  warmupController = controller;
  const { signal } = controller;

  const load = (camera: number, idx: number) => loadFrame(
    frameCacheKey(sourcePathIdx, camera, idx, DEFAULT_VIEWER_IMAGE_FORMAT, refreshKey),
    frameUrl(backendUrl, sourcePathIdx, camera, idx, DEFAULT_VIEWER_IMAGE_FORMAT),
    signal,
  );
  const report = (camera: number, idx: number, e: unknown) => {
    if (!isAbortError(e)) {
      console.warn(`[warmCalibrationFrameCache] camera ${camera} frame ${idx}: ${errorMessage(e)}`);
    }
  };

  const frameCounts = new Map<number, number>();

  /** Frame 1 also carries the frame count, so it must lead for every camera. */
  const learn = async (camera: number) => {
    try {
      const first = await load(camera, 1);
      frameCounts.set(camera, first.frameCount);
    } catch (e) {
      report(camera, 1, e);
    }
  };

  const drain = async (order: number[]) => {
    const jobs: { camera: number; idx: number }[] = [];
    for (const camera of order) {
      const total = frameCounts.get(camera);
      if (total === undefined) continue;
      for (let idx = 2; idx <= Math.min(WARMUP_FRAME_LIMIT, total); idx++) {
        jobs.push({ camera, idx });
      }
    }
    const worker = async () => {
      for (let job = jobs.shift(); job && !signal.aborted; job = jobs.shift()) {
        try {
          await load(job.camera, job.idx);
        } catch (e) {
          report(job.camera, job.idx, e);
        }
      }
    };
    await Promise.all(Array.from({ length: WARMUP_CONCURRENCY }, worker));
  };

  (async () => {
    // The camera on screen is warmed to completion first, and its frame 1 runs
    // uncontended. Fetching every camera's frame 1 in one Promise.all made the
    // frame the user is actually waiting for queue behind cameras they are not
    // looking at — on a 4-camera rig, a 4x slower first paint.
    const others = cameras.filter((c) => c !== primaryCamera);
    await learn(primaryCamera);
    if (signal.aborted) return;
    await drain([primaryCamera]);
    if (signal.aborted) return;

    // Then the rest, so a camera switch finds them already cached.
    await Promise.all(others.map(learn));
    if (signal.aborted) return;
    await drain(others);
  })();
}

/**
 * Hook for viewing calibration images with caching and prefetching.
 *
 * Similar to useImagePair but designed for single-frame calibration images.
 * Overlay rendering uses saved detection data passed to the component. Frames
 * come from the module-scope cache above, so a remounted viewer (tab switch)
 * paints from memory.
 */
export function useCalibrationImageViewer(
  backendUrl: string,
  sourcePathIdx: number,
  camera: number,
  idx: number,
  imageFormat: CalibrationViewerImageFormat = DEFAULT_VIEWER_IMAGE_FORMAT,
  autoLimits: boolean = DEFAULT_VIEWER_AUTO_LIMITS,
  refreshKey?: string,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [stats, setStats] = useState<CalibrationFrame['stats'] | null>(null);

  // Contrast values as percentages (0-100)
  const [vmin, setVmin] = useState(0);
  const [vmax, setVmax] = useState(100);

  // This instance's prefetch requests. Created lazily, aborted only when the
  // key namespace changes — never per navigation (see prefetchSurrounding).
  const prefetchAbortControllerRef = useRef<AbortController | null>(null);
  const frameCountRef = useRef<number>(0);

  const getCacheKey = useCallback((frameIdx: number) => {
    return frameCacheKey(sourcePathIdx, camera, frameIdx, imageFormat, refreshKey);
  }, [sourcePathIdx, camera, imageFormat, refreshKey]);

  const buildFrameUrl = useCallback((frameIdx: number) => {
    return frameUrl(backendUrl, sourcePathIdx, camera, frameIdx, imageFormat);
  }, [backendUrl, camera, sourcePathIdx, imageFormat]);

  // Cancel this instance's prefetch requests
  const cancelPrefetches = useCallback(() => {
    if (prefetchAbortControllerRef.current) {
      prefetchAbortControllerRef.current.abort();
      prefetchAbortControllerRef.current = null;
    }
  }, []);

  // Prefetch a single frame into the shared cache
  const prefetchFrame = useCallback(async (frameIdx: number, signal?: AbortSignal) => {
    if (frameIdx < 1) return;
    const cacheKey = getCacheKey(frameIdx);
    if (frameCache.has(cacheKey) || inFlight.has(cacheKey)) return;
    try {
      await loadFrame(cacheKey, buildFrameUrl(frameIdx), signal);
    } catch {
      // Silent fail for prefetch: the viewer fetches the frame on demand.
    }
  }, [getCacheKey, buildFrameUrl]);

  // Prefetch surrounding frames for smooth playback.
  // Does NOT cancel in-flight requests — lets existing fetches complete while
  // adding new ones. Cancelling per navigation caused the cancel→refetch→cancel
  // loop that stalls playback (the same fix useImagePair carries).
  const prefetchSurrounding = useCallback((currentIdx: number, count: number = PREFETCH_WINDOW) => {
    if (!prefetchAbortControllerRef.current) {
      prefetchAbortControllerRef.current = new AbortController();
    }
    const signal = prefetchAbortControllerRef.current.signal;

    // Prefetch forward (with upper bound check)
    for (let i = 1; i <= count; i++) {
      const targetIdx = currentIdx + i;
      if (frameCountRef.current > 0 && targetIdx > frameCountRef.current) {
        break;  // Stop if we exceed known frame count
      }
      prefetchFrame(targetIdx, signal);
    }
    // Prefetch backward
    for (let i = 1; i <= Math.min(count, 2); i++) {
      if (currentIdx - i > 0) {
        prefetchFrame(currentIdx - i, signal);
      }
    }
  }, [prefetchFrame]);

  // Fetch current frame
  useEffect(() => {
    const abortController = new AbortController();
    let cancelled = false;

    const apply = (frame: CalibrationFrame) => {
      setImage(frame.image);
      setWidth(frame.width);
      setHeight(frame.height);
      setFrameCount(frame.frameCount);
      frameCountRef.current = frame.frameCount;
      setStats(frame.stats);
      if (autoLimits && frame.stats) {
        setVmin(frame.stats.vmin_pct);
        setVmax(frame.stats.vmax_pct);
      }
      setError(null);
    };

    const cacheKey = getCacheKey(idx);
    const cached = cacheGet(cacheKey);
    if (cached) {
      apply(cached);
      setLoading(false);
      prefetchSurrounding(idx);
    } else {
      setLoading(true);
      setError(null);
      loadFrame(cacheKey, buildFrameUrl(idx), abortController.signal)
        .then((frame) => {
          if (cancelled) return;
          apply(frame);
          prefetchSurrounding(idx);
        })
        .catch((e) => {
          if (cancelled || isAbortError(e)) return;
          setError(errorMessage(e));
          console.error('[useCalibrationImageViewer] Error fetching frame:', e);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [idx, getCacheKey, buildFrameUrl, autoLimits, prefetchSurrounding]);

  // The key namespace changed: this instance's in-flight prefetches are for
  // frames it will not show. The shared cache is NOT cleared here — its keys
  // already isolate the old namespace, and clearing on every mount would defeat
  // the tab-switch survival the module-scope cache exists for.
  useEffect(() => {
    cancelPrefetches();
  }, [sourcePathIdx, camera, imageFormat, cancelPrefetches, backendUrl, refreshKey]);

  return {
    // Image state
    loading,
    error,
    image,
    width,
    height,
    frameCount,
    stats,

    // Contrast controls
    vmin,
    setVmin,
    vmax,
    setVmax,

    // Cache management
    prefetchFrame,
    prefetchSurrounding,
    cancelPrefetches,
  };
}
