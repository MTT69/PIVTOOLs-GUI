"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RawImage, buildColormap } from "@/lib/imageUtils";

interface OverlayPoint {
  x: number;
  y: number;
}

export interface MarkerPoint {
  x: number;
  y: number;
  color: string;
  label?: string;
}

interface ZoomableCanvasProps {
  raw?: RawImage | null;
  src?: string | null;
  error?: string | null;
  vmin: number;  // Percentage (0-100)
  vmax: number;  // Percentage (0-100)
  colormap: "gray" | "viridis";
  title: string;
  useGrid?: boolean;
  gridSize?: number;
  gridThickness?: number;
  zoomLevel?: number;
  panX?: number;
  panY?: number;
  onZoomChange?: (zoom: number, panX: number, panY: number) => void;
  // Detection overlay
  overlayPoints?: OverlayPoint[];
  overlayColor?: string;
  overlayRadius?: number;
  // Click mode for point selection
  onImageClick?: (imageX: number, imageY: number) => void;
  clickMode?: boolean;
  markerPoints?: MarkerPoint[];
}

export default function ZoomableCanvas({
  raw, src, error, vmin, vmax, colormap, title,
  useGrid, gridSize = 16, gridThickness = 1,
  zoomLevel, panX, panY, onZoomChange,
  overlayPoints, overlayColor = '#ff0000', overlayRadius = 8,
  onImageClick, clickMode = false, markerPoints
}: ZoomableCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const markerCanvasRef = useRef<HTMLCanvasElement>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const cmap = useMemo(() => buildColormap(colormap), [colormap]);

  // Pre-build a Uint32Array LUT for fast pixel writes (ABGR for little-endian)
  const cmapLUT = useMemo(() => {
    if (!cmap) return null;
    const lut = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const r = cmap[i * 3], g = cmap[i * 3 + 1], b = cmap[i * 3 + 2];
      lut[i] = (255 << 24) | (b << 16) | (g << 8) | r; // ABGR for little-endian
    }
    return lut;
  }, [cmap]);

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

    // Convert percentages (0-100) to pixel values (0-255)
    // The image is normalized to 8-bit by the backend
    const pixelVmin = (vmin / 100) * 255;
    const pixelVmax = (vmax / 100) * 255;

    if (raw?.data) {
      const { width, height, data, bitDepth } = raw;
      canvas.width = width;
      canvas.height = height;
      const out = new Uint8ClampedArray(width * height * 4);
      // For raw data, use the actual data range based on bit depth
      const maxDataVal = bitDepth ? Math.pow(2, bitDepth) - 1 : 255;
      const dataVmin = (vmin / 100) * maxDataVal;
      const dataVmax = (vmax / 100) * maxDataVal;
      const range = Math.max(1e-9, dataVmax - dataVmin);
      if (cmapLUT) {
        const out32 = new Uint32Array(out.buffer);
        for (let i = 0; i < width * height; i++) {
          const t = Math.max(0, Math.min(1, (Number(data[i]) - dataVmin) / range));
          out32[i] = cmapLUT[Math.floor(t * 255)];
        }
      } else {
        for (let i = 0; i < width * height; i++) {
          const t = Math.max(0, Math.min(1, (Number(data[i]) - dataVmin) / range));
          const idx = Math.floor(t * 255);
          const j = i * 4;
          [out[j], out[j+1], out[j+2]] = [cmap[idx * 3], cmap[idx * 3 + 1], cmap[idx * 3 + 2]];
          out[j + 3] = 255;
        }
      }
      ctx.putImageData(new ImageData(out, width, height), 0, 0);
    } else if (imgEl) {
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      // Draw image, then remap pixels according to vmin/vmax/colormap
      // Image is 8-bit (0-255) from backend, convert percentage to pixel values
      ctx.drawImage(imgEl, 0, 0);
      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const out = new Uint8ClampedArray(data.length);
        const range = Math.max(1e-9, pixelVmax - pixelVmin);
        if (cmapLUT) {
          const out32 = new Uint32Array(out.buffer);
          const pixelCount = canvas.width * canvas.height;
          for (let i = 0; i < pixelCount; i++) {
            const I = data[i * 4]; // Use red channel as intensity
            const t = Math.max(0, Math.min(1, (I - pixelVmin) / range));
            out32[i] = cmapLUT[Math.floor(t * 255)];
          }
        } else {
          for (let i = 0; i < data.length; i += 4) {
            const I = data[i]; // Use red channel as intensity
            const t = Math.max(0, Math.min(1, (I - pixelVmin) / range));
            const idx = Math.floor(t * 255);
            out[i] = cmap[idx * 3];
            out[i + 1] = cmap[idx * 3 + 1];
            out[i + 2] = cmap[idx * 3 + 2];
            out[i + 3] = 255;
          }
        }
        ctx.putImageData(new ImageData(out, canvas.width, canvas.height), 0, 0);
      } catch (e) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [raw, imgEl, vmin, vmax, cmap, cmapLUT]);

  // Draw overlay dots on a dedicated canvas (much faster than SVG <circle> elements)
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size canvas to match the image dimensions (not the display dimensions)
    const w = raw?.width || imgEl?.naturalWidth || 0;
    const h = raw?.height || imgEl?.naturalHeight || 0;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    if (!overlayPoints || overlayPoints.length === 0) return;

    ctx.fillStyle = overlayColor;
    ctx.globalAlpha = 0.8;
    for (const pt of overlayPoints) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, overlayRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [overlayPoints, overlayColor, overlayRadius, raw, imgEl]);

  // Draw marker points (labeled circles + crosshairs for point selection)
  useEffect(() => {
    const canvas = markerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = raw?.width || imgEl?.naturalWidth || 0;
    const h = raw?.height || imgEl?.naturalHeight || 0;
    if (w === 0 || h === 0) return;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    if (!markerPoints || markerPoints.length === 0) return;

    // Scale marker size relative to image (min 16, max 40, ~1.5% of smallest dimension)
    const baseDim = Math.min(w, h);
    const r = Math.max(16, Math.min(40, Math.round(baseDim * 0.015)));
    const crossLen = r * 1.8;
    const fontSize = Math.max(10, Math.round(r * 0.7));

    for (const pt of markerPoints) {
      // Crosshair lines (white with dark outline for contrast)
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'black';
      ctx.beginPath();
      ctx.moveTo(pt.x - crossLen, pt.y);
      ctx.lineTo(pt.x + crossLen, pt.y);
      ctx.moveTo(pt.x, pt.y - crossLen);
      ctx.lineTo(pt.x, pt.y + crossLen);
      ctx.stroke();

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'white';
      ctx.beginPath();
      ctx.moveTo(pt.x - crossLen, pt.y);
      ctx.lineTo(pt.x + crossLen, pt.y);
      ctx.moveTo(pt.x, pt.y - crossLen);
      ctx.lineTo(pt.x, pt.y + crossLen);
      ctx.stroke();

      // Filled circle
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = pt.color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 1;
      ctx.stroke();

      // Label
      if (pt.label) {
        ctx.fillStyle = 'white';
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pt.label, pt.x, pt.y);
      }
    }
  }, [markerPoints, raw, imgEl]);

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

  // Track click start for click mode (to distinguish clicks from drags)
  const clickStartPos = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    if (boxZoomMode) {
      // Box zoom takes priority — works even when clickMode is active
      setIsSelecting(true);
      selectionStart.current = { x: mouseX, y: mouseY };
      setSelectionRect({ x: mouseX, y: mouseY, w: 0, h: 0 });
    } else if (clickMode) {
      clickStartPos.current = { x: mouseX, y: mouseY };
      // Still allow drag in click mode for repositioning
      setIsDragging(true);
      lastPos.current = { x: e.clientX, y: e.clientY };
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

  const handleMouseUp = (e: React.MouseEvent) => {
    // Click mode: detect single click (mouse hasn't moved much)
    if (clickMode && onImageClick && isDragging) {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const dx = mouseX - clickStartPos.current.x;
        const dy = mouseY - clickStartPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) < 5) {
          // Convert screen coords to image coords
          const imageX = (mouseX - offset.x) / scale;
          const imageY = (mouseY - offset.y) / scale;
          onImageClick(imageX, imageY);
        }
      }
    }
    if (isSelecting && selectionRect && selectionRect.w > 10 && selectionRect.h > 10) {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      // Calculate new scale to fit the selection rectangle
      const newScale = Math.min(wrapper.clientWidth / selectionRect.w, wrapper.clientHeight / selectionRect.h) * scale;

      // Find the center of the selection box in screen (wrapper) coordinates
      const selectionCenterX = selectionRect.x + selectionRect.w / 2;
      const selectionCenterY = selectionRect.y + selectionRect.h / 2;

      // Convert selection center from screen coords to image coords
      // Screen position = imagePos * scale + offset, so imagePos = (screenPos - offset) / scale
      const imageCenterX = (selectionCenterX - offset.x) / scale;
      const imageCenterY = (selectionCenterY - offset.y) / scale;

      // Calculate new offset so that image center appears at wrapper center
      const wrapperCenterX = wrapper.clientWidth / 2;
      const wrapperCenterY = wrapper.clientHeight / 2;

      const newOffset = {
        x: wrapperCenterX - imageCenterX * newScale,
        y: wrapperCenterY - imageCenterY * newScale
      };

      onZoomChange?.(newScale, newOffset.x, newOffset.y);
      setBoxZoomMode(false);
    }
    setIsDragging(false);
    setIsSelecting(false);
    setSelectionRect(null);
  };

  const cursor = boxZoomMode ? 'zoom-in' : clickMode ? 'crosshair' : (isDragging ? 'grabbing' : 'grab');

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
              {/* Detection overlay points (canvas-based for performance) */}
              <canvas
                ref={overlayCanvasRef}
                className="absolute top-0 left-0 pointer-events-none"
                style={{
                  width: raw?.width || imgEl?.naturalWidth || 0,
                  height: raw?.height || imgEl?.naturalHeight || 0,
                }}
              />
              {/* Marker points (labeled circles for point selection) */}
              <canvas
                ref={markerCanvasRef}
                className="absolute top-0 left-0 pointer-events-none"
                style={{
                  width: raw?.width || imgEl?.naturalWidth || 0,
                  height: raw?.height || imgEl?.naturalHeight || 0,
                }}
              />
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