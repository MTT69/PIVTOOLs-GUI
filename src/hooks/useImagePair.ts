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

  // Generate cache key for prefetch buffer
  const getCacheKey = useCallback((idx: number) => {
    return `${sourcePathIdx}-${camera}-${idx}-${imageFormat}`;
  }, [sourcePathIdx, camera, imageFormat]);

  // Prefetch a single frame
  const prefetchFrame = useCallback(async (idx: number) => {
    const cacheKey = getCacheKey(idx);

    // Skip if already in buffer or being fetched
    if (prefetchBufferRef.current.has(cacheKey) || prefetchInProgressRef.current.has(cacheKey)) {
      return;
    }

    prefetchInProgressRef.current.add(cacheKey);

    try {
      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);
      const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${idx}&source_path_idx=${sourcePathIdx}&format=${imageFormat}`;
      const res = await fetch(url);

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

      // Limit buffer size to prevent memory issues (keep last 20 frames)
      if (prefetchBufferRef.current.size > 20) {
        const keys = Array.from(prefetchBufferRef.current.keys());
        // Remove oldest entries
        for (let i = 0; i < keys.length - 15; i++) {
          prefetchBufferRef.current.delete(keys[i]);
        }
      }
    } catch (e) {
      // Silent fail for prefetch
    } finally {
      prefetchInProgressRef.current.delete(cacheKey);
    }
  }, [backendUrl, camera, sourcePathIdx, imageFormat, getCacheKey]);

  // Prefetch surrounding frames for smooth playback
  const prefetchSurrounding = useCallback((currentIdx: number, count: number = 5) => {
    // Prefetch next N frames
    for (let i = 1; i <= count; i++) {
      prefetchFrame(currentIdx + i);
    }
    // Also prefetch a couple previous frames for reverse playback
    for (let i = 1; i <= 2; i++) {
      if (currentIdx - i > 0) {
        prefetchFrame(currentIdx - i);
      }
    }
  }, [prefetchFrame]);

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
  }, [backendUrl, sourcePathIdx, camera, index, imageFormat, getCacheKey, prefetchSurrounding]);

  // Clear prefetch buffer when source/camera changes
  useEffect(() => {
    prefetchBufferRef.current.clear();
  }, [sourcePathIdx, camera]);

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
    prefetchSurrounding
  };
}
