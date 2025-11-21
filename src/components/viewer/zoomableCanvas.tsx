"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RawImage, buildColormap } from "@/lib/imageUtils";

interface ZoomableCanvasProps {
  raw?: RawImage | null;
  src?: string | null;
  error?: string | null;
  vmin: number;
  vmax: number;
  colormap: "gray" | "viridis";
  title: string;
  useGrid?: boolean;
  gridSize?: number;
  gridThickness?: number;
  zoomLevel?: number;
  panX?: number;
  panY?: number;
  onZoomChange?: (zoom: number, panX: number, panY: number) => void;
}

export default function ZoomableCanvas({ raw, src, error, vmin, vmax, colormap, title, useGrid, gridSize = 16, gridThickness = 1, zoomLevel, panX, panY, onZoomChange }: ZoomableCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const cmap = useMemo(() => buildColormap(colormap), [colormap]);

  // Use props for zoom state, with defaults
  const scale = zoomLevel ?? 1;
  const offset = { x: panX ?? 0, y: panY ?? 0 };

  // Interaction State
  const [isDragging, setIsDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Box Zoom State
  const [boxZoomMode, setBoxZoomMode] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStart = useRef({ x: 0, y: 0 });
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    if (!src) { setImgEl(null); return; }
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = `data:image/png;base64,${src}`;
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    if (raw?.data) {
      const { width, height, data } = raw;
      canvas.width = width;
      canvas.height = height;
      const out = new Uint8ClampedArray(width * height * 4);
      const range = Math.max(1e-9, vmax - vmin);
      for (let i = 0; i < width * height; i++) {
        const t = Math.max(0, Math.min(1, (Number(data[i]) - vmin) / range));
        const idx = Math.floor(t * 255);
        const j = i * 4;
        [out[j], out[j+1], out[j+2]] = [cmap[idx * 3], cmap[idx * 3 + 1], cmap[idx * 3 + 2]];
        out[j + 3] = 255;
      }
      ctx.putImageData(new ImageData(out, width, height), 0, 0);
    } else if (imgEl) {
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      // Draw image, then remap pixels according to vmin/vmax/colormap
      ctx.drawImage(imgEl, 0, 0);
      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const out = new Uint8ClampedArray(data.length);
        const range = Math.max(1e-9, vmax - vmin);
        for (let i = 0; i < data.length; i += 4) {
          const I = data[i]; // Use red channel as intensity
          const t = Math.max(0, Math.min(1, (I - vmin) / range));
          const idx = Math.floor(t * 255);
          out[i] = cmap[idx * 3];
          out[i + 1] = cmap[idx * 3 + 1];
          out[i + 2] = cmap[idx * 3 + 2];
          out[i + 3] = 255;
        }
        ctx.putImageData(new ImageData(out, canvas.width, canvas.height), 0, 0);
      } catch (e) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [raw, imgEl, vmin, vmax, cmap]);

  const fitToView = () => {
    const wrapper = wrapperRef.current;
    const imgW = raw?.width || imgEl?.naturalWidth;
    const imgH = raw?.height || imgEl?.naturalHeight;
    if (!wrapper || !imgW || !imgH) return;
    const s = Math.min(wrapper.clientWidth / imgW, wrapper.clientHeight / imgH) * 0.98;
    const o = { x: (wrapper.clientWidth - imgW * s) / 2, y: (wrapper.clientHeight - imgH * s) / 2 };
    onZoomChange?.(s, o.x, o.y);
  };

  // Track if we've done initial fit
  const hasInitialFit = useRef(false);

  useEffect(() => {
    // Only auto-fit on initial load, not when image changes
    if (!hasInitialFit.current && (raw || imgEl)) {
      fitToView();
      hasInitialFit.current = true;
    }
  }, [raw, imgEl]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    if (boxZoomMode) {
      setIsSelecting(true);
      selectionStart.current = { x: mouseX, y: mouseY };
      setSelectionRect({ x: mouseX, y: mouseY, w: 0, h: 0 });
    } else {
      setIsDragging(true);
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (isSelecting) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      setSelectionRect({
        x: Math.min(selectionStart.current.x, mouseX), y: Math.min(selectionStart.current.y, mouseY),
        w: Math.abs(mouseX - selectionStart.current.x), h: Math.abs(mouseY - selectionStart.current.y),
      });
      return;
    }
    if (!isDragging) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    onZoomChange?.(scale, offset.x + dx, offset.y + dy);
  };

  const handleMouseUp = () => {
    if (isSelecting && selectionRect && selectionRect.w > 10 && selectionRect.h > 10) {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const newScale = Math.min(wrapper.clientWidth / selectionRect.w, wrapper.clientHeight / selectionRect.h) * scale;
      const newOffset = {
        x: offset.x - selectionRect.x * (newScale / scale - 1),
        y: offset.y - selectionRect.y * (newScale / scale - 1)
      };
      onZoomChange?.(newScale, newOffset.x, newOffset.y);
      setBoxZoomMode(false);
    }
    setIsDragging(false);
    setIsSelecting(false);
    setSelectionRect(null);
  };

  const cursor = boxZoomMode ? 'crosshair' : (isDragging ? 'grabbing' : 'grab');

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{title}</span>
        <div className="flex items-center gap-2">
          <Button variant={boxZoomMode ? "default" : "outline"} size="sm" onClick={() => setBoxZoomMode(!boxZoomMode)}>Box Zoom</Button>
          <Button variant="outline" size="sm" onClick={fitToView}>Fit</Button>
        </div>
      </div>
      <div
        ref={wrapperRef}
        className="relative w-full flex-1 bg-black/80 rounded-md overflow-hidden border"
        style={{ cursor }}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {error ? <div className="absolute inset-0 flex items-center justify-center text-red-400 p-4">{error}</div> :
          <>
            <div style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: "0 0" }}>
              <canvas ref={canvasRef} />
            </div>
            {useGrid && <div className="absolute inset-0 pointer-events-none" style={{
              backgroundSize: `${gridSize * scale}px ${gridSize * scale}px`,
              backgroundImage: `linear-gradient(to right, rgba(255,0,0,0.3) ${gridThickness}px, transparent ${gridThickness}px),
                                linear-gradient(to bottom, rgba(255,0,0,0.3) ${gridThickness}px, transparent ${gridThickness}px)`
            }} />}
            {selectionRect && <div className="absolute pointer-events-none border-2 border-dashed border-white bg-blue-500/20" style={{
              left: selectionRect.x, top: selectionRect.y, width: selectionRect.w, height: selectionRect.h
            }} />}
          </>
        }
      </div>
    </div>
  );
}