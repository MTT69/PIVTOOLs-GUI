"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Joint multi-camera calibration hook — drives the three /calibration/joint/* routes
 * (resolve_grid, generate + status, model) added in S2·C0.
 *
 * The joint solve ties every camera to ONE shared released board through a global dot
 * index, the DaVis-matching calibration. This hook owns the network + job-polling state;
 * the spec (which cameras, n_views, board params) is built by the component from the tab's
 * existing inputs and persisted config. State that belongs to a view (selected camera,
 * current frame) lives in the component, not here.
 */

const BASE = "/backend/calibration";

/** One (camera, view) entry from resolve_grid: detected dot pixels + resolved global index. */
export interface JointView {
  camera: number;
  view: number;
  n: number;
  points: number[][];
  /** Detector's LOCAL (col, row) index per dot — lets the overlay draw the mesh before anchoring. */
  grid_indices?: number[][] | null;
  /** Per-dot global (gx, gy) index, or null when this view is not yet resolvable. */
  global_index: number[][] | null;
  resolved: boolean;
  /** Why an unresolved view could not be placed (no anchor, broken chain, …); null if resolved. */
  reason?: string | null;
  /**
   * The competing layouts a thin-overlap bridge leaves when the dots cannot break the mirror
   * ambiguity (empty for any view that resolves cleanly). Each carries the global-index `extend`
   * direction that, written back as `camera_extends[camera]`, reproduces that choice headlessly.
   * The GUI shows one chip per candidate (footprint = gx/gy range) and the user picks the real one.
   */
  candidates?: OrientationCandidate[];
}

/** One orientation a thin bridge allows, for the confirm-on-overlay picker (see JointView). */
export interface OrientationCandidate {
  extend: [number, number];
  gx_range: [number, number];
  gy_range: [number, number];
  n: number;
  rms: number;
}

export interface JointResolveResult {
  success: boolean;
  board: string;
  cameras: number[];
  n_views: number;
  spacing_mm: number;
  datum_camera: number;
  datum_view: number;
  views: JointView[];
  n_resolved: number;
  n_views_total: number;
  errors: string[];
  error?: string;
}

/**
 * Generate-job status. While running it carries progress/processed/total; on completion the
 * driver's result fields are merged in at the top level (job_manager.complete_job stores
 * **final_data flat), so per_camera_rms etc. read straight off the status payload.
 */
export interface JointJobStatus {
  status: "starting" | "running" | "completed" | "failed";
  progress?: number;
  processed?: number;
  total?: number;
  // Completion fields (pinhole + polynomial)
  model_type?: "pinhole" | "polynomial";
  cameras?: number[];
  per_camera_rms?: Record<string, number>;
  rms_units?: "px" | "mm";
  rms_px?: number;
  converged?: boolean;
  cross_camera_board_agreement_mm?: number;
  n_board_dots?: number;
  paths?: string[];
  error?: string;
}

/** Per-camera polynomial parameters for the joint results panel (the actual fitted cubic). */
export interface JointPolynomialParams {
  model_type: "polynomial";
  /** 10-term cubic coefficients, basis [1, s, s², s³, t, t², t³, s·t, s²·t, s·t²]. */
  coeffs_x: number[];
  coeffs_y: number[];
  /** Pixel normalisation: s = (x - x0) / sx, t = (y - y0) / sy. */
  x0: number;
  sx: number;
  y0: number;
  sy: number;
  rms_x_mm: number;
  rms_y_mm: number;
  image_width: number;
  image_height: number;
}

/** Per-camera pinhole parameters for the joint results panel (intrinsics + extrinsics). */
export interface JointCameraParams {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  /** [k1, k2, p1, p2, k3] */
  dist: number[];
  image_size: [number, number];
  rms_px: number;
  /** Camera centre in the world/board frame, mm (C = -R^T t). */
  position_mm: [number, number, number];
  /** World->camera orientation, Tait-Bryan euler degrees (cv2.RQDecomp3x3). */
  rotation_deg: [number, number, number];
}

