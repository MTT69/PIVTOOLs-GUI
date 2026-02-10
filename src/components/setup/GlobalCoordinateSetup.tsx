"use client";
import React from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MarkerPoint } from "@/components/viewer/zoomableCanvas";
import {
  useGlobalCoordinates,
  SelectionMode,
  OverlapPair,
} from "@/hooks/useGlobalCoordinates";

/** Return type of useGlobalCoordinates hook */
export type GlobalCoordinatesState = ReturnType<typeof useGlobalCoordinates>;

// ── Inline controls for the CalibrationImageViewer settings bar ──

interface GCInlineControlsProps {
  gc: GlobalCoordinatesState;
  currentCamera: number;
  cameraOptions: number[];
  onCameraChange: (cam: number) => void;
}

/** Info about a pair that involves the current camera */
interface PairForCamera {
  pair: OverlapPair;
  pairIdx: number;
  side: 'a' | 'b';
  otherCamera: number;
  featureIdx: number; // 1-based display index for this camera
}

function getPairsForCamera(pairs: OverlapPair[], camera: number): PairForCamera[] {
  const result: PairForCamera[] = [];
  let featureIdx = 1;
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (pair.camera_a === camera) {
      result.push({ pair, pairIdx: i, side: 'a', otherCamera: pair.camera_b, featureIdx });
      featureIdx++;
    } else if (pair.camera_b === camera) {
      result.push({ pair, pairIdx: i, side: 'b', otherCamera: pair.camera_a, featureIdx });
      featureIdx++;
    }
  }
  return result;
}

