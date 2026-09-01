import { useState, useEffect, useRef, useCallback } from 'react';
import type { DataSourceType } from './useVectorViewer';
import { fetchJson, postJson, errorMessage } from '@/lib/api';

// All valid statistic keys (1:1 mapping with config)
const ALL_STAT_KEYS = [
  "mean_velocity", "mean_stresses", "mean_tke",
  "mean_vorticity", "mean_divergence",
  "correlation_quality",
  "inst_velocity", "inst_stresses",
  "inst_vorticity", "inst_divergence", "inst_gamma"
];

// Mirrors VectorStatisticsProcessor.DIAGNOSTIC_STATISTICS. The quality channels
// these read survive only in uncalibrated vector files, so an uncalibrated run
// may request nothing else — the backend rejects anything outside this set.
const DIAGNOSTIC_STAT_KEYS = ["correlation_quality"];

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
 * Simplified: Uses base_path_idx + workflow pattern.
 * Workflow controls which targets are processed (per_camera, after_merge, both, stereo).
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

  // Data source: false = all cameras, true = merged only (legacy)
  const [processMerged, setProcessMerged] = useState<boolean>(false);

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
        const data = await fetchJson<StatisticsConstraints>(`${backendUrl}/statistics/constraints`);
        setConstraints(data);
      } catch (err) {
        console.error("Error fetching statistics constraints:", errorMessage(err));
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
    const pollStartTimeRef = useRef<number>(0);
    const MAX_POLL_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

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
      pollStartTimeRef.current = Date.now();

      const fetchStatus = async () => {
        try {
          const data = await fetchJson<StatisticsJobDetails>(`${backendUrl}/statistics/status/${jobId}`);

          if (active) {
            setStatus(data.status || "not_started");
            setDetails(data);

            // Safety timeout: stop polling if exceeded max duration
            if (Date.now() - pollStartTimeRef.current > MAX_POLL_DURATION_MS) {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              setStatus("error");
              setCalculating(false);
              return;
            }

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
          console.error("Error fetching statistics status:", errorMessage(err));
          if (active) {
            setStatus("error");
            setDetails({ status: "error", progress: 0, error: errorMessage(err) });
            setCalculating(false);
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
      await postJson(`${backendUrl}/update_config`, {
        statistics: {
          enabled_methods: enabledMethods,
          gamma_radius: newGammaRadius,
        },
      });
    } catch (err) {
      console.error("Failed to update config:", errorMessage(err));
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
  // Uses simplified API: base_path_idx + process_merged (boolean)
  const calculateStatistics = async () => {
    setCalculating(true);

    // An uncalibrated run computes diagnostics only. requestedStatistics is
    // seeded from config and still carries the calibrated selection (whose
    // checkboxes this panel hides), so send only what the source can produce
    // rather than letting the backend reject the whole request.
    const isUncalibratedSource = !!dataSource && dataSource.includes('uncalibrated');
    const statsToSend = isUncalibratedSource
      ? requestedStatistics.filter((id: string) => DIAGNOSTIC_STAT_KEYS.includes(id))
      : requestedStatistics;

    try {
      const data = await postJson(`${backendUrl}/statistics/calculate`, {
        base_path_idx: basePathIdx,
        workflow: workflow,
        // Always instantaneous: the Statistics panel is gated on !isEnsemble
        // (useVectorViewer canCalculateStatistics), so an ensemble dataSource
        // can never reach here.
        type_name: 'instantaneous',
        source_endpoint: dataSource
          ? (isUncalibratedSource
              ? 'uncalibrated'
              : dataSource.includes('stereo')
                ? 'stereo'
                : dataSource.includes('merged')
                  ? 'merged'
                  : 'regular')
          : sourceEndpoint,
        requested_statistics: statsToSend.length > 0 ? statsToSend : undefined,
      });
      setStatisticsJobId(data.parent_job_id);
      setShowDialog(false);
      console.log(`Statistics calculation started! Job ID: ${data.parent_job_id}, processing ${data.processed_targets} target(s)`);
    } catch (err) {
      console.error("Error starting statistics calculation:", err);
      alert(`Error: ${errorMessage(err)}`);
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
    // Data source toggle (simplified - legacy)
    processMerged,
    setProcessMerged,
    cameraCount,

    // Workflow options (new)
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
