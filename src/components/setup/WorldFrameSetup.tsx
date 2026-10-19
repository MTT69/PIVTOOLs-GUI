"use client";

/**
 * World-frame (coordinate-system) picker for calibration.
 *
 * The user clicks origin / +X / +Y on the datum view; each click snaps to the
 * nearest DETECTED feature (`/calibration/snap_fiducial`, which needs the datum
 * detection cached first via `/calibration/detect_datum`). The three snapped
 * pixels become the `clicks` payload passed to `generate_model`. With no clicks,
 * the backend falls back to the board's grid-corner default — so picking is an
 * optional refinement, not a required step.
 *
 * Shared by every tab (planar + stereo). Stereo ChArUco defines the frame on camera 1
 * only (corner ids match across cameras). Stereo dotboard runs one picker per camera:
 * dotboard grid indices are re-zeroed per view, so camera 2's origin/+X/+Y must mark the
 * same physical dots as camera 1's; camera 1's origin mm names the origin for both.
 */

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { MarkerPoint } from "@/components/viewer/zoomableCanvas";
import { postJson, errorMessage } from "@/lib/api";

export type WorldFrameRole = "origin" | "x_axis" | "y_axis";

export interface WorldFrameClicks {
  origin: [number, number];
  x_axis: [number, number];
  y_axis: [number, number];
  origin_mm: [number, number];
}

interface UseWorldFrameArgs {
  board: string;
  camera: number;
  sourcePathIdx: number;
  datumFrame: number;
  boardParams: () => Record<string, unknown>;
  imageFormat: string;
  imageType: string;
}

/** A typed mm coordinate: the number, or null when blank / not a number (never a silent 0). */
const mmOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

const ROLE_STYLE: Record<WorldFrameRole, { label: string; color: string }> = {
  origin: { label: "Origin", color: "#22c55e" },
  x_axis: { label: "+X", color: "#ef4444" },
  y_axis: { label: "+Y", color: "#3b82f6" },
};

