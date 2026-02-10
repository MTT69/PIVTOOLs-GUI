"use client";

import { useEffect, useMemo, useRef } from 'react';
import { buildColormap } from '@/lib/imageUtils'; // Assumes utils are in a lib file

interface ColorbarProps {
  vmin: number;
  vmax: number;
  colormap: "gray" | "viridis";
  height?: number;
}

export default function Colorbar({ vmin, vmax, colormap, height = 240 }: ColorbarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cmap = useMemo(() => buildColormap(colormap), [colormap]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const width = 16;
    canvas.width = width;
    canvas.height = height;
    const img = ctx.createImageData(width, height);
    
    for (let y = 0; y < height; y++) {
      const t = 1 - y / (height - 1); // Invert y-axis for standard colorbar
      const idx = Math.min(255, Math.max(0, Math.round(t * 255)));
      const [r, g, b] = [cmap[idx * 3], cmap[idx * 3 + 1], cmap[idx * 3 + 2]];
      
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [cmap, height]);

  return (
    <div className="flex flex-col items-center">
      <span className="text-xs">{vmax?.toFixed(0) ?? ""}</span>
      <canvas ref={canvasRef} className="rounded border my-1" />
      <span className="text-xs">{vmin?.toFixed(0) ?? ""}</span>
    </div>
  );
}