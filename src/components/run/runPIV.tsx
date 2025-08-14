"use client";
import React, { useState, useEffect, useRef } from "react";
// Polling interval (ms) – user requested 20 seconds
const POLL_INTERVAL_MS = 20000;
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress"; // Ensure this matches the correct export

const RunPIV: React.FC = () => {
  const [sourcePaths, setSourcePaths] = useState<string[]>(() => {
    try {
      return JSON.parse(typeof window !== "undefined" ? localStorage.getItem("piv_source_paths") || "[]" : "[]");
    } catch {
      return [];
    }
  });
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(0);
  const [camera, setCamera] = useState<string>("1");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  // Track the polling interval (browser returns a number, not NodeJS.Timeout)
  const [polling, setPolling] = useState<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollOnceRef = useRef<(() => Promise<void>) | null>(null);

  // Fixed polling implementation
  const startPolling = () => {
    console.log("Starting polling...");
    // First, ensure any existing polling is stopped
    stopPolling({ resetProgress: false });

    // Define the polling function
    const pollOnce = async () => {
      try {
        console.log(`[${new Date().toISOString()}] [poll] checking status...`);
        const statusResponse = await fetch("/backend/check_status", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });

        if (!statusResponse.ok) {
          console.error(`Status check returned ${statusResponse.status}: ${statusResponse.statusText}`);
          return; // Continue polling despite errors
        }

        const statusData = await statusResponse.json();
        console.log("Status response:", statusData);
        const rawSource = statusData.progress ?? statusData.status;
        const raw = Number(rawSource);
        const newProgress = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 100) : 0;
        setProgress((prev) => (newProgress > prev ? newProgress : prev));

        // Also fetch the status image when we poll
        if (showStatusImage) {
          await fetchStatusImage();
        }

        if (newProgress >= 100) {
          console.log("Processing complete, stopping polling");
          stopPolling();
          alert("PIV processing completed!");
        }
      } catch (err) {
        console.error("Error checking status:", err);
        // Don't stop polling for transient errors, just log them
      }
    };

    // Store the polling function for immediate use
    pollOnceRef.current = pollOnce;

    // Create the interval and store it in both state and ref - fixed by removing window prefix
    const interval = setInterval(pollOnce, POLL_INTERVAL_MS);
    pollingRef.current = interval;
    setPolling(interval);
    setIsPolling(true);

    // Run immediately without waiting for first interval
    pollOnce().catch((err) => console.error("Error in initial poll:", err));
  };

  const stopPolling = (options?: { resetProgress?: boolean }) => {
    console.log("Stopping polling...");
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setPolling(null);
    setIsPolling(false);
    if (options?.resetProgress) setProgress(0);
  };

  // Cleanup any active interval on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        console.log("Component unmounting, clearing interval");
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "piv_source_paths") {
        try {
          setSourcePaths(JSON.parse(e.newValue || "[]"));
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleRunPIV = async () => {
    // Always stop any existing polling and reset state before starting a new run
    stopPolling({ resetProgress: true });

    setLoading(true);
    try {
      const response = await fetch("/backend/run_piv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: sourcePaths[sourcePathIdx],
          camera,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to run PIV: ${response.statusText}`);
      }

      const data = await response.json();
      console.log("Run PIV response:", data);
      alert(`Run PIV triggered: ${data.message}`);

      // Start polling with our new function
      startPolling();
    } catch (error) {
      console.error("Error running PIV:", error);
      alert(`Error running PIV: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelRun = async () => {
    setLoading(true);
    try {
      const response = await fetch("/backend/cancel_run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Failed to cancel PIV run: ${response.statusText}`);
      }

      const data = await response.json();
      console.log("Cancel Run response:", data);
      alert(`Cancel Run triggered: ${data.message}`);

      // Stop polling if it's active
      stopPolling({ resetProgress: true });
    } catch (error) {
      console.error("Error canceling PIV run:", error);
      alert(`Error canceling PIV run: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  // Add state for status image
  const [statusImageSrc, setStatusImageSrc] = useState<string | null>(null);
  const [statusImageLoading, setStatusImageLoading] = useState(false);
  const [statusImageError, setStatusImageError] = useState<string | null>(null);
  const [showStatusImage, setShowStatusImage] = useState(true); // Show by default

  // Function to fetch status image
  const fetchStatusImage = async () => {
    if (!sourcePaths[sourcePathIdx]) return;

    setStatusImageLoading(true);
    setStatusImageError(null);

    try {
      const params = new URLSearchParams();
      params.set("base_path", sourcePaths[sourcePathIdx]);
      params.set("camera", camera);

      const url = `/backend/check_status_image?${params.toString()}`;
      const res = await fetch(url);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: `Status code: ${res.status}` }));
        throw new Error(errorData.error || `Failed to fetch status image: ${res.status}`);
      }

      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const json = await res.json();
        setStatusImageSrc(json.image ?? null);
      } else {
        // Handle direct image response
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result as string;
          const base64Content = base64data.split(",")[1] || base64data;
          setStatusImageSrc(base64Content);
        };
        reader.readAsDataURL(blob);
      }
    } catch (e: any) {
      console.error("Error fetching status image:", e);
      setStatusImageError(e.message || "Unknown error");
    } finally {
      setStatusImageLoading(false);
    }
  };

  // Toggle status image visibility
  const toggleStatusImage = () => {
    const newValue = !showStatusImage;
    setShowStatusImage(newValue);
    if (newValue && !statusImageSrc && !statusImageLoading) {
      fetchStatusImage();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Run PIV</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 mb-4">
            {/* Source path selection */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Source Path:</label>
              {sourcePaths.length > 0 ? (
                <select
                  value={String(sourcePathIdx)}
                  onChange={(e) => setSourcePathIdx(Number(e.target.value))}
                  className="border rounded px-2 py-1"
                >
                  {sourcePaths.map((p, i) => {
                    // Show last two segments of the path
                    const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
                    const parts = norm.split("/").filter(Boolean);
                    const lastTwo = parts.length >= 2 ? parts.slice(-2).join("/") : norm;
                    return (
                      <option key={i} value={i}>
                        {`${i}: /${lastTwo}`}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <Input
                  type="text"
                  value="No source paths available"
                  readOnly
                  className="w-full"
                />
              )}
            </div>

            {/* Camera selection */}
            <div className="flex items-center gap-4">
              <label htmlFor="camera" className="text-sm font-medium">
                Camera:
              </label>
              <select
                id="camera"
                value={camera}
                onChange={(e) => setCamera(e.target.value)}
                className="border rounded px-2 py-1"
              >
                <option value="1">Camera 1</option>
                <option value="2">Camera 2</option>
                {/* Add more cameras if needed */}
              </select>
            </div>

            {/* Progress bar */}
            <div className="flex flex-col gap-2">
              {/* <label className="text-sm font-medium">
                Progress: {isPolling && <span className="text-xs text-blue-500">(Checking status every 20s)</span>}
              </label> */}
              <Progress value={progress} className="w-full" />
              <span className="text-xs text-gray-500">{progress}%</span>
            </div>

            {/* Status image viewer */}
            <div className="mt-2">
              <div className="flex items-center mb-2">
                <Button
                  variant="outline"
                  onClick={toggleStatusImage}
                  size="sm"
                  className="flex items-center gap-2"
                >
                  {showStatusImage ? "Hide Status Image" : "Show Status Image"}
                </Button>
              </div>

              {showStatusImage && (
                <div className="border rounded p-4 bg-gray-50">
                  {statusImageError && (
                    <div className="w-full p-3 mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
                      {statusImageError}
                    </div>
                  )}

                  {statusImageSrc ? (
                    <div className="flex flex-col items-center relative">
                      <img
                        src={`data:image/png;base64,${statusImageSrc}`}
                        alt="Processing Status"
                        className="rounded border w-full max-w-3xl"
                      />
                      {statusImageLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60">
                          <span className="text-gray-500">Refreshing...</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-48 flex items-center justify-center bg-gray-100 border rounded">
                      <span className="text-gray-500">
                        {statusImageLoading ? "Loading status image..." : "No status image available"}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Run and Cancel buttons */}
            <div className="flex items-center gap-4">
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={handleRunPIV}
                disabled={loading}
              >
                {loading ? "Running..." : "Run PIV"}
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700"
                onClick={handleCancelRun}
                disabled={loading}
              >
                {loading ? "Canceling..." : "Cancel Run"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RunPIV;
