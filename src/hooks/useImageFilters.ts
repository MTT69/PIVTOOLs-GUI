import { useState, useCallback, useEffect } from 'react';

export type FilterType =
  | "time" | "pod"  // Batch filters
  | "lmax" | "maxnorm" | "median" | "norm" | "norm2" | "ssmin" | "gaussian" | "invert" | "clahe";  // Spatial filters

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
  // Stats are now percentages (0-100%)
  const [procStats, setProcStats] = useState<{ A: { vmin_pct: number, vmax_pct: number }, B: { vmin_pct: number, vmax_pct: number } } | null>(null);
  const [needsProcessing, setNeedsProcessing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [processingBlocked, setProcessingBlocked] = useState(false);

  // Wrapper for setFilters that blocks changes during processing
  const setFilters = useCallback((newFilters: ImageFilter[] | ((prev: ImageFilter[]) => ImageFilter[])) => {
    if (procLoading) {
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
      await fetch(`${backendUrl}/processing_status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancel: true }),
      });
      setProcLoading(false);
      setProcessingBlocked(false);
    } catch (e) {
      console.error("Failed to cancel processing:", e);
    }
  }, [backendUrl]);

  const runProcessing = useCallback(async (camera: string, index: number, sourcePathIdx: number, autoLimits: boolean = false) => {
    setProcLoading(true);
    setLastError(null);
    setNeedsProcessing(false);
    setProcImgA(null);
    setProcImgB(null);
    setProcStats(null);
    try {
      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);

      // Determine if we need batch processing (time/pod filters present)
      const needsBatch = filters.some(f => f.type === 'time' || f.type === 'pod');

      if (needsBatch) {
        // Batch processing for time/pod filters
        await fetch(`${backendUrl}/filter`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            camera: cameraNumber,
            start_idx: index,
            count: 1,
            filters,
            source_path_idx: sourcePathIdx,
          }),
        });

        // Poll for completion using the new processing_status endpoint
        let attempts = 0;
        const maxAttempts = 120; // 2 minutes max wait for batch processing
        let completed = false;

        while (attempts < maxAttempts && !completed) {
          await new Promise(r => setTimeout(r, 1000));

          // Check status using new endpoint
          const statusRes = await fetch(`${backendUrl}/processing_status`);
          const statusJson = await statusRes.json();

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
        const res = await fetch(`${backendUrl}/get_processed_pair?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to fetch processed pair");

        setProcImgA(json.A ?? null);
        setProcImgB(json.B ?? null);
        if (json.stats) setProcStats(json.stats);
      } else {
        // Spatial filters only - process frame-by-frame on demand
        const res = await fetch(`${backendUrl}/filter_single_frame`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            camera: cameraNumber,
            frame_idx: index,
            filters,
            source_path_idx: sourcePathIdx,
            auto_limits: autoLimits,
          }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to process frame");

        setProcImgA(json.A ?? null);
        setProcImgB(json.B ?? null);
        if (json.stats) setProcStats(json.stats);
      }
    } catch (e: any) {
      console.error("Processing failed:", e);
      setLastError(e.message || "Processing failed");
    } finally {
      setProcLoading(false);
    }
  }, [backendUrl, filters]);

  // Auto-processing function that checks cache for batch filters, processes spatial filters on demand
  // NOTE: We intentionally do NOT clear images at the start - keep showing previous frame until new one is ready
  // This prevents grey flash during playback
  const autoProcessFrame = useCallback(async (camera: string, index: number, sourcePathIdx: number, autoLimits: boolean = false) => {
    setNeedsProcessing(false);
    setProcLoading(true);

    // If no filters, clear images and return
    if (filters.length === 0) {
      setProcImgA(null);
      setProcImgB(null);
      setProcStats(null);
      setProcLoading(false);
      return;
    }

    try {
      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);

      // Determine if we need batch processing (time/pod filters present)
      const needsBatch = filters.some(f => f.type === 'time' || f.type === 'pod');

      if (needsBatch) {
        // For batch filters, try to fetch pre-processed images first
        const params = new URLSearchParams({
          type: "processed",
          frame: String(index),
          camera: String(cameraNumber),
          source_path_idx: String(sourcePathIdx),
          auto_limits: String(autoLimits),
        });
        const res = await fetch(`${backendUrl}/get_processed_pair?${params.toString()}`);

        if (res.ok) {
          const json = await res.json();
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
        } else {
          // No pre-processed images available - signal that batch processing is needed
          // NOTE: Don't clear images here - keep showing old image during playback
          setNeedsProcessing(true);
        }
      } else {
        // Spatial filters only - process frame-by-frame on demand
        const res = await fetch(`${backendUrl}/filter_single_frame`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            camera: cameraNumber,
            frame_idx: index,
            filters,
            source_path_idx: sourcePathIdx,
            auto_limits: autoLimits,
          }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to process frame");

        setProcImgA(json.A ?? null);
        setProcImgB(json.B ?? null);
        if (json.stats) setProcStats(json.stats);
      }
    } catch (e: any) {
      console.error("Auto-processing failed:", e);
      setLastError(e.message || "Auto-processing failed");
      // Clear processed images on error
      setProcImgA(null);
      setProcImgB(null);
    } finally {
      setProcLoading(false);
    }
  }, [backendUrl, filters]);

  // Add filter with default parameters based on type
  const addFilter = (type: FilterType, params: Partial<ImageFilter> = {}) => {
    const defaultParams: Record<FilterType, Partial<ImageFilter>> = {
      time: {},
      pod: {},
      lmax: { size: [7, 7] },
      maxnorm: { size: [7, 7], max_gain: 1.0 },
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
      
      const response = await fetch(`${backendUrl}/get_processed_pair?${params.toString()}`);
      
      if (response.ok) {
        const data = await response.json();
        setProcImgA(data.A ?? null);
        setProcImgB(data.B ?? null);
        if (data.stats) setProcStats(data.stats);
      } else {
        // No processed images available for this frame - clear the display
        setProcImgA(null);
        setProcImgB(null);
        setProcStats(null);
      }
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