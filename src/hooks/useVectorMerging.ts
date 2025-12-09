import { useState, useEffect, useRef } from 'react';

export interface MergingJobDetails {
  status: string;
  progress: number;
  total_frames?: number;
  processed_frames?: number;
  message?: string;
  error?: string;
  valid_runs?: number[];
}

export interface MergingConstraints {
  allowed_source_endpoints: string[];
  is_stereo_setup: boolean;
  stereo_blocked: boolean;
  stereo_reason: string | null;
}

/**
 * Hook for managing vector merging state and operations.
 * @param backendUrl The backend URL prefix
 * @param basePathIdx Current base path index
 * @param cameraOptions Array of available camera numbers (e.g., [1, 2, 3])
 * @param imageCount Number of images to process
 */
export function useVectorMerging(
  backendUrl: string = "/backend",
  basePathIdx: number = 0,
  cameraOptions: number[] = [],
  imageCount: number = 1000
) {
  // --- State Initialization ---
  const [selectedCameras, setSelectedCameras] = useState<number[]>([]);
  const [merging, setMerging] = useState<boolean>(false);
  const [mergingJobId, setMergingJobId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState<boolean>(false);
  const [constraints, setConstraints] = useState<MergingConstraints | null>(null);

  // --- Fetch constraints on mount ---
  useEffect(() => {
    const fetchConstraints = async () => {
      try {
        const res = await fetch(`${backendUrl}/merge_vectors/constraints`);
        if (res.ok) {
          const data = await res.json();
          setConstraints(data);
        }
      } catch (err) {
        console.error("Error fetching merging constraints:", err);
      }
    };
    fetchConstraints();
  }, [backendUrl]);

  // --- Job status hook ---
  const useMergingJobStatus = (jobId: string | null) => {
    const [status, setStatus] = useState<string>("not_started");
    const [details, setDetails] = useState<MergingJobDetails | null>(null);
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
          const res = await fetch(`${backendUrl}/merge_vectors/status/${jobId}`);
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
              setMerging(false);
            } else if (data.status === "running" || data.status === "starting") {
              // Start polling if running and not already polling
              if (!intervalRef.current) {
                intervalRef.current = setInterval(fetchStatus, 1000);
              }
            }
          }
        } catch (err) {
          console.error("Error fetching merging status:", err);
          if (active) {
            setStatus("error");
            setDetails({ status: "error", progress: 0, message: String(err) });
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
  const { status: jobStatus, details: jobDetails } = useMergingJobStatus(mergingJobId);

  // --- Merge vectors function ---
  const mergeVectors = async () => {
    if (selectedCameras.length < 2) {
      alert("Please select at least 2 cameras to merge");
      return;
    }

    setMerging(true);

    try {
      const res = await fetch(`${backendUrl}/merge_vectors/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_path_idx: basePathIdx,
          cameras: selectedCameras,  // Already number[]
          image_count: imageCount,
          type_name: "instantaneous",
          endpoint: "",
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to start vector merging");
      }

      const data = await res.json();
      setMergingJobId(data.job_id);
      setShowDialog(false);
      console.log(`Vector merging started! Job ID: ${data.job_id}`);
    } catch (err: any) {
      console.error("Error starting vector merging:", err);
      alert(`Error: ${err.message}`);
      setMerging(false);
    }
  };

  // --- Reset function ---
  const resetMerging = () => {
    setMergingJobId(null);
    setMerging(false);
  };

  return {
    // State
    selectedCameras,
    merging,
    mergingJobId,
    showDialog,
    constraints,

    // Setters
    setSelectedCameras,
    setMerging,
    setMergingJobId,
    setShowDialog,

    // Job status
    jobStatus,
    jobDetails,

    // Actions
    mergeVectors,
    resetMerging,

    // Derived state for UI
    isStereoBlocked: constraints?.stereo_blocked ?? false,
    stereoBlockedReason: constraints?.stereo_reason ?? null,
  };
}
