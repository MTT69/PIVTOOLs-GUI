import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// All valid statistic keys (1:1 mapping with config)
const ALL_STAT_KEYS = [
  "mean_velocity", "mean_stresses", "mean_tke",
  "mean_vorticity", "mean_divergence", "inst_velocity", "inst_stresses",
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

// Path info interface for CameraSelector
interface PathInfo {
  source: string;
  base: string;
}

/**
 * Hook for managing statistics calculation state and operations.
 * Syncs checkbox states and gamma_radius with config.yaml.
 * Supports multi-path batch processing.
 * @param backendUrl The backend URL prefix
 * @param basePathIdx Current base path index (legacy, for backward compatibility)
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
  // Multi-path selection
  const [activePaths, setActivePaths] = useState<number[]>(() => {
    const configPaths = config?.statistics?.active_paths;
    if (Array.isArray(configPaths) && configPaths.length > 0) {
      return configPaths;
    }
    return [basePathIdx];
  });

  // Build paths array for CameraSelector
  const paths: PathInfo[] = useMemo(() => {
    const basePaths = config?.paths?.base_paths || [];
    const sourcePaths = config?.paths?.source_paths || [];
    return basePaths.map((base: string, idx: number) => ({
      base,
      source: sourcePaths[idx] || base,
    }));
  }, [config?.paths?.base_paths, config?.paths?.source_paths]);

  // Camera selection - which cameras to process
  const [selectedCameras, setSelectedCameras] = useState<number[]>(() => {
    const configCameras = config?.statistics?.cameras;
    if (Array.isArray(configCameras) && configCameras.length > 0) {
      return configCameras;
    }
    // Default to all cameras
    return cameraOptions.map((c: string) => parseInt(c.replace("Cam", "")));
  });

  // Data source toggles - whether to include merged data
  const [includeMerged, setIncludeMerged] = useState<boolean>(
    config?.statistics?.include_merged ?? false
  );

  // Legacy compatibility aliases
  const processCameras = selectedCameras.length > 0;
  const processMerged = includeMerged;
  const setProcessCameras = (value: boolean) => {
    if (value && selectedCameras.length === 0) {
      setSelectedCameras(cameraOptions.map((c: string) => parseInt(c.replace("Cam", ""))));
    } else if (!value) {
      setSelectedCameras([]);
    }
  };
  const setProcessMerged = setIncludeMerged;

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
    newActivePaths: number[],
    newSelectedCameras: number[],
    newIncludeMerged: boolean
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
            active_paths: newActivePaths,
            cameras: newSelectedCameras,
            include_merged: newIncludeMerged,
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
      updateConfigStatistics(requestedStatistics, gammaRadius, activePaths, selectedCameras, includeMerged);
    }, 500);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [requestedStatistics, gammaRadius, activePaths, selectedCameras, includeMerged, updateConfigStatistics]);

  // --- Calculate statistics function ---
  // Processes cameras and/or merged data based on toggle settings
  // Now supports multi-path batch processing
  const calculateStatistics = async () => {
    if (selectedCameras.length === 0 && !includeMerged) {
      alert("Please select at least one data source to process (cameras or merged)");
      return;
    }

    if (activePaths.length === 0) {
      alert("Please select at least one path to process");
      return;
    }

    setCalculating(true);

    try {
      const res = await fetch(`${backendUrl}/statistics/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active_paths: activePaths,
          cameras: selectedCameras,
          include_merged: includeMerged,
          image_count: imageCount,
          type_name: "instantaneous",
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
      console.log(`Statistics calculation started! Job ID: ${data.parent_job_id}, processing ${data.processed_targets} targets across ${activePaths.length} path(s)`);
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

  // Camera count for CameraSelector
  const cameraCount = cameraOptions.length;

  return {
    // Batch state (new)
    activePaths,
    setActivePaths,
    paths,
    selectedCameras,
    setSelectedCameras,
    includeMerged,
    setIncludeMerged,
    cameraCount,

    // Legacy state (for backward compatibility)
    processCameras,
    processMerged,
    setProcessCameras,
    setProcessMerged,

    // Statistics options
    requestedStatistics,
    gammaRadius,
    calculating,
    statisticsJobId,
    showDialog,

    // Setters
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
