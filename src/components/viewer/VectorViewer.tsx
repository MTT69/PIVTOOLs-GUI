// import React from "react";
import React, { useRef, useState, useEffect, useCallback } from "react";
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
  
  // Auto-generate file paths
  const matFile = `${directory}/${String(index).padStart(5, "0")}.mat`;
  const coordsFile = `${directory}/coordinates.mat`;

  // Call backend to render vector field PNG
  const fetchImage = useCallback(async () => {
  setLoading(true);
  setError(null);
  // Do not clear imageSrc/meta until new image is loaded
    try {
      if (!matFile || !coordsFile) throw new Error("Please provide both data and coords file paths");
      const params = new URLSearchParams();
      params.set("data", matFile);
      params.set("coords", coordsFile);
      params.set("var", type);
      params.set("cmap", cmap);
      if (run && run > 0) params.set("run", String(run));
      if (lower.trim() !== "") params.set("lower_limit", String(Number(lower)));
      if (upper.trim() !== "") params.set("upper_limit", String(Number(upper)));
      const url = `${backendUrl}/plot_vector?${params.toString()}`;
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
  }, [matFile, coordsFile, type, run, lower, upper, cmap, backendUrl]);
  
  // Automatically render when index or other relevant parameters change
  useEffect(() => {
    if (hasRendered && directory) {
      fetchImage();
    }
  }, [hasRendered, directory, index, cmap, fetchImage]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Vector Viewer</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 mb-4">
            <div className="flex flex-col gap-4 mb-4">
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={directory}
                  onChange={e => setDirectory(e.target.value)}
                  placeholder="Select directory"
                  className="w-full"
                />
                <input
                  type="file"
                  style={{ display: "none" }}
                  ref={dirInputRef}
                />
                <Button variant="outline" onClick={() => dirInputRef.current?.click()}>
                  Browse
                </Button>
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
                {/* Set hasRendered to true on first manual Render click */}
            </div>
            <p className="text-xs text-muted-foreground">Note: files must be readable by the backend server. Index selects 0000x.mat, coordinates.mat is auto-selected.</p>
          </div>
        </div>
          {/* Image viewer placeholder, similar to ImagePairViewer */}
          <div className="mt-6">
            {error && (
              <div className="w-full p-3 mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>
            )}
            {imageSrc && (
              <div className="flex flex-col items-center relative">
                <img src={`data:image/png;base64,${imageSrc}`} alt="Vector Result" className="rounded border w-full max-w-3xl" />
                {loading && (
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
