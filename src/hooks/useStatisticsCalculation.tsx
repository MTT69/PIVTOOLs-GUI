import { useState, useEffect, useRef } from 'react';

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
 * @param backendUrl The backend URL prefix
 * @param basePathIdx Current base path index
 * @param cameraOptions Array of available cameras (e.g., ["Cam1", "Cam2"])
 * @param imageCount Number of images to process
 */
export function useStatisticsCalculation(
  backendUrl: string = "/backend",
  basePathIdx: number = 0,
  cameraOptions: string[] = [],
  imageCount: number = 1000
) {
  // --- State Initialization ---
  const [selectedCameras, setSelectedCameras] = useState<string[]>([]);
  const [includeMerged, setIncludeMerged] = useState<boolean>(false);
  const [requestedStatistics, setRequestedStatistics] = useState<string[]>([]);
  const [calculating, setCalculating] = useState<boolean>(false);
  const [statisticsJobId, setStatisticsJobId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState<boolean>(false);

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

  // --- Calculate statistics function ---
  const calculateStatistics = async () => {
    if (selectedCameras.length === 0 && !includeMerged) {
      alert("Please select at least one camera or merged data");
      return;
    }

    setCalculating(true);

    try {
      const res = await fetch(`${backendUrl}/statistics/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_path_idx: basePathIdx,
          cameras: selectedCameras.map((c: string) => parseInt(c.replace("Cam", ""))),
          include_merged: includeMerged,
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
    selectedCameras,
    includeMerged,
    requestedStatistics,
    calculating,
    statisticsJobId,
    showDialog,

    // Setters
    setSelectedCameras,
    setIncludeMerged,
    setRequestedStatistics,
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
