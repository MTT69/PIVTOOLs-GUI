"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorldFrame, WorldFrameState } from "@/components/setup/WorldFrameSetup";

/**
 * Dotboard global-grid spec builder for the joint multi-camera flow (S2·C2).
 *
 * A dotboard has no built-in global index (unlike ChArUco corner ids), so the user defines
 * one with a few clicks, captured here as a `GlobalGridSpec` that resolve_grid/generate consume
 * and that persists to the sidecar `inputs.mat` via /calibration/joint/inputs (so the CLI
 * reproduces it headlessly):
 *
 *   1. DATUM — origin / +X / +Y on the datum camera's datum view (reuses `useWorldFrame`,
 *      which snaps each click to a detected dot via the backend). Fixes the world frame, so
 *      every dot in that view gets a global (gx, gy).
 *   2. CROSS-CAMERA LINKS — a guided wizard per other camera: click a dot in the datum camera
 *      (the reference), then the SAME physical dot in the new camera; repeat for ≥ 2 dot-pairs.
 *      Each pair becomes a `Correspondence` (same_as = the datum view), which ties the new
 *      camera's datum view into the one shared frame. Two pairs are required because, unlike a
 *      within-camera link, there is no shared orientation prior across cameras.
 *
 * Link clicks snap CLIENT-SIDE against the detected dot pixels resolve_grid already returns
 * (passed in as `snapTo`) — no extra snap route. The backend re-snaps on solve, so the snap
 * here is purely so the marker lands on the dot the user meant.
 *
 * HONEST LIMIT (C2): this resolves each camera's DATUM view into the shared frame. Non-datum
 * views stay unresolved (flagged in the overlay) until C3's auto-resolve fills them in. That is
 * enough for a full polynomial joint solve (datum-view only) but gives pinhole few views per
 * camera — C3 is the click-reducer that adds the rest.
 */

export interface DatumClicks {
  origin: [number, number];
  x_axis: [number, number];
  y_axis: [number, number];
  origin_mm: [number, number];
}

export type SameAs = "origin" | [number, number];

export interface Correspondence {
  pixel: [number, number];
  same_as: SameAs;
  ref_pixel: [number, number] | null;
}

export interface Anchor {
  camera: number;
  view: number;
  correspondences: Correspondence[];
}

/**
 * One step of the guided "Set global coordinates" flow. The wizard walks an ordered list of these,
 * auto-navigating the viewer and auto-committing, so the user only clicks the dots:
 *   - `datum`: define the world frame on the datum camera's datum view — origin, then +X, then +Y
 *     (the `useWorldFrame` picker auto-advances the three). Always the first step.
 *   - `origin`: click the global origin dot once in (camera, view) — resolves a datum-camera frame.
 *   - `bridge`: click `minPairs` shared dots in `refCamera` and the same in `camera`, both at the
 *     same frame — ties a downstream camera into the grid.
 */
export type GuideAction =
  | { kind: "datum"; camera: number; view: number }
  | { kind: "origin"; camera: number; view: number }
  | { kind: "bridge"; camera: number; view: number; refCamera: number; minPairs: number };

export interface GuideStatus {
  index: number;
  total: number;
  prompt: string;
  kind: "datum" | "origin" | "bridge";
}

/** The block sent in resolve_grid / generate request bodies and persisted to the sidecar. */
export interface GlobalGridSpecBlock {
  datum_camera: number;
  datum_view: number;
  datum_clicks: DatumClicks | null;
  anchors: Anchor[];
  cameras: number[];
  /**
   * Per-camera GLOBAL-index extend direction `{camera: [dx, dy]}`, the confirm-on-overlay pick.
   * Set only when a thin-overlap bridge is otherwise mirror-ambiguous; the backend resolver uses
   * it to choose the real layout over the fold (absent ⇒ the resolver raises on such a view rather
   * than guessing). Keys serialize to strings in JSON; the CLI reader coerces them back to ints.
   */
  camera_extends: Record<number, [number, number]>;
}

