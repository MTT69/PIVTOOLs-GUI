import { useState, useEffect, useRef, useCallback } from 'react';

// All valid statistic keys (1:1 mapping with config)
const ALL_STAT_KEYS = [
  "mean_velocity", "reynolds_stress", "normal_stress", "mean_tke",
  "mean_vorticity", "mean_divergence", "inst_velocity", "inst_fluctuations",
  "inst_vorticity", "inst_divergence", "inst_gamma"
];

export interface StatisticsJobDetails {
  status: string;
  progress: number;
  overall_progress?: number;
  camera?: string;
  valid_runs?: number[];
  error?: string;
  elapsed_time?: number;
  estimated_remaining?: number;
  sub_job_statuses?: Array<{
    status: string;
    progress: number;
    camera: string;
    type: string;
  }>;
}

/**
 * Hook for managing statistics calculation state and operations.
 * Syncs checkbox states and gamma_radius with config.yaml.
 * @param backendUrl The backend URL prefix
 * @param basePathIdx Current base path index
 * @param cameraOptions Array of available cameras (e.g., ["Cam1", "Cam2"])
 * @param imageCount Number of images to process
 * @param config Config object containing statistics settings
 */
export function useStatisticsCalculation(
  backendUrl: string = "/backend",
  basePathIdx: number = 0,
  cameraOptions: string[] = [],
  imageCount: number = 1000,
  config?: any
) {
  // --- State Initialization ---
  // Data source toggles - which data to process (cameras, merged, or both)
  const [processCameras, setProcessCameras] = useState<boolean>(
    config?.statistics?.process_cameras ?? true
  );
  const [processMerged, setProcessMerged] = useState<boolean>(
    config?.statistics?.process_merged ?? false
  );

  // Initialize requestedStatistics from config enabled_methods (1:1 mapping)
  const [requestedStatistics, setRequestedStatistics] = useState<string[]>(() => {
    const enabledMethods = config?.statistics?.enabled_methods || {};
    return ALL_STAT_KEYS.filter(key => enabledMethods[key] === true);
  });

  // Initialize gamma_radius from config
  const [gammaRadius, setGammaRadius] = useState<number>(
    config?.statistics?.gamma_radius ?? 5
  );

  const [calculating, setCalculating] = useState<boolean>(false);
  const [statisticsJobId, setStatisticsJobId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState<boolean>(false);

  // Track if this is the initial mount (to skip sync on first render)
  const isInitialMount = useRef(true);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Job status hook ---
  const useStatisticsJobStatus = (jobId: string | null) => {
    const [status, setStatus] = useState<string>("not_started");
    const [details, setDetails] = useState<StatisticsJobDetails | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
      if (!jobId) {
        setStatus("not_started");
        setDetails(null);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }

      let active = true;

      const fetchStatus = async () => {
        try {
          const res = await fetch(`${backendUrl}/statistics/status/${jobId}`);
          if (!res.ok) {
            throw new Error("Failed to fetch status");
          }
          const data = await res.json();
          
          if (active) {
            setStatus(data.status || "not_started");
            setDetails(data);

            // Stop polling if completed or failed
            if (data.status === "completed" || data.status === "failed") {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              setCalculating(false);
            } else if (data.status === "running" || data.status === "starting") {
              // Start polling if running and not already polling
              if (!intervalRef.current) {
                intervalRef.current = setInterval(fetchStatus, 1000);
              }
            }
          }
        } catch (err) {
          console.error("Error fetching statistics status:", err);
          if (active) {
            setStatus("error");
            setDetails({ status: "error", progress: 0, error: String(err) });
          }
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      };

      // Initial fetch
      fetchStatus();

      return () => {
        active = false;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }, [jobId, backendUrl]);

    return { status, details };
  };

  // Get job status
  const { status: jobStatus, details: jobDetails } = useStatisticsJobStatus(statisticsJobId);

  // --- Config sync function ---
  const updateConfigStatistics = useCallback(async (
    newRequestedStats: string[],
    newGammaRadius: number,
    newProcessCameras: boolean,
    newProcessMerged: boolean
  ) => {
    // Build enabled_methods object (1:1 mapping)
    const enabledMethods: Record<string, boolean> = {};
    for (const key of ALL_STAT_KEYS) {
      enabledMethods[key] = newRequestedStats.includes(key);
    }

    try {
      await fetch(`${backendUrl}/update_config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statistics: {
            enabled_methods: enabledMethods,
            gamma_radius: newGammaRadius,
            process_cameras: newProcessCameras,
            process_merged: newProcessMerged,
          },
        }),
      });
    } catch (err) {
      console.error("Failed to update config:", err);
    }
  }, [backendUrl]);

  // --- Debounced config sync on state changes ---
  useEffect(() => {
    // Skip sync on initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Debounce config updates
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      updateConfigStatistics(requestedStatistics, gammaRadius, processCameras, processMerged);
    }, 500);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [requestedStatistics, gammaRadius, processCameras, processMerged, updateConfigStatistics]);

  // --- Calculate statistics function ---
  // Processes cameras and/or merged data based on toggle settings
  const calculateStatistics = async () => {
    // Convert camera options to int array
    const allCameras = cameraOptions.map((c: any) =>
      typeof c === 'string' ? parseInt(c.replace("Cam", "")) : c
    );

    // Determine what to process based on toggles
    const camerasToProcess = processCameras ? allCameras : [];
    const shouldProcessMerged = processMerged;

    if (camerasToProcess.length === 0 && !shouldProcessMerged) {
      alert("Please select at least one data source to process (cameras or merged)");
      return;
    }

    setCalculating(true);

    try {
      const res = await fetch(`${backendUrl}/statistics/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_path_idx: basePathIdx,
          cameras: camerasToProcess,
          include_merged: shouldProcessMerged,
          image_count: imageCount,
          type_name: "instantaneous",
          endpoint: "",
          requested_statistics: requestedStatistics.length > 0 ? requestedStatistics : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to start statistics calculation");
      }

      const data = await res.json();
      setStatisticsJobId(data.parent_job_id);
      setShowDialog(false);
      console.log(`Statistics calculation started! Job ID: ${data.parent_job_id}`);
    } catch (err: any) {
      console.error("Error starting statistics calculation:", err);
      alert(`Error: ${err.message}`);
      setCalculating(false);
    }
  };

  // --- Reset function ---
  const resetStatistics = () => {
    setStatisticsJobId(null);
    setCalculating(false);
  };

  return {
    // State
    processCameras,
    processMerged,
    requestedStatistics,
    gammaRadius,
    calculating,
    statisticsJobId,
    showDialog,

    // Setters
    setProcessCameras,
    setProcessMerged,
    setRequestedStatistics,
    setGammaRadius,
    setCalculating,
    setStatisticsJobId,
    setShowDialog,

    // Job status
    jobStatus,
    jobDetails,

    // Actions
    calculateStatistics,
    resetStatistics,
  };
}
