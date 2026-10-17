import { useState, useCallback, useEffect, useRef } from 'react';
import { ApiError, fetchJson, postJson, errorMessage } from '@/lib/api';
import type { DisplayBounds, DisplayStats } from '@/hooks/useImagePair';

export type FilterType =
  | "time" | "pod"  // Batch filters
  | "lmax" | "maxnorm" | "meannorm" | "median" | "norm" | "norm2" | "ssmin" | "gaussian" | "invert" | "clahe";  // Spatial filters

export interface ImageFilter {
  type: FilterType;
  size?: [number, number];  // For spatial filters like median, lmax, maxnorm, norm
  sigma?: number;  // For gaussian
  clip_limit?: number;  // For clahe
  tile_grid_size?: [number, number];  // For clahe
  max_gain?: number;  // For maxnorm, norm
  threshold?: number;  // For lmax
  n?: number;  // For time (temporal) filter
  offset?: number;  // For time (temporal) filter
  white?: number;  // For norm
  bg?: [number, number];  // For background subtraction
  [key: string]: any;  // Allow dynamic filter parameter access
}

export function useImageFilters(backendUrl: string) {
  const [filtersInternal, setFiltersInternal] = useState<ImageFilter[]>([]);
  const [procLoading, setProcLoading] = useState(false);
  const [procImgA, setProcImgA] = useState<string | null>(null);
  const [procImgB, setProcImgB] = useState<string | null>(null);
  // Per-frame display stats in the processed frame's intensity units
  const [procStats, setProcStats] = useState<{ A: DisplayStats, B: DisplayStats } | null>(null);
  const [needsProcessing, setNeedsProcessing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [processingBlocked, setProcessingBlocked] = useState(false);
  // True while the in-flight processing request runs a caller-supplied filtersOverride (a display
  // preview, not the user's filter list), so it must not block edits to the user's filters
  const previewInFlightRef = useRef(false);
  // Id of the latest processing request: a response (or its loading-flag reset) from an older one,
  // e.g. the SSMin preview still in flight when saved filters load, must not overwrite the newer one
  const requestIdRef = useRef(0);

  // Wrapper for setFilters that blocks changes while the user's filters are being processed
  const setFilters = useCallback((newFilters: ImageFilter[] | ((prev: ImageFilter[]) => ImageFilter[])) => {
    if (procLoading && !previewInFlightRef.current) {
      setProcessingBlocked(true);
      return false; // Indicate filter change was blocked
    }
    setFiltersInternal(newFilters);
    setLastError(null);
    return true;
  }, [procLoading]);

  // Read-only access to filters
  const filters = filtersInternal;

  // Cancel ongoing processing
  const cancelProcessing = useCallback(async () => {
    try {
      await postJson(`${backendUrl}/processing_status`, { cancel: true });
      setProcLoading(false);
      setProcessingBlocked(false);
    } catch (e) {
      console.error("Failed to cancel processing:", errorMessage(e));
    }
  }, [backendUrl]);

  // filtersOverride: process with these filters instead of the user's list (request-only, never stored)
  // displayBounds: manual display window encoded by /filter_single_frame; null = auto. Batch (time/pod)
  // results come from the store, encoded with the auto window, so the bounds do not apply there.
  const runProcessing = useCallback(async (camera: string, index: number, sourcePathIdx: number, autoLimits: boolean = false, filtersOverride?: ImageFilter[], displayBounds: DisplayBounds | null = null) => {
    const activeFilters = filtersOverride ?? filters;
    const requestId = ++requestIdRef.current;
    const isStale = () => requestId !== requestIdRef.current;
    previewInFlightRef.current = filtersOverride !== undefined;
    setProcLoading(true);
    setLastError(null);
    setNeedsProcessing(false);
    setProcImgA(null);
    setProcImgB(null);
    setProcStats(null);
    try {
      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);

      // Determine if we need batch processing (time/pod filters present)
      const needsBatch = activeFilters.some(f => f.type === 'time' || f.type === 'pod');

      if (needsBatch) {
        // Batch processing for time/pod filters
        await postJson(`${backendUrl}/filter`, {
          camera: cameraNumber,
          start_idx: index,
          count: 1,
          filters: activeFilters,
          source_path_idx: sourcePathIdx,
        });

        // Poll for completion using the new processing_status endpoint
        let attempts = 0;
        const maxAttempts = 120; // 2 minutes max wait for batch processing
        let completed = false;

        while (attempts < maxAttempts && !completed) {
          await new Promise(r => setTimeout(r, 1000));

          // Check status using new endpoint
          const statusJson = await fetchJson(`${backendUrl}/processing_status`);

          if (!statusJson.processing) {
            completed = true;
            break;
          }

          attempts++;
        }

        if (!completed) {
          throw new Error("Processing timeout - batch filter took too long");
        }

        // Fetch the result
        const params = new URLSearchParams({
          type: "processed",
          frame: String(index),
          camera: String(cameraNumber),
          source_path_idx: String(sourcePathIdx),
          auto_limits: String(autoLimits),
        });
        const json = await fetchJson(`${backendUrl}/get_processed_pair?${params.toString()}`);
        if (isStale()) return;

        setProcImgA(json.A ?? null);
        setProcImgB(json.B ?? null);
        if (json.stats) setProcStats(json.stats);
      } else {
        // Spatial filters only - process frame-by-frame on demand
        const json = await postJson(`${backendUrl}/filter_single_frame`, {
          camera: cameraNumber,
          frame_idx: index,
          filters: activeFilters,
          source_path_idx: sourcePathIdx,
          auto_limits: autoLimits,
          ...(displayBounds ?? {}),
        });
        if (isStale()) return;

        setProcImgA(json.A ?? null);
        setProcImgB(json.B ?? null);
        if (json.stats) setProcStats(json.stats);
      }
    } catch (e) {
      if (isStale()) return;
      console.error("Processing failed:", e);
      setLastError(errorMessage(e));
    } finally {
      if (!isStale()) setProcLoading(false);
    }
  }, [backendUrl, filters]);

  // Auto-processing function that checks cache for batch filters, processes spatial filters on demand
  // NOTE: We intentionally do NOT clear images at the start - keep showing previous frame until new one is ready
  // This prevents grey flash during playback
  // filtersOverride, displayBounds: as in runProcessing; a non-empty override always processes
  const autoProcessFrame = useCallback(async (camera: string, index: number, sourcePathIdx: number, autoLimits: boolean = false, filtersOverride?: ImageFilter[], displayBounds: DisplayBounds | null = null) => {
    const activeFilters = filtersOverride ?? filters;
    const requestId = ++requestIdRef.current;
    const isStale = () => requestId !== requestIdRef.current;
    previewInFlightRef.current = filtersOverride !== undefined;
    setNeedsProcessing(false);
    setProcLoading(true);

    // If no filters, clear images and return
    if (activeFilters.length === 0) {
      setProcImgA(null);
      setProcImgB(null);
      setProcStats(null);
      setProcLoading(false);
      return;
    }

    try {
      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);

      // Determine if we need batch processing (time/pod filters present)
      const needsBatch = activeFilters.some(f => f.type === 'time' || f.type === 'pod');

      if (needsBatch) {
        // For batch filters, try to fetch pre-processed images first
        const params = new URLSearchParams({
          type: "processed",
          frame: String(index),
          camera: String(cameraNumber),
          source_path_idx: String(sourcePathIdx),
          auto_limits: String(autoLimits),
        });
        let json: any = null;
        try {
          json = await fetchJson(`${backendUrl}/get_processed_pair?${params.toString()}`);
          if (isStale()) return;
        } catch (e) {
          // A backend non-2xx means no pre-processed images yet - signal that batch
          // processing is needed. Anything else (network, parse) is a real error for
          // the outer catch. NOTE: Don't clear images here - keep showing old image
          // during playback
          if (!(e instanceof ApiError)) throw e;
          if (isStale()) return;
          setNeedsProcessing(true);
        }

        if (json) {
          // Check if we actually got images (not just an OK status)
          if (json.A && json.B) {
            setProcImgA(json.A);
            setProcImgB(json.B);
            if (json.stats) setProcStats(json.stats);
            setNeedsProcessing(false);
          } else {
            // Cache miss - signal that batch processing is needed
            // NOTE: Don't clear images here - keep showing old image during playback
            setNeedsProcessing(true);
          }
        }
      } else {
        // Spatial filters only - process frame-by-frame on demand
        const json = await postJson(`${backendUrl}/filter_single_frame`, {
          camera: cameraNumber,
          frame_idx: index,
          filters: activeFilters,
          source_path_idx: sourcePathIdx,
          auto_limits: autoLimits,
          ...(displayBounds ?? {}),
        });
        if (isStale()) return;

        setProcImgA(json.A ?? null);
        setProcImgB(json.B ?? null);
        if (json.stats) setProcStats(json.stats);
      }
    } catch (e) {
      if (isStale()) return;
      console.error("Auto-processing failed:", e);
      setLastError(errorMessage(e));
      // Clear processed images on error
      setProcImgA(null);
      setProcImgB(null);
    } finally {
      if (!isStale()) setProcLoading(false);
    }
  }, [backendUrl, filters]);

  // Add filter with default parameters based on type
  const addFilter = (type: FilterType, params: Partial<ImageFilter> = {}) => {
    const defaultParams: Record<FilterType, Partial<ImageFilter>> = {
      time: {},
      pod: {},
      lmax: { size: [7, 7] },
      maxnorm: { size: [7, 7], max_gain: 1.0 },
      meannorm: {},
      median: { size: [5, 5] },
      norm: { size: [7, 7], max_gain: 1.0 },
      norm2: { size: [7, 7], max_gain: 1.0 },
      ssmin: { size: [7, 7] },
      gaussian: { sigma: 1.0, size: [7, 7] },
      invert: {},
      clahe: { clip_limit: 2.0, tile_grid_size: [8, 8] as [number, number] },
    };

    setFilters(f => [...f, { type, ...defaultParams[type], ...params }]);
  };

  // Update filter parameters
  const updateFilter = (idx: number, updates: Partial<ImageFilter>) =>
    setFilters(f => f.map((flt, i) => i === idx ? { ...flt, ...updates } : flt));

  const removeFilter = (idx: number) => setFilters(f => f.filter((_, i) => i !== idx));
  
  // Move filter up/down in order
  const moveFilter = (idx: number, direction: 'up' | 'down') => {
    setFilters(f => {
      const newFilters = [...f];
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= f.length) return f;
      [newFilters[idx], newFilters[newIdx]] = [newFilters[newIdx], newFilters[idx]];
      return newFilters;
    });
  };
  
  // Improved fetchProcessed function
  const fetchProcessed = useCallback(async (camera: string, index: number, sourcePathIdx: number, autoLimits: boolean = false) => {
    try {
      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);
      const params = new URLSearchParams({
        type: "processed",
        frame: String(index),
        camera: String(cameraNumber),
        source_path_idx: String(sourcePathIdx),
        auto_limits: String(autoLimits),
      });
      
      const data = await fetchJson(`${backendUrl}/get_processed_pair?${params.toString()}`);
      setProcImgA(data.A ?? null);
      setProcImgB(data.B ?? null);
      if (data.stats) setProcStats(data.stats);
    } catch (error) {
      // Handle error by clearing processed images
      setProcImgA(null);
      setProcImgB(null);
      setProcStats(null);
    }
  }, [backendUrl]);

  // Clear processed images when filters change (since they would be invalid)
  useEffect(() => {
    setProcImgA(null);
    setProcImgB(null);
  }, [filters]);
  
  // Download image as PNG
  const downloadImage = useCallback(async (
    imageType: 'raw' | 'processed',
    frame: 'A' | 'B',
    base64Data: string,
    frameIdx: number,
    camera: number
  ) => {
    try {
      const response = await fetch(`${backendUrl}/download_image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: imageType,
          frame,
          data: base64Data,
          frame_idx: frameIdx,
          camera,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Download failed');
      }
      
      // Get the blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Cam${camera}_frame${frameIdx.toString().padStart(5, '0')}_${frame}_${imageType}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
    }
  }, [backendUrl]);

  return {
    filters,
    setFilters,
    addFilter,
    updateFilter,
    removeFilter,
    moveFilter,
    runProcessing,
    autoProcessFrame,
    procLoading,
    procImgA,
    procImgB,
    procStats,
    fetchProcessed,
    downloadImage,
    needsProcessing,
    lastError,
    processingBlocked,
    cancelProcessing,
    clearProcessingBlocked: () => setProcessingBlocked(false),
  };
}