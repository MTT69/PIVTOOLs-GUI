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

// ── Discoverable summary + action for the tab body (multi-camera only) ──
//
// The datum/overlap PICKING lives in GCInlineControls (in the viewer settings bar); this
// block surfaces the step on the main card so a multi-camera user discovers it, explains
// what it does, and exposes the Compute+Save action with the saved per-camera offsets (mm).

interface GlobalFrameSummaryProps {
  gc: GlobalCoordinatesState;
  cameraOptions: number[];
  board?: string;
  sourcePathIdx?: number;
}

export function GlobalFrameSummary({
  gc,
  cameraOptions,
  board = 'dotboard',
  sourcePathIdx = 0,
}: GlobalFrameSummaryProps) {
  if (cameraOptions.length <= 1) return null;   // single camera = its own frame, nothing to stitch
  const ready = !!gc.datumPixel;
  return (
    <div className="border-t pt-4 space-y-2">
      <h4 className="text-sm font-semibold">Multi-camera global frame</h4>
      <p className="text-xs text-muted-foreground">
        Stitch every camera into one shared coordinate frame. In the image viewer&apos;s{' '}
        <strong>Global Coords</strong> controls, pick the datum origin and an overlap point for each
        camera pair, then compute + save to bake each camera&apos;s offset into its model. Velocities
        and stresses are unaffected (the offset shifts coordinates only).
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          disabled={!ready || gc.savingGlobal}
          onClick={() => gc.saveGlobalFrame(board, sourcePathIdx)}
          className="bg-blue-600 hover:bg-blue-700 text-white"
          title={ready
            ? "Compute the datum-chain shifts and bake them into each camera's model"
            : "Pick the datum origin in the viewer's Global Coords controls first"}
        >
          {gc.savingGlobal ? 'Saving…' : 'Compute + Save Global Frame'}
        </Button>
        {!ready && (
          <span className="text-xs text-muted-foreground">datum origin not set yet</span>
        )}
        {gc.savedShifts && (
          <span className="text-xs text-green-700">
            Saved:{' '}
            {Object.entries(gc.savedShifts.camera_shifts)
              .map(([c, s]: [string, number[]]) =>
                `Cam${c} (${s[0].toFixed(1)}, ${s[1].toFixed(1)}) mm`)
              .join('   ')}
          </span>
        )}
        {gc.globalError && <span className="text-xs text-red-600">{gc.globalError}</span>}
      </div>
    </div>
  );
}

// ── Inline controls for the CalibrationImageViewer settings bar ──

interface GCInlineControlsProps {
  gc: GlobalCoordinatesState;
  currentCamera: number;
  cameraOptions: number[];
  onCameraChange: (cam: number) => void;
  board?: string;          // which model family to bake the offset into
  sourcePathIdx?: number;  // which calibration source
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
  board = 'dotboard',
  sourcePathIdx = 0,
}: GCInlineControlsProps) {
  const isCam1 = currentCamera === 1;
  const hasMultipleCameras = cameraOptions.length > 1;

  const pairsForCamera = getPairsForCamera(gc.overlapPairs, currentCamera);

  const isSelectingOrigin = gc.selectionMode === 'datum';

  const camIdx = cameraOptions.indexOf(currentCamera);
  const canPrev = camIdx > 0;
  const canNext = camIdx < cameraOptions.length - 1;

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

          {/* Compute + Save Global Frame — bakes per-camera world_offset_mm into each
              model, so the calibrate step emits coordinates in the shared rig frame.
              The mirror is the per-camera calibration axis choice, not a flag here. */}
          {gc.datumPixel && (
            <>
              <div className="border-l h-6 mx-1" />
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  size="sm"
                  className="h-7 bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={gc.savingGlobal}
                  onClick={() => gc.saveGlobalFrame(board, sourcePathIdx)}
                  title="Compute the datum-chain shifts and bake them into each camera's model"
                >
                  {gc.savingGlobal ? 'Saving…' : 'Compute + Save Global Frame'}
                </Button>
                {gc.savedShifts && (
                  <span className="text-[11px] text-blue-700 whitespace-nowrap">
                    {Object.entries(gc.savedShifts.camera_shifts)
                      .map(([c, s]) => `C${c}(${s[0].toFixed(1)},${s[1].toFixed(1)})`)
                      .join('  ')}
                  </span>
                )}
                {gc.globalError && (
                  <span className="text-[11px] text-red-600 whitespace-nowrap">{gc.globalError}</span>
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
