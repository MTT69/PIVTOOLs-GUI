import { useState, useEffect, useRef, useCallback } from 'react';
import { RawImage, DType, decodeTypedArray, percentileFromRaw } from '@/lib/imageUtils';

// Prefetch buffer for smooth playback
interface PrefetchedFrame {
  index: number;
  imgA: string | null;
  imgB: string | null;
  vmin: number;
  vmax: number;
}

// Constants for cache management
const MAX_CACHE_SIZE = 30;
const PREFETCH_WINDOW = 5; // Frames to prefetch ahead (reduced for lighter load)
const PINNED_FRAME = 1; // Frame 1 should always stay in cache

export function useImagePair(
  backendUrl: string,
  sourcePathIdx: number,
  camera: string,
  index: number,
  imageFormat: 'jpeg' | 'png' = 'jpeg',
  autoLimits: boolean = false,
  enabled: boolean = true  // When false, disables auto-fetching (e.g., during processed playback)
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgA, setImgA] = useState<string | null>(null);
  const [imgB, setImgB] = useState<string | null>(null);
  const [imgARaw, setImgARaw] = useState<RawImage | null>(null);
  const [imgBRaw, setImgBRaw] = useState<RawImage | null>(null);
  const [metadata, setMetadata] = useState<{ bitDepth?: number, dtype?: DType, dims?: { w: number, h: number } } | null>(null);
  const [vmin, setVmin] = useState(0);
  const [vmax, setVmax] = useState(255);

  // Prefetch buffer for smooth playback
  const prefetchBufferRef = useRef<Map<string, PrefetchedFrame>>(new Map());
  const prefetchInProgressRef = useRef<Set<string>>(new Set());

  // AbortController for cancelling prefetch requests
  const prefetchAbortControllerRef = useRef<AbortController | null>(null);

  // Track the current "target" index to cancel prefetches when it changes
  const currentTargetIndexRef = useRef<number>(index);

  // Generate cache key for prefetch buffer
  const getCacheKey = useCallback((idx: number) => {
    return `${sourcePathIdx}-${camera}-${idx}-${imageFormat}-${autoLimits}`;
  }, [sourcePathIdx, camera, imageFormat, autoLimits]);

  // Cancel all in-progress prefetch requests
  const cancelPrefetches = useCallback(() => {
    if (prefetchAbortControllerRef.current) {
      prefetchAbortControllerRef.current.abort();
      prefetchAbortControllerRef.current = null;
    }
    prefetchInProgressRef.current.clear();
  }, []);

  // Clean cache to keep only frames around target index (with frame 1 pinning)
  const cleanCache = useCallback((targetIdx: number) => {
    const buffer = prefetchBufferRef.current;
    if (buffer.size <= MAX_CACHE_SIZE) return;

    // Get all cached frame indices, separating pinned and evictable
    const entries = Array.from(buffer.entries());
    const pinnedEntries = entries.filter(e => e[1].index === PINNED_FRAME);
    const evictableEntries = entries.filter(e => e[1].index !== PINNED_FRAME);

    // Sort evictable by distance from target
    evictableEntries.sort((a, b) => {
      const distA = Math.abs(a[1].index - targetIdx);
      const distB = Math.abs(b[1].index - targetIdx);
      return distA - distB;
    });

    // Keep pinned frames plus closest evictable frames up to MAX_CACHE_SIZE
    const evictableToKeep = MAX_CACHE_SIZE - pinnedEntries.length;
    const toKeep = new Set([
      ...pinnedEntries.map(e => e[0]),
      ...evictableEntries.slice(0, evictableToKeep).map(e => e[0])
    ]);

    for (const key of buffer.keys()) {
      if (!toKeep.has(key)) {
        buffer.delete(key);
      }
    }
  }, []);

  // Prefetch a single frame with cancellation support
  const prefetchFrame = useCallback(async (idx: number, signal?: AbortSignal) => {
    const cacheKey = getCacheKey(idx);

    // Skip if already in buffer or being fetched
    if (prefetchBufferRef.current.has(cacheKey) || prefetchInProgressRef.current.has(cacheKey)) {
      return;
    }

    prefetchInProgressRef.current.add(cacheKey);

    try {
      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);
      const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${idx}&source_path_idx=${sourcePathIdx}&format=${imageFormat}&auto_limits=${autoLimits}`;
      const res = await fetch(url, { signal });

      if (!res.ok) {
        prefetchInProgressRef.current.delete(cacheKey);
        return;
      }

      const json = await res.json();

      // Store in prefetch buffer
      // Stats are now percentages (0-100), default to full range if missing
      prefetchBufferRef.current.set(cacheKey, {
        index: idx,
        imgA: json.A || null,
        imgB: json.B || null,
        vmin: json.stats?.A?.vmin_pct ?? 0,
        vmax: json.stats?.A?.vmax_pct ?? 100,
      });

      // Clean cache if it's getting too large
      cleanCache(currentTargetIndexRef.current);
    } catch (e: any) {
      // Silent fail for prefetch (including AbortError)
      if (e.name !== 'AbortError') {
        // Only log non-abort errors
      }
    } finally {
      prefetchInProgressRef.current.delete(cacheKey);
    }
  }, [backendUrl, camera, sourcePathIdx, imageFormat, autoLimits, getCacheKey, cleanCache]);

  // Prefetch surrounding frames for smooth playback
  // Does NOT cancel in-flight requests — lets existing fetches complete while adding new ones.
  // This prevents the cancel→refetch→cancel loop that caused playback stalls after ~15 frames.
  const prefetchSurrounding = useCallback((currentIdx: number, count: number = PREFETCH_WINDOW) => {
    // Update the target index
    currentTargetIndexRef.current = currentIdx;

    // Reuse existing AbortController if one exists, otherwise create new
    if (!prefetchAbortControllerRef.current) {
      prefetchAbortControllerRef.current = new AbortController();
    }
    const signal = prefetchAbortControllerRef.current.signal;

    // Prefetch next N frames (prioritize forward direction)
    // prefetchFrame already skips frames that are cached or in-flight
    for (let i = 1; i <= count; i++) {
      prefetchFrame(currentIdx + i, signal);
    }
    // Also prefetch a few previous frames for reverse playback
    const backwardCount = Math.min(count, 3);
    for (let i = 1; i <= backwardCount; i++) {
      if (currentIdx - i > 0) {
        prefetchFrame(currentIdx - i, signal);
      }
    }

    // Clean cache around current position
    cleanCache(currentIdx);
  }, [prefetchFrame, cleanCache]);

  const fetchPair = useCallback(async () => {
    if (!camera) return;

    const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);
    const cacheKey = getCacheKey(index);

    // Check prefetch buffer first
    const prefetched = prefetchBufferRef.current.get(cacheKey);
    if (prefetched) {
      setImgA(prefetched.imgA);
      setImgB(prefetched.imgB);
      setVmin(prefetched.vmin);
      setVmax(prefetched.vmax);
      setMetadata({ bitDepth: 8, dtype: 'uint8' });
      setImgARaw(null);
      setImgBRaw(null);
      setError(null);

      // Prefetch ahead for smooth playback
      prefetchSurrounding(index);
      return;
    }

    setLoading(true);
    setError(null);
    setImgA(null); setImgB(null); setImgARaw(null); setImgBRaw(null);

    try {
      const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${index}&source_path_idx=${sourcePathIdx}&format=${imageFormat}&auto_limits=${autoLimits}`;
      const res = await fetch(url);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || `Image pair not found (frame ${index})`);
      }

      // Check for raw image fields and meta (for 16-bit support)
      if (json.meta?.width && (json.A_raw || json.B_raw)) {
        const meta = json.meta;
        setMetadata({ bitDepth: meta.bitDepth, dtype: meta.dtype, dims: { w: meta.width, h: meta.height } });
        let rawA = null, rawB = null;
        if (json.A_raw) {
          try {
            rawA = { ...meta, data: decodeTypedArray(json.A_raw, meta.dtype) };
          } catch (err) {
            const msg = typeof err === 'object' && err !== null && 'message' in err ? (err as any).message : String(err);
            setError('Failed to decode A_raw: ' + msg);
            rawA = null;
          }
        }
        if (json.B_raw) {
          try {
            rawB = { ...meta, data: decodeTypedArray(json.B_raw, meta.dtype) };
          } catch (err) {
            const msg = typeof err === 'object' && err !== null && 'message' in err ? (err as any).message : String(err);
            setError('Failed to decode B_raw: ' + msg);
            rawB = null;
          }
        }
        setImgARaw(rawA);
        setImgBRaw(rawB);

        // Use server-provided stats (percentages 0-100)
        if (json.stats?.A) {
          setVmin(json.stats.A.vmin_pct);
          setVmax(json.stats.A.vmax_pct);
        } else if (rawA && rawA.data) {
          // Fallback: calculate from raw data as percentage
          const p1 = percentileFromRaw(rawA.data, 1);
          const p99 = percentileFromRaw(rawA.data, 99);
          const dataArr = Array.from(rawA.data) as number[];
          const dataMin = Math.min(...dataArr);
          const dataMax = Math.max(...dataArr);
          const range = dataMax - dataMin || 1;
          setVmin(Math.round(100 * (p1 - dataMin) / range));
          setVmax(Math.round(100 * (p99 - dataMin) / range));
        }
      } else {
        // Standard JPEG/PNG response
        setMetadata({ bitDepth: 8, dtype: 'uint8' });
        setImgA(json.A);
        setImgB(json.B);

        // Use server-provided stats (percentages 0-100)
        if (json.stats?.A) {
          setVmin(json.stats.A.vmin_pct);
          setVmax(json.stats.A.vmax_pct);
        } else {
          // Fallback to full range (0-100%)
          setVmin(0);
          setVmax(100);
        }
      }

      // Prefetch surrounding frames for smooth playback
      prefetchSurrounding(index);

    } catch (e: any) {
      setError(e.message);
      if (typeof window !== 'undefined') {
        console.error('[useImagePair] Error fetching image pair:', e);
      }
    } finally {
      setLoading(false);
    }
  }, [backendUrl, sourcePathIdx, camera, index, imageFormat, getCacheKey, prefetchSurrounding]);

  // Auto-fetch when parameters change with abort controller for cancellation
  useEffect(() => {
    // Skip fetch when disabled (e.g., during processed playback to avoid bandwidth competition)
    if (!enabled) {
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;

    // Only cancel prefetches when the frame is NOT cached (manual navigation / cache miss).
    // During playback, frames advance only when cached — cancelling would kill the
    // prefetch pipeline that keeps the cache fed, causing stalls after ~15 frames.
    const cacheKey = getCacheKey(index);
    if (!prefetchBufferRef.current.has(cacheKey)) {
      cancelPrefetches();
    }

    // Update target index
    currentTargetIndexRef.current = index;

    const fetchPairWithCancel = async () => {
      if (!camera) return;

      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);
      const cacheKey = getCacheKey(index);

      // Check prefetch buffer first
      const prefetched = prefetchBufferRef.current.get(cacheKey);
      if (prefetched) {
        setImgA(prefetched.imgA);
        setImgB(prefetched.imgB);
        setVmin(prefetched.vmin);
        setVmax(prefetched.vmax);
        setMetadata({ bitDepth: 8, dtype: 'uint8' });
        setImgARaw(null);
        setImgBRaw(null);
        setError(null);
        setLoading(false);

        // Prefetch ahead
        prefetchSurrounding(index);
        return;
      }

      setLoading(true);
      setError(null);
      setImgA(null); setImgB(null); setImgARaw(null); setImgBRaw(null);

      try {
        const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${index}&source_path_idx=${sourcePathIdx}&format=${imageFormat}&auto_limits=${autoLimits}`;
        const res = await fetch(url, { signal: abortController.signal });

        if (cancelled) return;

        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || `Image pair not found (frame ${index})`);
        }

        // Check for raw image fields and meta
        if (json.meta?.width && (json.A_raw || json.B_raw)) {
          const meta = json.meta;
          setMetadata({ bitDepth: meta.bitDepth, dtype: meta.dtype, dims: { w: meta.width, h: meta.height } });
          let rawA = null, rawB = null;
          if (json.A_raw) {
            try {
              rawA = { ...meta, data: decodeTypedArray(json.A_raw, meta.dtype) };
            } catch (err) {
              const msg = typeof err === 'object' && err !== null && 'message' in err ? (err as any).message : String(err);
              setError('Failed to decode A_raw: ' + msg);
              rawA = null;
            }
          }
          if (json.B_raw) {
            try {
              rawB = { ...meta, data: decodeTypedArray(json.B_raw, meta.dtype) };
            } catch (err) {
              const msg = typeof err === 'object' && err !== null && 'message' in err ? (err as any).message : String(err);
              setError('Failed to decode B_raw: ' + msg);
              rawB = null;
            }
          }
          setImgARaw(rawA);
          setImgBRaw(rawB);

          // Use server stats (percentages 0-100)
          if (json.stats?.A) {
            setVmin(json.stats.A.vmin_pct);
            setVmax(json.stats.A.vmax_pct);
          } else if (rawA && rawA.data) {
            // Fallback: calculate from raw data as percentage
            const p1 = percentileFromRaw(rawA.data, 1);
            const p99 = percentileFromRaw(rawA.data, 99);
            const dataArr = Array.from(rawA.data) as number[];
            const dataMin = Math.min(...dataArr);
            const dataMax = Math.max(...dataArr);
            const range = dataMax - dataMin || 1;
            setVmin(Math.round(100 * (p1 - dataMin) / range));
            setVmax(Math.round(100 * (p99 - dataMin) / range));
          }
        } else {
          // Standard response
          setMetadata({ bitDepth: 8, dtype: 'uint8' });
          setImgA(json.A);
          setImgB(json.B);

          // Use server-provided stats (percentages 0-100)
          if (json.stats?.A) {
            setVmin(json.stats.A.vmin_pct);
            setVmax(json.stats.A.vmax_pct);
          } else {
            setVmin(0);
            setVmax(100);
          }
        }

        // Prefetch surrounding frames
        prefetchSurrounding(index);

      } catch (e: any) {
        if (e.name === 'AbortError') {
          return;
        }
        setError(e.message);
        if (typeof window !== 'undefined') {
          console.error('[useImagePair] Error fetching image pair:', e);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchPairWithCancel();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [backendUrl, sourcePathIdx, camera, index, imageFormat, autoLimits, getCacheKey, prefetchSurrounding, cancelPrefetches, enabled]);

  // Track previous camera to detect camera switches
  const prevCameraRef = useRef(camera);

  // Clear prefetch buffer and cancel prefetches when source/camera/format changes
  // Also clear backend cache on camera switch for faster loading
  useEffect(() => {
    cancelPrefetches();
    prefetchBufferRef.current.clear();

    // Clear backend raw cache on camera switch (non-blocking fire-and-forget)
    if (prevCameraRef.current !== camera) {
      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);
      fetch(`${backendUrl}/clear_raw_cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exclude_camera: cameraNumber }),
      }).catch(() => {}); // Silent fail — cache clear is best-effort
      prevCameraRef.current = camera;
    }
  }, [sourcePathIdx, camera, imageFormat, autoLimits, cancelPrefetches, backendUrl]);

  // Check if a frame is in the prefetch cache
  const isFrameCached = useCallback((idx: number): boolean => {
    const cacheKey = getCacheKey(idx);
    return prefetchBufferRef.current.has(cacheKey);
  }, [getCacheKey]);

  return {
    loading,
    error,
    imgA,
    imgB,
    imgARaw,
    imgBRaw,
    metadata,
    vmin,
    setVmin,
    vmax,
    setVmax,
    reload: fetchPair,
    prefetchFrame,
    prefetchSurrounding,
    cancelPrefetches,
    isFrameCached
  };
}
