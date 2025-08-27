"use client";
import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CalibrationMethod = "scale_factor" | "pinhole" | "stereo";

interface Config {
  images: { num_images?: number };
  paths: { camera_numbers?: number[] };
  calibration?: {
    active?: CalibrationMethod;
    scale_factor?: any;
    pinhole?: any;
    stereo?: any;
    [key: string]: any;
  };
}

function useConfig(): [Config, (path: string[], value: any) => void] {
  // Minimal config loader for this page
  const [config, setConfig] = useState<Config>({ images: {}, paths: {} });
  useEffect(() => {
    fetch("/backend/config")
      .then(r => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);
  // Improved updateConfig: POST to backend and update local state, with safe deep update
  function updateConfig(path: string[], value: any) {
    fetch("/backend/update_config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(path.length === 1 ? { [path[0]]: value } : { [path[0]]: { [path[1]]: value } }),
    }).then(() => {
      // After updating, refetch config from backend to ensure latest camera_numbers
      fetch("/backend/config")
        .then(r => r.json())
        .then(setConfig)
        .catch(() => {});
    });
  }
  return [config, updateConfig];
}

// --- Scale Factor Calibration UI ---
const ScaleFactorCalibration: React.FC<{ config: Config; updateConfig: (path: string[], value: any) => void; setActive: () => void; isActive: boolean }> = ({ config, updateConfig, setActive, isActive }) => {
  // Determine number of cameras robustly
  const camNums = config.paths?.camera_numbers;
  let numCameras = 1;
  if (Array.isArray(camNums)) {
    if (camNums.length === 1) {
      const maybeCount = Number(camNums[0]);
      if (!Number.isNaN(maybeCount) && maybeCount > 0) numCameras = maybeCount;
    } else if (camNums.length > 1) {
      numCameras = camNums.length;
    }
  }
  const calib = config.calibration?.scale_factor || {};
  const [dt, setDt] = useState<string>(calib.dt !== undefined ? String(calib.dt) : "");
  const [pxPerMm, setPxPerMm] = useState<string>(calib.px_per_mm !== undefined ? String(calib.px_per_mm) : "");
  const [xOffsets, setXOffsets] = useState<string[]>(Array.isArray(calib.x_offset) ? calib.x_offset.map(String) : Array(numCameras).fill(""));
  const [yOffsets, setYOffsets] = useState<string[]>(Array.isArray(calib.y_offset) ? calib.y_offset.map(String) : Array(numCameras).fill(""));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDt(calib.dt !== undefined ? String(calib.dt) : "");
    setPxPerMm(calib.px_per_mm !== undefined ? String(calib.px_per_mm) : "");
    setXOffsets(Array.isArray(calib.x_offset) ? calib.x_offset.map(String) : Array(numCameras).fill(""));
    setYOffsets(Array.isArray(calib.y_offset) ? calib.y_offset.map(String) : Array(numCameras).fill(""));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numCameras, config.calibration?.scale_factor]);

  // Update offsets if number of cameras changes
  useEffect(() => {
    setXOffsets(prev => {
      const arr = [...prev];
      while (arr.length < numCameras) arr.push("");
      return arr.slice(0, numCameras);
    });
    setYOffsets(prev => {
      const arr = [...prev];
      while (arr.length < numCameras) arr.push("");
      return arr.slice(0, numCameras);
    });
  }, [numCameras]);

  // Debounced auto-save
  const debounceTimer = React.useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const block = {
        dt: Number(dt),
        px_per_mm: Number(pxPerMm),
        x_offset: xOffsets.map(Number),
        y_offset: yOffsets.map(Number),
      };
      updateConfig(["calibration", "scale_factor"], block);
    }, 500);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dt, pxPerMm, xOffsets, yOffsets]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scale Factor Calibration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium">Δt (seconds)</label>
            <Input type="number" step="any" value={dt} onChange={e=>setDt(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium">Pixels per mm</label>
            <Input type="number" step="any" value={pxPerMm} onChange={e=>setPxPerMm(e.target.value)} />
          </div>
        </div>
        {/* Table/grid for X/Y offsets per camera */}
        <div>
          <label className="block text-xs font-medium mb-1">Camera Offsets (px)</label>
          <div className="overflow-x-auto">
            <table className="min-w-[320px] border text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 border">Camera</th>
                  <th className="px-2 py-1 border">X Offset</th>
                  <th className="px-2 py-1 border">Y Offset</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({length: numCameras}).map((_,i)=>(
                  <tr key={i}>
                    <td className="px-2 py-1 border text-center">{i+1}</td>
                    <td className="px-2 py-1 border">
                      <Input
                        type="number"
                        step="any"
                        value={xOffsets[i]||""}
                        onChange={e=>{
                          const next = [...xOffsets]; next[i]=e.target.value; setXOffsets(next);
                        }}
                        className="w-24"
                        placeholder="X"
                      />
                    </td>
                    <td className="px-2 py-1 border">
                      <Input
                        type="number"
                        step="any"
                        value={yOffsets[i]||""}
                        onChange={e=>{
                          const next = [...yOffsets]; next[i]=e.target.value; setYOffsets(next);
                        }}
                        className="w-24"
                        placeholder="Y"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex gap-2">
          {/* <Button onClick={handleSave} disabled={saving || !dt || !pxPerMm}>Save Scale Factor Calibration</Button> */}
          {!isActive && <Button variant="outline" onClick={setActive}>Set as Active</Button>}
          {isActive && <span className="text-green-600 text-xs font-semibold ml-2">Active</span>}
        </div>
        <div className="text-xs text-gray-500 mt-2">
          This method sets the scale using known pixels/mm, dt, and camera offsets.<br />
          Updates the calibration.scale_factor block in config.yaml.
        </div>
      </CardContent>
    </Card>
  );
};

// --- Pinhole Calibration UI ---
const PinholeCalibration: React.FC<{ config: Config; updateConfig: (path: string[], value: any) => void; setActive: () => void; isActive: boolean }> = ({ config, updateConfig, setActive, isActive }) => {
  // Load pinhole config from YAML
  const pinholeConfig = config.calibration?.pinhole || {};
  // Use string state for dt for consistency and to avoid losing precision
  const [dt, setDt] = useState<string>(pinholeConfig.dt !== undefined ? String(pinholeConfig.dt) : "");
  const [dotDistance, setDotDistance] = useState<number>(pinholeConfig.dot_distance_mm ?? 28.9);
  const [gridTolerance, setGridTolerance] = useState<number>(pinholeConfig.grid_tolerance ?? 0.5);
  const [ransacThresh, setRansacThresh] = useState<number>(pinholeConfig.ransac_threshold ?? 3.0);
  const [sourcePaths, setSourcePaths] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("piv_source_paths") || "[]"); } catch { return []; }
  });
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState("1");
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [dots, setDots] = useState<[number, number][]>([]);
  const [datum, setDatum] = useState<[number, number] | null>(null);
  const [right, setRight] = useState<[number, number] | null>(null);
  const [above, setAbove] = useState<[number, number] | null>(null);
  const [dewarpedB64, setDewarpedB64] = useState<string | null>(null);
  const [inlierMask, setInlierMask] = useState<number[]>([]);
  const [gridPoints, setGridPoints] = useState<[number, number][]>([]);
  const [gridIndices, setGridIndices] = useState<[number, number][]>([]);
  const [showIndices, setShowIndices] = useState(true);
  const [loading, setLoading] = useState(false);
  // Add native image size state
  const [nativeSize, setNativeSize] = useState<{ w: number; h: number }>({ w: 1024, h: 1024 });

  const loadImage = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ source_path_idx: String(sourcePathIdx), camera });
      const res = await fetch(`/backend/calibration/get_image?${params.toString()}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to load calibration image");
      setImageB64(j.image);
      // If backend provides width/height, use them; else fallback to 1024
      setNativeSize({
        w: j.width || 1024,
        h: j.height || 1024
      });
      setDots([]); setDatum(null); setRight(null); setAbove(null);
      setDewarpedB64(null); setGridPoints([]); setGridIndices([]); setInlierMask([]);
      return true;
    } catch (e:any) { alert(e.message); }
    finally { setLoading(false); }
  };

  const detectDots = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ source_path_idx: String(sourcePathIdx), camera });
      const res = await fetch(`/backend/calibration/detect_dots?${params.toString()}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to detect dots");
      setDots(j.dots || []);
    } catch (e:any) { alert(e.message); }
    finally { setLoading(false); }
  };

  // Auto-load image and detect dots when this component mounts (e.g., when tab opens).
  // Assumption: the component is mounted when the calibration tab is opened. If the
  // tab keeps the component mounted while hidden, a different visibility signal is
  // required from the parent and this effect should be adjusted.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const ok = await loadImage();
      if (!mounted) return;
      if (ok) await detectDots();
    })();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function findNearest(pt:[number,number]): [number,number] {
    if (!dots.length) return pt;
    let best = dots[0]; let bd = Infinity;
    for (const d of dots) { const dx = d[0]-pt[0]; const dy = d[1]-pt[1]; const dist = dx*dx+dy*dy; if (dist<bd){bd=dist; best=d as [number,number];}}
    return best as [number,number];
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imageB64) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    // Map to image coordinates using native size
    const scaleX = canvas.width / canvas.clientWidth;
    const scaleY = canvas.height / canvas.clientHeight;
    const ix = x * scaleX * (nativeSize.w / canvas.width);
    const iy = y * scaleY * (nativeSize.h / canvas.height);
    const snapped = findNearest([ix, iy]);
    if (!datum) setDatum(snapped);
    else if (!right) setRight(snapped);
    else if (!above) setAbove(snapped);
    else { setDatum(snapped); setRight(null); setAbove(null); }
  };

  const computeCalibration = async () => {
    if (!datum || !right || !above) { alert("Select datum, right, above dots."); return; }
    try {
      setLoading(true);
      const body = {
        source_path_idx: sourcePathIdx,
        camera,
        datum,
        right,
        above,
        dot_distance_mm: dotDistance,
        grid_tolerance: gridTolerance,
        ransac_threshold: ransacThresh
      };
      const res = await fetch('/backend/calibration/compute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Calibration failed');
      setDewarpedB64(j.dewarped);
      setInlierMask(j.inlier_mask || []);
      setGridPoints(j.grid_points || []);
      setGridIndices(j.grid_indices || []);
    } catch (e:any) { alert(e.message); }
    finally { setLoading(false); }
  };

  // On config change, update dt state
  useEffect(() => {
    setDt(pinholeConfig.dt !== undefined ? String(pinholeConfig.dt) : "");
  }, [pinholeConfig.dt]);

  // Debounced auto-save
  const debounceTimer = React.useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      updateConfig(["calibration", "pinhole"], {
        dt: Number(dt),
        dot_distance_mm: dotDistance,
        grid_tolerance: gridTolerance,
        ransac_threshold: ransacThresh,
        // Add more fields as needed
      });
    }, 500);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dt, dotDistance, gridTolerance, ransacThresh]);

  // Camera dropdown options: derive count robustly from config.paths.camera_numbers
  const cameraDropdownOptions = React.useMemo(() => {
    const camNums = config?.paths?.camera_numbers;
    let count = 1;
    if (Array.isArray(camNums)) {
      if (camNums.length === 1) {
        // Single-element array may store the count (e.g. [4])
        const maybeCount = Number(camNums[0]);
        if (!Number.isNaN(maybeCount) && maybeCount > 0) count = maybeCount;
      } else if (camNums.length > 1) {
        // Multi-element array likely lists camera indices => use length
        count = camNums.length;
      }
    }
    // Return numeric string values so they match the `camera` state (which is "1", "2", ...)
    return Array.from({ length: Math.max(1, Math.floor(count)) }, (_, i) => String(i + 1));
  }, [config]);

  // Ensure selected camera string matches available options
  useEffect(() => {
    if (!cameraDropdownOptions.includes(camera)) {
      setCamera(cameraDropdownOptions[0] || "1");
    }
  }, [cameraDropdownOptions]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Planar Calibration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-medium">Source Path</label>
              <select value={sourcePathIdx} onChange={e=>setSourcePathIdx(Number(e.target.value))} className="border rounded px-2 py-1">
                {sourcePaths.map((p,i)=> <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Camera</label>
              <select value={camera} onChange={e=>setCamera(e.target.value)} className="border rounded px-2 py-1">
                {cameraDropdownOptions.map((cam, i) => (
                  <option key={i} value={cam}>{cam}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Δt (seconds)</label>
              <Input type="number" step="any" value={dt} onChange={e=>setDt(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium">Dot Distance (mm)</label>
              <Input type="number" step="0.1" value={dotDistance} onChange={e=>setDotDistance(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-xs font-medium">Grid Tol</label>
              <Input type="number" step="0.05" value={gridTolerance} onChange={e=>setGridTolerance(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-xs font-medium">RANSAC Thresh</label>
              <Input type="number" step="0.1" value={ransacThresh} onChange={e=>setRansacThresh(Number(e.target.value))} />
            </div>
            <div className="flex gap-2">
              <Button onClick={loadImage} disabled={loading}>Load Image</Button>
              <Button onClick={detectDots} disabled={!imageB64 || loading}>Detect Dots</Button>
              <Button onClick={computeCalibration} disabled={!above || loading}>Compute</Button>
              <Button variant="outline" onClick={()=>setShowIndices(s=>!s)} disabled={!gridPoints.length}>{showIndices?"Hide Indices":"Show Indices"}</Button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1">
              <h3 className="text-sm font-semibold mb-2">Calibration Image</h3>
              {imageB64 ? (
                <div className="relative border rounded inline-block">
                  <canvas
                    width={nativeSize.w}
                    height={nativeSize.h}
                    style={{ maxWidth: "512px", width: "100%", imageRendering: "pixelated" }}
                    onClick={handleCanvasClick}
                    ref={el => {
                      if (el && imageB64) {
                        const ctx = el.getContext('2d');
                        if (ctx) {
                          const img = new Image();
                          img.onload = () => {
                            ctx.clearRect(0,0,el.width, el.height);
                            ctx.drawImage(img,0,0, el.width, el.height);
                            // draw dots
                            ctx.strokeStyle = 'lime'; ctx.fillStyle='rgba(0,255,0,0.6)';
                            dots.forEach((d,i)=>{
                              ctx.beginPath();
                              ctx.arc(
                                d[0] * (el.width / nativeSize.w),
                                d[1] * (el.height / nativeSize.h),
                                4, 0, Math.PI*2
                              );
                              ctx.fill();
                            });
                            const drawMark=(pt:[number,number]|null, color:string, label:string)=>{
                              if(!pt) return;
                              ctx.strokeStyle=color; ctx.lineWidth=2;
                              ctx.beginPath();
                              ctx.arc(
                                pt[0] * (el.width / nativeSize.w),
                                pt[1] * (el.height / nativeSize.h),
                                8,0,Math.PI*2
                              );
                              ctx.stroke();
                              ctx.fillStyle=color; ctx.font='12px sans-serif';
                              ctx.fillText(
                                label,
                                pt[0] * (el.width / nativeSize.w) + 10,
                                pt[1] * (el.height / nativeSize.h)
                              );
                            };
                            drawMark(datum,'yellow','D'); drawMark(right,'orange','X'); drawMark(above,'cyan','Y');
                          };
                          img.src = `data:image/png;base64,${imageB64}`;
                        }
                      }
                    }}
                  />
                  <p className="text-xs text-gray-500 mt-1">Click to select Datum -&gt; Right -&gt; Above. Fourth click resets.</p>
                  {/* Show native size for debugging */}
                  <div className="absolute top-1 right-2 text-xs text-gray-400 bg-white/70 px-1 rounded">
                    {nativeSize.w}×{nativeSize.h}
                  </div>
                </div>
              ) : <div className="w-full h-64 border rounded flex items-center justify-center text-gray-400">No image</div>}
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold mb-2">Dewarped Image</h3>
              {dewarpedB64 ? (
                <div className="relative border rounded inline-block">
                  <img src={`data:image/png;base64,${dewarpedB64}`} className="max-w-full" />
                  {showIndices && gridPoints.length>0 && (
                    <div className="absolute inset-0 pointer-events-none">
                      {/* Could add overlay in future */}
                    </div>
                  )}
                </div>
              ) : <div className="w-full h-64 border rounded flex items-center justify-center text-gray-400">No dewarped</div>}
            </div>
          </div>
          {gridPoints.length>0 && (
            <div className="text-xs text-gray-600">Grid points: {gridPoints.length} (inliers {inlierMask.filter(x=>x).length})</div>
          )}
          <div className="flex gap-2 mt-2">
            {/* <Button onClick={handleSave}>Save Pinhole Calibration</Button> */}
            {!isActive && <Button variant="outline" onClick={setActive}>Set as Active</Button>}
            {isActive && <span className="text-green-600 text-xs font-semibold ml-2">Active</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// --- Main Calibration Page ---
const Calibration: React.FC = () => {
  const [method, setMethod] = useState<CalibrationMethod>("pinhole");
  const [config, updateConfig] = useConfig();
  const active = config.calibration?.active || "pinhole";

  // Only change active method, do not overwrite configs
  function setActiveMethod(m: CalibrationMethod) {
    updateConfig(["calibration", "active"], m);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Calibration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-center">
            <label className="text-sm font-medium">Method:</label>
            <select value={method} onChange={e=>setMethod(e.target.value as CalibrationMethod)} className="border rounded px-2 py-1">
              <option value="scale_factor">Scale Factor</option>
              <option value="pinhole">Pinhole (Planar)</option>
              <option value="stereo" disabled>Stereo (coming soon)</option>
            </select>
            <span className="ml-4 text-xs text-gray-500">Active: <b>{active}</b></span>
          </div>
        </CardContent>
      </Card>
      {method === "scale_factor" && (
        <ScaleFactorCalibration
          config={config}
          updateConfig={updateConfig}
          setActive={() => setActiveMethod("scale_factor")}
          isActive={active === "scale_factor"}
        />
      )}
      {method === "pinhole" && (
        <PinholeCalibration
          config={config}
          updateConfig={updateConfig}
          setActive={() => setActiveMethod("pinhole")}
          isActive={active === "pinhole"}
        />
      )}
      {/* Stereo method can be added here in the future */}
    </div>
  );
};

export default Calibration;