export interface JointModel {
  exists: boolean;
  model_type?: "pinhole" | "polynomial";
  board?: string;
  cameras?: number[];
  // Pinhole
  per_camera_rms?: Record<string, number>;
  rms_px?: number;
  spacing_mm?: number;
  board_release?: string;
  converged?: boolean;
  cross_camera_board_agreement_mm?: number;
  n_board_dots?: number;
  image_sizes?: Record<string, [number, number]>;
  /** Pinhole: full per-camera intrinsics + extrinsics. Polynomial: fitted cubic + per-axis mm RMS. */
  per_camera?: Record<string, JointCameraParams | JointPolynomialParams>;
  /** Pinhole only: pairwise camera-centre distances, keyed "a-b". */
  baselines_mm?: Record<string, number>;
}

const POLL_MS = 700;

function qs(o: Record<string, unknown>): string {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  return p.toString();
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

interface JointGenerateStart {
  success: boolean;
  job_id?: string;
  error?: string;
}

export function useJointCalibration() {
  const [resolveData, setResolveData] = useState<JointResolveResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [jobStatus, setJobStatus] = useState<JointJobStatus | null>(null);
  const [model, setModel] = useState<JointModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Monotonic token: only the latest loadModel call may write `model` (older in-flight
  // responses that resolve later are discarded), so a fast model_type/camera switch can't
  // land a stale model.
  const modelReqRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** Detect-all (cached server-side) + resolve the global grid for the live overlay. */
  const resolveGrid = useCallback(
    async (body: Record<string, unknown>): Promise<JointResolveResult | null> => {
      setResolving(true);
      setError(null);
      try {
        const data = await postJSON<JointResolveResult>("/joint/resolve_grid", body);
        if (!data.success) {
          setError(data.error || "grid resolve failed");
          setResolveData(null);
          return null;
        }
        setResolveData(data);
        return data;
      } catch (e) {
        setError(String(e));
        setResolveData(null);
        return null;
      } finally {
        setResolving(false);
      }
    },
    [],
  );

  /** Load the saved joint model (pinhole JointRecord or per-camera polynomial) for display. */
  const loadModel = useCallback(
    async (query: Record<string, unknown>): Promise<JointModel | null> => {
      const token = ++modelReqRef.current;
      try {
        const res = await fetch(`${BASE}/joint/model?${qs(query)}`);
        const data = (await res.json()) as JointModel;
        if (modelReqRef.current !== token) return data; // superseded — don't clobber a newer load
        setModel(data);
        setError(null); // a successful current load clears any stale error
        return data;
      } catch (e) {
        if (modelReqRef.current === token) setError(String(e));
        return null;
      }
    },
    [],
  );

  /**
   * Start the joint solve as a background job and poll until it ends. `onComplete` fires
   * once with the final status (use it to refresh the saved model). A new generate cancels
   * any in-flight poll so two runs never interleave.
   */
  const generate = useCallback(
    async (
      body: Record<string, unknown>,
      onComplete?: (status: JointJobStatus) => void,
    ): Promise<void> => {
      stopPolling();
      setError(null);
      setJobStatus({ status: "starting", progress: 0 });
      let start: JointGenerateStart;
      try {
        start = await postJSON<JointGenerateStart>("/joint/generate", body);
      } catch (e) {
        setJobStatus({ status: "failed", error: String(e) });
        return;
      }
      if (!start.success || !start.job_id) {
        setJobStatus({ status: "failed", error: start.error || "failed to start joint solve" });
        return;
      }
      const jobId = start.job_id;
      // Capture this interval's handle. A status fetch already in flight when the timer is
      // cleared (a newer generate, or unmount) still resolves and would otherwise setJobStatus
      // after its context was superseded — the handle check discards those late writes.
      const handle = setInterval(async () => {
        let status: JointJobStatus;
        try {
          const res = await fetch(`${BASE}/joint/generate/status/${jobId}`);
          status = (await res.json()) as JointJobStatus;
        } catch {
          return; // transient blip — keep polling
        }
        if (pollRef.current !== handle) return; // superseded by a newer generate / unmount
        setJobStatus(status);
        if (status.status === "completed" || status.status === "failed") {
          stopPolling();
          if (status.status === "completed") onComplete?.(status);
        }
      }, POLL_MS);
      pollRef.current = handle;
    },
    [stopPolling],
  );

  const clearResolve = useCallback(() => setResolveData(null), []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  return {
    resolveData,
    resolving,
    jobStatus,
    generating: jobStatus?.status === "running" || jobStatus?.status === "starting",
    model,
    error,
    setError,
    resolveGrid,
    generate,
    loadModel,
    clearResolve,
  };
}
