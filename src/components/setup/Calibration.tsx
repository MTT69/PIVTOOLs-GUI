"use client";
import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Dot { x: number; y: number; }

const Calibration: React.FC = () => {
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
  const [dotDistance, setDotDistance] = useState(28.9);
  const [gridTolerance, setGridTolerance] = useState(0.5);
  const [ransacThresh, setRansacThresh] = useState(3.0);
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
    return false;
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
              <select value={camera} onChange={e=>setCamera(e.target.value)} className="border rounded px-2 py-1"> <option value="1">Cam1</option><option value="2">Cam2</option> </select>
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
        </CardContent>
      </Card>
    </div>
  );
};

export default Calibration;