/**
 * Link wizard state: name the SAME physical dots in a reference view and the view being resolved.
 * The user clicks ALL `minPairs` dots in the reference view first, then the viewer auto-switches to
 * the target view and the user clicks the same dots in the same order — `refs[i]` corresponds to
 * `pixs[i]`. Two flavours, same mechanic:
 *   - cross-camera link: refView == targetView == datum view, refCam == datum camera, ≥2 pairs
 *     (no shared orientation prior across cameras).
 *   - within-camera RESCUE: refCam == targetCam, refView is a resolved same-camera view, the
 *     target is any other view; 1 pair suffices (the same-camera orientation prior disambiguates).
 *
 * `awaiting` is the phase: collect refs in the reference view, then collect target pixels. The link
 * auto-commits once `pixs.length == refs.length` (== minPairs), in both guided and manual modes.
 */
interface LinkState {
  targetCam: number;
  targetView: number;
  refCam: number;
  refView: number;
  minPairs: number;
  refs: Array<[number, number]>; // reference dots, picked in the reference view
  pixs: Array<[number, number]>; // matching dots in the target view (zipped by index with refs)
  awaiting: "ref" | "target";
}

/** Minimum dot-pairs to tie a new camera in (no cross-camera orientation prior — see docstring). */
export const MIN_LINK_PAIRS = 2;
/** A within-camera rescue needs only one pair; the same-camera orientation prior fixes the rest. */
export const MIN_RESCUE_PAIRS = 1;

const ORIGIN_COLOR = "#22c55e"; // green — the global origin dot of a resolved view
// Shared-dot palette, indexed by PICK ORDER. A correspondence shows the SAME colour in both views
// (dot 1 in the reference camera ↔ dot 1 in the target camera), so the user matches by colour. All
// distinct from the green origin marker.
const PAIR_COLORS = [
  "#f97316", // orange
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#eab308", // amber
  "#ec4899", // pink
  "#3b82f6", // blue
];
const PAIR_COLOR_NAMES = ["orange", "purple", "cyan", "amber", "pink", "blue"];
const pairColor = (i: number) => PAIR_COLORS[i % PAIR_COLORS.length];
const pairColorName = (i: number) => PAIR_COLOR_NAMES[i % PAIR_COLOR_NAMES.length];

/** A 2-tuple of finite numbers, or null. Guards config/JSON pixels before they reach the solve. */
function asPair(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number"
    ? [v[0], v[1]]
    : null;
}

/** Validate persisted anchors from arbitrary config JSON into well-formed Anchor[] (drops the
 * malformed rather than trusting an `as` cast — a bad pixel/same_as must never reach the solve). */
function parseAnchors(raw: unknown): Anchor[] {
  if (!Array.isArray(raw)) return [];
  const out: Anchor[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const rec = a as Record<string, unknown>;
    if (typeof rec.camera !== "number" || typeof rec.view !== "number") continue;
    const corrRaw = Array.isArray(rec.correspondences) ? rec.correspondences : [];
    const corr: Correspondence[] = [];
    for (const c of corrRaw) {
      if (!c || typeof c !== "object") continue;
      const cr = c as Record<string, unknown>;
      const pixel = asPair(cr.pixel);
      if (!pixel) continue;
      const same = cr.same_as;
      if (same === "origin") {
        corr.push({ pixel, same_as: "origin", ref_pixel: null });
      } else if (
        Array.isArray(same) && same.length === 2 &&
        typeof same[0] === "number" && typeof same[1] === "number"
      ) {
        const ref = asPair(cr.ref_pixel);
        if (!ref) continue; // a cross-view link without ref_pixel is meaningless — drop it
        corr.push({ pixel, same_as: [same[0], same[1]], ref_pixel: ref });
      }
    }
    if (corr.length > 0) out.push({ camera: rec.camera, view: rec.view, correspondences: corr });
  }
  return out;
}

/** Validate a persisted `camera_extends` map from config JSON into `{camera: [dx, dy]}` (string
 * keys → int camera; drops malformed entries so a bad hint never reaches the solve). */
function parseCameraExtends(raw: unknown): Record<number, [number, number]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<number, [number, number]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const cam = Number(k);
    const dir = asPair(v);
    if (Number.isInteger(cam) && dir) out[cam] = dir;
  }
  return out;
}

interface UseJointGridSpecArgs {
  cameras: number[];
  sourcePathIdx: number;
  dotSpacingMm: number;
  imageFormat: string;
  imageType: string;
  /** Client-side snap of a click to the nearest detected dot in (camera, view); null if none. */
  snapTo: (camera: number, view: number, px: number, py: number) => [number, number] | null;
  /** Called after a committed spec change, so the parent re-resolves the live overlay. */
  onSpecChange: () => void;
}

