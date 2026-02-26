import { useState, useEffect, useRef, useCallback } from 'react';
import type { DataSourceType } from './useVectorViewer';

// All valid statistic keys (1:1 mapping with config)
const ALL_STAT_KEYS = [
  "mean_velocity", "mean_stresses", "mean_tke",
  "mean_vorticity", "mean_divergence", "mean_peak_height",
  "inst_velocity", "inst_stresses",
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

export interface StatisticsConstraints {
  allowed_source_endpoints: string[];
  workflow_options: string[];
  current_workflow: string;
  current_source_endpoint: string;
  is_stereo: boolean;
}

export type StatsWorkflow = 'per_camera' | 'after_merge' | 'both' | 'stereo';

/**
 * Hook for managing statistics calculation state and operations.
 * Syncs checkbox states and gamma_radius with config.yaml.
 *
 * Uses base_path_idx + workflow (string) pattern.
 * - workflow='per_camera':  Processes all cameras from config.camera_numbers
 * - workflow='after_merge': Processes merged data only
 * - workflow='both':        Processes all cameras then merged data
 * - workflow='stereo':      Processes stereo combined result
 *
 * @param backendUrl The backend URL prefix
 * @param basePathIdx Current base path index
 * @param cameraOptions Array of available camera numbers (e.g., [1, 2, 3])
 * @param imageCount Number of images to process
 * @param config Config object containing statistics settings
 */
export function useStatisticsCalculation(
  backendUrl: string = "/backend",
  basePathIdx: number = 0,
  cameraOptions: number[] = [],
  imageCount: number = 1000,
  config?: any,
  dataSource?: DataSourceType
) {
  // --- State Initialization ---

  // Workflow mode: per_camera, after_merge, both, or stereo
  const [workflow, setWorkflow] = useState<StatsWorkflow>(() => {
    const configWorkflow = config?.statistics?.workflow;
    if (configWorkflow && ['per_camera', 'after_merge', 'both', 'stereo'].includes(configWorkflow)) {
      return configWorkflow as StatsWorkflow;
    }
    return 'per_camera';
  });

  // Source endpoint: regular, merged, stereo (data source location)
  const [sourceEndpoint, setSourceEndpoint] = useState<string>(() => {
    return config?.statistics?.source_endpoint || 'regular';
  });

  // Constraints from backend
  const [constraints, setConstraints] = useState<StatisticsConstraints | null>(null);

  // Fetch constraints on mount
  useEffect(() => {
    const fetchConstraints = async () => {
      try {
        const res = await fetch(`${backendUrl}/statistics/constraints`);
        if (res.ok) {
          const data = await res.json();
          setConstraints(data);
        }
      } catch (err) {
        console.error("Error fetching statistics constraints:", err);
      }
    };
    fetchConstraints();
  }, [backendUrl]);

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
    newGammaRadius: number
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
      updateConfigStatistics(requestedStatistics, gammaRadius);
    }, 500);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [requestedStatistics, gammaRadius, updateConfigStatistics]);

  // --- Calculate statistics function ---
  const calculateStatistics = async () => {
    setCalculating(true);

    try {
      const res = await fetch(`${backendUrl}/statistics/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_path_idx: basePathIdx,
          workflow: workflow,
          type_name: dataSource?.includes('ensemble') ? 'ensemble' : (config?.statistics?.type_name || 'instantaneous'),
          source_endpoint: dataSource ? (dataSource.includes('stereo') ? 'stereo' : (dataSource.includes('merged') ? 'merged' : 'regular')) : sourceEndpoint,
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
      console.log(`Statistics calculation started! Job ID: ${data.parent_job_id}, processing ${data.processed_targets} target(s)`);
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

  // Camera count for DataSourceToggle
  const cameraCount = cameraOptions.length;

  return {
    // Camera count for DataSourceToggle
    cameraCount,

    // Workflow options
    workflow,
    setWorkflow,
    sourceEndpoint,
    setSourceEndpoint,
    constraints,
    workflowOptions: constraints?.workflow_options ?? ['per_camera', 'after_merge', 'both'],
    allowedSourceEndpoints: constraints?.allowed_source_endpoints ?? ['instantaneous', 'ensemble', 'merged', 'stereo'],
    isStereoStats: constraints?.is_stereo ?? false,

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
