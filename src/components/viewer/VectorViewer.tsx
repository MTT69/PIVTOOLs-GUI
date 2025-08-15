// import React from "react};
import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function VectorViewer({ backendUrl = "/backend" }: { backendUrl?: string }) {
  const [hasRendered, setHasRendered] = useState(false);
  const [directory, setDirectory] = useState<string>("C:/Users/ees1u24/Desktop/PIVTools/PlottingPlayground");
  const [index, setIndex] = useState<number>(1);
  const [type, setType] = useState<string>("ux");
  const [run, setRun] = useState<number>(1);
  const [lower, setLower] = useState<string>("");
  const [upper, setUpper] = useState<string>("");
  const [cmap, setCmap] = useState<string>("default");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ run: number; var: string; width?: number; height?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  // Base paths from localStorage + selected index
  const [basePaths, setBasePaths] = useState<string[]>(() => {
    try { return JSON.parse(typeof window !== "undefined" ? localStorage.getItem("piv_base_paths") || "[]" : "[]"); } catch { return []; }
  });
  const [basePathIdx, setBasePathIdx] = useState<number>(0);
  const [camera, setCamera] = useState<string>("1");
  const [merged, setMerged] = useState<boolean>(false);
  const [playing, setPlaying] = useState(false);
  // pending value while dragging slider to avoid firing requests for every tick
  const [pendingIndex, setPendingIndex] = useState<number>(index);
  const [pointerDown, setPointerDown] = useState<boolean>(false);
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const maxFrame = 999; // You may want to make this dynamic

  // New: mean statistics mode
  const [meanMode, setMeanMode] = useState<boolean>(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // New: stat-vars list from stats file
  const [statVars, setStatVars] = useState<string[] | null>(null);
  const [statVarsLoading, setStatVarsLoading] = useState(false);
  const [statVarsError, setStatVarsError] = useState<string | null>(null);

  // New: per-frame vars (from check_vars)
  const [frameVars, setFrameVars] = useState<string[] | null>(null);
  const [frameVarsLoading, setFrameVarsLoading] = useState(false);
  const [frameVarsError, setFrameVarsError] = useState<string | null>(null);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "piv_base_paths") {
        try { setBasePaths(JSON.parse(e.newValue || "[]")); } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Effective directory: prefer selected base path if available
  const effectiveDir = useMemo(() => {
    if (basePaths.length > 0 && basePathIdx >= 0 && basePathIdx < basePaths.length) {
      return basePaths[basePathIdx];
    }
    return directory;
  }, [basePaths, basePathIdx, directory]);

  // Auto-generate file paths from effective directory
  const matFile = useMemo(() => `${effectiveDir}/${String(index).padStart(5, "0")}.mat`, [effectiveDir, index]);
  const coordsFile = useMemo(() => `${effectiveDir}/coordinates.mat`, [effectiveDir]);

  // Folder browse (prefer Tauri; fallback to webkitdirectory)
  const handleBrowse = () => {
    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.dialog?.open) {
        tauri.dialog.open({ directory: true, multiple: false }).then((selected: any) => {
          if (typeof selected === "string") setDirectory(selected);
        }).catch(() => {});
        return;
      }
    } catch {
      // ignore and fallback
    }
    dirInputRef.current?.click();
  };

  const onDirPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const anyFile: any = files[0];
    const rel: string = anyFile.webkitRelativePath || "";
    const root = rel.split("/")[0] || "";
    let folderPath = root;
    if (anyFile.path && rel) {
      const abs = String(anyFile.path);
      folderPath = abs.substring(0, abs.length - rel.length) + root;
    }
    setDirectory(folderPath);
    e.currentTarget.value = "";
  };

  const fetchImage = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Do not clear imageSrc/meta until new image is loaded
    try {
      // Only send the selected base path, not the file path
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", String(index));
      params.set("var", type);
      params.set("cmap", cmap);
      if (run && run > 0) params.set("run", String(run));
      if (lower.trim() !== "") params.set("lower_limit", String(Number(lower)));
      if (upper.trim() !== "") params.set("upper_limit", String(Number(upper)));
      params.set("camera", camera);
      params.set("merged", merged ? "1" : "0");
      const url = `${backendUrl}/plot/plot_vector?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to fetch vector plot");
      setImageSrc(json.image ?? null);
      setMeta(json.meta ?? null);
    } catch (e: any) {
      setError(e.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [effectiveDir, index, type, run, lower, upper, cmap, backendUrl, camera, merged]);

  // New: fetch list of variables available in the mean/stats file
  const fetchStatVars = useCallback(async () => {
    setStatVarsLoading(true);
    setStatVarsError(null);
    try {
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("camera", camera);
      params.set("merged", merged ? "1" : "0");
      const url = `${backendUrl}/plot/check_stat_vars?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch stat vars (${res.status})`);
      const vars = Array.isArray(json.vars) ? json.vars.map(String) : [];
      setStatVars(vars);
      // if current type not in vars, pick first available
      if (vars.length > 0) setType(prev => vars.includes(prev) ? prev : vars[0]);
    } catch (e: any) {
      setStatVarsError(e?.message ?? "Unknown error");
      setStatVars(null);
    } finally {
      setStatVarsLoading(false);
    }
  }, [effectiveDir, camera, merged, backendUrl]);
 
  // New: fetch variables available in a single frame file
  const fetchFrameVars = useCallback(async () => {
    setFrameVarsLoading(true);
    setFrameVarsError(null);
    try {
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", String(index));
      params.set("camera", camera);
      params.set("merged", merged ? "1" : "0");
      const url = `${backendUrl}/plot/check_vars?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch frame vars (${res.status})`);
      const vars = Array.isArray(json.vars) ? json.vars.map(String) : [];
      setFrameVars(vars);
      if (vars.length > 0) setType(prev => (vars.includes(prev) ? prev : vars[0]));
    } catch (e: any) {
      setFrameVarsError(e?.message ?? "Unknown error");
      setFrameVars(null);
    } finally {
      setFrameVarsLoading(false);
    }
  }, [effectiveDir, index, camera, merged, backendUrl]);
  
  // New: fetch min/max limits for the selected variable from /plot/check_limits
  const fetchLimits = useCallback(async () => {
    setLimitsLoading(true);
    try {
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("camera", camera);
      params.set("merged", merged ? "1" : "0");
      params.set("var", type);
      const url = `${backendUrl}/plot/check_limits?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch limits (${res.status})`);
      // Expecting { min: number, max: number }
      if (typeof json.min === "number" && typeof json.max === "number") {
        setLower(String(json.min));
        setUpper(String(json.max));
      } else {
        console.warn("check_limits returned unexpected payload", json);
      }
    } catch (err) {
      console.error("Error fetching limits:", err);
      // keep existing lower/upper values on error
    } finally {
      setLimitsLoading(false);
    }
  }, [effectiveDir, camera, merged, type, backendUrl, setLower, setUpper]);
  
  // Toggle play: when starting playback, fetch limits first and then play
  const handlePlayToggle = () => {
    setPlaying(p => !p);
  };
 
  // New: fetch mean statistics image from /plot_stats (same params as fetchImage)
  const fetchStatsImage = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", String(index)); // kept for compatibility, backend ignores frame for stats
      params.set("var", type);
      params.set("cmap", cmap);
      if (run && run > 0) params.set("run", String(run));
      if (lower.trim() !== "") params.set("lower_limit", String(Number(lower)));
      if (upper.trim() !== "") params.set("upper_limit", String(Number(upper)));
      params.set("camera", camera);
      params.set("merged", merged ? "1" : "0");

      const url = `${backendUrl}/plot/plot_stats?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch stats plot (${res.status})`);
      setImageSrc(json.image ?? null);
      setMeta(json.meta ?? null);
      setHasRendered(true);
    } catch (e: any) {
      setStatsError(e?.message ?? "Unknown error");
    } finally {
      setStatsLoading(false);
    }
  }, [effectiveDir, index, type, run, lower, upper, cmap, backendUrl, camera, merged]);

  // Render handler: when meanMode off, fetch frame vars first then image
  const handleRender = useCallback(async () => {
    setHasRendered(true);
    if (meanMode) {
      await fetchStatsImage();
      return;
    }
    // for frame plotting: fetch available variables for the frame first
    await fetchFrameVars();
    await fetchImage();
  }, [meanMode, fetchFrameVars, fetchImage, fetchStatsImage]);

  // New: fetch stat-vars first, then stats image
  const toggleMeanMode = async () => {
    const newVal = !meanMode;
    setMeanMode(newVal);
    if (newVal) {
      // clear any manual limits when switching to mean statistics
      setLower("");
      setUpper("");
      setStatsError(null);
      await fetchStatVars();
      await fetchStatsImage();
    } else {
      setStatsError(null);
      setStatVars(null);
      setStatVarsError(null);
    }
  };

  // Automatically render when index or other relevant parameters change
  useEffect(() => {
    if (!hasRendered || !(effectiveDir || basePaths.length > 0)) return;
    // When meanMode is active, always use stats endpoint; otherwise use normal plot
    if (meanMode) {
      void fetchStatsImage();
    } else {
      void fetchImage();
    }
  // include all relevant dependencies so changes to type/run/limits/camera/merged trigger correct endpoint
  }, [
    hasRendered,
    effectiveDir,
    index,
    type,
    run,
    lower,
    upper,
    cmap,
    camera,
    merged,
    basePathIdx,
    meanMode,
    fetchImage,
    fetchStatsImage,
  ]);
  
  // Play/pause effect
  useEffect(() => {
    if (playing) {
      playIntervalRef.current = setInterval(() => {
        setIndex(i => {
          if (i < maxFrame) return i + 1;
          setPlaying(false);
          return i;
        });
      }, 300);
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
  }, [playing, maxFrame]);

  // keep pendingIndex in sync when index changes programmatically
  useEffect(() => {
    setPendingIndex(index);
  }, [index]);
  
  // cleanup on unmount: clear commit timeout and play interval
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
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 mb-4">
            <div className="flex flex-col gap-4 mb-4">
              {/* Base path selection */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Base Path:</label>
                {basePaths.length > 0 ? (
                  <>
                    <select
                      value={String(basePathIdx)}
                      onChange={e => setBasePathIdx(Number(e.target.value))}
                      className="border rounded px-2 py-1"
                    >
                      {basePaths.map((p, i) => {
                        // Show last two segments of the path
                        const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
                        const parts = norm.split("/").filter(Boolean);
                        const lastTwo = parts.length >= 2 ? parts.slice(-2).join("/") : norm;
                        return <option key={i} value={i}>{`${i}: /${lastTwo}`}</option>;
                      })}
                    </select>
                  </>
                ) : (
                  <>
                    <Input
                      type="text"
                      value={directory}
                      onChange={e => setDirectory(e.target.value)}
                      placeholder="Select directory"
                      className="w-full"
                    />
                    {/* Hidden directory input for web fallback */}
                    {/* @ts-ignore */}
                    <input
                      type="file"
                      style={{ display: "none" }}
                      ref={dirInputRef}
                      onChange={onDirPicked}
                      multiple
                      // @ts-ignore
                      webkitdirectory="true"
                      // @ts-ignore
                      directory="true"
                    />
                    <Button variant="outline" onClick={handleBrowse}>
                      Browse
                    </Button>
                  </>
                )}
              </div>

              {/* Camera and merged controls */}
              <div className="flex items-center gap-4">
                <label htmlFor="camera" className="text-sm font-medium">Camera:</label>
                <select
                  id="camera"
                  value={camera}
                  onChange={e => setCamera(e.target.value)}
                  className="border rounded px-2 py-1"
                >
                  <option value="1">Camera 1</option>
                  <option value="2">Camera 2</option>
                  {/* Add more cameras if needed */}
                </select>

                {/* Merged Data and Mean Statistics (checkbox) */}
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={merged}
                    onChange={e => setMerged(e.target.checked)}
                    className="accent-soton-blue w-4 h-4 rounded border-gray-300"
                  />
                  Merged Data
                </label>

                {/* Mean statistics checkbox placed beside Merged Data */}
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={meanMode}
                    onChange={() => { void toggleMeanMode(); }}
                    className="accent-soton-blue w-4 h-4 rounded border-gray-300"
                  />
                  Mean Statistics
                  {statVarsLoading && <span className="ml-2 text-xs text-gray-500">Loading vars...</span>}
                  {meanMode && statsLoading && <span className="ml-2 text-xs text-gray-500">Computing...</span>}
                </label>
              </div>

              <div className={`flex items-center gap-2 transition-opacity duration-200 ${meanMode ? "opacity-40 pointer-events-none" : ""}`}>
                {/* File Index controls - faded/disabled when meanMode is active */}
                <label htmlFor="index" className="text-sm font-medium">File Index:</label>
                <Button size="sm" variant="outline" onClick={() => setIndex(i => Math.max(1, i - 1))}>-</Button>
                <Input id="index" type="number" min={1} value={index} onChange={e => setIndex(Math.max(1, Number(e.target.value)))} className="w-24" />
                <Button size="sm" variant="outline" onClick={() => setIndex(i => i + 1)}>+</Button>
                <span className="text-xs text-gray-500">{matFile}</span>
              </div>

              <div className={`flex items-center gap-4 mb-4 transition-opacity duration-200 ${meanMode ? "opacity-40 pointer-events-none" : ""}`}>
                {/* Frame slider - faded/disabled when meanMode is active */}
                <label htmlFor="frame-slider" className="text-sm font-medium">Frame:</label>
                <input
                  id="frame-slider"
                  type="range"
                  min={1}
                  max={maxFrame}
                  value={pendingIndex}
                  // update pending value for every movement
                  onChange={e => {
                    const v = Math.max(1, Number(e.target.value));
                    setPendingIndex(v);
                    // if not dragging (pointer not down), commit (handles clicks) with a small debounce
                    if (!pointerDown) {
                      if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
                      commitTimeoutRef.current = setTimeout(() => {
                        setIndex(v);
                        commitTimeoutRef.current = null;
                      }, 80);
                    }
                  }}
                  // detect drag start/end (works for mouse & touch via pointer events)
                  onPointerDown={() => {
                    setPointerDown(true);
                    if (commitTimeoutRef.current) { clearTimeout(commitTimeoutRef.current); commitTimeoutRef.current = null; }
                  }}
                  onPointerUp={() => {
                    setPointerDown(false);
                    if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
                    // commit the value left at when pointer is released
                    commitTimeoutRef.current = setTimeout(() => {
                      setIndex(pendingIndex);
                      commitTimeoutRef.current = null;
                    }, 20);
                  }}
                  // handle quick drags that may cancel pointerup or leave the element
                  onPointerCancel={() => {
                    setPointerDown(false);
                    if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
                    commitTimeoutRef.current = setTimeout(() => {
                      setIndex(pendingIndex);
                      commitTimeoutRef.current = null;
                    }, 20);
                  }}
                  onPointerLeave={() => {
                    // if leaving while dragging, commit as if pointer released
                    if (pointerDown) {
                      setPointerDown(false);
                      if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
                      commitTimeoutRef.current = setTimeout(() => {
                        setIndex(pendingIndex);
                        commitTimeoutRef.current = null;
                      }, 20);
                    }
                  }}
                  className="w-64"
                />
                <span className="text-xs text-gray-500">{index}</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={playing ? "default" : "outline"}
                    onClick={() => { handlePlayToggle(); }}
                    className="flex items-center gap-1"
                  >
                    {playing ? <span>&#10073;&#10073; Pause</span> : <span>&#9654; Play</span>}
                  </Button>
                </div>
              </div>
  
              <div className="flex items-center gap-3 flex-wrap">
                <label htmlFor="type" className="text-sm font-medium">Type:</label>
                <select id="type" value={type} onChange={e => setType(e.target.value)} className="border rounded px-2 py-1">
                  {meanMode ? (
                    statVarsLoading ? (
                      <option>Loading...</option>
                    ) : statVars && statVars.length > 0 ? (
                      statVars.map(v => <option key={v} value={v}>{v}</option>)
                    ) : (
                      <option disabled>No vars</option>
                    )
                  ) : (
                    frameVarsLoading ? (
                      <option>Loading...</option>
                    ) : frameVars && frameVars.length > 0 ? (
                      frameVars.map(v => <option key={v} value={v}>{v}</option>)
                    ) : (
                      <>
                        <option value="ux">ux</option>
                        <option value="uy">uy</option>
                      </>
                    )
                  )}
                </select>
                <label htmlFor="cmap" className="text-sm font-medium">Colormap:</label>
                <select id="cmap" value={cmap} onChange={e => setCmap(e.target.value)} className="border rounded px-2 py-1">
                  <option value="default">default</option>
                  <option value="viridis">viridis</option>
                  <option value="plasma">plasma</option>
                  <option value="inferno">inferno</option>
                  <option value="magma">magma</option>
                  <option value="cividis">cividis</option>
                  <option value="jet">jet</option>
                  <option value="gray">gray</option>
                  <option value="bone">bone</option>
                  <option value="copper">copper</option>
                  <option value="pink">pink</option>
                  <option value="spring">spring</option>
                  <option value="summer">summer</option>
                  <option value="autumn">autumn</option>
                  <option value="winter">winter</option>
                  <option value="hot">hot</option>
                  <option value="cool">cool</option>
                  <option value="Wistia">Wistia</option>
                  <option value="twilight">twilight</option>
                  <option value="hsv">hsv</option>
                </select>
                <label htmlFor="run" className="text-sm font-medium">Run:</label>
                <Input id="run" type="number" min={1} value={run} onChange={e => setRun(Math.max(1, Number(e.target.value)))} className="w-24" />
                <label className="text-sm font-medium">Lower:</label>
                <Input type="number" value={lower} onChange={e => setLower(e.target.value)} placeholder="auto" className="w-28" />
                <label className="text-sm font-medium">Upper:</label>
                <Input type="number" value={upper} onChange={e => setUpper(e.target.value)} placeholder="auto" className="w-28" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { void fetchLimits(); }}
                  disabled={limitsLoading || meanMode} // disabled when mean statistics is active
                  className="ml-2"
                >
                  {limitsLoading ? "Getting..." : "Get Limits"}
                </Button>
                
                {/* Render button: uses stats endpoint when meanMode active */}
                <Button
                  className="bg-soton-blue"
                  onClick={() => { void handleRender(); }}
                  disabled={loading || statsLoading || frameVarsLoading}
                >
                  {(loading || statsLoading || frameVarsLoading) ? "Loading..." : "Render"}
                </Button>
              </div>

              {statsError && meanMode && (
                <div className="w-full p-3 mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
                  {statsError}
                </div>
              )}

              <p className="text-xs text-muted-foreground">Note: files must be readable by the backend server. Index selects 0000x.mat, coordinates.mat is auto-selected.</p>
            </div>
          </div>

          {/* Slider and play button above image */}
          <div className="flex items-center gap-4 mb-4">
            {/* <label htmlFor="frame-slider" className="text-sm font-medium">Frame:</label>
            <input
              id="frame-slider"
              type="range"
              min={1}
              max={maxFrame}
              value={index}
              onChange={e => setIndex(Number(e.target.value))}
              className="w-64"
            />
            <span className="text-xs text-gray-500">{index}</span>
            <Button
              size="sm"
              variant={playing ? "default" : "outline"}
              onClick={() => setPlaying(p => !p)}
              className="flex items-center gap-1"
            >
              {playing ? (
                <span>&#10073;&#10073; Pause</span>
              ) : (
                <span>&#9654; Play</span>
              )}
            </Button> */}
          </div>

          {/* Image viewer placeholder, similar to ImagePairViewer */}
          <div className="mt-6">
            {error && (
              <div className="w-full p-3 mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>
            )}
            {imageSrc && (
              <div className="flex flex-col items-center relative">
                <img src={`data:image/png;base64,${imageSrc}`} alt="Vector Result" className="rounded border w-full max-w-3xl" />
                {/* Only show rendering overlay if not playing */}
                {loading && !playing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60">
                    <span className="text-gray-500">Rendering...</span>
                  </div>
                )}
                {meta && (
                  <div className="text-xs text-gray-500 mt-2">Run: {meta.run} • Var: {meta.var}{meta.width && meta.height ? ` • ${meta.width}×${meta.height}` : ""}</div>
                )}
              </div>
            )}
            {!imageSrc && (
              <div className="w-full h-64 flex items-center justify-center bg-gray-100 border rounded">
                <span className="text-gray-500">No image loaded</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}