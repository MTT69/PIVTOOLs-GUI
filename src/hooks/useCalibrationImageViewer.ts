import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Cache entry for prefetched calibration frames
 */
interface PrefetchedFrame {
  idx: number;
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
}


// Cache constants
const MAX_CACHE_SIZE = 15;
const PREFETCH_WINDOW = 3;

/**
 * Hook for viewing calibration images with caching and prefetching.
 *
 * Similar to useImagePair but designed for single-frame calibration images.
 * Overlay rendering uses saved detection data passed to the component.
 */
export function useCalibrationImageViewer(
  backendUrl: string,
  sourcePathIdx: number,
  camera: number,
  idx: number,
  imageFormat: 'jpeg' | 'png' = 'jpeg',
  autoLimits: boolean = true,
  calibrationType: 'pinhole' | 'charuco' | 'stereo' | 'stereo-charuco' = 'pinhole'
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [stats, setStats] = useState<{
    min: number;
    max: number;
    mean: number;
    vmin_pct: number;
    vmax_pct: number;
  } | null>(null);

  // Contrast values as percentages (0-100)
  const [vmin, setVmin] = useState(0);
  const [vmax, setVmax] = useState(100);


  // Prefetch buffer
  const prefetchBufferRef = useRef<Map<string, PrefetchedFrame>>(new Map());
  const prefetchInProgressRef = useRef<Set<string>>(new Set());
  const prefetchAbortControllerRef = useRef<AbortController | null>(null);
  const currentTargetIdxRef = useRef<number>(idx);

  // Generate cache key
  const getCacheKey = useCallback((frameIdx: number) => {
    return `${sourcePathIdx}-${camera}-${frameIdx}-${imageFormat}-${autoLimits}-${calibrationType}`;
  }, [sourcePathIdx, camera, imageFormat, autoLimits, calibrationType]);

  // Build frame URL based on calibration type
  const buildFrameUrl = useCallback((frameIdx: number) => {
    if (calibrationType === 'stereo') {
      // Stereo pinhole uses different endpoint structure
      return `${backendUrl}/calibration/stereo/pinhole/frame/${frameIdx}?camera=${camera}&source_path_idx=${sourcePathIdx}`;
    }
    if (calibrationType === 'stereo-charuco') {
      // Stereo ChArUco uses different endpoint structure
      return `${backendUrl}/calibration/stereo/charuco/frame/${frameIdx}?camera=${camera}&source_path_idx=${sourcePathIdx}`;
    }
    // Pinhole and charuco use the shared endpoint
    return `${backendUrl}/calibration/get_frame?camera=${camera}&idx=${frameIdx}&source_path_idx=${sourcePathIdx}&format=${imageFormat}&auto_limits=${autoLimits}`;
  }, [backendUrl, camera, sourcePathIdx, imageFormat, autoLimits, calibrationType]);

  // Cancel all prefetch requests
  const cancelPrefetches = useCallback(() => {
    if (prefetchAbortControllerRef.current) {
      prefetchAbortControllerRef.current.abort();
      prefetchAbortControllerRef.current = null;
    }
    prefetchInProgressRef.current.clear();
  }, []);

  // Clean cache to keep frames around target index
  const cleanCache = useCallback((targetIdx: number) => {
    const buffer = prefetchBufferRef.current;
    if (buffer.size <= MAX_CACHE_SIZE) return;

    const entries = Array.from(buffer.entries());
    // Sort by distance from target
    entries.sort((a, b) => {
      const distA = Math.abs(a[1].idx - targetIdx);
      const distB = Math.abs(b[1].idx - targetIdx);
      return distA - distB;
    });

    // Keep closest frames
    const toKeep = new Set(entries.slice(0, MAX_CACHE_SIZE).map(e => e[0]));
    for (const key of buffer.keys()) {
      if (!toKeep.has(key)) {
        buffer.delete(key);
      }
    }
  }, []);

  // Prefetch a single frame
  const prefetchFrame = useCallback(async (frameIdx: number, signal?: AbortSignal) => {
    if (frameIdx < 1) return;

    const cacheKey = getCacheKey(frameIdx);

    // Skip if already cached or in progress
    if (prefetchBufferRef.current.has(cacheKey) || prefetchInProgressRef.current.has(cacheKey)) {
      return;
    }

    prefetchInProgressRef.current.add(cacheKey);

    try {
      const url = buildFrameUrl(frameIdx);
      const res = await fetch(url, { signal });

      if (!res.ok) {
        prefetchInProgressRef.current.delete(cacheKey);
        return;
      }

      const json = await res.json();

      prefetchBufferRef.current.set(cacheKey, {
        idx: frameIdx,
        image: json.image,
        stats: json.stats,
        width: json.width,
        height: json.height,
      });

      cleanCache(currentTargetIdxRef.current);
    } catch (e: any) {
      // Silent fail for prefetch
    } finally {
      prefetchInProgressRef.current.delete(cacheKey);
    }
  }, [getCacheKey, buildFrameUrl, cleanCache]);

  // Prefetch surrounding frames
  const prefetchSurrounding = useCallback((currentIdx: number, count: number = PREFETCH_WINDOW) => {
    cancelPrefetches();
    currentTargetIdxRef.current = currentIdx;

    const abortController = new AbortController();
    prefetchAbortControllerRef.current = abortController;
    const signal = abortController.signal;

    // Prefetch forward
    for (let i = 1; i <= count; i++) {
      prefetchFrame(currentIdx + i, signal);
    }
    // Prefetch backward
    for (let i = 1; i <= Math.min(count, 2); i++) {
      if (currentIdx - i > 0) {
        prefetchFrame(currentIdx - i, signal);
      }
    }
  }, [prefetchFrame, cancelPrefetches]);

  // Fetch current frame
  useEffect(() => {
    const abortController = new AbortController();
    let cancelled = false;

    cancelPrefetches();
    currentTargetIdxRef.current = idx;

    const fetchFrame = async () => {
      const cacheKey = getCacheKey(idx);

      // Check cache first
      const cached = prefetchBufferRef.current.get(cacheKey);
      if (cached) {
        setImage(cached.image);
        setWidth(cached.width);
        setHeight(cached.height);
        setStats(cached.stats);
        if (autoLimits && cached.stats) {
          setVmin(cached.stats.vmin_pct);
          setVmax(cached.stats.vmax_pct);
        }
        setError(null);
        setLoading(false);
        prefetchSurrounding(idx);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const url = buildFrameUrl(idx);
        const res = await fetch(url, { signal: abortController.signal });

        if (cancelled) return;

        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || `Calibration image not found (frame ${idx})`);
        }

        setImage(json.image);
        setWidth(json.width);
        setHeight(json.height);
        setFrameCount(json.frame_count);
        setStats(json.stats);

        if (autoLimits && json.stats) {
          setVmin(json.stats.vmin_pct);
          setVmax(json.stats.vmax_pct);
        }

        prefetchSurrounding(idx);

      } catch (e: any) {
        if (e.name === 'AbortError') return;
        setError(e.message);
        console.error('[useCalibrationImageViewer] Error fetching frame:', e);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchFrame();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [idx, getCacheKey, buildFrameUrl, autoLimits, prefetchSurrounding, cancelPrefetches]);

  // Clear cache when parameters change
  useEffect(() => {
    cancelPrefetches();
    prefetchBufferRef.current.clear();
  }, [sourcePathIdx, camera, imageFormat, autoLimits, calibrationType, cancelPrefetches]);

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
