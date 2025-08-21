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
const RunPIV: React.FC<{ config?: any }> = ({ config }) => {
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
  // derive camera options from config if provided (same logic as Masking/VectorViewer)
  const cameraOptions: string[] = (() => {
    const nFromPaths = config?.paths?.camera_numbers?.length ? Number(config.paths.camera_numbers[0]) : undefined;
    const nFromIm = config?.imProperties?.cameraCount ? Number(config.imProperties.cameraCount) : undefined;
    const n = (Number.isFinite(nFromPaths as number) && (nFromPaths as number) > 0)
      ? (nFromPaths as number)
      : (Number.isFinite(nFromIm as number) && (nFromIm as number) > 0) ? (nFromIm as number) : 1;
    const count = Number.isFinite(n) ? n : 1;
    return Array.from({ length: count }, (_, i) => `Cam${i + 1}`);
  })();

  // ensure camera state reflects available options
  const [camera, setCamera] = useState<string>(() => cameraOptions.length > 0 ? cameraOptions[0] : "Cam1");
  useEffect(() => {
    if (cameraOptions.length === 0) return;
    if (!cameraOptions.includes(camera)) setCamera(cameraOptions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOptions.length, cameraOptions[0]]);
  const [varType, setVarType] = useState<string>("ux");
  const [cmap, setCmap] = useState<string>("default");
  const [run, setRun] = useState<number>(1);
  const [lowerLimit, setLowerLimit] = useState<string>("");
  const [upperLimit, setUpperLimit] = useState<string>("");
  // Refs to always read the latest limits inside async/interval callbacks
  const lowerLimitRef = useRef<string>(lowerLimit);
  const upperLimitRef = useRef<string>(upperLimit);
  // Refs for other settings so interval callbacks/readers always see latest values
  const sourcePathIdxRef = useRef<number>(sourcePathIdx);
  const cameraRef = useRef<string>(camera);
  const varTypeRef = useRef<string>(varType);
  const cmapRef = useRef<string>(cmap);
  const runRef = useRef<number>(run);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [polling, setPolling] = useState<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollOnceRef = useRef<(() => Promise<void>) | null>(null);
  const uncalPollFnRef = useRef<(() => Promise<void>) | null>(null);

  // Uncalibrated preview polling
  const [expectedCount, setExpectedCount] = useState<number | null>(null);
  const nextUncalIndexRef = useRef<number>(1);
  const uncalPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Status image state
  const [statusImageSrc, setStatusImageSrc] = useState<string | null>(null);
  const [statusImageLoading, setStatusImageLoading] = useState(false);
  const [statusImageError, setStatusImageError] = useState<string | null>(null);
  const [showStatusImage, setShowStatusImage] = useState(true);
  // frame variable list (populated once when first status image arrives)
  const [frameVars, setFrameVars] = useState<string[] | null>(null);
  const [frameVarsLoading, setFrameVarsLoading] = useState(false);
  const [frameVarsError, setFrameVarsError] = useState<string | null>(null);

  useEffect(() => {
    lowerLimitRef.current = lowerLimit;
  }, [lowerLimit]);

  useEffect(() => {
    upperLimitRef.current = upperLimit;
  }, [upperLimit]);

  useEffect(() => { sourcePathIdxRef.current = sourcePathIdx; }, [sourcePathIdx]);
  useEffect(() => { cameraRef.current = camera; }, [camera]);
  useEffect(() => { varTypeRef.current = varType; }, [varType]);
  useEffect(() => { cmapRef.current = cmap; }, [cmap]);
  useEffect(() => { runRef.current = run; }, [run]);

  // This function will be updated on every render with the latest state
  useEffect(() => {
    uncalPollFnRef.current = async () => {
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
        params.set("var", varType); // Use latest varType
        if (cmap && cmap !== "default") params.set("cmap", cmap);
  if (run > 0) params.set("run", String(run)); // Use latest run
  // Read from refs so interval callbacks always use the freshest values
  if (lowerLimitRef.current.trim()) params.set("lower_limit", lowerLimitRef.current);
  if (upperLimitRef.current.trim()) params.set("upper_limit", upperLimitRef.current);
  const res = await fetch(`/backend/plot/get_uncalibrated_image?${params.toString()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.image) {
            setStatusImageSrc(json.image);
            // If backend returned meta.run, update local run state to keep UI in sync
            if (json.meta && json.meta.run != null) {
              const parsed = Number(json.meta.run);
              if (Number.isFinite(parsed) && parsed > 0) setRun(parsed);
            }
            // Only update progress if we have an expectedCount (from backend)
            setProgress((prev) => {
              if (!expectedCount) return prev; // Do not increment progress until backend provides count
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
  }, [sourcePathIdx, camera, varType, cmap, run, lowerLimit, upperLimit, expectedCount]);

  const startPolling = () => {
    // Stop existing polling first
    stopPolling({ resetProgress: false });
    const pollOnce = async () => {
      try {
        // Use the existing get_uncalibrated_count endpoint instead of a separate check_status endpoint.
  const params = new URLSearchParams();
  params.set("basepath_idx", String(sourcePathIdxRef.current));
  params.set("camera", cameraRef.current);
  params.set("var", varTypeRef.current);
  if (cmapRef.current && cmapRef.current !== "default") params.set("cmap", cmapRef.current);

  const statusResponse = await fetch(`/backend/get_uncalibrated_count?${params.toString()}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });
        if (!statusResponse.ok) return;
        const statusData = await statusResponse.json();
        // Prefer percent if provided by backend, otherwise leave progress as-is.
        const percent = typeof statusData.percent === "number" ? statusData.percent : Number(statusData.percent ?? statusData.progress ?? 0);
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

  const uncalCountPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startUncalCountPolling = () => {
    stopUncalCountPolling();
    const pollUncalCount = async () => {
      try {
        const params = new URLSearchParams();
        params.set("basepath_idx", String(sourcePathIdx));
        params.set("camera", camera);
        params.set("var", varType);
        if (cmap && cmap !== "default") params.set("cmap", cmap);
        const cntRes = await fetch(`/backend/get_uncalibrated_count?${params.toString()}`);
        if (cntRes.ok) {
          const cntJson = await cntRes.json();
          const newCount = Number(cntJson.count) || null;
          setExpectedCount(newCount);
          if (typeof cntJson.percent === "number") {
            setProgress(Math.round(cntJson.percent));
          }
        }
      } catch (e) {
        // Silent fail
      }
    };
    pollUncalCount(); // Initial call
    uncalCountPollingRef.current = setInterval(pollUncalCount, POLL_INTERVAL_MS);
  };

  const stopUncalCountPolling = () => {
    if (uncalCountPollingRef.current) {
      clearInterval(uncalCountPollingRef.current);
      uncalCountPollingRef.current = null;
    }
  };

  useEffect(() => () => { if (uncalCountPollingRef.current) clearInterval(uncalCountPollingRef.current); }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "piv_source_paths") {
        try { setSourcePaths(JSON.parse(e.newValue || "[]")); } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Fetch available variables in the first frame for the selected source path / camera
  const fetchFrameVars = async (frameIndex = 1) => {
    setFrameVarsLoading(true);
    setFrameVarsError(null);
    try {
      const params = new URLSearchParams();
      params.set("basepath_idx", String(sourcePathIdx));
  params.set("frame", String(frameIndex));
  params.set("camera", camera);
  // merged not exposed in this component but keep consistent default 0
  params.set("merged", "0");
  // Indicate we are querying uncalibrated .mat for RunPIV
  params.set("is_uncalibrated", "1");
      const res = await fetch(`/backend/plot/check_vars?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch frame vars (${res.status})`);
  const rawVars = Array.isArray(json.vars) ? json.vars.map(String) : [];
  // Only allow this fixed set in RunPIV
  const allowed = ["ux", "uy", "nan_mask", "peak_mag"];
  const filtered = rawVars.filter((v: string) => allowed.includes(v));
  // If backend did not provide any of the allowed vars, still expose the fixed list as fallback
  const finalVars = filtered.length > 0 ? filtered : allowed;
  setFrameVars(finalVars);
  if (finalVars.length > 0) setVarType(prev => finalVars.includes(prev) ? prev : finalVars[0]);
    } catch (e: any) {
      setFrameVarsError(e?.message ?? "Unknown error");
      setFrameVars(null);
    } finally {
      setFrameVarsLoading(false);
    }
  };

  const handleRunPIV = async () => {
    stopPolling({ resetProgress: true });
    stopUncalPolling();
    stopUncalCountPolling();
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
  params.set("basepath_idx", String(sourcePathIdxRef.current));
  params.set("camera", cameraRef.current);
  params.set("var", varTypeRef.current);
  if (cmapRef.current && cmapRef.current !== "default") params.set("cmap", cmapRef.current);
  const cntRes = await fetch(`/backend/get_uncalibrated_count?${params.toString()}`);
      let exp: number | null = null;
      if (cntRes.ok) {
        try {
          const cntJson = await cntRes.json();
          exp = Number(cntJson.count) || null;
          // If backend provides a percent, seed the progress bar with it
          if (typeof cntJson.percent === "number") setProgress(Math.round(cntJson.percent));
          else setProgress(0); // Explicitly set to 0 if no percent from backend
        } catch {
          setProgress(0); // Explicitly set to 0 if error parsing backend response
        }
      } else {
        setProgress(0); // Explicitly set to 0 if backend does not respond
      }
      // Start lightweight uncalibrated preview polling (3s interval)
      setExpectedCount(exp);
      nextUncalIndexRef.current = 1;
      startUncalPolling();
      // --- Ensure main polling is started for progress updates every 3s ---
      startPolling();
      // --- Start polling uncalibrated count every 3s ---
      startUncalCountPolling();
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
      stopUncalCountPolling();
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
  params.set("basepath_idx", String(sourcePathIdxRef.current));
  params.set("camera", cameraRef.current);
  params.set("var", varTypeRef.current);
  if (cmapRef.current && cmapRef.current !== "default") params.set("cmap", cmapRef.current);
  if (runRef.current > 0) params.set("run", String(runRef.current));
  // Use refs so this helper uses the latest values like the uncal polling path
  if (lowerLimitRef.current.trim()) params.set("lower_limit", lowerLimitRef.current);
  if (upperLimitRef.current.trim()) params.set("upper_limit", upperLimitRef.current);
      // default index for a quick preview (use 1 if nothing else)
  params.set("index", String(nextUncalIndexRef.current || 1));
      // FIX: use /backend/plot/get_uncalibrated_image instead of /plot/get_uncalibrated_image
      const res = await fetch(`/backend/plot/get_uncalibrated_image?${params.toString()}`);
      if (!res.ok) throw new Error(`Status image failed: ${res.status}`);
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const json = await res.json();
        setStatusImageSrc(json.image ?? null);
        if (json.meta && json.meta.run != null) {
          const parsed = Number(json.meta.run);
          if (Number.isFinite(parsed) && parsed > 0) setRun(parsed);
        }
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

  // When the first status image arrives, try to populate available frame variables
  useEffect(() => {
    if (statusImageSrc && !frameVars && !frameVarsLoading) {
      void fetchFrameVars(1).catch(() => {});
    }
  }, [statusImageSrc, frameVars, frameVarsLoading]);

  // Uncalibrated preview polling helpers
  const startUncalPolling = () => {
    stopUncalPolling();
    const poll = async () => {
      if (uncalPollFnRef.current) {
        await uncalPollFnRef.current();
      }
    };
    poll(); // Initial call
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
                {cameraOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              {/* Variable type */}
              <label htmlFor="varType" className="text-sm font-medium">Type:</label>
              <select id="varType" value={varType} onChange={(e) => setVarType(e.target.value)} className="border rounded px-2 py-1">
                {frameVarsLoading ? (
                  <option>Loading...</option>
                ) : frameVars && frameVars.length > 0 ? (
                  frameVars.map(v => <option key={v} value={v}>{v}</option>)
                ) : (
                  <>
                    <option value="ux">ux</option>
                    <option value="uy">uy</option>
                  </>
                )}
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
