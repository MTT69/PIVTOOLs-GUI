// src/hooks/usePivRunner.ts

import { useState, useEffect, useRef, useCallback } from 'react';

// The polling interval in milliseconds
const POLL_INTERVAL_MS = 500;

/**
 * Defines the settings the PIV runner needs to operate.
 */
interface PivRunnerSettings {
  sourcePathIdx: number;
  varType: string;
  cmap: string;
  run: number;
  lowerLimit: string;
  upperLimit: string;
  showStatusImage: boolean;
  activePaths: number[];  // Indices of source/base path pairs to process
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
  const [logs, setLogs] = useState<string>("");

  const nextFrameIndexRef = useRef<number>(1);
  const settingsRef = useRef(settings);
  const lastImageUpdateRef = useRef<number>(0);
  const availableFramesRef = useRef<number[]>([]);

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
          var: currentSettings.varType,
          is_uncalibrated: '1',
        });
        if (currentSettings.cmap !== 'default') params.set('cmap', currentSettings.cmap);
        
        // Fetch progress, image, and logs in parallel
        const [statusRes, logsRes] = await Promise.all([
          fetch(`/backend/get_uncalibrated_count?${params.toString()}`),
          jobId ? fetch(`/backend/piv_logs?job_id=${jobId}`) : Promise.resolve(null),
        ]);

        // Process progress response
        let currentProgress = 0;
        let availableFrames: number[] = [];
        if (statusRes.ok) {
          const data = await statusRes.json();
          currentProgress = Math.round(data.percent ?? 0);
          setProgress((p: number) => Math.max(p, currentProgress)); // Avoid progress going backwards
          if (currentProgress >= 100) setIsPolling(false); // Stop polling on completion
          // Parse available files to get frame indices
          if (data.files && Array.isArray(data.files)) {
            availableFrames = data.files.map((f: string) => {
              const match = f.match(/(\d+)\.mat$/);
              return match ? parseInt(match[1], 10) : null;
            }).filter((n: number | null) => n !== null) as number[];
            availableFrames.sort((a, b) => a - b); // Sort frames in ascending order
            availableFramesRef.current = availableFrames;
          }
        }

        // Process logs response
        if (logsRes && logsRes.ok) {
          const logsData = await logsRes.json();
          setLogs(logsData.logs || "");
        }

        // Fetch image if we have available frames and showStatusImage is enabled
        const now = Date.now();
        const timeSinceLastUpdate = now - lastImageUpdateRef.current;

        if (currentSettings.showStatusImage && availableFrames.length > 0) {
          // Show new image every 2 seconds or immediately if first frame
          if (lastImageUpdateRef.current === 0 || timeSinceLastUpdate >= 2000) {
            // Find the frame to display
            let frameToShow: number;

            if (lastImageUpdateRef.current === 0) {
              // First image - show the first available frame
              frameToShow = availableFrames[0];
              nextFrameIndexRef.current = 0; // Index in the array, not the frame number
            } else {
              // Subsequent images - cycle through available frames
              const nextIdx = (nextFrameIndexRef.current + 1) % availableFrames.length;
              frameToShow = availableFrames[nextIdx];
              nextFrameIndexRef.current = nextIdx;
            }

            // Only fetch if the frame is in our available list
            if (availableFrames.includes(frameToShow)) {
              // Fetch the image
              const imageParams = new URLSearchParams(params);
              imageParams.set('index', String(frameToShow));
              const imageRes = await fetch(`/backend/plot/get_uncalibrated_image?${imageParams.toString()}`);

              if (imageRes.ok) {
                const data = await imageRes.json();
                if (data.image) {
                  setStatusImage({ src: data.image, error: null });
                  lastImageUpdateRef.current = now;
                }
              } else {
                // Don't show error for 404 - just means frame not ready yet
                if (imageRes.status !== 404) {
                  setStatusImage((prev: any) => ({ ...prev, error: `Image Error: ${imageRes.statusText}` }));
                }
              }
            }
          }
        } else if (currentSettings.showStatusImage && availableFrames.length === 0 && isPolling && currentProgress > 0) {
          // Show waiting message when no frames are available yet but processing has started
          setStatusImage({ src: null, error: null });
        }
      } catch (error) {
        setStatusImage((prev: any) => ({ ...prev, src: null, error: "Polling failed. Check connection." }));
      }
    };

    pollStatus(); // Initial poll
    const intervalId = setInterval(pollStatus, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId); // Cleanup on unmount or when polling stops
  }, [isPolling, jobId]);

  const run = useCallback(async () => {
    setIsLoading(true);
    setStatusImage({ src: null, error: null });
    setProgress(0);
    setLogs(""); // Clear logs at start
    nextFrameIndexRef.current = 0; // Start from first frame in array
    lastImageUpdateRef.current = 0;
    availableFramesRef.current = [];
    setJobId(null);

    try {
      const response = await fetch('/backend/run_piv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePathIdx: settingsRef.current.sourcePathIdx,
          active_paths: settingsRef.current.activePaths,
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

  return { isLoading, isPolling, progress, statusImage, logs, run, cancel };
}