export function GCInlineControls({
  gc,
  currentCamera,
  cameraOptions,
  onCameraChange,
}: GCInlineControlsProps) {
  const isCam1 = currentCamera === 1;
  const hasMultipleCameras = cameraOptions.length > 1;

  const pairsForCamera = getPairsForCamera(gc.overlapPairs, currentCamera);

  const isSelectingOrigin = gc.selectionMode === 'datum';

  const camIdx = cameraOptions.indexOf(currentCamera);
  const canPrev = camIdx > 0;
  const canNext = camIdx < cameraOptions.length - 1;

  // Check if origin and first feature are set (for flip toggle visibility)
  const canShowFlip = isCam1 && gc.datumPixel && pairsForCamera.length > 0;

  return (
    <>
      {/* ─── Top row: GC toggle + camera nav ─── */}
      <div className="border-l h-6 mx-1" />

      {/* Enable toggle */}
      <div className="flex items-center gap-1.5">
        <Switch
          checked={gc.enabled}
          onCheckedChange={gc.setEnabled}
          className="scale-75"
        />
        <span className="text-xs font-medium whitespace-nowrap">Global Coords</span>
      </div>

      {/* Camera navigation */}
      {gc.enabled && hasMultipleCameras && (
        <>
          <div className="border-l h-6 mx-1" />
          <div className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              disabled={!canPrev}
              onClick={() => onCameraChange(cameraOptions[camIdx - 1])}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs font-medium min-w-[48px] text-center whitespace-nowrap">
              Cam {currentCamera}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              disabled={!canNext}
              onClick={() => onCameraChange(cameraOptions[camIdx + 1])}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </>
      )}

      {/* ─── Second row: origin + per-pair feature pickers ─── */}
      {gc.enabled && (
        <>
          {/* Force flex wrap to new line */}
          <div className="basis-full h-0" />

          {/* Set Origin (Camera 1 only) */}
          {isCam1 && (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className={
                  isSelectingOrigin
                    ? "h-7 border-green-500 text-green-600 animate-pulse"
                    : "h-7 border-green-500 text-green-600"
                }
                onClick={() =>
                  gc.setSelectionMode(isSelectingOrigin ? 'none' : 'datum')
                }
              >
                {isSelectingOrigin
                  ? 'Click image...'
                  : gc.datumPixel
                  ? 'Re-pick Origin'
                  : 'Set Origin'}
              </Button>
              {gc.datumPixel && (
                <span className="text-xs text-green-600 whitespace-nowrap">
                  O({gc.datumPixel[0].toFixed(0)},{gc.datumPixel[1].toFixed(0)})
                </span>
              )}
            </div>
          )}

          {/* Physical origin coordinates (Camera 1, when datum is set) */}
          {isCam1 && gc.datumPixel && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">X:</span>
              <input
                type="text"
                inputMode="numeric"
                value={gc.datumPhysicalX}
                onChange={e => gc.setDatumPhysicalX(e.target.value)}
                onBlur={gc.handlePhysicalBlur}
                className="w-14 h-6 text-xs border rounded px-1"
              />
              <span className="text-xs text-muted-foreground">Y:</span>
              <input
                type="text"
                inputMode="numeric"
                value={gc.datumPhysicalY}
                onChange={e => gc.setDatumPhysicalY(e.target.value)}
                onBlur={gc.handlePhysicalBlur}
                className="w-14 h-6 text-xs border rounded px-1"
              />
              <span className="text-xs text-muted-foreground">mm</span>
            </div>
          )}

          {/* Per-pair feature buttons */}
          {hasMultipleCameras && pairsForCamera.map(({ pair, side, otherCamera, featureIdx }) => {
            const selMode: SelectionMode = `pair_${pair.camera_a}_${pair.camera_b}_${side}`;
            const isSelecting = gc.selectionMode === selMode;
            const featurePixel = side === 'a' ? pair.pixel_on_a : pair.pixel_on_b;

            return (
              <React.Fragment key={`${pair.camera_a}_${pair.camera_b}_${side}`}>
                {(isCam1 && gc.datumPixel && featureIdx === 1) && <div className="border-l h-6 mx-1" />}
                {(!isCam1 && featureIdx > 1) && <div className="border-l h-6 mx-1" />}
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className={
                      isSelecting
                        ? "h-7 border-blue-500 text-blue-600 animate-pulse"
                        : "h-7 border-blue-500 text-blue-600"
                    }
                    onClick={() => {
                      gc.setSelectionMode(isSelecting ? 'none' : selMode);
                    }}
                  >
                    {isSelecting
                      ? 'Click image...'
                      : featurePixel
                      ? `Re-pick F${featureIdx}`
                      : `Pick F${featureIdx}`}
                    <span className="text-[10px] opacity-60 ml-0.5">{'\u2194'}C{otherCamera}</span>
                  </Button>
                  {featurePixel && featurePixel[0] != null && featurePixel[1] != null && (
                    <span className="text-xs text-blue-600 whitespace-nowrap">
                      C{currentCamera}F{featureIdx}({featurePixel[0].toFixed(0)},{featurePixel[1].toFixed(0)})
                    </span>
                  )}
                </div>
              </React.Fragment>
            );
          })}

          {/* Flip X toggle (cam 1 only, after origin + first feature) */}
          {canShowFlip && (
            <>
              <div className="border-l h-6 mx-1" />
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Flip X:</span>
                <Switch
                  checked={gc.invertUx}
                  onCheckedChange={gc.setInvertUx}
                  className="scale-75"
                />
                {gc.autoInvertUx !== null && !gc.invertUxManual && (
                  <span className="text-[10px] text-muted-foreground italic">auto</span>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

// ── Helper functions (used by parent components) ──

/**
 * Build marker points for a given camera/frame from gc state.
 */
export function getGlobalCoordMarkers(gc: GlobalCoordinatesState, cam: number, frame: number): MarkerPoint[] {
  if (!gc.enabled) return [];
  const markers: MarkerPoint[] = [];

  // Datum marker on camera 1
  if (cam === 1 && gc.datumPixel) {
    markers.push({ x: gc.datumPixel[0], y: gc.datumPixel[1], color: "#22c55e", label: "O" });
  }

  // Feature markers from overlap pairs
  const pairsForCam = getPairsForCamera(gc.overlapPairs, cam);
  for (const { pair, side, featureIdx } of pairsForCam) {
    const pixel = side === 'a' ? pair.pixel_on_a : pair.pixel_on_b;
    if (pixel) {
      markers.push({
        x: pixel[0],
        y: pixel[1],
        color: "#3b82f6",
        label: `C${cam}F${featureIdx}`,
      });
    }
  }

  return markers;
}

/**
 * Get the camera/frame the viewer should switch to while selecting.
 */
export function getGlobalCoordViewerTarget(gc: GlobalCoordinatesState): { camera: number; frame: number } | null {
  if (gc.selectionMode === "datum") {
    return { camera: 1, frame: gc.datumFrame };
  }
  const pairMatch = gc.selectionMode.match(/^pair_(\d+)_(\d+)_(a|b)$/);
  if (pairMatch) {
    const camA = parseInt(pairMatch[1]);
    const camB = parseInt(pairMatch[2]);
    const side = pairMatch[3] as 'a' | 'b';
    const pair = gc.overlapPairs.find(p => p.camera_a === camA && p.camera_b === camB);
    if (side === 'a') {
      return { camera: camA, frame: pair?.frame_a ?? 1 };
    } else {
      return { camera: camB, frame: pair?.frame_b ?? 1 };
    }
  }
  return null;
}

/**
 * Handle a point selection from the image viewer.
 */
export function handleGlobalCoordPointSelect(gc: GlobalCoordinatesState, px: number, py: number, camera: number, frame: number) {
  if (gc.selectionMode === "datum") {
    gc.handleDatumPointSelect(px, py);
  } else {
    const pairMatch = gc.selectionMode.match(/^pair_(\d+)_(\d+)_(a|b)$/);
    if (pairMatch) {
      const camA = parseInt(pairMatch[1]);
      const camB = parseInt(pairMatch[2]);
      const side = pairMatch[3] as 'a' | 'b';
      gc.handlePairPointSelect(px, py, camA, camB, side);
    }
  }
}

export { useGlobalCoordinates };
export type { SelectionMode, OverlapPair };
