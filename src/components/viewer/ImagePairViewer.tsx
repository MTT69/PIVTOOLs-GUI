"use client";

import { useEffect, useMemo, useRef, useState, WheelEvent } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

// Simple colormap interpolation between stops
function hexToRgb(hex: string) {
  const parsed = hex.replace("#", "");
  const bigint = parseInt(parsed, 16);
  if (parsed.length === 6) {
    return [
      (bigint >> 16) & 255,
      (bigint >> 8) & 255,
      bigint & 255,
    ];
  }
  return [0, 0, 0];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function buildColormap(name: string, size = 256): Uint8ClampedArray {
  if (name === "gray") {
    const arr = new Uint8ClampedArray(size * 3);
    for (let i = 0; i < size; i++) {
      arr[i * 3 + 0] = i;
      arr[i * 3 + 1] = i;
      arr[i * 3 + 2] = i;
    }
    return arr;
  }
  // Viridis-like stops
  const stops = ["#440154", "#414487", "#2A788E", "#22A884", "#7AD151", "#FDE725"]; // approx viridis
  const colors = stops.map(hexToRgb);
  const arr = new Uint8ClampedArray(size * 3);
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    const seg = (colors.length - 1) * t;
    const i0 = Math.floor(seg);
    const i1 = Math.min(i0 + 1, colors.length - 1);
    const localT = seg - i0;
    const r = Math.round(lerp(colors[i0][0], colors[i1][0], localT));
    const g = Math.round(lerp(colors[i0][1], colors[i1][1], localT));
    const b = Math.round(lerp(colors[i0][2], colors[i1][2], localT));
    arr[i * 3 + 0] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
  return arr;
}

function percentileFromRGBA(data: Uint8ClampedArray, p: number) {
  const len = data.length / 4; // RGBA
  const vals = new Uint8Array(len);
  for (let i = 0; i < len; i++) vals[i] = data[i * 4]; // red channel as intensity
  vals.sort();
  const idx = Math.min(len - 1, Math.max(0, Math.floor((p / 100) * len)));
  return vals[idx];
}

// Compute percentile from raw typed array (uses sampling for speed on large arrays)
function percentileFromRaw(arr: Uint8Array | Uint16Array | Float32Array, p: number) {
  const n = arr.length;
  const sampleSize = Math.min(n, 200_000);
  if (sampleSize === n) {
    const copy = Array.from(arr as any as number[]);
    copy.sort((a, b) => a - b);
    const idx = Math.min(copy.length - 1, Math.max(0, Math.floor((p / 100) * copy.length)));
    return copy[idx];
  }
  // Reservoir-like random sample
  const step = Math.max(1, Math.floor(n / sampleSize));
  const sample: number[] = [];
  for (let i = 0; i < n && sample.length < sampleSize; i += step) sample.push(Number(arr[i]));
  sample.sort((a, b) => a - b);
  const idx = Math.min(sample.length - 1, Math.max(0, Math.floor((p / 100) * sample.length)));
  return sample[idx];
}

type DType = "uint8" | "uint16";

type RawImage = {
  data: Uint8Array | Uint16Array;
  width: number;
  height: number;
  bitDepth: number; // e.g. 8 or 16
  dtype: DType;
};

function base64ToArrayBuffer(base64: string) {
  const binary_string = typeof window !== 'undefined' ? window.atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary_string.charCodeAt(i);
  return bytes.buffer;
}

function decodeTypedArray(base64: string, dtype: DType) {
  const buf = base64ToArrayBuffer(base64);
  if (dtype === "uint16") return new Uint16Array(buf);
  return new Uint8Array(buf);
}

type ZoomableCanvasProps = {
  // If raw provided, it will be used; otherwise src PNG will be used
  raw?: RawImage | null;
  src?: string | null; // base64 PNG without data: prefix
  vmin: number;
  vmax: number;
  colormap: "gray" | "viridis";
  title: string;
};

function ZoomableCanvas({ raw, src, vmin, vmax, colormap, title, scale, setScale, offset, setOffset, useGrid = false, gridSize = 1 }: ZoomableCanvasProps & {
  scale: number;
  setScale: (scale: number) => void;
  offset: { x: number; y: number };
  setOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  useGrid?: boolean;
  gridSize?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);

  const cmap = useMemo(() => buildColormap(colormap), [colormap]);

  const [dragging, setDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [hasFit, setHasFit] = useState(false);

  // New: box zoom mode toggle state
  const [boxZoomMode, setBoxZoomMode] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const selStart = useRef<{ x: number; y: number } | null>(null);
  const [selRect, setSelRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // New: grid overlay state
  const [imageSize, setImageSize] = useState<{width: number, height: number} | null>(null);

  // Load image element when src changes (PNG path)
  useEffect(() => {
    if (!src) { setImgEl(null); return; }
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = `data:image/png;base64,${src}`;
  }, [src]);

  // Draw (raw preferred)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (raw && raw.data && raw.width && raw.height) {
      // Render from raw data with our own mapping
      const { width, height, data } = raw;
      canvas.width = width;
      canvas.height = height;
      setImageSize({width, height});
      const out = new Uint8ClampedArray(width * height * 4);
      const rng = Math.max(1e-12, vmax - vmin);
      for (let i = 0; i < width * height; i++) {
        const I = Number(data[i]);
        let t = (I - vmin) / rng;
        if (t < 0) t = 0; if (t > 1) t = 1;
        const idx = Math.min(255, Math.max(0, Math.round(t * 255)));
        const r = cmap[idx * 3 + 0];
        const g = cmap[idx * 3 + 1];
        const b = cmap[idx * 3 + 2];
        const j = i * 4;
        out[j] = r; out[j + 1] = g; out[j + 2] = b; out[j + 3] = 255;
      }
      const mapped = new ImageData(out, width, height);
      ctx.putImageData(mapped, 0, 0);
      return;
    }

    // Fallback: draw PNG then remap via 8-bit canvas readback
    if (!imgEl) return;
    canvas.width = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
    setImageSize({width: imgEl.naturalWidth, height: imgEl.naturalHeight});
    ctx.drawImage(imgEl, 0, 0);
    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const out = new Uint8ClampedArray(data.length);
      const rng = Math.max(1, vmax - vmin);
      for (let i = 0; i < data.length; i += 4) {
        const I = data[i];
        let t = (I - vmin) / rng;
        if (t < 0) t = 0; if (t > 1) t = 1;
        const idx = Math.min(255, Math.max(0, Math.round(t * 255)));
        const r = cmap[idx * 3 + 0];
        const g = cmap[idx * 3 + 1];
        const b = cmap[idx * 3 + 2];
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
      }
      const mapped = new ImageData(out, canvas.width, canvas.height);
      const ctx2 = canvas.getContext("2d");
      ctx2?.putImageData(mapped, 0, 0);
    } catch (e) {
      console.warn("Canvas mapping error", e);
    }
  }, [raw, imgEl, vmin, vmax, cmap]);

  // Fit-to-view computation
  function fitToView() {
    const wrap = wrapperRef.current;
    const c = canvasRef.current;
    if (!wrap || !c) return;
    const rect = wrap.getBoundingClientRect();
    // Dimensions from raw or img
    let w = 0, h = 0;
    if (raw && raw.width && raw.height) { w = raw.width; h = raw.height; }
    else if (imgEl) { w = imgEl.naturalWidth; h = imgEl.naturalHeight; }
    if (!w || !h) return;
    const s = Math.min(rect.width / w, rect.height / h);
    const x = (rect.width - w * s) / 2;
    const y = (rect.height - h * s) / 2;
    setScale(s);
    setOffset({ x, y });
  }

  // 100% view (top-left)
  function resetTo100() { setScale(1); setOffset({ x: 0, y: 0 }); }

  // Perform initial fit once on load/change
  useEffect(() => { 
    // Only reset fit if we've never fit before (preserves zoom when changing images)
    if (!hasFit) setHasFit(false);
  }, [raw, imgEl]);
  
  useEffect(() => {
    if (!hasFit && (raw || imgEl)) {
      // Delay to ensure wrapper has measured size
      requestAnimationFrame(() => { fitToView(); setHasFit(true); });
    }
  }, [hasFit, raw, imgEl]);

  // Disable wheel zoom - only prevent default to avoid page scrolling
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault(); // Prevent page scroll but don't zoom
  }

  function handleMouseDown(e: React.MouseEvent) {
    // If in box zoom mode -> begin box selection
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (boxZoomMode && rect) {
      e.preventDefault();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      selStart.current = { x: sx, y: sy };
      setSelecting(true);
      setSelRect({ left: sx, top: sy, width: 0, height: 0 });
      setDragging(false);
      return;
    }
    // Otherwise begin panning
    setDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
  }

  function handleMouseUp(e?: React.MouseEvent) {
    // finalize selection if active
    if (selecting && selStart.current && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const ex = (e ? e.clientX : lastPos.current.x) - rect.left;
      const ey = (e ? e.clientY : lastPos.current.y) - rect.top;
      const sx = selStart.current.x;
      const sy = selStart.current.y;
      const left = Math.min(sx, ex);
      const top = Math.min(sy, ey);
      const width = Math.max(1, Math.abs(ex - sx));
      const height = Math.max(1, Math.abs(ey - sy));
      // Only zoom if reasonable rectangle
      if (width > 6 && height > 6) {
        // Convert to image-space coordinates
        const ix = (left - offset.x) / scale;
        const iy = (top - offset.y) / scale;
        const iw = width / scale;
        const ih = height / scale;
        const W = rect.width;
        const H = rect.height;
        // New scale to fit selection into viewer
        const Sx = W / Math.max(iw, 1e-6);
        const Sy = H / Math.max(ih, 1e-6);
        const newScale = Math.min(20, Math.max(0.25, Math.min(Sx, Sy)));
        const newOffsetX = (W - iw * newScale) / 2 - ix * newScale;
        const newOffsetY = (H - ih * newScale) / 2 - iy * newScale;
        setScale(newScale);
        setOffset({ x: newOffsetX, y: newOffsetY });
        
        // Exit box zoom mode after successful zoom
        setBoxZoomMode(false);
      }
      // clear selection
      selStart.current = null;
      setSelecting(false);
      setSelRect(null);
      return;
    }
    setDragging(false);
  }
  
  function handleMouseLeave() { 
    // If selecting, finalize as mouse up
    if (selecting) {
      handleMouseUp();
      return;
    }
    setDragging(false); 
  }
  
  function handleMouseMove(e: React.MouseEvent) {
    if (selecting && selStart.current && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const sx = selStart.current.x;
      const sy = selStart.current.y;
      const left = Math.min(sx, cx);
      const top = Math.min(sy, cy);
      const width = Math.abs(cx - sx);
      const height = Math.abs(cy - sy);
      setSelRect({ left, top, width, height });
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setOffset((o: { x: number; y: number }) => ({ x: o.x + dx, y: o.y + dy }));
  }

  function resetView() { setScale(1); setOffset({ x: 0, y: 0 }); }

  // Determine cursor based on current mode
  const cursorClass = boxZoomMode 
    ? "cursor-crosshair" 
    : (dragging ? "cursor-grabbing" : "cursor-grab");

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-600">{title}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fitToView}>Fit</Button>
          <Button 
            variant={boxZoomMode ? "default" : "outline"} 
            size="sm" 
            onClick={() => setBoxZoomMode(!boxZoomMode)}
            className={boxZoomMode ? "bg-blue-600 text-white" : ""}
          >
            Box Zoom
          </Button>
        </div>
      </div>
      <div className="relative w-full h-[480px] bg-black/80 rounded-md overflow-hidden border border-gray-200">
        <div
          ref={wrapperRef}
          className={`absolute inset-0 ${cursorClass}`}
          onWheel={handleWheel}
          onMouseDown={(e) => { setHasFit(true); handleMouseDown(e); }}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
          style={{ overflow: "hidden", touchAction: "none" }}
        >
          <div style={{ position: "absolute", left: offset.x, top: offset.y, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
              <canvas ref={canvasRef} />
          </div>
          
          {/* Grid overlay - visible only when useGrid is true */}
          {useGrid && imageSize && (
              <div
                style={{
                  position: "absolute",
                  left: offset.x,
                  top: offset.y,
                  width: imageSize.width * scale,
                  height: imageSize.height * scale,
                  pointerEvents: "none",
                  backgroundImage: `
                    linear-gradient(to right, rgba(50, 150, 255, 0.3) 2px, transparent 2px),
                    linear-gradient(to bottom, rgba(50, 150, 255, 0.3) 2px, transparent 2px)
                  `,
                  backgroundSize: `${gridSize * scale}px ${gridSize * scale}px`,
                  boxSizing: "border-box",
                  border: "2px solid rgba(50, 150, 255, 0.5)"
                }}
              ></div>
          )}
          
          {/* Selection rectangle overlay with improved visibility */}
          {selRect && (
              <div
                style={{
                  position: "absolute",
                  left: selRect.left,
                  top: selRect.top,
                  width: selRect.width,
                  height: selRect.height,
                  border: "2px dashed rgba(255, 255, 255, 0.9)",
                  background: "rgba(65, 105, 225, 0.2)",
                  pointerEvents: "none",
                  boxSizing: "border-box",
                }}
              ></div>
          )}
        </div>
      </div>
    </div>
  );
}

function Colorbar({ vmin, vmax, colormap }: { vmin: number; vmax: number; colormap: "gray" | "viridis" }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cmap = useMemo(() => buildColormap(colormap), [colormap]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = 16;
    const height = 240;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const t = 1 - y / (height - 1);
      const idx = Math.min(255, Math.max(0, Math.round(t * 255)));
      const r = cmap[idx * 3 + 0];
      const g = cmap[idx * 3 + 1];
      const b = cmap[idx * 3 + 2];
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        img.data[i + 0] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [cmap, vmin, vmax]);

  return (
    <div className="flex flex-col items-center">
      <canvas ref={canvasRef} className="rounded border border-gray-200" />
      <div className="flex justify-between w-12 text-xs text-gray-600 mt-1">
        <span>{vmin}</span>
        <span>{vmax}</span>
      </div>
    </div>
  );
}

export default function ImagePairViewer({ backendUrl = "/backend", onFiltersChange, filterSaveNote, config, updateConfig }: { 
  backendUrl?: string, 
  onFiltersChange?: (filters: any[]) => void, 
  filterSaveNote?: string,
  config?: any,
  updateConfig?: (path: string[], value: any) => void
}) {
  const [camera, setCamera] = useState("Cam1");
  const [index, setIndex] = useState<number>(1);
  // Add separate indices for raw and processed
  const [rawIndex, setRawIndex] = useState<number>(1);
  const [procIndex, setProcIndex] = useState<number>(1);
  
  const [loading, setLoading] = useState(false);
  const [imgA, setImgA] = useState<string | null>(null);
  const [imgB, setImgB] = useState<string | null>(null);
  const [imgARaw, setImgARaw] = useState<RawImage | null>(null);
  const [imgBRaw, setImgBRaw] = useState<RawImage | null>(null);
  const [bitDepth, setBitDepth] = useState<number | null>(null);
  const [dtype, setDtype] = useState<DType | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [colormap, setColormap] = useState<"gray" | "viridis">("gray");
  // Add back vmin/vmax for auto-limits and mirroring to raw controls
  const [vmin, setVmin] = useState(0);
  const [vmax, setVmax] = useState(255);
  // Replace basePathIdx with sourcePathIdx and load options from localStorage
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(0);
  const [sourcePaths, setSourcePaths] = useState<string[]>(() => {
    try { return JSON.parse(typeof window !== "undefined" ? localStorage.getItem("piv_source_paths") || "[]" : "[]"); } catch { return []; }
  });
  const [rawToggle, setRawToggle] = useState<"A" | "B">("A");
  const [procToggle, setProcToggle] = useState<"A" | "B">("A");
  const [procImgA, setProcImgA] = useState<string | null>(null);
  const [procImgB, setProcImgB] = useState<string | null>(null);
  const [procLoading, setProcLoading] = useState(false);
  const [filters, setFilters] = useState<{type: "POD" | "time", batch_size?: number}[]>([]);
  // Shared temporal batch length applied to all temporal filters (time/POD)
  const [temporalBatch, setTemporalBatch] = useState<number>(50);

  // Per-image controls
  const [rawIndexControl, setRawIndexControl] = useState<number>(0); // index for raw image

  // Per-image min/max
  const [rawVmin, setRawVmin] = useState(0);
  const [rawVmax, setRawVmax] = useState(255);
  const [procVmin, setProcVmin] = useState(0);
  const [procVmax, setProcVmax] = useState(255);

  // Add grid size state - change default to 16
  const [gridSize, setGridSize] = useState<number>(16);
  const [useGrid, setUseGrid] = useState<boolean>(false);

  const maxVal = useMemo(() => {
    if (bitDepth) return Math.pow(2, bitDepth) - 1;
    return 255;
  }, [bitDepth]);

  const deriveCameraCount = (cfg: any) => {
    // 1) Try first element of config.paths.camera_numbers
    const nFromPaths = Array.isArray(cfg?.paths?.camera_numbers) && cfg.paths.camera_numbers.length > 0
      ? Number(cfg.paths.camera_numbers[0])
      : undefined;
    // 2) Fallback to config.imProperties.cameraCount
    const nFromIm = cfg?.imProperties ? Number(cfg.imProperties.cameraCount) : undefined;
    // 3) Choose nFromPaths if valid, else nFromIm, else default 1
    const nChoice = (Number.isFinite(nFromPaths as number) && (nFromPaths as number) > 0)
      ? (nFromPaths as number)
      : (Number.isFinite(nFromIm as number) && (nFromIm as number) > 0)
        ? (nFromIm as number)
        : 1;
    return Number.isFinite(nChoice) && nChoice > 0 ? Math.floor(nChoice) : 1;
  };
  
  const cameraDropdownOptions = useMemo(() => {
    const count = deriveCameraCount(config);
    return Array.from({ length: count }, (_, i) => `Cam${i + 1}`);
  }, [config]);

  // Ensure camera state reflects available options
  useEffect(() => {
    if (!cameraDropdownOptions || cameraDropdownOptions.length === 0) return;
    setCamera(prev => cameraDropdownOptions.includes(prev) ? prev : cameraDropdownOptions[0]);
  }, [cameraDropdownOptions]);

  // unify cameraOptions to the dropdown options
  const cameraOptions = useMemo(() => cameraDropdownOptions, [cameraDropdownOptions]);

  // Update min/max for raw when new image loaded
  useEffect(() => {
    setRawVmin(vmin);
    setRawVmax(vmax);
  }, [vmin, vmax, imgARaw, imgBRaw, imgA, imgB]);

  // Optionally, update processed min/max when new processed image loaded
  useEffect(() => {
    setProcVmin(rawVmin);
    setProcVmax(rawVmax);
  }, [procImgA, procImgB]);

  // Refresh on storage changes (if open in multiple tabs/windows)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "piv_source_paths") {
        try { setSourcePaths(JSON.parse(e.newValue || "[]")); } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Helper to show just the last segment of a path
  const basename = (p: string) => {
    if (!p) return "";
    const parts = p.replace(/\\/g, "/").split("/");
    return parts.filter(Boolean).pop() || p;
  };

  // Helper to extract camera number
  const getCameraNumber = (camString: string) => {
    return camString.replace(/\D/g, '');
  };

  async function fetchPair(auto = false, silent = false) {
    if (!camera) {
      if (!auto && !silent) alert("Please enter a camera folder name");
      return;
    }
    try {
      if (!silent) setLoading(true);
      const cameraNumber = Number(getCameraNumber(camera));
      // Remove grid parameter from the API call
      const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${index}&source_path_idx=${sourcePathIdx}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to fetch");

      // Prefer raw path if backend provides it (A_raw/B_raw + meta)
      if (json.meta && (json.A_raw || json.B_raw)) {
        const meta = json.meta as { width: number; height: number; bitDepth: number; dtype: DType };
        setBitDepth(meta.bitDepth);
        setDtype(meta.dtype);
        setDimensions({ width: meta.width, height: meta.height });

        if (json.A_raw) {
          const data = decodeTypedArray(json.A_raw, meta.dtype);
          setImgARaw({ data, width: meta.width, height: meta.height, bitDepth: meta.bitDepth, dtype: meta.dtype });
          setImgA(null);
        } else { setImgARaw(null); setImgA(json.A ?? null); }

        if (json.B_raw) {
          const data = decodeTypedArray(json.B_raw, meta.dtype);
          setImgBRaw({ data, width: meta.width, height: meta.height, bitDepth: meta.bitDepth, dtype: meta.dtype });
          setImgB(null);
        } else { setImgBRaw(null); setImgB(json.B ?? null); }

        // Auto-limits using raw if available, else fallback
        if (json.A_raw) {
          const arr = (decodeTypedArray(json.A_raw, meta.dtype)) as Uint8Array | Uint16Array;
          const p1 = percentileFromRaw(arr, 1);
          const p99 = percentileFromRaw(arr, 99);
          setVmin(Math.floor(p1));
          setVmax(Math.ceil(p99));
        } else if (json.A) {
          setTimeout(() => autoLimitsPng(json.A), 0);
        }
      } else {
        // Fallback to PNGs only
        setImgA(json.A);
        setImgB(json.B);
        setImgARaw(null); setImgBRaw(null);
        setBitDepth(json.bitDepth ?? null); // if provided
        setDtype((json.dtype as DType) ?? null);
        setDimensions(null);
        setTimeout(() => autoLimitsPng(json.A), 0);
      }
    } catch (e: any) {
      console.error(e);
      if (!auto && !silent) alert(e.message || "Error fetching images");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // Compute percentiles from PNG canvas (8-bit)
  function autoLimitsPng(base64Png: string) {
    const tmp = document.createElement("canvas");
    const ctx = tmp.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      tmp.width = img.naturalWidth;
      tmp.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      try {
        const data = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
        const p1 = percentileFromRGBA(data, 1);
        const p99 = percentileFromRGBA(data, 99);
        setVmin(p1);
        setVmax(p99);
      } catch (e) {
        // ignore if security error
      }
    };
    img.src = `data:image/png;base64,${base64Png}`;
  }

  // Auto limits from raw
  function autoLimitsRaw() {
    if (!imgARaw?.data) return;
    const p1 = percentileFromRaw(imgARaw.data, 1);
    const p99 = percentileFromRaw(imgARaw.data, 99);
    setVmin(Math.floor(p1));
    setVmax(Math.ceil(p99));
  }

  // Fetch processed image for the current frame; if missing, run processing silently and retry once
  async function fetchProcessedPair(silent = false) {
    if (!camera) return;
    try {
      if (!silent) setProcLoading(true);
      const params = new URLSearchParams();
      params.set("type", "processed");
      params.set("frame", String(index));            // 1-based
      params.set("camera", String(Number(getCameraNumber(camera)))); // always just the number
      params.set("source_path_idx", String(sourcePathIdx));
      const res = await fetch(`${backendUrl}/get_processed_pair?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        // On cache miss, run processing once (silent) to populate this frame, then retry
        await runProcessing(true);
        const res2 = await fetch(`${backendUrl}/get_processed_pair?${params.toString()}`);
        const json2 = await res2.json();
        if (!res2.ok) throw new Error(json2.error || "Failed to fetch processed");
        setProcImgA(json2.A ?? null);
        setProcImgB(json2.B ?? null);
        return;
      }
      setProcImgA(json.A ?? null);
      setProcImgB(json.B ?? null);
    } catch (e) {
      setProcImgA(null); setProcImgB(null);
    } finally {
      if (!silent) setProcLoading(false);
    }
  }

  const [playingRawBatch, setPlayingRawBatch] = useState(false);
  const [playingProcBatch, setPlayingProcBatch] = useState(false);

  // Update raw/proc indices when main index changes (but not during play)
  useEffect(() => {
    if (!playingRawBatch) setRawIndex(index);
    if (!playingProcBatch) setProcIndex(index);
  }, [index, playingRawBatch, playingProcBatch]);

  // 4. Auto-load on index/camera/source change: raw pair and processed (silent while playing)
  useEffect(() => {
    // Use rawIndex for raw images
    const fetchRaw = async () => {
      if (!camera) return;
      try {
        if (!playingRawBatch) setLoading(true);
        const cameraNumber = Number(getCameraNumber(camera));
        // Remove grid parameter from the API call
        const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${rawIndex}&source_path_idx=${sourcePathIdx}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to fetch");

        // Handle raw data same as before...
        if (json.meta && (json.A_raw || json.B_raw)) {
          const meta = json.meta as { width: number; height: number; bitDepth: number; dtype: DType };
          setBitDepth(meta.bitDepth);
          setDtype(meta.dtype);
          setDimensions({ width: meta.width, height: meta.height });

          if (json.A_raw) {
            const data = decodeTypedArray(json.A_raw, meta.dtype);
            setImgARaw({ data, width: meta.width, height: meta.height, bitDepth: meta.bitDepth, dtype: meta.dtype });
            setImgA(null);
          } else { setImgARaw(null); setImgA(json.A ?? null); }

          if (json.B_raw) {
            const data = decodeTypedArray(json.B_raw, meta.dtype);
            setImgBRaw({ data, width: meta.width, height: meta.height, bitDepth: meta.bitDepth, dtype: meta.dtype });
            setImgB(null);
          } else { setImgBRaw(null); setImgB(json.B ?? null); }

          if (json.A_raw) {
            const arr = (decodeTypedArray(json.A_raw, meta.dtype)) as Uint8Array | Uint16Array;
            const p1 = percentileFromRaw(arr, 1);
            const p99 = percentileFromRaw(arr, 99);
            setVmin(Math.floor(p1));
            setVmax(Math.ceil(p99));
          } else if (json.A) {
            setTimeout(() => autoLimitsPng(json.A), 0);
          }
        } else {
          setImgA(json.A);
          setImgB(json.B);
          setImgARaw(null); setImgBRaw(null);
          setBitDepth(json.bitDepth ?? null);
          setDtype((json.dtype as DType) ?? null);
          setDimensions(null);
          setTimeout(() => autoLimitsPng(json.A), 0);
        }
      } catch (e: any) {
        console.error(e);
      } finally {
        if (!playingRawBatch) setLoading(false);
      }
    };

    fetchRaw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawIndex, camera, sourcePathIdx]);

  useEffect(() => {
    // Use procIndex for processed images
    if (filters.length > 0 && procImgA === null && procImgB === null) {
      // Only fetch initially if we have a result already - don't auto-process
      const fetchProc = async () => {
        try {
          if (!playingProcBatch) setProcLoading(true);
          const params = new URLSearchParams();
          params.set("type", "processed");
          params.set("frame", String(procIndex));
          params.set("camera", String(Number(getCameraNumber(camera))));
          params.set("source_path_idx", String(sourcePathIdx));
          const res = await fetch(`${backendUrl}/get_processed_pair?${params.toString()}`);
          
          // If we get a successful response, update the images
          if (res.ok) {
            const json = await res.json();
            setProcImgA(json.A ?? null);
            setProcImgB(json.B ?? null);
          }
        } catch (e) {
          // If error, just leave as null - don't auto-process
        } finally {
          if (!playingProcBatch) setProcLoading(false);
        }
      };
      
      // Try to fetch existing processed results, but don't auto-process if missing
      fetchProc();
    } else if (filters.length === 0) {
      setProcImgA(null); 
      setProcImgB(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procIndex, camera, sourcePathIdx]);
  
  // ZoomableCanvas component for raw and processed images
  function ZoomableCanvasWrapper({ raw, src, vmin, vmax, colormap, title, isProcessed }: any) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);

    const cmap = useMemo(() => buildColormap(colormap), [colormap]);

    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const lastPos = useRef({ x: 0, y: 0 });
    const [hasFit, setHasFit] = useState(false);

    // Selection (box-zoom) state
    const [selecting, setSelecting] = useState(false);
    const selStart = useRef<{ x: number; y: number } | null>(null);
    const [selRect, setSelRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

    // Add image size state for grid
    const [imageSize, setImageSize] = useState<{width: number, height: number} | null>(null);

    // Load image element when src changes (PNG path)
    useEffect(() => {
      if (!src) { setImgEl(null); return; }
      const img = new Image();
      img.onload = () => {
        setImgEl(img);
        setImageSize({width: img.naturalWidth, height: img.naturalHeight});
      };
      img.src = `data:image/png;base64,${src}`;
    }, [src]);

    // Draw (raw preferred)
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (raw && raw.data && raw.width && raw.height) {
        // Render from raw data with our own mapping
        const { width, height, data } = raw;
        canvas.width = width;
        canvas.height = height;
        setImageSize({width, height});
        const out = new Uint8ClampedArray(width * height * 4);
        const rng = Math.max(1e-12, vmax - vmin);
        for (let i = 0; i < width * height; i++) {
          const I = Number(data[i]);
          let t = (I - vmin) / rng;
          if (t < 0) t = 0; if (t > 1) t = 1;
          const idx = Math.min(255, Math.max(0, Math.round(t * 255)));
          const r = cmap[idx * 3 + 0];
          const g = cmap[idx * 3 + 1];
          const b = cmap[idx * 3 + 2];
          const j = i * 4;
          out[j] = r; out[j + 1] = g; out[j + 2] = b; out[j + 3] = 255;
        }
        const mapped = new ImageData(out, width, height);
        ctx.putImageData(mapped, 0, 0);
        return;
      }

      // Fallback: draw PNG then remap via 8-bit canvas readback
      if (!imgEl) return;
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      setImageSize({width: imgEl.naturalWidth, height: imgEl.naturalHeight});
      ctx.drawImage(imgEl, 0, 0);
      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const out = new Uint8ClampedArray(data.length);
        const rng = Math.max(1, vmax - vmin);
        for (let i = 0; i < data.length; i += 4) {
          const I = data[i];
          let t = (I - vmin) / rng;
          if (t < 0) t = 0; if (t > 1) t = 1;
          const idx = Math.min(255, Math.max(0, Math.round(t * 255)));
          const r = cmap[idx * 3 + 0];
          const g = cmap[idx * 3 + 1];
          const b = cmap[idx * 3 + 2];
          out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
        }
        const mapped = new ImageData(out, canvas.width, canvas.height);
        const ctx2 = canvas.getContext("2d");
        ctx2?.putImageData(mapped, 0, 0);
      } catch (e) {
        console.warn("Canvas mapping error", e);
      }
    }, [raw, imgEl, vmin, vmax, cmap]);

    // Fit-to-view computation
    function fitToView() {
      const wrap = wrapperRef.current;
      const c = canvasRef.current;
      if (!wrap || !c) return;
      const rect = wrap.getBoundingClientRect();
      // Dimensions from raw or img
      let w = 0, h = 0;
      if (raw && raw.width && raw.height) { w = raw.width; h = raw.height; }
      else if (imgEl) { w = imgEl.naturalWidth; h = imgEl.naturalHeight; }
      if (!w || !h) return;
      const s = Math.min(rect.width / w, rect.height / h);
      const x = (rect.width - w * s) / 2;
      const y = (rect.height - h * s) / 2;
      setScale(s);
      setOffset({ x, y });
    }

    // 100% view (top-left)
    function resetTo100() { setScale(1); setOffset({ x: 0, y: 0 }); }

    // Perform initial fit once on load/change
    useEffect(() => { 
      // Only reset fit if we've never fit before (preserves zoom when changing images)
      if (!hasFit) setHasFit(false);
    }, [raw, imgEl]);
    
    useEffect(() => {
      if (!hasFit && (raw || imgEl)) {
        // Delay to ensure wrapper has measured size
        requestAnimationFrame(() => { fitToView(); setHasFit(true); });
      }
    }, [hasFit, raw, imgEl]);

    function handleMouseDown(e: React.MouseEvent) {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (e.shiftKey && rect) {
        e.preventDefault();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        selStart.current = { x: sx, y: sy };
        setSelecting(true);
        setSelRect({ left: sx, top: sy, width: 0, height: 0 });
        setDragging(false);
        return;
      }
      setDragging(true);
      lastPos.current = { x: e.clientX, y: e.clientY };
    }

    function handleMouseUp(e?: React.MouseEvent) {
      if (selecting && selStart.current && wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        const ex = (e ? e.clientX : lastPos.current.x) - rect.left;
        const ey = (e ? e.clientY : lastPos.current.y) - rect.top;
        const sx = selStart.current.x;
        const sy = selStart.current.y;
        const left = Math.min(sx, ex);
        const top = Math.min(sy, ey);
        const width = Math.max(1, Math.abs(ex - sx));
        const height = Math.max(1, Math.abs(ey - sy));
        // Only zoom if reasonable rectangle
        if (width > 6 && height > 6) {
          // Convert to image-space coordinates (optional: implement zoom-to-box)
          // For now, just fit to selection in viewer coordinates
          const W = rect.width;
          const H = rect.height;
          const Sx = W / Math.max(width, 1e-6);
          const Sy = H / Math.max(height, 1e-6);
          const newScale = Math.min(20, Math.max(0.25, Math.min(Sx, Sy)));
          const newOffsetX = (W - width * newScale) / 2 - left * newScale;
          const newOffsetY = (H - height * newScale) / 2 - top * newScale;
          setScale(newScale);
          setOffset({ x: newOffsetX, y: newOffsetY });
        }
        selStart.current = null;
        setSelecting(false);
        setSelRect(null);
        return;
      }
      setDragging(false);
    }

    function handleMouseLeave() { 
      if (selecting) {
        handleMouseUp();
        return;
      }
      setDragging(false); 
    }

    function handleMouseMove(e: React.MouseEvent) {
      if (selecting && selStart.current && wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const sx = selStart.current.x;
        const sy = selStart.current.y;
        const left = Math.min(sx, cx);
        const top = Math.min(sy, cy);
        const width = Math.abs(cx - sx);
        const height = Math.abs(cy - sy);
        setSelRect({ left, top, width, height });
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setOffset((o: { x: number; y: number }) => ({ x: o.x + dx, y: o.y + dy }));
    }

    function handleWheel(e: WheelEvent<HTMLDivElement>) {
      throw new Error("Function not implemented.");
    }

    return (
      <div className="w-full">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium">{title}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fitToView}>Fit</Button>
          </div>
        </div>
        <div className="relative w-full h-[480px] bg-black/80 rounded-md overflow-hidden border border-gray-200">
          <div
            ref={wrapperRef}
            className={`absolute inset-0 cursor-grab active:cursor-grabbing`}
            onWheel={(e) => { e.preventDefault(); setHasFit(true); handleWheel(e); }}
            onMouseDown={(e) => { setHasFit(true); handleMouseDown(e); }}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
            style={{ overflow: "hidden", touchAction: "none" }}
          >
            <div style={{ position: "absolute", left: offset.x, top: offset.y, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
              <canvas ref={canvasRef} />
            </div>
            
            {/* Grid overlay - visible only when useGrid is true */}
            {useGrid && imageSize && (
              <div
                style={{
                  position: "absolute",
                  left: offset.x,
                  top: offset.y,
                  width: imageSize.width * scale,
                  height: imageSize.height * scale,
                  pointerEvents: "none",
                  backgroundImage: `
                    linear-gradient(to right, rgba(50, 150, 255, 0.3) 2px, transparent 2px),
                    linear-gradient(to bottom, rgba(50, 150, 255, 0.3) 2px, transparent 2px)
                  `,
                  backgroundSize: `${gridSize * scale}px ${gridSize * scale}px`,
                  boxSizing: "border-box",
                  border: "2px solid rgba(50, 150, 255, 0.5)"
                }}
              />
            )}
            
            {/* Selection rectangle overlay */}
            {selRect && (
              <div
                style={{
                  position: "absolute",
                  left: selRect.left,
                  top: selRect.top,
                  width: selRect.width,
                  height: selRect.height,
                  border: "2px dashed rgba(255,255,255,0.9)",
                  background: "rgba(255,255,255,0.08)",
                  pointerEvents: "none",
                  boxSizing: "border-box",
                }}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // 5. Run processing with stacked filters - include grid size
  async function runProcessing(silent = false) {
    if (!silent) setProcLoading(true);
    try {
      const cameraNumber = Number(getCameraNumber(camera));
      const res = await fetch(`${backendUrl}/filter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera: cameraNumber,
          start_idx: index,
          count: 1,
          filters,
          source_path_idx: sourcePathIdx,
          temporal_batch_filter: temporalBatch,
          window_size: useGrid ? gridSize : 1, // Change from grid_size to window_size
        }),
      });
      if (res.status === 409) {
        // Processing already in progress; skip
        return;
      }
      await res.json();
      // Poll for status, then fetch processed
      let tries = 0;
      while (tries < 30) {
        const status = await fetch(`${backendUrl}/status`).then(r => r.json());
        if (!status.processing) break;
        await new Promise(r => setTimeout(r, 500));
        tries++;
      }
      await fetchProcessedPair(); // idx=0 in store
    } catch (e) {
      setProcImgA(null); setProcImgB(null);
    } finally {
      if (!silent) setProcLoading(false);
    }
  }

  // 5. Filter stack UI helpers
  function addFilter(type: "POD" | "time") {
    setFilters(f => [...f, {type, batch_size: type === "POD" ? 100 : 50}]);
  }
  function removeFilter(idx: number) {
    setFilters(f => f.filter((_, i) => i !== idx));
  }
  function moveFilter(idx: number, dir: -1 | 1) {
    setFilters(f => {
      const arr = [...f];
      if (idx + dir < 0 || idx + dir >= arr.length) return arr;
      [arr[idx], arr[idx + dir]] = [arr[idx + dir], arr[idx]];
      return arr;
    });
  }
  function updateBatchSize(idx: number, batch_size: number) {
    setFilters(f => f.map((flt, i) => i === idx ? {...flt, batch_size} : flt));
  }

  const playRawBatchRef = useRef<NodeJS.Timeout | null>(null);
  const playProcBatchRef = useRef<NodeJS.Timeout | null>(null);

  // Compute batch size from filters (largest batch_size from temporal filters)
  const batchSize = useMemo(() => {
    if (temporalBatch && temporalBatch > 0) return temporalBatch;
    const sizes = filters
      .filter(f => f.type === "POD" || f.type === "time")
      .map(f => f.batch_size || 1);
    return sizes.length > 0 ? Math.max(...sizes) : 1;
  }, [filters, temporalBatch]);

  // Compute batch window for current index
  const batchStart = useMemo(() => Math.floor((index - 1) / batchSize) * batchSize + 1, [index, batchSize]);
  const batchEnd = useMemo(() => batchStart + batchSize - 1, [batchStart, batchSize]);

  // Play batch effect for raw
  useEffect(() => {
    if (playingRawBatch) {
      playRawBatchRef.current = setInterval(() => {
        setRawIndex(i => {
          if (i < batchEnd) return i + 1;
          setPlayingRawBatch(false);
          return i;
        });
      }, 300);
    } else if (playRawBatchRef.current) {
      clearInterval(playRawBatchRef.current);
      playRawBatchRef.current = null;
    }
    return () => {
      if (playRawBatchRef.current) {
        clearInterval(playRawBatchRef.current);
        playRawBatchRef.current = null;
      }
    };
  }, [playingRawBatch, batchEnd]);

  // Play batch effect for processed
  useEffect(() => {
    if (playingProcBatch) {
      playProcBatchRef.current = setInterval(() => {
        setProcIndex(i => {
          if (i < batchEnd) return i + 1;
          setPlayingProcBatch(false);
          return i;
        });
      }, 300);
    } else if (playProcBatchRef.current) {
      clearInterval(playProcBatchRef.current);
      playProcBatchRef.current = null;
    }
    return () => {
      if (playProcBatchRef.current) {
        clearInterval(playProcBatchRef.current);
        playProcBatchRef.current = null;
      }
    };
  }, [playingProcBatch, batchEnd]);

  // Shared zoom state
  const [sharedScale, setSharedScale] = useState(1);
  // Single shared offset so raw and processed views stay in sync
  const [sharedOffset, setSharedOffset] = useState({ x: 0, y: 0 });
  
  // Update zoom handler
  const handleZoomChange = (value: number) => {
    setSharedScale(value);
  };
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Processed Image Pair Viewer</CardTitle>
          <CardDescription>
            Load and process image pairs. Left: raw (A/B toggle). Right: processed (A/B toggle).<br />
            Set filters and order, then process.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filter stack UI - moved above images */}
          <div className="flex flex-col gap-4 mb-6">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => addFilter("POD")}>Add POD Filter</Button>
              <Button size="sm" variant="outline" onClick={() => addFilter("time")}>Add Time Filter</Button>
            </div>
            {/* Shared temporal batch length (applies to all temporal filters) */}
            <div className="flex items-center gap-3">
              <Label htmlFor="temp-batch">Temporal batch length</Label>
              <Input id="temp-batch" type="number" min={1} className="w-24" value={temporalBatch}
                     onChange={e => setTemporalBatch(Math.max(1, Number(e.target.value)))} />
              <span className="text-xs text-gray-500">Used for both Time and POD filters</span>
            </div>
            <div>
              {filters.length === 0 && <span className="text-sm text-gray-500">No filters applied.</span>}
              {filters.map((filter, idx) => (
                <div key={idx} className="flex items-center gap-2 py-1">
                  <span className="flex-1 text-sm bg-gray-100 rounded px-2 py-1">{filter.type} Filter</span>
                  <Button size="sm" variant="ghost" onClick={() => moveFilter(idx, -1)} disabled={idx === 0}>↑</Button>
                  <Button size="sm" variant="ghost" onClick={() => moveFilter(idx, 1)} disabled={idx === filters.length - 1}>↓</Button>
                  <Button size="sm" variant="destructive" onClick={() => removeFilter(idx)}>✕</Button>
                </div>
              ))}
            </div>
            <Button size="sm" onClick={() => runProcessing()} disabled={procLoading || filters.length === 0}>
              {procLoading ? "Processing..." : "Run Processing"}
            </Button>
          </div>

          {/* Controls row: Source Path, Camera, Pair Index, Colormap */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-4">
            {/* Source path selection (dropdown) */}
            <div>
              <Label htmlFor="srcpath">Source Path</Label>
              <Select value={String(sourcePathIdx)} onValueChange={(v) => setSourcePathIdx(Number(v))}>
                <SelectTrigger id="srcpath"><SelectValue placeholder="Pick source path" /></SelectTrigger>
                <SelectContent>
                  {sourcePaths.map((p, i) => (
                    <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Configured in Settings → Directories.</p>
            </div>
            {/* Camera dropdown */}
            <div>
              <Label htmlFor="camera">Camera</Label>
              <Select value={camera} onValueChange={setCamera}>
                <SelectTrigger id="camera"><SelectValue placeholder="Select camera" /></SelectTrigger>
                <SelectContent>
                  {cameraDropdownOptions.map((cam, i) => (
                    <SelectItem key={i} value={cam}>{cam}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Must match backend config (e.g. Cam1, Cam2).</p>
            </div>
            {/* Pair index */}
            <div>
              <Label htmlFor="index">Pair index</Label>
              <Input id="index" type="number" value={index} onChange={(e) => setIndex(parseInt(e.target.value || "0"))} />
              <p className="text-xs text-muted-foreground mt-1">Which frame pair to inspect.</p>
            </div>
            
            {/* Colormap dropdown */}
            <div>
              <Label htmlFor="cmap">Colormap</Label>
              <Select value={colormap} onValueChange={(v) => setColormap(v as any)}>
                <SelectTrigger id="cmap"><SelectValue placeholder="Select colormap" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gray">Grayscale</SelectItem>
                  <SelectItem value="viridis">Viridis</SelectItem>
                </SelectContent>
                <p className="text-xs text-muted-foreground mt-1">colormap</p>

              </Select>
            </div>
          </div>
          {/* Load Pair button and info */}
          <div className="flex items-center gap-3 mb-4">
            <Button className="bg-soton-blue hover:bg-soton-darkblue" onClick={() => fetchPair()} disabled={loading}>
              {loading ? "Loading..." : "Load Pair"}
            </Button>
            {bitDepth && (
              <span className="text-sm text-gray-600">Detected: {bitDepth}-bit{dtype ? ` ${dtype}` : ""}{dimensions ? ` (${dimensions.width}×${dimensions.height})` : ""}</span>
            )}
          </div>

          {/* Batch navigation and play controls */}
          <div className="flex items-center gap-3 mb-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIndex(Math.max(1, batchStart - batchSize))}
              disabled={index <= batchSize}
            >
              Previous Batch
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIndex(batchStart)}
              disabled={index === batchStart}
            >
              Batch Start
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIndex(batchEnd)}
              disabled={index === batchEnd}
            >
              Batch End
            </Button>
            {/* Separate Play Raw and Play Processed buttons, now using correct state */}
            <Button
              size="sm"
              variant={playingRawBatch ? "default" : "outline"}
              onClick={() => setPlayingRawBatch(p => !p)}
            >
              {playingRawBatch ? "Pause Raw" : "Play Raw"}
            </Button>
            <Button
              size="sm"
              variant={playingProcBatch ? "default" : "outline"}
              onClick={() => setPlayingProcBatch(p => !p)}
            >
              {playingProcBatch ? "Pause Processed" : "Play Processed"}
            </Button>
            <span className="text-xs text-gray-500">
              Batch: {batchStart} - {batchEnd} (size {batchSize})
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Replace fixed height with flex layout for dynamic sizing */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch mb-10">
        {/* Raw image set with controls */}
        <div className="flex flex-col mb-6">
          {/* Raw controls - explicit height */}
          <div className="flex flex-col gap-2 mb-4 h-[140px]">
            {/* First row: A/B selector only */}
            <div className="flex items-center gap-2">
              <span className="font-medium">Raw Image</span>
              <Button size="sm" variant={rawToggle === "A" ? "default" : "outline"} onClick={() => setRawToggle("A")}>A</Button>
              <Button size="sm" variant={rawToggle === "B" ? "default" : "outline"} onClick={() => setRawToggle("B")}>B</Button>
            </div>
            {/* Grid controls moved to their own line to match processed spacer height */}
            <div className="h-[38px] flex items-center gap-2">
              <Switch 
                id="use-grid" 
                checked={useGrid} 
                onCheckedChange={setUseGrid} 
              />
              <Label htmlFor="use-grid" className="ml-1">Show Grid</Label>
              <Label htmlFor="grid-size" className="ml-3">Grid Size (px)</Label>
              <Input
                id="grid-size"
                type="number"
                value={gridSize}
                onChange={e => setGridSize(Math.max(1, parseInt(e.target.value) || 1))}
                disabled={!useGrid}
                className="w-20"
              />
            </div>
            {/* Min/Max controls */}
            <div className="flex items-center gap-2">
              <Label htmlFor="raw-vmin">Min</Label>
              <Input
                id="raw-vmin"
                type="number"
                value={rawVmin}
                onChange={e => {
                  const val = Number.isNaN(parseInt(e.target.value)) ? 0 : parseInt(e.target.value);
                  const newMin = Math.max(0, Math.min(maxVal, val));
                  setRawVmin(newMin);
                  if (newMin > rawVmax) setRawVmax(newMin);
                }}
                className="w-20"
              />
              <Label htmlFor="raw-vmax">Max</Label>
              <Input
                id="raw-vmax"
                type="number"
                value={rawVmax}
                onChange={e => {
                  const val = Number.isNaN(parseInt(e.target.value)) ? 0 : parseInt(e.target.value);
                  const newMax = Math.max(0, Math.min(maxVal, val));
                  setRawVmax(newMax);
                  if (newMax < rawVmin) setRawVmin(newMax);
                }}
                className="w-20"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => imgARaw ? autoLimitsRaw() : (imgA && autoLimitsPng(imgA))}
              >
                Auto
              </Button>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-xs text-gray-500">Min</span>
                <input
                  type="range"
                  min={0}
                  max={maxVal}
                  step={1}
                  value={rawVmin}
                  onChange={(e) => {
                    const newMin = Math.max(0, Math.min(maxVal, parseInt(e.target.value)));
                    setRawVmin(newMin);
                    if (newMin > rawVmax) setRawVmax(newMin);
                  }}
                  className="w-full"
                />
                <span className="text-xs text-gray-500">Max</span>
                <input
                  type="range"
                  min={0}
                  max={maxVal}
                  step={1}
                  value={rawVmax}
                  onChange={(e) => {
                    const newMax = Math.max(0, Math.min(maxVal, parseInt(e.target.value)));
                    setRawVmax(newMax);
                    if (newMax < rawVmin) setRawVmin(newMax);
                  }}
                  className="w-full"
                />
              </div>
            </div>
          </div>
          <div className="h-[480px] mb-4"> {/* Fixed height with bottom margin */}
            <ZoomableCanvas
              raw={rawToggle === "A" ? imgARaw : imgBRaw}
              src={rawToggle === "A" ? imgA : imgB}
              vmin={rawVmin}
              vmax={rawVmax}
              colormap={colormap}
              title={`Raw ${rawToggle} (Frame ${rawIndex})`}
              scale={sharedScale}
              setScale={setSharedScale}
              offset={sharedOffset}
              setOffset={setSharedOffset}
              useGrid={useGrid}
              gridSize={gridSize}
            />
          </div>
        </div>
        {/* Processed image set with controls */}
        <div className="flex flex-col mb-6">
          {/* Processed controls - explicit height */}
          <div className="flex flex-col gap-2 mb-4 h-[140px]">
            <div className="flex items-center gap-2">
              <span className="font-medium">Processed Image</span>
              <Button size="sm" variant={procToggle === "A" ? "default" : "outline"} onClick={() => setProcToggle("A")}>A</Button>
              <Button size="sm" variant={procToggle === "B" ? "default" : "outline"} onClick={() => setProcToggle("B")}>B</Button>
            </div>
            {/* Add blank line for vertical alignment */}
            <div className="h-[38px]"></div>
            <div className="flex items-center gap-2">
              <Label htmlFor="proc-vmin">Min</Label>
              <Input
                id="proc-vmin"
                type="number"
                value={procVmin}
                onChange={e => {
                  const val = Number.isNaN(parseInt(e.target.value)) ? 0 : parseInt(e.target.value);
                  const newMin = Math.max(0, Math.min(maxVal, val));
                  setProcVmin(newMin);
                  if (newMin > procVmax) setProcVmax(newMin);
                }}
                className="w-20"
              />
              <Label htmlFor="proc-vmax">Max</Label>
              <Input
                id="proc-vmax"
                type="number"
                value={procVmax}
                onChange={e => {
                  const val = Number.isNaN(parseInt(e.target.value)) ? 0 : parseInt(e.target.value);
                  const newMax = Math.max(0, Math.min(maxVal, val));
                  setProcVmax(newMax);
                  if (newMax < procVmin) setProcVmin(newMax);
                }}
                className="w-20"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  // For now, just copy raw min/max as "auto"
                  setProcVmin(rawVmin);
                  setProcVmax(rawVmax);
                }}
              >
                Auto
              </Button>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-xs text-gray-500">Min</span>
                <input
                  type="range"
                  min={0}
                  max={maxVal}
                  step={1}
                  value={procVmin}
                  onChange={(e) => {
                    const newMin = Math.max(0, Math.min(maxVal, parseInt(e.target.value)));
                    setProcVmin(newMin);
                    if (newMin > procVmax) setProcVmax(newMin);
                  }}
                  className="w-full"
                />
                <span className="text-xs text-gray-500">Max</span>
                <input
                  type="range"
                  min={0}
                  max={maxVal}
                  step={1}
                  value={procVmax}
                  onChange={(e) => {
                    const newMax = Math.max(0, Math.min(maxVal, parseInt(e.target.value)));
                    setProcVmax(newMax);
                    if (newMax < procVmin) setProcVmin(newMax);
                  }}
                  className="w-full"
                />
              </div>
            </div>
          </div>
          <div className="h-[480px] mb-4"> {/* Fixed height with bottom margin */}
            <ZoomableCanvas
              raw={undefined}
              src={procToggle === "A" ? procImgA : procImgB}
              vmin={procVmin}
              vmax={procVmax}
              colormap={colormap}
              title={`Processed ${procToggle} (Frame ${procIndex})`}
              scale={sharedScale}
              setScale={setSharedScale}
              offset={sharedOffset}
              setOffset={setSharedOffset}
              useGrid={useGrid}
              gridSize={gridSize}
            />
          </div>
        </div>
      </div>
      {filterSaveNote && (
        <div className="text-xs text-blue-700 mb-6 mt-4">{filterSaveNote}</div>
      )}
    </div>
    )};