export function useWorldFrame({
  board, camera, sourcePathIdx, datumFrame, boardParams, imageFormat, imageType,
}: UseWorldFrameArgs) {
  const [mode, setMode] = useState<WorldFrameRole | "none">("none");
  const [clicks, setClicks] = useState<Partial<Record<WorldFrameRole, [number, number]>>>({});
  const [originMmX, setOriginMmX] = useState("0");
  const [originMmY, setOriginMmY] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // True once the datum view has been detected, so the dots exist to snap/pick against.
  const [ready, setReady] = useState(false);

  // Detect the datum view so snap_fiducial has a cached detection to snap to.
  const prepare = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson("/backend/calibration/detect_datum", {
        camera, source_path_idx: sourcePathIdx, datum_frame: datumFrame, board,
        board_params: boardParams(), image_format: imageFormat, image_type: imageType,
      });
      if (!data.success) setError(data.error || "Board not detected on the datum frame");
      setReady(!!data.success);
      return !!data.success;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [camera, sourcePathIdx, datumFrame, board, boardParams, imageFormat, imageType]);

  const startPick = useCallback(async (role: WorldFrameRole) => {
    if (ready) { setMode(role); return; }
    const ok = await prepare();
    if (ok) setMode(role);
  }, [ready, prepare]);

  const handlePoint = useCallback(async (px: number, py: number) => {
    if (mode === "none") return;
    const role = mode;
    setMode("none");
    try {
      // The datum identity is sent so the backend can refuse a snap against another view's
      // cached detection.
      const data = await postJson("/backend/calibration/snap_fiducial", {
        camera, click_x: px, click_y: py, source_path_idx: sourcePathIdx, board, datum_frame: datumFrame,
      });
      if (data.snapped_x !== undefined) {
        setClicks(prev => ({ ...prev, [role]: [data.snapped_x, data.snapped_y] }));
        // Auto-advance origin -> +X -> +Y so a single "Set Origin" starts the sequence.
        if (role === "origin") setMode("x_axis");
        else if (role === "x_axis") setMode("y_axis");
      } else {
        setError(data.error || "Could not snap to a detected dot");
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [mode, camera, sourcePathIdx, board, datumFrame]);

  const clear = useCallback(() => {
    setClicks({});
    setMode("none");
    setError(null);
  }, []);

  // Restore a saved frame (from a loaded model) so the picked origin/+X/+Y + origin mm
  // re-appear without re-picking. Marks ready so the markers + mm inputs render.
  const restore = useCallback((wfData: {
    mode?: string;
    origin?: [number, number] | null;
    x_axis?: [number, number] | null;
    y_axis?: [number, number] | null;
    origin_mm?: [number, number] | null;
  } | null) => {
    if (!wfData || wfData.mode !== "clicks" || !wfData.origin) return;
    const c: Partial<Record<WorldFrameRole, [number, number]>> = { origin: wfData.origin };
    if (wfData.x_axis) c.x_axis = wfData.x_axis;
    if (wfData.y_axis) c.y_axis = wfData.y_axis;
    setClicks(c);
    if (wfData.origin_mm) {
      setOriginMmX(String(wfData.origin_mm[0]));
      setOriginMmY(String(wfData.origin_mm[1]));
    }
    setReady(true);
    setMode("none");
    setError(null);
  }, []);

  // Reset picked points + readiness when the view they were picked on changes.
  useEffect(() => {
    setClicks({});
    setMode("none");
    setError(null);
    setReady(false);
  }, [camera, sourcePathIdx, datumFrame]);

  // The origin's world mm, once the origin is placed. Invalid input blocks the frame: it is
  // never sent as 0.
  const mmX = mmOrNull(originMmX);
  const mmY = mmOrNull(originMmY);
  const originMmError = clicks.origin && (mmX === null || mmY === null)
    ? `Origin ${mmX === null ? "X" : "Y"} must be a number in mm`
    : null;
  // Complete = all three picks AND a valid origin mm, so Generate stays blocked otherwise.
  const picksComplete = !!(clicks.origin && clicks.x_axis && clicks.y_axis);
  const complete = picksComplete && originMmError === null;
  const payload: WorldFrameClicks | null = complete && mmX !== null && mmY !== null
    ? {
        origin: clicks.origin!, x_axis: clicks.x_axis!, y_axis: clicks.y_axis!,
        origin_mm: [mmX, mmY],
      }
    : null;

  return {
    mode, setMode, clicks, startPick, handlePoint, clear, restore, prepare, error, busy, complete, payload,
    ready, originMmX, originMmY, setOriginMmX, setOriginMmY, originMmError,
  };
}

export type WorldFrameState = ReturnType<typeof useWorldFrame>;

/** Markers for the viewer overlay (always shown so the picked frame is visible). */
export function getWorldFrameMarkers(wf: WorldFrameState): MarkerPoint[] {
  const out: MarkerPoint[] = [];
  (Object.keys(ROLE_STYLE) as WorldFrameRole[]).forEach(role => {
    const p = wf.clicks[role];
    if (p) out.push({ x: p[0], y: p[1], color: ROLE_STYLE[role].color, label: ROLE_STYLE[role].label });
  });
  return out;
}

/** Inline controls for the viewer settings bar (and a standalone status line).
 *
 * Picking is disabled until the dots are detected (``wf.ready``). The user picks
 * the origin, which auto-advances to +X then +Y; the origin's world (X, Y) mm can
 * be typed once it is placed. ``getWorldFrameMarkers`` paints the picked points.
 */
export function WorldFrameControls({ wf, label = "World frame:", showOriginMm = true }: {
  wf: WorldFrameState;
  /** Lead-in text, e.g. "Cam 2 frame:" when a tab runs one picker per camera. */
  label?: string;
  /** Off for a second camera, whose origin mm is camera 1's. */
  showOriginMm?: boolean;
}) {
  const pickBtn = (role: WorldFrameRole) => {
    const picked = !!wf.clicks[role];
    const active = wf.mode === role;
    return (
      <Button
        key={role}
        type="button"
        size="sm"
        variant={active ? "default" : picked ? "secondary" : "outline"}
        onClick={() => wf.startPick(role)}
        disabled={wf.busy}
        className="h-7 px-2 text-xs"
        style={picked ? { borderColor: ROLE_STYLE[role].color } : undefined}
      >
        {wf.busy && active && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
        {picked ? "✓ " : "Set "}{ROLE_STYLE[role].label}
      </Button>
    );
  };

  const any = wf.clicks.origin || wf.clicks.x_axis || wf.clicks.y_axis;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-xs text-muted-foreground">{label}</span>
      {wf.busy && <span className="text-xs text-muted-foreground">detecting…</span>}
      {!wf.busy && !wf.ready && (
        <span className="text-xs text-muted-foreground">click Set Origin, then click the dot</span>
      )}
      {(Object.keys(ROLE_STYLE) as WorldFrameRole[]).map(pickBtn)}
      {showOriginMm && wf.clicks.origin && (
        <span className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground ml-1">X:</span>
          <input
            type="text"
            inputMode="numeric"
            value={wf.originMmX}
            onChange={e => wf.setOriginMmX(e.target.value)}
            className="w-12 h-6 text-xs border rounded px-1"
          />
          <span className="text-xs text-muted-foreground">Y:</span>
          <input
            type="text"
            inputMode="numeric"
            value={wf.originMmY}
            onChange={e => wf.setOriginMmY(e.target.value)}
            className="w-12 h-6 text-xs border rounded px-1"
          />
          <span className="text-xs text-muted-foreground">mm</span>
        </span>
      )}
      {any && (
        <Button type="button" size="sm" variant="ghost" onClick={wf.clear} className="h-7 px-2 text-xs">
          Clear
        </Button>
      )}
      {wf.complete && <span className="text-xs text-green-600">frame set</span>}
      {showOriginMm && wf.originMmError && <span className="text-xs text-red-600">{wf.originMmError}</span>}
      {wf.error && <span className="text-xs text-red-600">{wf.error}</span>}
    </div>
  );
}
