"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
// ...no direct button usage; kept minimal imports
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { useRef } from "react";

interface PODProps {
  config?: any;
  updateConfig?: (path: string[], value: any) => void;
}

export default function POD({ config, updateConfig }: PODProps) {
  const [basePaths, setBasePaths] = useState<string[]>(() => {
    try { return JSON.parse(typeof window !== "undefined" ? localStorage.getItem("piv_base_paths") || "[]" : "[]"); } catch { return []; }
  });
  const [basePathIdx, setBasePathIdx] = useState<number>(0);
  
  // Derive camera options from config like RunPIV and ImagePairViewer
  const cameraOptions = useMemo(() => {
    // Use the same logic to derive camera options from config
    const nFromPaths = config?.paths?.camera_numbers?.length ? Number(config.paths.camera_numbers[0]) : undefined;
    const nFromIm = config?.imProperties?.cameraCount ? Number(config.imProperties.cameraCount) : undefined;
    const n = (Number.isFinite(nFromPaths as number) && (nFromPaths as number) > 0)
      ? (nFromPaths as number)
      : (Number.isFinite(nFromIm as number) && (nFromIm as number) > 0) ? (nFromIm as number) : 1;
    const count = Number.isFinite(n) ? n : 1;
    return Array.from({ length: count }, (_, i) => String(i + 1));
  }, [config]);

  const [camera, setCamera] = useState<string>(() => cameraOptions.length > 0 ? cameraOptions[0] : "1");
  
  // Ensure camera state reflects available options when config changes
  useEffect(() => {
    if (cameraOptions.length === 0) return;
    if (!cameraOptions.includes(camera)) setCamera(cameraOptions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOptions.length, cameraOptions[0]]);

  // merged data toggle (next to camera)
  const [merged, setMerged] = useState<boolean>(false);
  const [randomised, setRandomised] = useState<boolean>(false);
  const [normalise, setNormalise] = useState<boolean>(false);
  const [stackUy, setStackUy] = useState<boolean>(false);
  const [kModes, setKModes] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const [progress, setProgress] = useState<number>(0);
  const [processing, setProcessing] = useState<boolean>(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Visualization-specific state (shown after progress reaches 100)
  const [modeIndex, setModeIndex] = useState<number>(1); // mode number / "frame" for plot endpoints
  const [maxMode, setMaxMode] = useState<number>(Math.max(1, Number(kModes) || 100));
  const [playing, setPlaying] = useState<boolean>(false);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // pending mode during dragging to avoid firing requests on every tick
  const [pendingMode, setPendingMode] = useState<number>(modeIndex);
  const [pointerDownMode, setPointerDownMode] = useState<boolean>(false);
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [type, setType] = useState<string>("ux");
  const [cmap, setCmap] = useState<string>("default");
  const [hasCheckedVars, setHasCheckedVars] = useState<boolean>(false);
  const [runVis, setRunVis] = useState<number>(1);
  const [lower, setLower] = useState<string>("");
  const [upper, setUpper] = useState<string>("");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [frameVars, setFrameVars] = useState<string[] | null>(null);
  const [frameVarsLoading, setFrameVarsLoading] = useState(false);
  const [frameVarsError, setFrameVarsError] = useState<string | null>(null);
  const POLL_INTERVAL_MS = 20000; // 20s as in RunPIV

  // Load existing POD settings from config if available
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/backend/config");
        const json = await res.json();
        if (!res.ok) return;
        const pp = json.post_processing || [];
        const pod = pp.find((e: any) => String(e.type || "").toLowerCase() === "pod");
        const settings = pod?.settings || {};
        if (typeof settings.randomised === "boolean") setRandomised(settings.randomised);
        if (typeof settings.normalise === "boolean") setNormalise(settings.normalise);
        if (typeof settings.stack_u_y === "boolean") setStackUy(settings.stack_u_y);
        if (typeof settings.k_modes === "number") setKModes(settings.k_modes);
    // also try to initialize basePath/camera from config if present
    if (typeof settings.basepath_idx === "number") setBasePathIdx(settings.basepath_idx);
    if (settings.camera) setCamera(String(settings.camera));
      } catch (e) {
        // ignore
      }
    }
    load();
  }, []);

  // Save one or more fields to backend immediately
  const saveChange = async (payload: any) => {
    setLoading(true);
    try {
      const wrapped = {
        post_processing: [
          {
            type: "POD",
            settings: payload,
          },
        ],
      };
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wrapped),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update POD settings");
      // reflect changes in parent config if provided (update_config returns { updated: ... })
      const updated = json.updated || {};
      if (updateConfig) {
        // prefer backend-echoed post_processing, otherwise mirror our wrapped payload
        updateConfig(["post_processing"], updated.post_processing || wrapped.post_processing);
      }
    } catch (e: any) {
      toast({ title: "Failed to save POD", description: e?.message ?? "Unknown error" });
    } finally {
      setLoading(false);
    }
  };

  const pollOnce = async () => {
    try {
      const res = await fetch("/backend/pod_status", { method: "GET", cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const raw = Number(json.status ?? json.progress ?? 0);
      const newProgress = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 100) : 0;
      setProgress((prev) => (newProgress > prev ? newProgress : prev));
      setProcessing(Boolean(json.processing));
      if (!json.processing || newProgress >= 100) stopPolling();
    } catch (e) {
      // silent
    }
  };

  const startPolling = () => {
    stopPolling({ resetProgress: false });
    pollOnce();
    pollingRef.current = setInterval(pollOnce, POLL_INTERVAL_MS);
  };

  const stopPolling = (options?: { resetProgress?: boolean }) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setProcessing(false);
    if (options?.resetProgress) setProgress(0);
  };

  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current); }, []);

  const handleStartPOD = async () => {
    setLoading(true);
    try {
  // include the actual base_path string so backend receives it (fallback to null if not available)
  const selectedBasePath = (Array.isArray(basePaths) && basePaths.length > 0 && basePathIdx >= 0 && basePathIdx < basePaths.length)
    ? basePaths[basePathIdx]
    : null;
  const payload: any = { basepath_idx: basePathIdx, base_path: selectedBasePath, camera };
   const res = await fetch("/backend/start_pod", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`Failed to start POD: ${res.statusText}`);
      const json = await res.json().catch(() => ({}));
      setProcessing(true);
      startPolling();
    } catch (e: any) {
      toast({ title: "Failed to start POD", description: e?.message ?? "Unknown error" });
    } finally { setLoading(false); }
  };

  const handleCancelPOD = async () => {
    setLoading(true);
    try {
      const res = await fetch("/backend/cancel_pod", { method: "POST" });
      if (!res.ok) throw new Error(`Failed to cancel POD: ${res.statusText}`);
      await res.json().catch(() => ({}));
      stopPolling({ resetProgress: true });
      setProcessing(false);
    } catch (e: any) {
      toast({ title: "Failed to cancel POD", description: e?.message ?? "Unknown error" });
    } finally { setLoading(false); }
  };

  // Keep maxMode in sync with kModes when available
  useEffect(() => {
    if (typeof kModes === "number" && kModes > 0) {
      setMaxMode(kModes);
      if (modeIndex > kModes) setModeIndex(kModes);
    }
  }, [kModes]);

  // Helper to get selected base path
  const getSelectedBasePath = () => {
    return (Array.isArray(basePaths) && basePaths.length > 0 && basePathIdx >= 0 && basePathIdx < basePaths.length)
      ? basePaths[basePathIdx]
      : null;
  };

  // Fetch variables available for a given mode/frame (plot/check_vars)
  const fetchFrameVars = async (mode = modeIndex) => {
    setFrameVarsLoading(true);
    setFrameVarsError(null);
    try {
      const basePath = getSelectedBasePath();
      if (!basePath) throw new Error("Please select a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", String(mode));
      params.set("camera", camera);
      params.set("merged", merged ? "1" : "0");
      const url = `/backend/plot/check_vars?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch vars (${res.status})`);
      const vars = Array.isArray(json.vars) ? json.vars.map(String) : [];
      setFrameVars(vars);
      if (vars.length > 0) setType(prev => (vars.includes(prev) ? prev : vars[0]));
      // mark that we've checked vars at least once successfully
      setHasCheckedVars(true);
    } catch (e: any) {
      setFrameVarsError(e?.message ?? "Unknown error");
      setFrameVars(null);
    } finally {
      setFrameVarsLoading(false);
    }
  };

  // Fetch visualization image via plot/plot_vector
  const fetchImage = async (mode = modeIndex) => {
    setLoadingImage(true);
    try {
      const basePath = getSelectedBasePath();
      if (!basePath) throw new Error("Please select a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", String(mode)); // using mode as 'frame' for plot endpoint
      params.set("var", type);
      params.set("cmap", cmap);
      if (runVis && runVis > 0) params.set("run", String(runVis));
      if (lower.trim() !== "") params.set("lower_limit", String(Number(lower)));
      if (upper.trim() !== "") params.set("upper_limit", String(Number(upper)));
      params.set("camera", camera);
      params.set("merged", merged ? "1" : "0");
      const url = `/backend/plot/plot_vector?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch plot (${res.status})`);
      setImageSrc(json.image ?? null);
      setMeta(json.meta ?? null);
    } catch (e: any) {
      toast({ title: "Visualization error", description: e?.message ?? "Unknown error" });
      setImageSrc(null);
      setMeta(null);
    } finally {
      setLoadingImage(false);
    }
  };

  // auto-fetch vars when modeIndex or base selection changes (only once POD completed)
  useEffect(() => {
    if (progress < 100) return;
    const basePath = getSelectedBasePath();
    if (!basePath) return;
    // only call check_vars automatically if we haven't done so yet
    if (!hasCheckedVars) void fetchFrameVars(modeIndex);
  }, [modeIndex, basePathIdx, camera, merged, progress, hasCheckedVars]);

  // Auto-render whenever mode, type, or colormap change (after POD finished).
  useEffect(() => {
    if (progress < 100) return;
    const basePath = getSelectedBasePath();
    if (!basePath) return;
    let cancelled = false;
    const doAutoRender = async () => {
      try {
        // Call check_vars only if we haven't done it yet; afterwards just fetch image
        if (!hasCheckedVars) {
          await fetchFrameVars(modeIndex);
          if (cancelled) return;
        }
        await fetchImage(modeIndex);
      } catch {
        // silent - fetchFrameVars/fetchImage already surface errors via toast/state
      }
    };
    void doAutoRender();
    return () => { cancelled = true; };
  // include modeIndex, type and cmap so changes auto-render
  }, [modeIndex, type, cmap, basePathIdx, camera, merged, progress, hasCheckedVars]);

  // Play/pause handling for modes
  useEffect(() => {
    if (playing) {
      playIntervalRef.current = setInterval(() => {
        setModeIndex(i => {
          if (i < maxMode) return i + 1;
          // stop if at end
          setPlaying(false);
          return i;
        });
      }, 400);
    } else if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [playing, maxMode]);

  // keep pendingMode in sync when modeIndex is changed programmatically
  useEffect(() => {
    setPendingMode(modeIndex);
  }, [modeIndex]);
  
  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (commitTimeoutRef.current) {
        clearTimeout(commitTimeoutRef.current);
        commitTimeoutRef.current = null;
      }
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="items-start">
          <CardTitle className="text-left">Proper Orthogonal Decomposition (POD)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-white rounded-xl shadow p-4 mb-4">
            <div className="space-y-4">
              {/* Base path selection */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Base Path:</label>
                {basePaths.length > 0 ? (
                  <select
                    value={String(basePathIdx)}
                    onChange={e => setBasePathIdx(Number(e.target.value))}
                    className="border rounded px-2 py-1"
                  >
                    {basePaths.map((p, i) => {
                      const norm = p.replace(/\\/g, "/").replace(/\/+$|\\$/g, "");
                      const parts = norm.split("/").filter(Boolean);
                      const lastTwo = parts.length >= 2 ? parts.slice(-2).join("/") : norm;
                      return <option key={i} value={i}>{`${i}: /${lastTwo}`}</option>;
                    })}
                  </select>
                ) : (
                  <Input type="text" value="No base paths" readOnly className="w-full" />
                )}
              </div>

              {/* Camera selection - updated to use dynamic options */}
              <div className="flex items-center gap-4">
                <label htmlFor="camera" className="text-sm font-medium">Camera:</label>
                <select
                  id="camera"
                  value={camera}
                  onChange={e => setCamera(e.target.value)}
                  className="border rounded px-2 py-1"
                >
                  {cameraOptions.map((cam) => (
                    <option key={cam} value={cam}>Camera {cam}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm font-medium ml-2">
                  <input
                    type="checkbox"
                    checked={merged}
                    onChange={e => setMerged(e.target.checked)}
                    className="accent-soton-blue w-4 h-4 rounded border-gray-300"
                  />
                  Merged Data
                </label>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-2/3 flex flex-col justify-center">
                  <label className="text-sm font-medium">Number of modes (k_modes)</label>
                  <div className="text-xs text-gray-500">0 for automatic / all modes</div>
                </div>
                <div className="w-1/3 text-right">
                  <Input
                    type="number"
                    min={0}
                    max={99999}
                    // visually limit to ~5 digits
                    className="w-20 inline-block"
                    value={kModes}
                    onChange={e => {
                      const raw = e.target.value;
                      const nm = raw === "" ? 0 : Number(raw);
                      setKModes(raw === "" ? "" : nm);
                      saveChange({ k_modes: nm });
                    }}
                  />
                </div>
              </div>

              {/* Always-visible switches that update backend config */}
              <div className="flex items-center gap-4">
                <div className="w-2/3">
                  <div className="text-sm font-medium">Randomised</div>
                  <div className="text-xs text-gray-500">Randomise snapshot order before decomposition</div>
                </div>
                <div className="w-1/3 text-right">
                  <Switch
                    checked={randomised}
                    onCheckedChange={(v: any) => {
                      setRandomised(Boolean(v));
                      saveChange({ randomised: Boolean(v) });
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-2/3">
                  <div className="text-sm font-medium">Normalise</div>
                  <div className="text-xs text-gray-500">Normalise snapshots prior to decomposition</div>
                </div>
                <div className="w-1/3 text-right">
                  <Switch
                    checked={normalise}
                    onCheckedChange={(v: any) => {
                      setNormalise(Boolean(v));
                      saveChange({ normalise: Boolean(v) });
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-2/3">
                  <div className="text-sm font-medium">Stack U/Y</div>
                  <div className="text-xs text-gray-500">Stack U and Y components instead of separate decompositions</div>
                </div>
                <div className="w-1/3 text-right">
                  <Switch
                    checked={stackUy}
                    onCheckedChange={(v: any) => {
                      setStackUy(Boolean(v));
                      saveChange({ stack_u_y: Boolean(v) });
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 mb-4">
            <div className="flex flex-col gap-2">
              <Progress value={progress} className="w-full" />
            </div>

            <div className="flex items-center justify-center gap-4 mt-4">
              <Button className="bg-green-600 hover:bg-green-700" onClick={handleStartPOD} disabled={loading || processing}>
                {loading ? "Starting..." : (processing ? "Running..." : "Start POD")}
              </Button>
              <Button className="bg-red-600 hover:bg-red-700" onClick={handleCancelPOD} disabled={loading || !processing}>
                {loading ? "Canceling..." : "Cancel POD"}
              </Button>
            </div>
          </div>

          {/* Visualization controls appear only after POD progress completes - moved below buttons */}
          {progress >= 100 && (
            <div className="bg-white rounded-xl shadow p-4 mb-4">
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium">Mode:</label>
                  <select
                    value={String(modeIndex)}
                    onChange={e => setModeIndex(Math.max(1, Number(e.target.value)))}
                    className="border rounded px-2 py-1"
                  >
                    {Array.from({ length: Math.max(1, maxMode) }, (_, i) => i + 1).map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <input
                    type="range"
                    min={1}
                    max={Math.max(1, maxMode)}
                    value={pendingMode}
                    onChange={e => {
                      const v = Math.max(1, Number(e.target.value));
                      setPendingMode(v);
                      // if not dragging, commit (covers clicks); debounce small to coalesce events
                      if (!pointerDownMode) {
                        if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
                        commitTimeoutRef.current = setTimeout(() => {
                          setModeIndex(v);
                          commitTimeoutRef.current = null;
                        }, 80);
                      }
                    }}
                    onPointerDown={() => {
                      setPointerDownMode(true);
                      if (commitTimeoutRef.current) { clearTimeout(commitTimeoutRef.current); commitTimeoutRef.current = null; }
                    }}
                    onPointerUp={() => {
                      setPointerDownMode(false);
                      if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
                      commitTimeoutRef.current = setTimeout(() => {
                        setModeIndex(pendingMode);
                        commitTimeoutRef.current = null;
                      }, 20);
                    }}
                    className="w-48"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPlaying(p => !p)}
                      className="px-3 py-1 rounded border bg-white hover:bg-gray-50"
                      aria-pressed={playing}
                    >
                      {playing ? <span>&#10073;&#10073; Pause</span> : <span>&#9654; Play</span>}
                    </button>
                    <span className="text-xs text-gray-500">{modeIndex}/{Math.max(1, maxMode)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-sm font-medium">Type:</label>
                  <select value={type} onChange={e => setType(e.target.value)} className="border rounded px-2 py-1">
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

                  <label className="text-sm font-medium">Colormap:</label>
                  <select value={cmap} onChange={e => setCmap(e.target.value)} className="border rounded px-2 py-1">
                    <option value="default">default</option>
                    <option value="viridis">viridis</option>
                    <option value="plasma">plasma</option>
                    <option value="inferno">inferno</option>
                    <option value="magma">magma</option>
                    <option value="cividis">cividis</option>
                    <option value="jet">jet</option>
                    <option value="gray">gray</option>
                  </select>

                  <label className="text-sm font-medium">Run:</label>
                  <Input type="number" min={1} value={runVis} onChange={e => setRunVis(Math.max(1, Number(e.target.value)))} className="w-24" />
                  <label className="text-sm font-medium">Lower:</label>
                  <Input type="number" value={lower} onChange={e => setLower(e.target.value)} placeholder="auto" className="w-28" />
                  <label className="text-sm font-medium">Upper:</label>
                  <Input type="number" value={upper} onChange={e => setUpper(e.target.value)} placeholder="auto" className="w-28" />

                  <Button
                    className="bg-soton-blue"
                    onClick={async () => {
                      // ensure check_vars is run at least once; skip on subsequent renders
                      if (!hasCheckedVars) await fetchFrameVars(modeIndex);
                      await fetchImage(modeIndex);
                    }}
                    disabled={loadingImage || frameVarsLoading}
                  >
                    {(loadingImage || frameVarsLoading) ? "Loading..." : "Render"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Visualization image area (shown when an image is available and POD finished) */}
          {progress >= 100 && (
            <div className="mt-4">
              {imageSrc ? (
                <div className="flex flex-col items-center relative">
                  <img src={`data:image/png;base64,${imageSrc}`} alt="POD Vector" className="rounded border w-full max-w-3xl" />
                  {loadingImage && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60">
                      <span className="text-gray-500">Rendering...</span>
                    </div>
                  )}
                  {meta && <div className="text-xs text-gray-500 mt-2">Run: {meta.run} • Var: {meta.var}</div>}
                </div>
              ) : (
                <div className="w-full h-48 flex items-center justify-center bg-gray-100 border rounded">
                  <span className="text-gray-500">No visualization loaded</span>
                </div>
              )}
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}

