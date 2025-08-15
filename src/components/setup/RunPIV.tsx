"use client";

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

// Polling interval (ms) for backend status checks (3 seconds to look cool)
const POLL_INTERVAL_MS = 3000;

/**
 * RunPIV component
 *
 * NOTE: Added a "Test PIV" button (dummy) which will later be implemented to
 * run PIV only for the temporal filter / batch length (e.g. the number of frames
 * implied by the active temporal filter such as time/POD). For now it simply
 * notifies the user. See handleTestPIV for TODO details.
 */
const RunPIV: React.FC = () => {
  const [sourcePaths, setSourcePaths] = useState<string[]>(() => {
    try {
      return JSON.parse(
        typeof window !== "undefined"
          ? localStorage.getItem("piv_source_paths") || "[]"
          : "[]"
      );
    } catch {
      return [];
    }
  });
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(0);
  const [camera, setCamera] = useState<string>("1");
  const [varType, setVarType] = useState<string>("ux");
  const [cmap, setCmap] = useState<string>("default");
  const [run, setRun] = useState<number>(1);
  const [lowerLimit, setLowerLimit] = useState<string>("");
  const [upperLimit, setUpperLimit] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [polling, setPolling] = useState<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollOnceRef = useRef<(() => Promise<void>) | null>(null);

  // Uncalibrated preview polling
  const [expectedCount, setExpectedCount] = useState<number | null>(null);
  const nextUncalIndexRef = useRef<number>(1);
  const uncalPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Status image state
  const [statusImageSrc, setStatusImageSrc] = useState<string | null>(null);
  const [statusImageLoading, setStatusImageLoading] = useState(false);
  const [statusImageError, setStatusImageError] = useState<string | null>(null);
  const [showStatusImage, setShowStatusImage] = useState(true);

  const startPolling = () => {
    // Stop existing polling first
    stopPolling({ resetProgress: false });
    const pollOnce = async () => {
      try {
        const statusResponse = await fetch("/backend/check_status", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });
        if (!statusResponse.ok) return;
        const statusData = await statusResponse.json();
        // If backend supplies percent, prefer it
        const percent = typeof statusData.percent === "number" ? statusData.percent : Number(statusData.progress ?? statusData.status ?? 0);
        const newProgress = Number.isFinite(percent) ? Math.min(Math.max(Math.round(percent), 0), 100) : 0;
        setProgress((prev) => (newProgress > prev ? newProgress : prev));
        if (showStatusImage) await fetchStatusImage();
        if (newProgress >= 100) stopPolling();
      } catch (err) {
        // Log only
        console.error("Polling error", err);
      }
    };
    pollOnceRef.current = pollOnce;
    const interval = setInterval(pollOnce, POLL_INTERVAL_MS);
    pollingRef.current = interval;
    setPolling(interval);
    setIsPolling(true);
    pollOnce();
  };

  const stopPolling = (options?: { resetProgress?: boolean }) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setPolling(null);
    setIsPolling(false);
    if (options?.resetProgress) setProgress(0);
  };

  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current); }, []);

  useEffect(() => () => { if (uncalPollingRef.current) clearInterval(uncalPollingRef.current); }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "piv_source_paths") {
        try { setSourcePaths(JSON.parse(e.newValue || "[]")); } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleRunPIV = async () => {
    stopPolling({ resetProgress: true });
    stopUncalPolling();
    setLoading(true);
    try {
      const response = await fetch("/backend/run_piv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePathIdx: sourcePathIdx,
          camera,
        }),
      });
      if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
      const data = await response.json();
      console.log("Run PIV response", data);
      // Query backend for existing uncalibrated .mat count (may be 0)
      const params = new URLSearchParams();
      params.set("basepath_idx", String(sourcePathIdx));
      params.set("camera", camera);
      params.set("var", varType);
      if (cmap && cmap !== "default") params.set("cmap", cmap);
      const cntRes = await fetch(`/backend/get_uncalibrated_count?${params.toString()}`);
      let exp: number | null = null;
      if (cntRes.ok) {
        try {
          const cntJson = await cntRes.json();
          exp = Number(cntJson.count) || null;
          // If backend provides a percent, seed the progress bar with it
          if (typeof cntJson.percent === "number") setProgress(Math.round(cntJson.percent));
        } catch {}
      }
      // Start lightweight uncalibrated preview polling (3s interval)
      setExpectedCount(exp);
      nextUncalIndexRef.current = 1;
      startUncalPolling();
    } catch (e: any) {
      alert(e.message || "Error starting PIV");
    } finally { setLoading(false); }
  };

  const handleCancelRun = async () => {
    setLoading(true);
    try {
      const response = await fetch("/backend/cancel_run", { method: "POST" });
      if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
      await response.json().catch(() => ({}));
  stopPolling({ resetProgress: true });
  stopUncalPolling();
    } catch (e: any) {
      alert(e.message || "Error cancelling");
    } finally { setLoading(false); }
  };

  const fetchStatusImage = async () => {
    if (!sourcePaths[sourcePathIdx]) return;
    setStatusImageLoading(true);
    setStatusImageError(null);
    try {
      const params = new URLSearchParams();
      params.set("basepath_idx", String(sourcePathIdx));
      params.set("camera", camera);
      params.set("var", varType);
      if (cmap && cmap !== "default") params.set("cmap", cmap);
      if (run > 0) params.set("run", String(run));
      if (lowerLimit.trim()) params.set("lower_limit", lowerLimit);
      if (upperLimit.trim()) params.set("upper_limit", upperLimit);
      // default index for a quick preview (use 1 if nothing else)
      params.set("index", String(nextUncalIndexRef.current || 1));
      const res = await fetch(`/backend/get_uncalibrated_image?${params.toString()}`);
      if (!res.ok) throw new Error(`Status image failed: ${res.status}`);
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const json = await res.json();
        setStatusImageSrc(json.image ?? null);
      } else {
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result as string;
            // strip prefix
          const base64Content = base64data.split(",")[1] || base64data;
          setStatusImageSrc(base64Content);
        };
        reader.readAsDataURL(blob);
      }
    } catch (e: any) {
      setStatusImageError(e.message || "Unknown error");
    } finally { setStatusImageLoading(false); }
  };

  // Uncalibrated preview polling helpers
  const startUncalPolling = () => {
    stopUncalPolling();
    const poll = async () => {
      const idx = nextUncalIndexRef.current;
      // If we know expected and already beyond it, stop
      if (expectedCount && idx > expectedCount) {
        stopUncalPolling();
        return;
      }
      try {
        const params = new URLSearchParams();
        params.set("basepath_idx", String(sourcePathIdx));
        params.set("camera", camera);
        params.set("index", String(idx));
        params.set("var", varType);
        if (cmap && cmap !== "default") params.set("cmap", cmap);
        if (run > 0) params.set("run", String(run));
        if (lowerLimit.trim()) params.set("lower_limit", lowerLimit);
        if (upperLimit.trim()) params.set("upper_limit", upperLimit);
        const res = await fetch(`/backend/get_uncalibrated_image?${params.toString()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.image) {
            setStatusImageSrc(json.image);
            setProgress((prev) => {
              if (!expectedCount) return Math.min(100, prev + 5);
              const newP = Math.round((idx / expectedCount) * 100);
              return newP > prev ? newP : prev;
            });
            // advance to next
            nextUncalIndexRef.current = idx + 1;
            // If we've reached expected count, stop
            if (expectedCount && idx >= expectedCount) stopUncalPolling();
          }
        }
      } catch (err) {
        console.error("uncal polling error", err);
      }
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    uncalPollingRef.current = id;
  };

  const stopUncalPolling = () => {
    if (uncalPollingRef.current) {
      clearInterval(uncalPollingRef.current);
      uncalPollingRef.current = null;
    }
  };

  const toggleStatusImage = () => {
    const newVal = !showStatusImage;
    setShowStatusImage(newVal);
    if (newVal && !statusImageSrc && !statusImageLoading) fetchStatusImage();
  };

  // Dummy Test PIV button handler
  const handleTestPIV = () => {
    /**
     * TODO: Implement running PIV only over a *test subset* of frames defined by:
     *  - If a temporal filter (e.g. type==='time' or 'POD') is active, use its batch_size.
     *  - Otherwise fall back to a small default window (e.g. 10 frames) centered or starting
     *    at the first requested index.
     * This should call a future backend endpoint (e.g. /backend/run_piv_test) with parameters:
     *  { sourcePath, camera, windowSize: <temporal_batch_length>, strategy: 'temporal-filter' }
     * Backend would then:
     *  - Load only that subset
     *  - Run the same multi-pass PIV pipeline
     *  - Store intermediate / final vectors for preview
     */
    alert("Test PIV (dummy): will run PIV for temporal filter batch size in future.");
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
                    const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
                    const parts = norm.split("/").filter(Boolean);
                    const lastTwo = parts.length >= 2 ? parts.slice(-2).join("/") : norm;
                    return (
                      <option key={i} value={i}>{`${i}: /${lastTwo}`}</option>
                    );
                  })}
                </select>
              ) : (
                <Input type="text" value="No source paths available" readOnly className="w-full" />
              )}
            </div>

            {/* Camera selection */}
            <div className="flex items-center gap-4">
              <label htmlFor="camera" className="text-sm font-medium">Camera:</label>
              <select
                id="camera"
                value={camera}
                onChange={(e) => setCamera(e.target.value)}
                className="border rounded px-2 py-1"
              >
                <option value="1">Camera 1</option>
                <option value="2">Camera 2</option>
              </select>

              {/* Variable type */}
              <label htmlFor="varType" className="text-sm font-medium">Type:</label>
              <select id="varType" value={varType} onChange={(e) => setVarType(e.target.value)} className="border rounded px-2 py-1">
                <option value="ux">ux</option>
                <option value="uy">uy</option>
              </select>

              {/* Colormap */}
              <label htmlFor="cmap" className="text-sm font-medium">Colormap:</label>
              <select id="cmap" value={cmap} onChange={(e) => setCmap(e.target.value)} className="border rounded px-2 py-1">
                <option value="default">default</option>
                <option value="viridis">viridis</option>
                <option value="plasma">plasma</option>
                <option value="inferno">inferno</option>
                <option value="magma">magma</option>
                <option value="cividis">cividis</option>
                <option value="jet">jet</option>
                <option value="gray">gray</option>
              </select>
            </div>

            {/* Run and Limits */}
            <div className="flex items-center gap-3 flex-wrap">
              <label htmlFor="run" className="text-sm font-medium">Run:</label>
              <Input id="run" type="number" min={1} value={run} onChange={e => setRun(Math.max(1, Number(e.target.value)))} className="w-24" />
              <label className="text-sm font-medium">Lower:</label>
              <Input type="number" value={lowerLimit} onChange={e => setLowerLimit(e.target.value)} placeholder="auto" className="w-28" />
              <label className="text-sm font-medium">Upper:</label>
              <Input type="number" value={upperLimit} onChange={e => setUpperLimit(e.target.value)} placeholder="auto" className="w-28" />
            </div>

            {/* Progress */}
            <div className="flex flex-col gap-2">
              <Progress value={progress} className="w-full" />
              <span className="text-xs text-gray-500">{progress}%{isPolling && " (polling)"}</span>
            </div>

            {/* Status image */}
            <div className="mt-2">
              <div className="flex items-center mb-2">
                <Button variant="outline" onClick={toggleStatusImage} size="sm" className="flex items-center gap-2">
                  {showStatusImage ? "Hide Status Image" : "Show Status Image"}
                </Button>
              </div>
              {showStatusImage && (
                <div className="border rounded p-4 bg-gray-50">
                  {statusImageError && (
                    <div className="w-full p-3 mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm">{statusImageError}</div>
                  )}
                  {statusImageSrc ? (
                    <div className="flex flex-col items-center relative">
                      <img
                        src={`data:image/png;base64,${statusImageSrc}`}
                        alt="Processing Status"
                        className="rounded border w-full max-w-3xl"
                      />
                      {statusImageLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                          <span className="text-gray-500">Refreshing...</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-48 flex items-center justify-center bg-gray-100 border rounded">
                      <span className="text-gray-500">{statusImageLoading ? "Loading status image..." : "No status image available"}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-4 flex-wrap">
              <Button className="bg-green-600 hover:bg-green-700" onClick={handleRunPIV} disabled={loading}>
                {loading ? "Running..." : "Run PIV"}
              </Button>
              <Button className="bg-red-600 hover:bg-red-700" onClick={handleCancelRun} disabled={loading}>
                {loading ? "Canceling..." : "Cancel Run"}
              </Button>
              <Button variant="outline" onClick={handleTestPIV} disabled={loading}>
                Test PIV (dummy)
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RunPIV;