export interface JointGridSpecState {
  datumCamera: number;
  datumView: number;
  setDatumCamera: (cam: number) => void;
  setDatumView: (view: number) => void;
  wf: WorldFrameState;
  anchors: Anchor[];
  unlinkedCameras: number[];
  link: LinkState | null;
  /** A pending single-click origin-dot anchor (datum camera's non-datum views), or null. */
  originPick: { camera: number; view: number } | null;
  startLink: (targetCam: number) => void;
  startRescue: (targetCam: number, targetView: number, refView: number) => void;
  /** Anchor a view by clicking the global origin dot once (same_as "origin"). */
  startOriginAnchor: (camera: number, view: number) => void;
  /** Tie a camera's view into the grid at the SAME frame via two shared dots (cross-camera bridge). */
  startBridge: (targetCam: number, view: number, refCam: number) => void;
  /** The per-camera extend hints `{camera: [dx, dy]}` (confirm-on-overlay picks). */
  cameraExtends: Record<number, [number, number]>;
  /** Record the chosen layout for a thin-overlap camera, then re-resolve (confirm-on-overlay). */
  setCameraExtend: (camera: number, extend: [number, number]) => void;
  cancelOriginPick: () => void;
  cancelLink: () => void;
  /** Undo the last picked dot in the active link (pops a target pixel, or a reference dot). */
  undoLast: () => void;
  removeAnchor: (camera: number, view: number) => void;
  /** Clear the whole global-coordinate spec — datum clicks + every anchor + any in-progress pick. */
  clearAll: () => void;
  anchorFor: (camera: number, view: number) => Anchor | undefined;
  selectActive: boolean;
  viewerTarget: { camera: number; frame: number } | null;
  handlePoint: (px: number, py: number, camera: number, frame: number) => void;
  pickMarkers: (camera: number, frame: number) => Array<{ x: number; y: number; color: string; label?: string }>;
  /** Persistent markers for committed anchors on a view (the dots already selected). */
  anchorMarkers: (camera: number, frame: number) => Array<{ x: number; y: number; color: string; label?: string }>;
  /** The guided "Set global coordinates" walk. */
  guideActive: boolean;
  guideStatus: GuideStatus | null;
  startGuide: (actions: GuideAction[]) => void;
  cancelGuide: () => void;
  /** Skip the current guided step (e.g. the needed dot is not visible in this view) and move on. */
  skipGuideStep: () => void;
  specBlock: GlobalGridSpecBlock;
  datumComplete: boolean;
}

