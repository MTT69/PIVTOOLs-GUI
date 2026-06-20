"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, Link2, X, Undo2, Crosshair } from "lucide-react";
import CalibrationImageViewer, { FrameDetectionData } from "@/components/viewer/CalibrationImageViewer";
import { MarkerPoint } from "@/components/viewer/zoomableCanvas";
import {
  useJointCalibration,
  JointJobStatus,
  JointModel,
  JointCameraParams,
  JointPolynomialParams,
  OrientationCandidate,
} from "@/hooks/useJointCalibration";
import { useJointGridSpec, GuideAction, GuideStatus, MIN_LINK_PAIRS } from "@/hooks/useJointGridSpec";
import { MultiCameraJobStatus } from "@/hooks/useDotboardCalibration";
import { getWorldFrameMarkers } from "@/components/setup/WorldFrameSetup";
import { CalibrationFigureGallery } from "@/components/setup/CalibrationFigureGallery";

interface JointMultiCameraProps {
  board: "charuco" | "dotboard";
  cameraOptions: number[];
  sourcePathIdx: number;
  numImages: number;
  imageFormat: string;
  imageType: string;
  modelType: "pinhole" | "polynomial";
  validationValid: boolean;
  // Datum frame (1-based) inherited from the page's "Datum Frame" setting — the joint wizard does
  // not re-ask for it.
  datumFrame?: number;
  // Dotboard-only: the global grid needs a clicked datum + per-view anchors, persisted to the
  // sidecar inputs.mat by useJointGridSpec. ChArUco needs none of this (corner ids give the grid).
  dotSpacingMm?: number;
  // Apply-to-vectors, threaded down from the parent tab's calibration hook (shared with the
  // single-camera button). Applies each camera's joint 2D model to its PIV vectors — planar, not
  // 3C. Optional so the component is inert if a parent does not wire it.
  calibrateVectors?: (forAllCameras: boolean, typeName: string, activePaths?: number[]) => void;
  vectorJobStatus?: MultiCameraJobStatus | null;
  isVectorCalibrating?: boolean;
}

/** The dominant global-index direction of an extend hint, as a signed-axis tag (+X / −X / +Y / −Y) —
 * kept as a small technical detail so the two chips stay distinguishable even on a symmetric rig. */
function extendTag(extend: [number, number]): string {
  const [dx, dy] = extend;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "+X" : "−X";
  return dy >= 0 ? "+Y" : "−Y";
}

/**
 * How much an orientation candidate overlaps the already-tied cameras, in grid columns, and with
 * which camera most. The fold folds a whole camera back over a tied one (large overlap); the true
 * side-by-side layout shares only the thin bridge strip (small overlap) — so the overlap count is
 * what tells them apart. `cam` is -1 when the footprint clears every tied camera entirely.
 */
function overlapWithTied(
  cand: OrientationCandidate,
  camera: number,
  extents: Record<number, { gx: [number, number]; gy: [number, number] }>,
): { cam: number; cols: number } {
  let cam = -1;
  let cols = 0;
  for (const [k, e] of Object.entries(extents)) {
    const c = Number(k);
    if (c === camera) continue;
    const oc = Math.min(cand.gx_range[1], e.gx[1]) - Math.max(cand.gx_range[0], e.gx[0]) + 1;
    const or = Math.min(cand.gy_range[1], e.gy[1]) - Math.max(cand.gy_range[0], e.gy[0]) + 1;
    if (oc > 0 && or > 0 && oc > cols) {
      cols = oc;
      cam = c;
    }
  }
  return { cam, cols };
}

/** One camera pair's ChArUco overlap: how many global corner ids both cameras see. */
interface CharucoLink {
  a: number;
  b: number;
  shared: number;
}

