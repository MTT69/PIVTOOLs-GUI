"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import ZoomableCanvas, { OverlayPoint, MarkerPoint, OverlayLine } from "@/components/viewer/zoomableCanvas";

export type ViewerMode = "none" | "world" | "measure" | "global";

interface Props {
  title: string;
  src: string | null;
  // frame navigation
  frame: number;
  frameCount: number;
  startIndex: number;
  datumFrame?: number;
  onFrame: (f: number) => void;
  enableDatumFrame?: boolean;
  // detection
  onDetect: () => void;
  busy?: boolean;
  detectLabel?: string;
  showDots: boolean;
  onToggleDots: () => void;
  overlayPoints?: OverlayPoint[];
  overlayLines?: OverlayLine[];
  markerPoints?: MarkerPoint[];
  // interaction
  mode: ViewerMode;
  onSetMode: (m: ViewerMode) => void;
  onImageClick?: (x: number, y: number) => void;
  measureLine?: { p1: { x: number; y: number }; p2?: { x: number; y: number } } | null;
  measureReadout?: string | null;
  enableMeasure?: boolean;
  stepHint?: string | null;
}

const lastFrame = (startIndex: number, count: number) => startIndex + Math.max(count, 1) - 1;

export const Calibration2Viewer: React.FC<Props> = ({
  title, src, frame, frameCount, startIndex, datumFrame, onFrame, enableDatumFrame,
  onDetect, busy, detectLabel = "Detect board", showDots, onToggleDots,
  overlayPoints, overlayLines, markerPoints,
  mode, onSetMode, onImageClick, measureLine, measureReadout, enableMeasure, stepHint,
}) => {
  const [zoom, setZoom] = useState({ z: 1, x: 0, y: 0 });
  const end = lastFrame(startIndex, frameCount);
  const clamp = (f: number) => Math.min(end, Math.max(startIndex, f));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onDetect} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {detectLabel}
        </Button>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={showDots} onChange={onToggleDots} />
          Show detected dots
        </label>
        {enableMeasure && (
          <Button size="sm" variant={mode === "measure" ? "default" : "outline"}
            onClick={() => onSetMode(mode === "measure" ? "none" : "measure")}>
            Measure
          </Button>
        )}
        {stepHint && <span className="text-sm text-muted-foreground">{stepHint}</span>}
      </div>

      <div className="h-[60vh] min-h-[420px]">
        <ZoomableCanvas
          src={src}
          vmin={0}
          vmax={100}
          colormap="gray"
          title={title}
          zoomLevel={zoom.z}
          panX={zoom.x}
          panY={zoom.y}
          onZoomChange={(z, x, y) => setZoom({ z, x, y })}
          overlayPoints={showDots ? overlayPoints : undefined}
          overlayColor="rgba(255,210,0,0.85)"
          overlayRadius={4}
          overlayLines={overlayLines}
          markerPoints={markerPoints}
          clickMode={mode !== "none"}
          onImageClick={onImageClick}
          measureLine={mode === "measure" ? measureLine : null}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => onFrame(clamp(frame - 1))} disabled={frame <= startIndex}>‹</Button>
          <span className="tabular-nums">frame {frame}{frameCount ? ` / ${end}` : ""}</span>
          <Button size="sm" variant="outline" onClick={() => onFrame(clamp(frame + 1))} disabled={!!frameCount && frame >= end}>›</Button>
        </div>
        {frameCount > 1 && (
          <input type="range" min={startIndex} max={end} value={frame}
            onChange={(e) => onFrame(clamp(parseInt(e.target.value, 10)))} className="flex-1 min-w-[120px]" />
        )}
        {enableDatumFrame && (
          <span className={datumFrame === frame ? "text-green-600 font-medium" : "text-muted-foreground"}>
            {datumFrame === frame ? "● this is the datum frame" : `datum: frame ${datumFrame}`}
          </span>
        )}
        {mode === "measure" && measureReadout && (
          <span className="text-cyan-600 font-medium">{measureReadout}</span>
        )}
      </div>
    </div>
  );
};
