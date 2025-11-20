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
const PREFETCH_WINDOW = 10; // Frames to load around current position

export function useImagePair(
  backendUrl: string,
  sourcePathIdx: number,
  camera: string,
  index: number,
  imageFormat: 'jpeg' | 'png' = 'jpeg'
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
    return `${sourcePathIdx}-${camera}-${idx}-${imageFormat}`;
  }, [sourcePathIdx, camera, imageFormat]);

  // Cancel all in-progress prefetch requests
  const cancelPrefetches = useCallback(() => {
    if (prefetchAbortControllerRef.current) {
      prefetchAbortControllerRef.current.abort();
      prefetchAbortControllerRef.current = null;
    }
    prefetchInProgressRef.current.clear();
  }, []);

  // Clean cache to keep only frames around target index
  const cleanCache = useCallback((targetIdx: number) => {
    const buffer = prefetchBufferRef.current;
    if (buffer.size <= MAX_CACHE_SIZE) return;

    // Get all cached frame indices
    const entries = Array.from(buffer.entries());

    // Sort by distance from target
    entries.sort((a, b) => {
      const distA = Math.abs(a[1].index - targetIdx);
      const distB = Math.abs(b[1].index - targetIdx);
      return distA - distB;
    });

    // Keep only the closest frames up to MAX_CACHE_SIZE
    const toKeep = new Set(entries.slice(0, MAX_CACHE_SIZE).map(e => e[0]));

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
      const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${idx}&source_path_idx=${sourcePathIdx}&format=${imageFormat}`;
      const res = await fetch(url, { signal });

      if (!res.ok) {
        prefetchInProgressRef.current.delete(cacheKey);
        return;
      }

      const json = await res.json();

      // Store in prefetch buffer
      prefetchBufferRef.current.set(cacheKey, {
        index: idx,
        imgA: json.A || null,
        imgB: json.B || null,
        vmin: json.stats?.A?.vmin ?? 0,
        vmax: json.stats?.A?.vmax ?? 255,
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
  }, [backendUrl, camera, sourcePathIdx, imageFormat, getCacheKey, cleanCache]);

  // Prefetch surrounding frames for smooth playback
  const prefetchSurrounding = useCallback((currentIdx: number, count: number = PREFETCH_WINDOW) => {
    // Cancel any previous prefetch operations
    cancelPrefetches();

    // Update the target index
    currentTargetIndexRef.current = currentIdx;

    // Create new AbortController for this batch of prefetches
    const abortController = new AbortController();
    prefetchAbortControllerRef.current = abortController;
    const signal = abortController.signal;

    // Prefetch next N frames (prioritize forward direction)
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
  }, [prefetchFrame, cancelPrefetches]);

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
      const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${index}&source_path_idx=${sourcePathIdx}&format=${imageFormat}`;
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

        // Use server-provided stats if available, otherwise calculate from raw
        if (json.stats?.A) {
          setVmin(json.stats.A.vmin);
          setVmax(json.stats.A.vmax);
        } else if (rawA && rawA.data) {
          const newVmin = Math.floor(percentileFromRaw(rawA.data, 1));
          const newVmax = Math.ceil(percentileFromRaw(rawA.data, 99));
          setVmin(newVmin);
          setVmax(newVmax);
        }
      } else {
        // Standard JPEG/PNG response
        setMetadata({ bitDepth: 8, dtype: 'uint8' });
        setImgA(json.A);
        setImgB(json.B);

        // Use server-provided stats (NO frontend calculation - this was the bottleneck!)
        if (json.stats?.A) {
          setVmin(json.stats.A.vmin);
          setVmax(json.stats.A.vmax);
        } else {
          // Fallback to defaults - do NOT calculate in JS
          setVmin(0);
          setVmax(255);
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
    const abortController = new AbortController();
    let cancelled = false;

    // Cancel previous prefetches when frame changes
    cancelPrefetches();

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
        const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${index}&source_path_idx=${sourcePathIdx}&format=${imageFormat}`;
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

          // Use server stats
          if (json.stats?.A) {
            setVmin(json.stats.A.vmin);
            setVmax(json.stats.A.vmax);
          } else if (rawA && rawA.data) {
            const newVmin = Math.floor(percentileFromRaw(rawA.data, 1));
            const newVmax = Math.ceil(percentileFromRaw(rawA.data, 99));
            setVmin(newVmin);
            setVmax(newVmax);
          }
        } else {
          // Standard response
          setMetadata({ bitDepth: 8, dtype: 'uint8' });
          setImgA(json.A);
          setImgB(json.B);

          // Use server-provided stats
          if (json.stats?.A) {
            setVmin(json.stats.A.vmin);
            setVmax(json.stats.A.vmax);
          } else {
            setVmin(0);
            setVmax(255);
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
  }, [backendUrl, sourcePathIdx, camera, index, imageFormat, getCacheKey, prefetchSurrounding, cancelPrefetches]);

  // Clear prefetch buffer and cancel prefetches when source/camera/format changes
  useEffect(() => {
    cancelPrefetches();
    prefetchBufferRef.current.clear();
  }, [sourcePathIdx, camera, imageFormat, cancelPrefetches]);

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
    cancelPrefetches
  };
}