/** Are all cameras joined into one component by edges with ≥ 2 shared corners? (union-find) */
function camerasConnected(cams: number[], edges: CharucoLink[]): boolean {
  if (cams.length < 2) return true;
  const parent = new Map<number, number>(cams.map((c) => [c, c]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const e of edges) {
    if (e.shared < 2) continue;
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const root = find(cams[0]);
  return cams.every((c) => find(c) === root);
}

/**
 * Joint multi-camera calibration UI, shown automatically whenever ≥ 2 cameras are configured
 * (no toggle — multi-camera is always a joint solve). One shared board every camera observes,
 * tied by a global dot index, so all cameras agree on the same physical board by construction.
 *
 * ChArUco resolves the grid from corner ids with zero clicks. Dotboard is anchored by the user:
 *   1. Datum world frame — origin / +X / +Y on the datum camera's datum image.
 *   2. The datum camera's other images — click the same origin dot once each.
 *   3. Every other camera — two shared dots per image, tying it into the grid (a "bridge").
 * Preview detects every image and draws the live (gx, gy) mesh so the anchoring can be verified.
 */
export const JointMultiCamera: React.FC<JointMultiCameraProps> = ({
  board,
  cameraOptions,
  sourcePathIdx,
  numImages,
  imageFormat,
  imageType,
  modelType,
  validationValid,
  datumFrame,
  dotSpacingMm = 0,
  calibrateVectors,
  vectorJobStatus,
  isVectorCalibrating,
}) => {
  const {
    resolveData,
    resolving,
    jobStatus,
    generating,
    model,
    error,
    resolveGrid,
    generate,
    loadModel,
    clearResolve,
  } = useJointCalibration();

  const [viewerCamera, setViewerCamera] = useState<number>(cameraOptions[0] ?? 1);
  const [currentFrame, setCurrentFrame] = useState<number>(1);
  const [showViewer, setShowViewer] = useState(false);

  // getCameraOptions() can return a fresh array each parent render; key effects off the stable
  // comma-string so they don't refire (clearing the overlay / re-fetching the model) every render.
  const camerasKey = cameraOptions.join(",");
  const cameras = useMemo(() => (camerasKey ? camerasKey.split(",").map(Number) : []), [camerasKey]);

  const handleFrameChange = useCallback((idx: number) => setCurrentFrame(idx), []);

  const isDotboard = board === "dotboard";

  // The 0-based datum VIEW the joint solve anchors on, from the page's 1-based "Datum Frame" field.
  // Defined once here so the request body (what the solve uses) and the datum guard (what the UI
  // checks) can never drift to different views.
  const charucoDatumView = Math.max(0, (datumFrame ?? 1) - 1);

  // Client-side snap of a viewer click to the nearest detected dot in (camera, view) — uses the
  // pixels resolve_grid already returns, so the link/origin clicks land on a real dot.
  const snapTo = useCallback(
    (cam: number, view: number, px: number, py: number): [number, number] | null => {
      const v = resolveData?.views.find((x) => x.camera === cam && x.view === view);
      if (!v || v.points.length === 0) return null;
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < v.points.length; i++) {
        const dx = v.points[i][0] - px;
        const dy = v.points[i][1] - py;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best < 0 ? null : [v.points[best][0], v.points[best][1]];
    },
    [resolveData],
  );

  const onSpecChange = useCallback(() => {
    /* spec changes drive a re-resolve through the specSig effect below */
  }, []);

  // Dotboard global-grid spec (datum + per-view anchors). For ChArUco this hook is inert (no clicks
  // are ever made), so it costs nothing but keeps the hook order stable.
  const grid = useJointGridSpec({
    cameras,
    sourcePathIdx,
    dotSpacingMm,
    imageFormat,
    imageType,
    snapTo,
    onSpecChange,
  });

  // PIV result type for the Calibrate Vectors apply (mirrors the single-camera tab's selector).
  const [vectorTypeName, setVectorTypeName] = useState<"instantaneous" | "ensemble">("instantaneous");

  // Keep the viewer camera valid as the configured camera set changes.
  useEffect(() => {
    if (cameras.length > 0 && !cameras.includes(viewerCamera)) {
      setViewerCamera(cameras[0]);
    }
  }, [cameras, viewerCamera]);

  // Inherit the datum frame from the page's "Datum Frame" setting — the wizard does not re-ask.
  // The initial value is adopted silently (the hook restores datum_view from config); only a later
  // user change drives setDatumView (which resets the spec, since the datum moved).
  const datumFrameRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!isDotboard || datumFrame == null) return;
    if (datumFrameRef.current === undefined) { datumFrameRef.current = datumFrame; return; }
    if (datumFrame === datumFrameRef.current) return;
    datumFrameRef.current = datumFrame;
    const target = datumFrame - 1;
    if (target >= 0 && target !== grid.datumView) grid.setDatumView(target);
  }, [isDotboard, datumFrame, grid.datumView, grid.setDatumView]);

  // Auto-detect the datum view whenever the viewer is open, so world-frame clicks snap immediately.
  // This replaces the old manual "Detect Dots" button — Preview already detects + draws the grid.
  useEffect(() => {
    if (isDotboard && showViewer && validationValid && !grid.wf.ready && !grid.wf.busy) {
      void grid.wf.prepare();
    }
  }, [isDotboard, showViewer, validationValid, grid.wf.ready, grid.wf.busy, grid.wf]);

  // The grid resolution is only valid for the spec it was computed from — drop it when the inputs
  // that feed the spec change, so the overlay never shows a stale grid.
  useEffect(() => {
    clearResolve();
  }, [board, sourcePathIdx, numImages, imageFormat, imageType, camerasKey, clearResolve]);

  // Load any saved joint model for display (and refresh after a generate completes).
  const modelQuery = useMemo(
    () => ({ board, source_path_idx: sourcePathIdx, model_type: modelType, cameras: camerasKey }),
    [board, sourcePathIdx, modelType, camerasKey],
  );
  useEffect(() => {
    loadModel(modelQuery);
  }, [loadModel, modelQuery]);

  const requestBody = useCallback((): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      board,
      source_path_idx: sourcePathIdx,
      cameras,
      n_views: numImages,
      image_format: imageFormat,
      image_type: imageType,
      model_type: modelType,
    };
    if (isDotboard) {
      base.global_grid = grid.specBlock;
      base.datum_camera = grid.datumCamera;
      base.datum_view = grid.datumView;
    } else {
      // ChArUco: corner ids build the grid (no spec), but the solve still anchors on a datum view.
      // Honour the page's "Datum Frame" field as that view (it was otherwise silently ignored).
      base.datum_camera = cameras[0];
      base.datum_view = charucoDatumView;
    }
    return base;
  }, [board, sourcePathIdx, cameras, numImages, imageFormat, imageType, modelType, isDotboard,
      charucoDatumView, grid.specBlock, grid.datumCamera, grid.datumView]);

  // Preview = detect every image + resolve the live grid, AND cache the datum detection so
  // world-frame clicks snap immediately. Detections are cached (in memory + on disk), so the first
  // Preview is the only slow one — re-opening is instant. `refresh` re-detects from disk (Re-detect).
  const preview = useCallback(async (refresh: boolean) => {
    setShowViewer(true);
    await Promise.all([
      resolveGrid({ ...requestBody(), ...(refresh ? { refresh: true } : {}) }),
      isDotboard ? grid.wf.prepare() : Promise.resolve(true),
    ]);
  }, [resolveGrid, requestBody, isDotboard, grid.wf]);
  const handlePreview = useCallback(() => preview(false), [preview]);
  // Views the guide could not include because their dots aren't detected — shown to the user so a
  // skipped frame/camera is never a silent jump.
  const [skippedViews, setSkippedViews] = useState<Array<{ camera: number; frame: number }>>([]);
  const handleRedetect = useCallback(() => {
    setSkippedViews([]); // detection may now succeed where it failed before
    return preview(true);
  }, [preview]);

  // Dotboard: re-resolve the live overlay whenever the committed spec changes (datum set, a view
  // anchored, a camera bridged). Only once the datum frame exists.
  const specSig = isDotboard ? JSON.stringify(grid.specBlock) : "";
  useEffect(() => {
    if (!isDotboard || !validationValid || cameras.length === 0) return;
    if (!grid.specBlock.datum_clicks) return;
    void resolveGrid({ ...requestBody() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specSig, isDotboard, validationValid, cameras.length, numImages, imageFormat, imageType]);

  // Auto-open the viewer when a dotboard pick is active, so clicks have somewhere to land.
  useEffect(() => {
    if (isDotboard && grid.selectActive && !showViewer) setShowViewer(true);
  }, [isDotboard, grid.selectActive, showViewer]);

  // While a pick/guide is active the viewer is driven to the wizard's target camera/frame.
  const guideTargetCam = isDotboard && grid.viewerTarget ? grid.viewerTarget.camera : null;
  const guideTargetFrame = isDotboard && grid.viewerTarget ? grid.viewerTarget.frame : null;

  // The user may toggle to another camera to inspect a dot already placed, without losing their
  // place in the walk: `inspectCamera` overrides the target camera (the frame is still held at the
  // target frame), and resets whenever the target advances — so the next step snaps them back. The
  // live crosshair (pickMarkers) only renders on the awaited image, so it vanishes off-target and
  // reappears on return. Off a pick/guide the toggle just sets the freely-browsable camera.
  const [inspectCamera, setInspectCamera] = useState<number | null>(null);
  useEffect(() => {
    setInspectCamera(null);
  }, [guideTargetCam, guideTargetFrame]);
  const pickCamera = useCallback(
    (cam: number) => {
      if (guideTargetCam != null) setInspectCamera(cam === guideTargetCam ? null : cam);
      else setViewerCamera(cam);
    },
    [guideTargetCam],
  );

  const effectiveCamera = guideTargetCam != null ? inspectCamera ?? guideTargetCam : viewerCamera;
  const view = currentFrame - 1;

  // Selection is PAUSED unless the displayed image is exactly the one the active pick expects. While
  // inspecting another camera or scrubbed to another frame, clicks do nothing (and never land on the
  // wrong image) — they resume the moment the user returns to the awaited camera + frame.
  const onTargetImage =
    !grid.viewerTarget ||
    (effectiveCamera === grid.viewerTarget.camera && currentFrame === grid.viewerTarget.frame);
  const selectionPaused = isDotboard && grid.selectActive && !onTargetImage;
  const pointSelectMode = isDotboard && grid.selectActive && onTargetImage;

  // ── Resolution bookkeeping from the live grid ──
  const perCam = useMemo(() => {
    const m: Record<number, { resolved: number; total: number }> = {};
    resolveData?.views.forEach((v) => {
      const e = (m[v.camera] = m[v.camera] || { resolved: 0, total: 0 });
      e.total += 1;
      if (v.resolved) e.resolved += 1;
    });
    return m;
  }, [resolveData]);
  const allResolved = resolveData != null && resolveData.n_resolved === resolveData.n_views_total;
  const everyCameraTied = cameras.every((c) => (perCam[c]?.resolved ?? 0) > 0);

  // Global column/row span already pinned for each resolved camera — context for the picker so the
  // user can see where each candidate footprint sits relative to the cameras that are tied.
  const resolvedExtents = useMemo(() => {
    const m: Record<number, { gx: [number, number]; gy: [number, number] }> = {};
    resolveData?.views.forEach((v) => {
      if (!v.resolved || !v.global_index?.length) return;
      const xs = v.global_index.map((g) => g[0]);
      const ys = v.global_index.map((g) => g[1]);
      const e = (m[v.camera] = m[v.camera] || {
        gx: [Infinity, -Infinity] as [number, number],
        gy: [Infinity, -Infinity] as [number, number],
      });
      e.gx = [Math.min(e.gx[0], ...xs), Math.max(e.gx[1], ...xs)];
      e.gy = [Math.min(e.gy[0], ...ys), Math.max(e.gy[1], ...ys)];
    });
    return m;
  }, [resolveData]);

  // Thin-overlap cameras the dots can't orient (mirror ambiguity) — one picker per camera (the hint
  // is per-camera, so the first candidate-bearing view settles every view of that camera). Each
  // candidate is enriched with how it sits relative to the tied cameras: the layout with the LARGEST
  // overlap is the fold (a camera mirrored back on top of a tied one); the smaller-overlap layout is
  // the real side-by-side board. That fold flag is what the chip labels lead with.
  const ambiguousCameras = useMemo(() => {
    const seen = new Set<number>();
    const out: Array<{
      camera: number;
      view: number;
      candidates: Array<{
        cand: OrientationCandidate;
        overlapCam: number;
        overlapCols: number;
        isFold: boolean;
      }>;
    }> = [];
    resolveData?.views.forEach((v) => {
      if (seen.has(v.camera) || (v.candidates?.length ?? 0) < 2) return;
      seen.add(v.camera);
      const enr = v.candidates!.map((cand) => {
        const o = overlapWithTied(cand, v.camera, resolvedExtents);
        return { cand, overlapCam: o.cam, overlapCols: o.cols };
      });
      const maxCols = Math.max(...enr.map((e) => e.overlapCols));
      const minCols = Math.min(...enr.map((e) => e.overlapCols));
      // Only call one a fold when the overlaps genuinely differ — on a symmetric rig (equal overlap
      // both ways) neither is flagged and the chips fall back to the direction tag.
      out.push({
        camera: v.camera,
        view: v.view,
        candidates: enr.map((e) => ({
          ...e,
          isFold: maxCols > minCols && e.overlapCols === maxCols,
        })),
      });
    });
    return out;
  }, [resolveData, resolvedExtents]);

  // ── Viewer overlay ──
  // Mesh (rings + red centres + grid lines) for the camera/frame shown, built from the resolved
  // grid. Unresolved views still show their raw detected dots (no lines) so they can be clicked.
  const jointDetections = useMemo<Record<number, FrameDetectionData> | undefined>(() => {
    if (!resolveData) return undefined;
    const out: Record<number, FrameDetectionData> = {};
    for (const v of resolveData.views) {
      if (v.camera !== effectiveCamera) continue;
      // Prefer the global index once the view is resolved; otherwise fall back to the detector's
      // local grid so the mesh is visible immediately on Preview (connectivity is the same).
      const idx = v.resolved && v.global_index ? v.global_index : v.grid_indices ?? undefined;
      out[v.view + 1] = {
        grid_points: v.points as [number, number][],
        grid_indices: idx ? (idx as [number, number][]) : undefined,
      };
    }
    return Object.keys(out).length ? out : undefined;
  }, [resolveData, effectiveCamera]);

  // World-frame markers (datum view) + in-progress bridge pick markers.
  const selectedMarkers = useMemo<MarkerPoint[]>(() => {
    if (!isDotboard) return [];
    const onDatum = effectiveCamera === grid.datumCamera && view === grid.datumView;
    return [
      ...(onDatum ? getWorldFrameMarkers(grid.wf) : []),
      ...grid.anchorMarkers(effectiveCamera, currentFrame),
      ...grid.pickMarkers(effectiveCamera, currentFrame),
    ];
  }, [isDotboard, effectiveCamera, view, currentFrame, grid]);

  // Per-view status for the current (camera, frame).
  const currentViewInfo = useMemo(() => {
    if (!isDotboard || !resolveData) return null;
    const v = resolveData.views.find((x) => x.camera === effectiveCamera && x.view === view);
    return v ? { resolved: v.resolved, reason: v.reason ?? null } : null;
  }, [isDotboard, resolveData, effectiveCamera, view]);

  // ChArUco auto-link: which global corner ids each camera sees, and how many it shares with each
  // other camera. Corner ids are globally consistent, so this is computed straight from the resolved
  // grid (no clicks) — it confirms the cross-camera linking the dotboard would need bridges for.
  const charucoLinks = useMemo(() => {
    if (isDotboard || !resolveData) return null;
    const perCam = new Map<number, Set<string>>();
    for (const v of resolveData.views) {
      if (!v.global_index || v.global_index.length === 0) continue;
      let s = perCam.get(v.camera);
      if (!s) { s = new Set<string>(); perCam.set(v.camera, s); }
      for (const g of v.global_index) s.add(`${g[0]},${g[1]}`);
    }
    const cams = [...perCam.keys()].sort((a, b) => a - b);
    const links: CharucoLink[] = [];
    for (let i = 0; i < cams.length; i++)
      for (let j = i + 1; j < cams.length; j++) {
        const A = perCam.get(cams[i])!;
        const B = perCam.get(cams[j])!;
        let n = 0;
        for (const k of A) if (B.has(k)) n++;
        if (n > 0) links.push({ a: cams[i], b: cams[j], shared: n });
      }
    return { cams, links, connected: camerasConnected(cams, links) };
  }, [isDotboard, resolveData]);

  // EVERY camera must have detected the datum view, not just the datum camera: run_joint (and
  // run_joint_polynomial) raise unless each camera has a pose at the datum board position
  // (joint.py "cameras {…} did not observe the datum view"). Guard it here, naming the offenders,
  // so the user gets a clear message instead of a bare solver error.
  const charucoDatumMissing = useMemo(() => {
    if (isDotboard || !resolveData) return [];
    return cameras.filter((c) => {
      const v = resolveData.views.find((x) => x.camera === c && x.view === charucoDatumView);
      return !(v && v.points.length > 0);
    });
  }, [isDotboard, resolveData, cameras, charucoDatumView]);
  const charucoDatumOk = charucoDatumMissing.length === 0;

  const dotboardReady = grid.datumComplete && everyCameraTied;
  const canGenerate =
    validationValid && cameras.length >= 2 && !generating &&
    (isDotboard ? dotboardReady : !!resolveData && charucoDatumOk);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return; // invariant lives with the action, not just the disabled prop
    await generate(requestBody(), () => loadModel(modelQuery));
  }, [canGenerate, generate, requestBody, loadModel, modelQuery]);

  // Build the guided walk. Frame-major, camera-inner: every frame is completed across ALL cameras
  // before the walk moves to the next frame. Per non-datum frame, in order: the datum camera's origin
  // click, then a 2-shared-dot bridge that ties each remaining camera to its ALREADY-RESOLVED
  // neighbour, walking OUTWARD from the datum — cam(d+1)←datum, cam(d+2)←cam(d+1), and likewise on the
  // datum's other side. This matches a linear rig's real overlap chain (cam1–cam2–cam3): a camera
  // shares dots only with its neighbour, never necessarily with the datum, so bridging everything to
  // the datum (a star) would ask for shared dots that do not exist. Adjacency is sorted-camera order,
  // the same convention generatePairs() uses. The backend resolver (resolve_global_grid) stitches the
  // chain with a fixpoint pass, so a reference need only be resolved earlier in the walk — the outward
  // order guarantees that. The datum frame goes first so the cross-camera orientation is fixed before
  // the per-frame origins; on it the world frame already sets the origin, so no origin click.
  //
  // A guided run is a deliberate full pass — it re-walks every detected view regardless of any saved
  // anchor (re-clicking overwrites it cleanly), so pressing the button never silently jumps a step.
  // A view whose dots aren't detected CAN'T be snapped (nor can a camera whose inward neighbour is
  // missing, since the chain breaks there); it is recorded in `skipped` and surfaced to the user (a
  // visible notice) rather than dropped in silence.
  const buildGuideActions = useCallback((): {
    actions: GuideAction[];
    skipped: Array<{ camera: number; frame: number }>;
  } => {
    if (!resolveData) return { actions: [], skipped: [] };
    const detected = (cam: number, vw: number) =>
      resolveData.views.some((x) => x.camera === cam && x.view === vw && x.points.length > 0);
    const c0 = grid.datumCamera;
    const sorted = [...cameras].sort((a, b) => a - b);
    const datumIdx = sorted.indexOf(c0);
    const frames = [
      grid.datumView,
      ...Array.from({ length: numImages }, (_, i) => i).filter((v) => v !== grid.datumView),
    ];
    // Step 0: define the world frame (origin/+X/+Y) on the datum camera's datum view — the start of
    // the single clean flow, so the user no longer presses a separate Origin button first.
    const actions: GuideAction[] = [{ kind: "datum", camera: c0, view: grid.datumView }];
    const skipped: Array<{ camera: number; frame: number }> = [];
    // Bridge along one side of the chain at frame f: each camera references the neighbour one step
    // closer to the datum (already resolved by the time we reach it). A missing detection breaks the
    // chain, so that camera and everything beyond it on this side is skipped.
    const emitSide = (indices: number[], f: number) => {
      let refCamera = c0;
      let chainOk = true;
      for (const i of indices) {
        const ci = sorted[i];
        if (chainOk && detected(ci, f)) {
          actions.push({ kind: "bridge", camera: ci, view: f, refCamera, minPairs: MIN_LINK_PAIRS });
          refCamera = ci;
        } else {
          skipped.push({ camera: ci, frame: f + 1 });
          chainOk = false;
        }
      }
    };
    for (const f of frames) {
      if (!detected(c0, f)) {
        // No datum-camera dots here — can't set this frame's origin or bridge against it.
        skipped.push({ camera: c0, frame: f + 1 });
        for (const ci of sorted) if (ci !== c0) skipped.push({ camera: ci, frame: f + 1 });
        continue;
      }
      if (f !== grid.datumView) actions.push({ kind: "origin", camera: c0, view: f });
      // Walk outward from the datum on each side so every bridge's reference is already resolved.
      emitSide(Array.from({ length: sorted.length - datumIdx - 1 }, (_, k) => datumIdx + 1 + k), f);
      emitSide(Array.from({ length: datumIdx }, (_, k) => datumIdx - 1 - k), f);
    }
    return { actions, skipped };
  }, [resolveData, grid, cameras, numImages]);

  const handleSetGlobalCoords = useCallback(() => {
    const { actions, skipped } = buildGuideActions();
    setSkippedViews(skipped);
    grid.startGuide(actions);
  }, [grid, buildGuideActions]);

  return (
    <div className="space-y-5">
      {cameraOptions.length < 2 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Joint solve needs ≥ 2 cameras</AlertTitle>
              <AlertDescription>
                Configure multiple cameras in <code>camera_numbers</code> to use the joint
                multi-camera flow. For a single camera use the per-camera mono solve.
              </AlertDescription>
            </Alert>
          )}

          {/* Dotboard global-grid wizard (datum + per-view anchors + bridges) */}
          {isDotboard && cameraOptions.length >= 2 && (
            <DotboardGridWizard grid={grid} resolving={resolving} perCam={perCam} cameras={cameras} />
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={!validationValid || cameraOptions.length === 0 || resolving}
            >
              {resolving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
              Preview Image &amp; Grid
            </Button>
            {resolveData && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRedetect}
                disabled={resolving}
                title="Re-detect from the images on disk (use after changing the calibration images)"
              >
                Re-detect
              </Button>
            )}
            {isDotboard && resolveData && !grid.guideActive && (
              <Button
                size="sm"
                onClick={handleSetGlobalCoords}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                title="One guided flow: world frame (origin/+X/+Y), then the shared dots across every camera and frame — auto-advances"
              >
                Set Global Coordinates
              </Button>
            )}
            {isDotboard && !grid.guideActive && (grid.datumComplete || grid.anchors.length > 0) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (
                    window.confirm(
                      "Clear the datum world frame and every anchored dot? You will re-pick the global coordinates from scratch.",
                    )
                  ) {
                    grid.clearAll();
                    setSkippedViews([]);
                  }
                }}
                className="text-red-600 hover:text-red-700"
                title="Wipe the datum frame + all anchors and start the global-coordinate setup over"
              >
                <X className="h-4 w-4 mr-1" /> Clear global coordinates
              </Button>
            )}
            {showViewer && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowViewer(false)}
                className="flex items-center gap-1"
              >
                <EyeOff className="h-4 w-4" /> Hide Viewer
              </Button>
            )}
            {!showViewer && resolveData && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowViewer(true)}
                className="flex items-center gap-1"
              >
                <Eye className="h-4 w-4" /> Show Viewer
              </Button>
            )}
          </div>

          {/* Resolve status — a real failure (detection error, no cameras) shows in both modes; the
              dotboard incomplete-spec `errors` noise is suppressed (the wizard guides instead). */}
          {error && (
            <div className="text-sm text-red-600 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}
          {resolveData && (
            <div className="text-sm space-y-1">
              <div className="flex items-center gap-2">
                {allResolved ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
                <span>
                  Resolved <strong>{resolveData.n_resolved}</strong> / {resolveData.n_views_total}{" "}
                  views &middot; spacing {resolveData.spacing_mm.toFixed(2)} mm
                </span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pl-6">
                {cameraOptions.map((cam) => {
                  const c = perCam[cam];
                  return (
                    <span key={cam}>
                      cam{cam}: {c ? `${c.resolved}/${c.total}` : "0/0"}
                    </span>
                  );
                })}
              </div>
              {resolveData.errors.length > 0 && !isDotboard && (
                <div className="text-xs text-red-600 pl-6">
                  {resolveData.errors.map((e, i) => (
                    <div key={i}>{e}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ChArUco auto-link confirmation. Corner ids are globally consistent, so the cameras are
              tied into one world frame with no manual bridges; the shared-corner counts confirm the
              cameras image a common region. (The solve also localizes each camera against the shared
              board directly, so overlap is reassurance, not a hard requirement.) */}
          {!isDotboard && resolveData && charucoLinks && (
            <Alert className={charucoLinks.connected ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}>
              <AlertTitle className="text-sm flex items-center gap-1">
                {charucoLinks.connected ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
                Auto-linked by ChArUco corner id
              </AlertTitle>
              <AlertDescription className="text-xs space-y-1">
                <div className="flex flex-wrap gap-3">
                  {charucoLinks.links.length > 0 ? (
                    charucoLinks.links.map((l) => (
                      <span key={`${l.a}-${l.b}`}>
                        cam{l.a} &cap; cam{l.b}: <strong>{l.shared}</strong> shared corners
                      </span>
                    ))
                  ) : (
                    <span>cameras share no corners — each still localizes against the board independently</span>
                  )}
                </div>
                <div className="text-muted-foreground">
                  Corner ids place every camera in one world frame automatically — no manual bridges.
                  World origin = corner id 0; axes follow the board grid.
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* ChArUco datum guard — the anchor view must have detected, else the solve has nothing
              to anchor on. Clear message instead of a bare run_joint ValueError. */}
          {!isDotboard && resolveData && !charucoDatumOk && (
            <Alert className="border-red-300 bg-red-50">
              <AlertDescription className="text-sm text-red-700">
                Datum frame {charucoDatumView + 1} detected no board in{" "}
                {charucoDatumMissing.map((c) => `cam${c}`).join(", ")}. Every camera must have a pose
                at the datum frame, so the joint solve cannot run. Choose a datum frame they all
                detect (or re-detect those images).
              </AlertDescription>
            </Alert>
          )}

          {/* Current view resolution status (dotboard) */}
          {showViewer && isDotboard && currentViewInfo && (
            <div className="text-xs flex items-center gap-1">
              {currentViewInfo.resolved ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span className="text-green-700">
                    Cam{effectiveCamera} frame {currentFrame}: resolved
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  <span className="text-amber-700">
                    Cam{effectiveCamera} frame {currentFrame}: not anchored
                    {currentViewInfo.reason ? ` — ${currentViewInfo.reason}` : ""}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Guided walk banner — the live prompt for the current step. */}
          {isDotboard && grid.guideActive && grid.guideStatus && (
            <GuideBanner
              status={grid.guideStatus}
              onUndo={grid.undoLast}
              canUndo={!!grid.link}
              onSkip={grid.skipGuideStep}
              onCancel={grid.cancelGuide}
            />
          )}

          {/* Detection gaps the guided walk had to leave out — surfaced so a skipped frame/camera is
              never a silent jump. Re-detect (or replace the image) and run the flow again to include them. */}
          {isDotboard && skippedViews.length > 0 && (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertDescription className="text-sm text-amber-800">
                No dots were detected on{" "}
                {skippedViews
                  .map((s) => `cam ${s.camera} frame ${s.frame}`)
                  .join(", ")}
                , so the guided walk skipped {skippedViews.length === 1 ? "it" : "them"}. Re-detect or
                replace {skippedViews.length === 1 ? "that image" : "those images"}, then run{" "}
                <strong>Set Global Coordinates</strong> again to include {skippedViews.length === 1 ? "it" : "them"}.
              </AlertDescription>
            </Alert>
          )}

          {/* Thin-overlap orientation picker (confirm-on-overlay). When a camera's bridge leaves a
              mirror ambiguity the dots can't break, the user confirms which footprint is real; the
              choice writes camera_extends[cam] and re-resolves. */}
          {isDotboard && ambiguousCameras.map(({ camera, view: ambView, candidates }) => (
            <Alert key={camera} className="border-amber-300 bg-amber-50">
              <AlertTitle className="text-sm text-amber-900">
                Where is camera {camera} relative to the cameras already set?
              </AlertTitle>
              <AlertDescription className="text-sm text-amber-800 space-y-2">
                <div>
                  The overlap is too thin to tell from the dots alone — a mirror flip fits them just
                  as well. Pick the option that matches how your cameras are physically arranged.
                </div>
                <div className="flex flex-wrap gap-2">
                  {candidates.map(({ cand, overlapCam, overlapCols, isFold }, i) => {
                    const other = overlapCam >= 0 ? `camera ${overlapCam}` : "the cameras already set";
                    const headline = isFold
                      ? `Sits back on top of ${other}`
                      : `Continues alongside ${other}`;
                    const detail = isFold
                      ? `Mirror image — camera ${camera} would land on top of ${other} (overlapping ${overlapCols} columns). Usually wrong.`
                      : overlapCam >= 0
                        ? `Camera ${camera} extends past ${other}, sharing just ${overlapCols} column${overlapCols === 1 ? "" : "s"} — the thin seam of a side-by-side / stacked rig.`
                        : `Camera ${camera} sits clear of the cameras already set.`;
                    return (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        className="h-auto flex-col items-start gap-0.5 py-2 text-left max-w-[20rem] whitespace-normal"
                        onClick={() => grid.setCameraExtend(camera, cand.extend)}
                      >
                        <span className="font-medium">{headline}</span>
                        <span className="text-xs font-normal text-muted-foreground">{detail}</span>
                        <span className="text-[11px] font-mono text-muted-foreground/70">
                          grid cols {cand.gx_range[0]}–{cand.gx_range[1]} · {cand.n} dots ·{" "}
                          {extendTag(cand.extend)}
                        </span>
                      </Button>
                    );
                  })}
                </div>
                <div className="text-xs text-muted-foreground">
                  (Camera {camera} bridges in on frame {ambView + 1}.)
                </div>
              </AlertDescription>
            </Alert>
          ))}

          {/* Image viewer with the live mesh overlay + dotboard picking */}
          {showViewer && validationValid && (
            <CalibrationImageViewer
              backendUrl="/backend"
              sourcePathIdx={sourcePathIdx}
              camera={effectiveCamera}
              numImages={numImages}
              calibrationType={board}
              refreshKey={`joint-${board}-${sourcePathIdx}-${imageFormat}`}
              onFrameChange={handleFrameChange}
              savedDetections={jointDetections}
              showSavedOverlay={true}
              selectedMarkers={selectedMarkers}
              pointSelectMode={pointSelectMode}
              onPointSelect={
                isDotboard ? (px, py, cam, frame) => grid.handlePoint(px, py, cam, frame) : undefined
              }
              externalCamera={guideTargetCam != null ? effectiveCamera : undefined}
              externalFrame={guideTargetFrame != null ? guideTargetFrame : undefined}
              frameBarExtras={
                cameraOptions.length > 1 ? (
                  <CameraToggle
                    cameras={cameraOptions}
                    value={effectiveCamera}
                    onPick={pickCamera}
                    inspecting={isDotboard && grid.guideActive && inspectCamera != null}
                  />
                ) : undefined
              }
              settingsBarExtras={
                isDotboard && grid.guideActive ? (
                  selectionPaused ? (
                    <span className="text-xs text-amber-700 font-medium">
                      Paused — return to Camera {grid.viewerTarget?.camera}, frame{" "}
                      {grid.viewerTarget?.frame} to keep clicking
                    </span>
                  ) : (
                    <span className="text-xs text-blue-700 font-medium">
                      Guided setup — follow the prompt above
                    </span>
                  )
                ) : isDotboard && resolveData ? (
                  <span className="text-xs text-muted-foreground">
                    Press <strong>Set Global Coordinates</strong> to define the world frame and tie the cameras together
                  </span>
                ) : undefined
              }
            />
          )}

          {/* Generate */}
          <div className="border-t pt-4 space-y-3">
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              title={
                cameraOptions.length < 2
                  ? "Joint solve needs at least 2 cameras"
                  : !validationValid
                  ? "Fix the calibration image source first"
                  : isDotboard && !dotboardReady
                  ? "Set the datum frame and tie every camera into the grid first"
                  : undefined
              }
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Solving...
                </>
              ) : (
                "Generate Joint Model"
              )}
            </Button>
            {isDotboard && !dotboardReady && (
              <p className="text-xs text-muted-foreground">
                {!grid.datumComplete
                  ? "Set the datum world frame, then anchor each image, before generating."
                  : `Tie the remaining camera${grid.unlinkedCameras.length > 1 ? "s" : ""} ${grid.unlinkedCameras.join(", ")} into the grid (bridge ≥ 1 image each) before generating.`}
              </p>
            )}

            <JointJobProgress jobStatus={jobStatus} />
          </div>

      {/* Calibrate Vectors — apply each camera's joint 2D model to its PIV vectors (planar, not
          3C). Same backend path + action as the single-camera button; mono apply resolves the
          joint model per camera. Works for pinhole (unified joint record) and polynomial
          (per-camera records the polynomial joint solve writes). Kept beside Generate, above the
          saved-model results + proof figures, so the calibrate action does not sit under them. */}
      {model?.exists && calibrateVectors && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-1">
            <Button
              onClick={() => calibrateVectors(true, vectorTypeName)}
              disabled={isVectorCalibrating}
              className="bg-green-600 hover:bg-green-700 text-white rounded-r-none"
              title="Calibrate vectors for all cameras with the joint model"
            >
              {isVectorCalibrating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Calibrating...
                </>
              ) : (
                "Calibrate Vectors"
              )}
            </Button>
            <Select
              value={vectorTypeName}
              onValueChange={(v) => setVectorTypeName(v as "instantaneous" | "ensemble")}
              disabled={isVectorCalibrating}
            >
              <SelectTrigger className="w-[130px] rounded-l-none border-l-0 bg-green-600 hover:bg-green-700 text-white border-green-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instantaneous">Instantaneous</SelectItem>
                <SelectItem value="ensemble">Ensemble</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {vectorJobStatus &&
            (vectorJobStatus.status === "running" || vectorJobStatus.status === "starting") && (
              <div className="p-3 border rounded bg-green-50">
                <div className="flex items-center gap-2 text-sm mb-1">
                  <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                  <strong>Vector Calibration:</strong>
                  <span className="capitalize">{vectorJobStatus.status}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {vectorJobStatus.current_camera ? (
                    <>Processing camera {vectorJobStatus.current_camera} </>
                  ) : null}
                  {vectorJobStatus.total_cameras > 0 && (
                    <span>
                      ({vectorJobStatus.processed_cameras}/{vectorJobStatus.total_cameras} completed)
                    </span>
                  )}
                </div>
              </div>
            )}
          {vectorJobStatus?.status === "completed" && (
            <div className="p-3 border rounded bg-green-50 text-green-700 text-sm">
              <CheckCircle2 className="h-4 w-4 inline mr-2" />
              Vector calibration completed! ({vectorJobStatus.processed_cameras} cameras)
            </div>
          )}
          {vectorJobStatus?.status === "failed" && (
            <div className="p-3 border rounded bg-red-50 text-red-700 text-sm">
              <AlertTriangle className="h-4 w-4 inline mr-2" />
              Vector calibration error: {vectorJobStatus.error || "Unknown error"}
            </div>
          )}
        </div>
      )}

      {/* Saved joint model — results + proof figures, rendered below the calibrate action. */}
      {model?.exists && (
        <JointModelResults
          model={model}
          cameraOptions={cameraOptions}
          board={board}
          sourcePathIdx={sourcePathIdx}
        />
      )}
    </div>
  );
};

/**
 * Dotboard guided wizard. One clean flow, started by "Set Global Coordinates": define the world
 * frame (origin/+X/+Y) on the datum view, then click two shared dots in the datum camera and the
 * same two in each other camera, repeated per frame. This panel explains the flow, takes the origin
 * world (X, Y) in mm, and shows live progress; the clicking itself is guided in the viewer.
 */
const DotboardGridWizard: React.FC<{
  grid: ReturnType<typeof useJointGridSpec>;
  resolving: boolean;
  perCam: Record<number, { resolved: number; total: number }>;
  cameras: number[];
}> = ({ grid, resolving, perCam, cameras }) => {
  const otherCams = cameras.filter((c) => c !== grid.datumCamera);
  const allTied = otherCams.every((c) => (perCam[c]?.resolved ?? 0) > 0);
  return (
    <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4" />
        <h4 className="text-sm font-semibold">Define the global grid</h4>
        {resolving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      <p className="text-xs text-muted-foreground">
        Press <strong>Set Global Coordinates</strong> for one guided flow on Camera{" "}
        <strong>{grid.datumCamera}</strong>, frame <strong>{grid.datumView + 1}</strong> (the datum,
        from the settings above):
      </p>
      <ol className="list-decimal pl-9 text-xs text-muted-foreground space-y-0.5">
        <li>World frame — click <strong>Origin → +X → +Y</strong>.</li>
        <li>
          Two shared dots in Camera {grid.datumCamera}, then the same two (colour-matched) in each
          other camera.
        </li>
        <li>The walk repeats this for every frame; the viewer moves you through it.</li>
      </ol>

      {/* Origin world coordinates (mm). Defaults to (0, 0); set a non-zero datum origin here. */}
      <div className="flex items-center gap-2 pl-7 text-xs">
        <span className="text-muted-foreground">Origin world coords:</span>
        <span className="text-muted-foreground">X</span>
        <input
          type="text"
          inputMode="numeric"
          value={grid.wf.originMmX}
          onChange={(e) => grid.wf.setOriginMmX(e.target.value)}
          className="w-14 h-6 text-xs border rounded px-1"
        />
        <span className="text-muted-foreground">Y</span>
        <input
          type="text"
          inputMode="numeric"
          value={grid.wf.originMmY}
          onChange={(e) => grid.wf.setOriginMmY(e.target.value)}
          className="w-14 h-6 text-xs border rounded px-1"
        />
        <span className="text-muted-foreground">mm</span>
      </div>

      {/* Live progress */}
      <div className="flex flex-wrap items-center gap-3 pl-7 text-xs">
        <span className="flex items-center gap-1">
          <StepBadge done={grid.datumComplete} n={1} /> world frame
        </span>
        <span className="flex items-center gap-1">
          <StepBadge done={allTied} n={2} /> cameras tied
        </span>
        {cameras.map((c) => {
          const s = perCam[c];
          const tied = (s?.resolved ?? 0) > 0;
          return (
            <span key={c} className={tied ? "text-green-600" : ""}>
              cam{c}: {s ? `${s.resolved}/${s.total}` : "0/0"} {tied ? "✓" : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Segmented camera selector, rendered next to the frame stepper. Replaces the old dropdown and stays
 * usable during the guided walk: clicking a camera other than the one awaiting input inspects it
 * (the live crosshair only renders on the awaited image, so it vanishes here and returns on the way
 * back); clicking the awaited camera rejoins the walk.
 */
const CameraToggle: React.FC<{
  cameras: number[];
  value: number;
  onPick: (cam: number) => void;
  inspecting: boolean;
}> = ({ cameras, value, onPick, inspecting }) => (
  <div className="flex items-center gap-1.5">
    <span className="text-xs text-muted-foreground">Camera</span>
    <div className="inline-flex rounded-md border overflow-hidden">
      {cameras.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          className={`h-8 px-2.5 text-xs font-medium border-l first:border-l-0 transition-colors ${
            value === c ? "bg-blue-600 text-white" : "bg-background hover:bg-muted"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
    {inspecting && (
      <span className="text-[11px] text-blue-700 whitespace-nowrap">inspecting — toggle back to continue</span>
    )}
  </div>
);

/** The live prompt for the guided "Set global coordinates" walk. */
const GuideBanner: React.FC<{
  status: GuideStatus;
  onUndo: () => void;
  canUndo: boolean;
  onSkip: () => void;
  onCancel: () => void;
}> = ({ status, onUndo, canUndo, onSkip, onCancel }) => (
  <div className="border-2 border-blue-400 rounded-lg p-3 bg-blue-50 flex items-center gap-3">
    <Crosshair className="h-5 w-5 text-blue-600 shrink-0" />
    <div className="flex-1">
      <div className="text-sm font-semibold text-blue-900">{status.prompt}</div>
      <div className="text-xs text-blue-700">
        Step {status.index + 1} of {status.total} · the viewer moves automatically; clicked dots stay marked
      </div>
    </div>
    <Button
      size="sm"
      variant="ghost"
      className="h-7"
      onClick={onUndo}
      disabled={!canUndo}
      title="Undo the last dot you clicked in this step"
    >
      <Undo2 className="h-3.5 w-3.5 mr-1" /> Undo dot
    </Button>
    <Button size="sm" variant="ghost" className="h-7" onClick={onSkip} title="Skip this view (the dot is not visible here)">
      Skip
    </Button>
    <Button size="sm" variant="outline" className="h-7" onClick={onCancel}>
      <X className="h-3.5 w-3.5 mr-1" /> Stop
    </Button>
  </div>
);

const StepBadge: React.FC<{ done: boolean; n: number }> = ({ done, n }) => (
  <span
    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
      done ? "bg-green-600 text-white" : "bg-muted-foreground/20 text-muted-foreground"
    }`}
  >
    {done ? "✓" : n}
  </span>
);

/** Generate-job progress + terminal state. */
const JointJobProgress: React.FC<{ jobStatus: JointJobStatus | null }> = ({ jobStatus }) => {
  if (!jobStatus) return null;

  if (jobStatus.status === "running" || jobStatus.status === "starting") {
    const pct = jobStatus.progress ?? 0;
    return (
      <div className="p-3 border rounded bg-blue-50">
        <div className="flex items-center gap-2 text-sm mb-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <strong>Joint solve:</strong>
          <span className="capitalize">{jobStatus.status}</span>
        </div>
        <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
          <div className="h-2 bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {pct.toFixed(0)}%
          {jobStatus.processed !== undefined && jobStatus.total !== undefined && (
            <span>
              {" "}
              | detecting {jobStatus.processed}/{jobStatus.total}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (jobStatus.status === "failed") {
    return (
      <div className="p-3 border rounded bg-red-50 text-red-700 text-sm">
        <AlertTriangle className="h-4 w-4 inline mr-2" />
        Joint solve failed: {jobStatus.error || "unknown error"}
      </div>
    );
  }

  // completed — report the reprojection RMS (the meaningful quality number), not the optimizer's
  // convergence flag: a strict 1e-4 px stopping tolerance reads "did not converge" even on an
  // excellent sub-pixel fit, which only alarms users. The number speaks for itself.
  const unit = jobStatus.rms_units ?? "px";
  const perCam = (jobStatus.cameras ?? [])
    .map((c) => jobStatus.per_camera_rms?.[String(c)])
    .filter((v): v is number => typeof v === "number");
  const overall = jobStatus.rms_px;
  return (
    <div className="p-3 border rounded bg-green-50 text-green-700 text-sm">
      <CheckCircle2 className="h-4 w-4 inline mr-2" />
      Joint model generated
      {typeof overall === "number" && Number.isFinite(overall) && (
        <span className="ml-2">— reprojection RMS {overall.toFixed(2)} {unit}</span>
      )}
      {perCam.length > 0 && (
        <span className="ml-1 text-green-600">
          (per camera: {perCam.map((v) => v.toFixed(2)).join(" / ")} {unit})
        </span>
      )}
    </div>
  );
};

/** Cubic basis term labels, aligned with the backend basis order in PolynomialModel. */
const POLY_BASIS = ["1", "s", "s²", "s³", "t", "t²", "t³", "s·t", "s²·t", "s·t²"];

/** Per-camera RMS + shared-board summary for a saved joint model. */
/** True when a per_camera entry carries pinhole intrinsics (vs the polynomial mm-RMS shape). */
function isPinholeParams(
  p: JointCameraParams | JointPolynomialParams | undefined,
): p is JointCameraParams {
  return !!p && "fx" in p;
}

const JointModelResults: React.FC<{
  model: JointModel;
  cameraOptions: number[];
  board: "charuco" | "dotboard";
  sourcePathIdx: number;
}> = ({ model, cameraOptions, board, sourcePathIdx }) => {
  const cams = (model.cameras && model.cameras.length ? model.cameras : cameraOptions)
    .slice()
    .sort((a, b) => a - b);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Joint Model Results</CardTitle>
        <CardDescription>
          {model.model_type === "polynomial"
            ? "Per-camera polynomial maps fitted in one shared global frame"
            : "One shared released board, jointly solved across all cameras"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {model.model_type === "polynomial" ? (
          <>
            <table className="text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pr-6 pb-1">Camera</th>
                  <th className="pr-6 pb-1">RMS X (mm)</th>
                  <th className="pb-1">RMS Y (mm)</th>
                </tr>
              </thead>
              <tbody>
                {cams.map((cam) => {
                  const r = model.per_camera?.[String(cam)];
                  const poly = r && "rms_x_mm" in r ? r : undefined;
                  return (
                    <tr key={cam}>
                      <td className="pr-6 font-medium">{cam}</td>
                      <td className="pr-6 font-mono">{poly ? poly.rms_x_mm.toFixed(4) : "—"}</td>
                      <td className="font-mono">{poly ? poly.rms_y_mm.toFixed(4) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* The actual fitted cubic per camera: pixel normalisation + the two 10-term
                coefficient vectors (image-px → world-mm), the polynomial analogue of the pinhole
                intrinsics card. */}
            <div className="grid md:grid-cols-2 gap-3">
              {cams.map((cam) => {
                const r = model.per_camera?.[String(cam)];
                const poly = r && "coeffs_x" in r ? r : undefined;
                if (!poly) return null;
                return (
                  <div key={cam} className="border rounded p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Camera {cam}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        RMS ({poly.rms_x_mm.toFixed(4)}, {poly.rms_y_mm.toFixed(4)}) mm ·{" "}
                        {poly.image_width} × {poly.image_height}
                      </span>
                    </div>
                    <ParamRow
                      label="Normalisation x0, sx"
                      value={`${poly.x0.toFixed(1)}, ${poly.sx.toFixed(1)} px`}
                    />
                    <ParamRow
                      label="Normalisation y0, sy"
                      value={`${poly.y0.toFixed(1)}, ${poly.sy.toFixed(1)} px`}
                    />
                    <div className="pt-1">
                      <div className="text-muted-foreground text-xs mb-0.5">
                        Cubic coefficients (X mm, Y mm)
                      </div>
                      <table className="font-mono text-[11px] w-full">
                        <tbody>
                          {POLY_BASIS.map((b, i) => (
                            <tr key={b}>
                              <td className="pr-3 text-muted-foreground">{b}</td>
                              <td className="pr-3 text-right">
                                {poly.coeffs_x[i]?.toExponential(3) ?? "—"}
                              </td>
                              <td className="text-right">
                                {poly.coeffs_y[i]?.toExponential(3) ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Metric label="Overall RMS" value={`${model.rms_px?.toFixed(4) ?? "—"} px`} />
              <Metric label="Board dots" value={String(model.n_board_dots ?? "—")} />
              <Metric label="Spacing" value={`${model.spacing_mm?.toFixed(2) ?? "—"} mm`} />
              <Metric label="Release" value={model.board_release ?? "—"} />
              {/* Cross-cam board agreement is 0 by construction for a joint solve (one shared
                  released board, so the cameras cannot disagree) — not worth a metric tile.
                  The optimizer's convergence flag is intentionally NOT surfaced: its 1e-4 px
                  stopping tolerance reads "no" on excellent sub-pixel fits and only misleads.
                  Overall RMS above is the quality number. */}
            </div>

            {/* Per-camera intrinsics + extrinsics (camera position/rotation relative to the
                board). Focal length is px only — mm would need the sensor pixel size. */}
            <div className="grid md:grid-cols-2 gap-3">
              {cams.map((cam) => {
                const p = model.per_camera?.[String(cam)];
                const rms = model.per_camera_rms?.[String(cam)];
                const sz = model.image_sizes?.[String(cam)];
                if (!isPinholeParams(p)) {
                  return (
                    <div key={cam} className="border rounded p-3 text-sm">
                      <div className="font-semibold mb-1">Camera {cam}</div>
                      <div className="text-muted-foreground">
                        RMS {rms !== undefined ? `${rms.toFixed(4)} px` : "—"}
                        {sz ? ` · ${sz[0]} × ${sz[1]}` : ""}
                      </div>
                    </div>
                  );
                }
                const k3 = p.dist[4];
                return (
                  <div key={cam} className="border rounded p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Camera {cam}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        RMS {p.rms_px.toFixed(4)} px · {p.image_size[0]} × {p.image_size[1]}
                      </span>
                    </div>
                    <ParamRow
                      label="Focal length f"
                      value={`${p.fx.toFixed(2)} px${
                        Math.abs(p.fx - p.fy) > 1e-6 ? ` (fy ${p.fy.toFixed(2)})` : ""
                      }`}
                    />
                    <ParamRow
                      label="Principal point"
                      value={`(${p.cx.toFixed(2)}, ${p.cy.toFixed(2)}) px`}
                    />
                    <ParamRow
                      label="Radial k1, k2"
                      value={`${p.dist[0].toExponential(3)}, ${p.dist[1].toExponential(3)}`}
                    />
                    <ParamRow
                      label="Tangential p1, p2"
                      value={`${p.dist[2].toExponential(3)}, ${p.dist[3].toExponential(3)}`}
                    />
                    {k3 !== undefined && Math.abs(k3) > 0 && (
                      <ParamRow label="Radial k3" value={k3.toExponential(3)} />
                    )}
                    <ParamRow
                      label="Position rel. board"
                      value={`(${p.position_mm.map((x) => x.toFixed(1)).join(", ")}) mm`}
                    />
                    <ParamRow
                      label="Rotation"
                      value={`(${p.rotation_deg.map((x) => x.toFixed(2)).join(", ")})°`}
                    />
                  </div>
                );
              })}
            </div>

            {model.baselines_mm && Object.keys(model.baselines_mm).length > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground">Baselines: </span>
                <span className="font-mono">
                  {Object.entries(model.baselines_mm)
                    .map(([k, v]) => `${k}: ${v.toFixed(1)} mm`)
                    .join("  ·  ")}
                </span>
              </div>
            )}
          </>
        )}

        {/* Proof figures written beside the joint record (detection overlays, per-camera
            reprojection, the cameras-relative-to-board scene, and the dewarp agreement).
            Returns null when none exist (e.g. polynomial joint, which writes no figures). */}
        <CalibrationFigureGallery
          query={{ joint: 1, board, source_path_idx: sourcePathIdx }}
          trigger={model}
        />
      </CardContent>
    </Card>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-muted-foreground text-xs">{label}</div>
    <div className="font-medium">{value}</div>
  </div>
);

const ParamRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-muted-foreground text-xs">{label}</span>
    <span className="font-mono text-xs">{value}</span>
  </div>
);

export default JointMultiCamera;
