// import React from "react";
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
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const maxFrame = 999; // You may want to make this dynamic

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

  // Automatically render when index or other relevant parameters change
  useEffect(() => {
    if (hasRendered && (effectiveDir || basePaths.length > 0)) {
      fetchImage();
    }
  }, [hasRendered, effectiveDir, index, cmap, basePathIdx, fetchImage]);

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
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={merged}
                    onChange={e => setMerged(e.target.checked)}
                    className="accent-soton-blue w-4 h-4 rounded border-gray-300"
                  />
                  Merged Data
                </label>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="index" className="text-sm font-medium">File Index:</label>
                <Button size="sm" variant="outline" onClick={() => setIndex(i => Math.max(1, i - 1))}>-</Button>
                <Input id="index" type="number" min={1} value={index} onChange={e => setIndex(Math.max(1, Number(e.target.value)))} className="w-24" />
                <Button size="sm" variant="outline" onClick={() => setIndex(i => i + 1)}>+</Button>
                <span className="text-xs text-gray-500">{matFile}</span>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <label htmlFor="type" className="text-sm font-medium">Type:</label>
                <select id="type" value={type} onChange={e => setType(e.target.value)} className="border rounded px-2 py-1">
                  <option value="ux">ux</option>
                  <option value="uy">uy</option>
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
                <Button className="bg-soton-blue" onClick={() => {
                  setHasRendered(true);
                  fetchImage();
                }}>
                  {loading ? "Loading..." : "Render"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Note: files must be readable by the backend server. Index selects 0000x.mat, coordinates.mat is auto-selected.</p>
            </div>
          </div>

          {/* Slider and play button above image */}
          <div className="flex items-center gap-4 mb-4">
            <label htmlFor="frame-slider" className="text-sm font-medium">Frame:</label>
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
            </Button>
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