export function useJointGridSpec({
  cameras,
  sourcePathIdx,
  dotSpacingMm,
  imageFormat,
  imageType,
  snapTo,
  onSpecChange,
}: UseJointGridSpecArgs): JointGridSpecState {
  // The clicked-coords block (datum + anchors + camera_extends) lives in the sidecar inputs.mat,
  // loaded via /calibration/joint/inputs — no longer in config. `gg` is the server snapshot that
  // drives the one-shot restore effects below; `ggRef` is what persist() merges partials against.
  const [gg, setGg] = useState<Record<string, unknown> | null>(null);
  const ggRef = useRef<Record<string, unknown> | null>(null);
  // State starts at defaults and adopts any persisted spec via the restore effects below, so the
  // flow is correct whether the sidecar is empty or its load resolves async.
  const [datumCamera, setDatumCameraRaw] = useState<number>(cameras[0] ?? 1);
  const [datumView, setDatumViewRaw] = useState<number>(0);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  // Per-camera extend hints {camera: [dx, dy]} — set only when a thin-overlap bridge is mirror-
  // ambiguous and the user confirms the layout on the overlay; fed to the resolver to pick the
  // real orientation over the fold.
  const [cameraExtends, setCameraExtends] = useState<Record<number, [number, number]>>({});
  const [link, setLink] = useState<LinkState | null>(null);
  // A pending single-click origin-dot anchor for one (camera, view) — the per-view mechanic the
  // datum camera uses on its non-datum frames. One click on the global origin dot resolves the view.
  const [originPick, setOriginPick] = useState<{ camera: number; view: number } | null>(null);
  // The guided "Set global coordinates" walk: an ordered action list + the current index. A ref
  // mirrors it so the click handler can read the live value (and auto-advance) without stale closure.
  const [guide, setGuide] = useState<{ actions: GuideAction[]; index: number } | null>(null);
  const guideRef = useRef<{ actions: GuideAction[]; index: number } | null>(null);
  useEffect(() => { guideRef.current = guide; }, [guide]);

  // Keep the datum camera valid as the configured set changes.
  useEffect(() => {
    if (cameras.length > 0 && !cameras.includes(datumCamera)) setDatumCameraRaw(cameras[0]);
  }, [cameras, datumCamera]);

  const boardParams = useCallback(() => ({ dot_spacing_mm: dotSpacingMm }), [dotSpacingMm]);
  const wf = useWorldFrame({
    board: "dotboard",
    camera: datumCamera,
    sourcePathIdx,
    datumFrame: datumView + 1, // useWorldFrame + detect_datum are 1-based; spec datum_view is 0-based
    boardParams,
    imageFormat,
    imageType,
  });

  // ── Load the persisted coords for this source once (and whenever the source changes) ──
  const loadedForSourceRef = useRef<number | null>(null);
  useEffect(() => {
    if (loadedForSourceRef.current === sourcePathIdx) return;
    loadedForSourceRef.current = sourcePathIdx;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/backend/calibration/joint/inputs?board=dotboard&source_path_idx=${sourcePathIdx}`,
        );
        const json = await res.json();
        const coords = (json?.coords as Record<string, unknown>) ?? null;
        if (!cancelled) {
          ggRef.current = coords;
          setGg(coords);
        }
      } catch (e) {
        console.error("Failed to load joint inputs:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourcePathIdx]);

  // ── Persistence into the sidecar inputs.mat (merges into the working coords; the stored
  //    detections are untouched server-side). The full merged block is sent — the endpoint
  //    replaces coords wholesale. `gg` is NOT updated here, so the one-shot restore effects fire
  //    only from the server snapshot, never from our own write. ──
  const persist = useCallback(
    async (block: Partial<GlobalGridSpecBlock>) => {
      const merged = { ...(ggRef.current || {}), ...block } as Record<string, unknown>;
      ggRef.current = merged;
      try {
        await fetch("/backend/calibration/joint/inputs/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            board: "dotboard",
            source_path_idx: sourcePathIdx,
            global_grid: merged,
          }),
        });
      } catch (e) {
        console.error("Failed to persist joint inputs:", e);
      }
    },
    [sourcePathIdx],
  );

  // ── Restore a persisted spec (two phases, so useWorldFrame's view-change reset cannot wipe
  //    the restored datum clicks before the frame settles to the persisted datum) ──
  const specRestoredRef = useRef(false);
  const clicksRestoredRef = useRef(false);
  const datumSig = useRef<string>("");

  // Phase 1: adopt the persisted scalars + anchors once a spec is present in config.
  useEffect(() => {
    if (specRestoredRef.current || !gg) return;
    const dc = gg.datum_clicks as Partial<DatumClicks> | undefined;
    const hasAnchors = Array.isArray(gg.anchors) && gg.anchors.length > 0;
    if (!dc?.origin && !hasAnchors) return; // nothing persisted yet
    if (typeof gg.datum_camera === "number") setDatumCameraRaw(gg.datum_camera);
    if (typeof gg.datum_view === "number") setDatumViewRaw(gg.datum_view);
    setAnchors(parseAnchors(gg.anchors));
    setCameraExtends(parseCameraExtends(gg.camera_extends));
    specRestoredRef.current = true;
  }, [gg]);

  // Phase 2: restore the datum clicks, but only once datumCamera/datumView match the persisted
  // datum — by then useWorldFrame has already reset for that frame and will not reset again.
  useEffect(() => {
    if (clicksRestoredRef.current || !specRestoredRef.current || !gg) return;
    const dc = gg.datum_clicks as Partial<DatumClicks> | undefined;
    if (!dc?.origin) {
      clicksRestoredRef.current = true;
      return;
    }
    if (typeof gg.datum_camera === "number" && datumCamera !== gg.datum_camera) return;
    if (typeof gg.datum_view === "number" && datumView !== gg.datum_view) return;
    wf.restore({
      mode: "clicks",
      origin: dc.origin as [number, number],
      x_axis: (dc.x_axis as [number, number]) ?? null,
      y_axis: (dc.y_axis as [number, number]) ?? null,
      origin_mm: (dc.origin_mm as [number, number]) ?? null,
    });
    datumSig.current = JSON.stringify([datumCamera, datumView, wf.payload]);
    clicksRestoredRef.current = true;
  }, [gg, datumCamera, datumView, wf]);

  // Persist the datum frame whenever its resolved values change (guarded against the per-render
  // identity of wf.payload so it does not POST in a loop). Ordering matters: the restore effect
  // above (declared earlier, so React runs it first within a commit) primes `datumSig` to the
  // restored payload, so this effect no-ops on the restore and does NOT echo the just-loaded
  // sidecar back to the server. Keep this effect AFTER the restore effect for that guard to hold.
  useEffect(() => {
    if (!wf.payload) return;
    const sig = JSON.stringify([datumCamera, datumView, wf.payload]);
    if (sig === datumSig.current) return;
    datumSig.current = sig;
    persist({ datum_camera: datumCamera, datum_view: datumView, datum_clicks: wf.payload });
    onSpecChange();
  }, [wf.payload, datumCamera, datumView, persist, onSpecChange]);

  // ── Changing the datum invalidates every link (anchors reference the datum view) ──
  const resetSpec = useCallback(
    (patch: Partial<GlobalGridSpecBlock>) => {
      setAnchors([]);
      setCameraExtends({});
      setLink(null);
      wf.clear();
      datumSig.current = "";
      persist({ anchors: [], camera_extends: {}, datum_clicks: null, ...patch });
      onSpecChange();
    },
    [wf, persist, onSpecChange],
  );
  const setDatumCamera = useCallback(
    (cam: number) => {
      setDatumCameraRaw(cam);
      resetSpec({ datum_camera: cam });
    },
    [resetSpec],
  );
  const setDatumView = useCallback(
    (view: number) => {
      setDatumViewRaw(view);
      resetSpec({ datum_view: view });
    },
    [resetSpec],
  );

  // ── Cross-camera link wizard ──
  const linkedCameras = useMemo(
    () => new Set(anchors.filter((a) => a.view === datumView).map((a) => a.camera)),
    [anchors, datumView],
  );
  const unlinkedCameras = useMemo(
    () => cameras.filter((c) => c !== datumCamera && !linkedCameras.has(c)),
    [cameras, datumCamera, linkedCameras],
  );

  // Cross-camera link: tie a new camera's datum view to the datum camera's datum view (≥2 pairs).
  const startLink = useCallback(
    (targetCam: number) => {
      if (!wf.complete) return; // datum frame must exist to link against
      setLink({
        targetCam, targetView: datumView, refCam: datumCamera, refView: datumView,
        minPairs: MIN_LINK_PAIRS, refs: [], pixs: [], awaiting: "ref",
      });
    },
    [wf.complete, datumView, datumCamera],
  );

  // Within-camera rescue: resolve one non-datum view against an already-resolved same-camera view.
  const startRescue = useCallback(
    (targetCam: number, targetView: number, refView: number) => {
      if (!wf.complete) return;
      if (refView === targetView) return; // a view cannot be its own reference (self-pair)
      setLink({
        targetCam, targetView, refCam: targetCam, refView,
        minPairs: MIN_RESCUE_PAIRS, refs: [], pixs: [], awaiting: "ref",
      });
    },
    [wf.complete],
  );

  // Per-view origin anchor: the datum camera's non-datum frames are resolved by a single click on
  // the global origin dot (same_as "origin"). Orientation comes from the same-camera prior; if the
  // backend flags the view as ambiguous, the user falls back to a within-camera rescue.
  const startOriginAnchor = useCallback(
    (camera: number, view: number) => {
      if (!wf.complete) return; // the datum world frame defines where the origin is
      setLink(null);
      setOriginPick({ camera, view });
    },
    [wf.complete],
  );

  // Cross-camera bridge at a SINGLE frame: tie a downstream camera's view into the grid by clicking
  // two shared physical dots in an already-resolved camera (refCam) and in this one, both at the same
  // frame (the simultaneous board pose). Two non-collinear dots lock translation + rotation.
  const startBridge = useCallback(
    (targetCam: number, view: number, refCam: number) => {
      if (!wf.complete) return;
      if (refCam === targetCam) return; // a bridge is cross-camera (use rescue within a camera)
      setOriginPick(null);
      setLink({
        targetCam, targetView: view, refCam, refView: view,
        minPairs: MIN_LINK_PAIRS, refs: [], pixs: [], awaiting: "ref",
      });
    },
    [wf.complete],
  );

  const cancelOriginPick = useCallback(() => setOriginPick(null), []);
  const cancelLink = useCallback(() => setLink(null), []);
  // Pop the last picked dot: a target pixel if we're in the target phase, else a reference dot
  // (which also drops us back to the reference phase if we'd just switched).
  const undoLast = useCallback(() => {
    setLink((l) => {
      if (!l) return l;
      if (l.pixs.length > 0) return { ...l, pixs: l.pixs.slice(0, -1) };
      if (l.refs.length > 0) return { ...l, refs: l.refs.slice(0, -1), awaiting: "ref" };
      return l;
    });
  }, []);

  const removeAnchor = useCallback(
    (camera: number, view: number) => {
      const next = anchors.filter((a) => !(a.camera === camera && a.view === view));
      setAnchors(next);
      persist({ anchors: next });
      onSpecChange();
    },
    [anchors, persist, onSpecChange],
  );

  const anchorFor = useCallback(
    (camera: number, view: number) => anchors.find((a) => a.camera === camera && a.view === view),
    [anchors],
  );

  // Confirm-on-overlay: the user picked which layout a thin-overlap camera takes, so record its
  // extend direction and re-resolve. The resolver then chooses that orientation over the fold.
  const setCameraExtend = useCallback(
    (camera: number, extend: [number, number]) => {
      const next = { ...cameraExtends, [camera]: extend };
      setCameraExtends(next);
      persist({ camera_extends: next });
      onSpecChange();
    },
    [cameraExtends, persist, onSpecChange],
  );

  // Clear the whole spec: datum world frame + every anchor + any pick/guide in progress. Used by the
  // "Clear global coordinates" button to start the anchoring over from scratch.
  const clearAll = useCallback(() => {
    setAnchors([]);
    setCameraExtends({});
    setLink(null);
    setOriginPick(null);
    setGuide(null);
    guideRef.current = null;
    wf.clear();
    datumSig.current = "";
    persist({ datum_clicks: null, anchors: [], camera_extends: {} });
    onSpecChange();
  }, [wf, persist, onSpecChange]);

  // ── Guided "Set global coordinates" walk ──
  // Set up the pick for one action (origin or bridge); the viewer follows via viewerTarget and the
  // viewer is already in click mode (selectActive), so the user only clicks dots.
  const runGuideAction = useCallback((a: GuideAction) => {
    if (a.kind === "datum") {
      setLink(null);
      setOriginPick(null);
      // Start the world-frame pick (origin → +X → +Y auto-advance). If it is already complete
      // (restored from config), do nothing — the wf.complete effect advances straight past it.
      if (!wf.complete) void wf.startPick("origin");
    } else if (a.kind === "origin") {
      setLink(null);
      setOriginPick({ camera: a.camera, view: a.view });
    } else {
      setOriginPick(null);
      setLink({
        targetCam: a.camera, targetView: a.view, refCam: a.refCamera, refView: a.view,
        minPairs: a.minPairs, refs: [], pixs: [], awaiting: "ref",
      });
    }
  }, [wf]);

  const startGuide = useCallback(
    (actions: GuideAction[]) => {
      if (actions.length === 0) return;
      setGuide({ actions, index: 0 });
      guideRef.current = { actions, index: 0 };
      runGuideAction(actions[0]);
    },
    [runGuideAction],
  );

  const cancelGuide = useCallback(() => {
    setGuide(null);
    guideRef.current = null;
    setOriginPick(null);
    setLink(null);
  }, []);

  // Advance to the next action after the current one commits; clears picking when the walk is done.
  const advanceGuide = useCallback(() => {
    const g = guideRef.current;
    if (!g) return;
    const next = g.index + 1;
    if (next >= g.actions.length) {
      setGuide(null);
      guideRef.current = null;
      setOriginPick(null);
      setLink(null);
      return;
    }
    const ng = { actions: g.actions, index: next };
    setGuide(ng);
    guideRef.current = ng;
    runGuideAction(g.actions[next]);
  }, [runGuideAction]);

  // The world-frame `datum` step has no click handler of its own (wf owns origin/+X/+Y); advance the
  // guide as soon as the frame is complete — whether the user just finished the three picks or it was
  // already set (restored from config, so the step is skipped).
  useEffect(() => {
    if (!guide) return;
    if (guide.actions[guide.index]?.kind === "datum" && wf.complete) advanceGuide();
  }, [guide, wf.complete, advanceGuide]);

  // ── Viewer wiring ──
  const datumPicking = wf.mode !== "none";
  const selectActive = datumPicking || link !== null || originPick !== null;

  const viewerTarget = useMemo(() => {
    if (datumPicking) return { camera: datumCamera, frame: datumView + 1 };
    if (originPick) return { camera: originPick.camera, frame: originPick.view + 1 };
    if (link) {
      return link.awaiting === "ref"
        ? { camera: link.refCam, frame: link.refView + 1 }
        : { camera: link.targetCam, frame: link.targetView + 1 };
    }
    return null;
  }, [datumPicking, originPick, link, datumCamera, datumView]);

  const handlePoint = useCallback(
    (px: number, py: number, camera: number, frame: number) => {
      if (datumPicking) {
        wf.handlePoint(px, py);
        return;
      }
      if (originPick) {
        const view = frame - 1;
        if (camera !== originPick.camera || view !== originPick.view) return;
        const snapped = snapTo(originPick.camera, originPick.view, px, py);
        if (!snapped) return; // no detected dots for this view yet — Preview/resolve first
        const anchor: Anchor = {
          camera: originPick.camera,
          view: originPick.view,
          correspondences: [{ pixel: snapped, same_as: "origin", ref_pixel: null }],
        };
        const next = [
          ...anchors.filter((a) => !(a.camera === originPick.camera && a.view === originPick.view)),
          anchor,
        ];
        setAnchors(next);
        setOriginPick(null);
        persist({ anchors: next });
        onSpecChange();
        if (guideRef.current) advanceGuide();
        return;
      }
      if (!link) return;
      const view = frame - 1;
      // The viewer auto-switches from the reference view to the target view once all reference dots
      // are in; if the displayed (camera, view) does not yet match the phase this pick is for (a
      // click during the swap, before the new image settled), drop it rather than snap the wrong view.
      const expectCam = link.awaiting === "ref" ? link.refCam : link.targetCam;
      const expectView = link.awaiting === "ref" ? link.refView : link.targetView;
      if (camera !== expectCam || view !== expectView) return;
      const snapped = snapTo(expectCam, expectView, px, py);
      if (!snapped) return; // no detected dots for this view yet — Preview/resolve first
      if (link.awaiting === "ref") {
        // Collect ALL reference dots first; switch to the target view once we have minPairs of them.
        const refs = [...link.refs, snapped];
        setLink({ ...link, refs, awaiting: refs.length >= link.minPairs ? "target" : "ref" });
        return;
      }
      // Target phase: match each reference dot in order. Auto-commit once every ref has a match —
      // refs[i] ↔ pixs[i]. Same path for guided and manual mode; guided also advances the walk.
      const pixs = [...link.pixs, snapped];
      if (pixs.length < link.refs.length) {
        setLink({ ...link, pixs });
        return;
      }
      const anchor: Anchor = {
        camera: link.targetCam,
        view: link.targetView,
        correspondences: link.refs.map((ref, i) => ({
          pixel: pixs[i],
          same_as: [link.refCam, link.refView] as [number, number],
          ref_pixel: ref,
        })),
      };
      const nextAnchors = [
        ...anchors.filter((a) => !(a.camera === link.targetCam && a.view === link.targetView)),
        anchor,
      ];
      setAnchors(nextAnchors);
      setLink(null);
      persist({ anchors: nextAnchors });
      onSpecChange();
      if (guideRef.current) advanceGuide();
    },
    [datumPicking, originPick, wf, link, snapTo, anchors, persist, onSpecChange, advanceGuide],
  );

  const pickMarkers = useCallback(
    (camera: number, frame: number) => {
      const out: Array<{ x: number; y: number; color: string; label?: string }> = [];
      if (!link) return out;
      const view = frame - 1;
      if (camera === link.refCam && view === link.refView) {
        link.refs.forEach((r, i) =>
          out.push({ x: r[0], y: r[1], color: pairColor(i), label: `${i + 1}` }));
      }
      if (camera === link.targetCam && view === link.targetView) {
        link.pixs.forEach((p, i) =>
          out.push({ x: p[0], y: p[1], color: pairColor(i), label: `${i + 1}` }));
      }
      return out;
    },
    [link],
  );

  // Persistent markers for COMMITTED anchors on a view, so the user sees which dot was selected
  // even after the click. Shows this view's own anchor dots (origin/bridge) plus any reference dot
  // picked in this view to bridge another camera.
  const anchorMarkers = useCallback(
    (camera: number, frame: number) => {
      const view = frame - 1;
      const out: Array<{ x: number; y: number; color: string; label?: string }> = [];
      const own = anchors.find((a) => a.camera === camera && a.view === view);
      if (own) {
        own.correspondences.forEach((c, i) => {
          out.push({
            x: c.pixel[0], y: c.pixel[1],
            color: c.same_as === "origin" ? ORIGIN_COLOR : pairColor(i),
            label: c.same_as === "origin" ? "O" : `${i + 1}`,
          });
        });
      }
      anchors.forEach((a) => {
        a.correspondences.forEach((c, i) => {
          if (c.same_as !== "origin" && c.ref_pixel &&
              c.same_as[0] === camera && c.same_as[1] === view) {
            out.push({ x: c.ref_pixel[0], y: c.ref_pixel[1], color: pairColor(i), label: `${i + 1}` });
          }
        });
      });
      return out;
    },
    [anchors],
  );

  // Human prompt for the current guided step (drives the banner above the viewer).
  const guideStatus = useMemo<GuideStatus | null>(() => {
    if (!guide) return null;
    const a = guide.actions[guide.index];
    const total = guide.actions.length;
    let prompt: string;
    if (a.kind === "datum") {
      const role =
        wf.mode === "x_axis" ? "+X axis" : wf.mode === "y_axis" ? "+Y axis" : "ORIGIN";
      prompt = `Define the world frame — click the ${role} dot on Camera ${a.camera}, frame ${a.view + 1}`;
    } else if (a.kind === "origin") {
      prompt = `Click the ORIGIN dot — Camera ${a.camera}, frame ${a.view + 1}`;
    } else if (link?.awaiting === "target") {
      // Matching phase: name the colour of the next dot to find in the target camera.
      const i = link.pixs.length;
      const count = ` (${Math.min(i + 1, a.minPairs)} of ${a.minPairs})`;
      prompt = `Now find the ${pairColorName(i)} dot${count} in Camera ${a.camera}, frame ${a.view + 1}`;
    } else {
      // Reference phase: pick all shared dots in the datum camera; each gets the next colour.
      const i = link?.refs.length ?? 0;
      const count = ` (${Math.min(i + 1, a.minPairs)} of ${a.minPairs})`;
      prompt = `Click shared dot ${i + 1} (${pairColorName(i)})${count} in Camera ${a.refCamera}, frame ${a.view + 1}`;
    }
    return { index: guide.index, total, prompt, kind: a.kind };
  }, [guide, link, wf.mode]);

  const specBlock = useMemo<GlobalGridSpecBlock>(
    () => ({
      datum_camera: datumCamera,
      datum_view: datumView,
      datum_clicks: wf.payload,
      anchors,
      cameras,
      camera_extends: cameraExtends,
    }),
    [datumCamera, datumView, wf.payload, anchors, cameras, cameraExtends],
  );

  return {
    datumCamera,
    datumView,
    setDatumCamera,
    setDatumView,
    wf,
    anchors,
    unlinkedCameras,
    link,
    originPick,
    startLink,
    startRescue,
    startOriginAnchor,
    startBridge,
    cameraExtends,
    setCameraExtend,
    cancelOriginPick,
    cancelLink,
    undoLast,
    removeAnchor,
    clearAll,
    anchorFor,
    selectActive,
    viewerTarget,
    handlePoint,
    pickMarkers,
    anchorMarkers,
    guideActive: guide !== null,
    guideStatus,
    startGuide,
    cancelGuide,
    skipGuideStep: advanceGuide,
    specBlock,
    datumComplete: wf.complete,
  };
}
