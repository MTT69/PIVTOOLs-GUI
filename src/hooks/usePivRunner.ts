// src/hooks/usePivRunner.ts

import { useState, useEffect, useRef, useCallback } from 'react';

// The polling interval in milliseconds
const POLL_INTERVAL_MS = 500;

/**
 * Defines the settings the PIV runner needs to operate.
 */
interface PivRunnerSettings {
  sourcePathIdx: number;
  camera: string;
  varType: string;
  cmap: string;
  run: number;
  lowerLimit: string;
  upperLimit: string;
  showStatusImage: boolean;
}

/**
 * A custom hook to manage the PIV processing lifecycle.
 * Encapsulates state, API calls, and polling logic.
 * @param settings - The current PIV settings from the UI.
 * @returns An object with state and methods to control the PIV job.
 */
export function usePivRunner(settings: PivRunnerSettings) {
  const [isLoading, setIsLoading] = useState(false); // True during start/cancel API calls
  const [isPolling, setIsPolling] = useState(false); // True when a job is active
  const [progress, setProgress] = useState(0);
  const [statusImage, setStatusImage] = useState({
    src: null as string | null,
    error: null as string | null,
  });
  const [jobId, setJobId] = useState<string | null>(null);

  const nextFrameIndexRef = useRef<number>(1);
  const settingsRef = useRef(settings);

  // Keep the settings ref updated to prevent stale closures in intervals
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // The single, consolidated polling effect
  useEffect(() => {
    if (!isPolling) return; // Exit if not polling

    const pollStatus = async () => {
      const currentSettings = settingsRef.current;
      try {
        const params = new URLSearchParams({
          basepath_idx: String(currentSettings.sourcePathIdx),
          camera: currentSettings.camera,
          var: currentSettings.varType,
          is_uncalibrated: '1',
        });
        if (currentSettings.cmap !== 'default') params.set('cmap', currentSettings.cmap);
        
        // First fetch progress to get available frames
        const statusRes = await fetch(`/backend/get_uncalibrated_count?${params.toString()}`);

        // Process progress response
        let currentProgress = 0;
        let availableFrames: number[] = [];
        if (statusRes.ok) {
          const data = await statusRes.json();
          currentProgress = Math.round(data.percent ?? 0);
          setProgress(p => Math.max(p, currentProgress)); // Avoid progress going backwards
          if (currentProgress >= 100) setIsPolling(false); // Stop polling on completion
          // Parse available files to get frame indices
          if (data.files && Array.isArray(data.files)) {
            availableFrames = data.files.map((f: string) => {
              const match = f.match(/(\d+)\.mat$/);
              return match ? parseInt(match[1], 10) : null;
            }).filter((n: number | null) => n !== null) as number[];
          }
        }

        // Now fetch image only if we have available frames
        let imageRes = null;
        if (currentSettings.showStatusImage && availableFrames.length > 0) {
          const firstFrame = Math.min(...availableFrames);
          nextFrameIndexRef.current = firstFrame;
          imageRes = await fetch(`/backend/plot/get_uncalibrated_image?${params.toString()}&index=${firstFrame}`);
        }

        // Process image response - show first available frame
        setStatusImage(prev => ({ ...prev, error: null }));
        if (imageRes?.ok) {
          const data = await imageRes.json();
          if (data.image) {
            setStatusImage(prev => ({ ...prev, src: data.image }));
          }
        } else if (imageRes && currentProgress > 0) {
          setStatusImage(prev => ({ ...prev, src: null, error: `Image Error: ${imageRes.statusText}` }));
        }
      } catch (error) {
        console.error("Polling error:", error);
        setStatusImage(prev => ({ ...prev, src: null, error: "Polling failed. Check connection." }));
      }
    };

    pollStatus(); // Initial poll
    const intervalId = setInterval(pollStatus, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId); // Cleanup on unmount or when polling stops
  }, [isPolling]);

  const run = useCallback(async () => {
    setIsLoading(true);
    setStatusImage({ src: null, error: null });
    setProgress(0);
    nextFrameIndexRef.current = 1;
    setJobId(null);

    try {
      const response = await fetch('/backend/run_piv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePathIdx: settingsRef.current.sourcePathIdx,
          camera: settingsRef.current.camera,
        }),
      });
      if (!response.ok) throw new Error(`Failed to start PIV: ${response.statusText}`);
      const data = await response.json();
      setJobId(data.job_id);
      setIsPolling(true);
    } catch (error: any) {
      alert(error.message || "Error starting PIV");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/backend/cancel_run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
      if (!response.ok) throw new Error(`Failed to cancel PIV: ${response.statusText}`);
      setIsPolling(false);
      setProgress(0);
      setJobId(null);
    } catch (error: any) {
      alert(error.message || "Error cancelling run");
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  return { isLoading, isPolling, progress, statusImage, run, cancel };
}