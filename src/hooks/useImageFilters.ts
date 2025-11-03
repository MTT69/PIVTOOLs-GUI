import { useState, useCallback } from 'react';

export interface ImageFilter {
  type: "POD" | "time";
  batch_size?: number;
}

export function useImageFilters(backendUrl: string) {
  const [filters, setFilters] = useState<ImageFilter[]>([]);
  const [procLoading, setProcLoading] = useState(false);
  const [procImgA, setProcImgA] = useState<string | null>(null);
  const [procImgB, setProcImgB] = useState<string | null>(null);

  const runProcessing = useCallback(async (camera: string, index: number, sourcePathIdx: number) => {
    setProcLoading(true);
    setProcImgA(null);
    setProcImgB(null);
    try {
      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);
      // Step 1: Run the filter processing
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

      // Step 2: Poll for completion (simplified for this example)
      await new Promise(r => setTimeout(r, 1500)); // Simple wait

      // Step 3: Fetch the result
      const params = new URLSearchParams({
        type: "processed",
        frame: String(index),
        camera: String(cameraNumber),
        source_path_idx: String(sourcePathIdx),
      });
      const res = await fetch(`${backendUrl}/get_processed_pair?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to fetch processed pair");

      setProcImgA(json.A ?? null);
      setProcImgB(json.B ?? null);
    } catch (e: any) {
      console.error("Processing failed:", e);
    } finally {
      setProcLoading(false);
    }
  }, [backendUrl, filters]);

  // Add filter with batch_size
  const addFilter = (type: "POD" | "time", batch_size: number = 50) =>
    setFilters(f => [...f, { type, batch_size }]);

  // Update batch_size for a filter
  const updateBatchSize = (idx: number, batch_size: number) =>
    setFilters(f => f.map((flt, i) => i === idx ? { ...flt, batch_size } : flt));

  const removeFilter = (idx: number) => setFilters(f => f.filter((_, i) => i !== idx));
  
  // Add fetchProcessed function if not present
  const fetchProcessed = async (camera: string, index: number, sourcePathIdx: number) => {
    try {
      const response = await fetch(`${backendUrl}/get_processed_pair?frame=${index}&type=processed&camera=${camera}&source_path_idx=${sourcePathIdx}`);
      const data = await response.json();
      setProcImgA(data.A);
      setProcImgB(data.B);
    } catch (error) {
      // Handle error, e.g., set to null if not available
      setProcImgA(null);
      setProcImgB(null);
    }
  };

  return {
    filters,
    setFilters,
    addFilter,
    updateBatchSize,
    removeFilter,
    runProcessing,
    procLoading,
    procImgA,
    procImgB,
    fetchProcessed,
  };
}