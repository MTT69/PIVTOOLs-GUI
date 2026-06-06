"use client";

import { useCallback, useState } from "react";

export type Pt = [number, number];

export interface V2Fiducials {
  origin?: Pt;
  x_axis?: Pt;
  y_axis?: Pt;
}

export interface V2Detected {
  points: number[][];
  grid: number[][];
  width: number;
  height: number;
  frame: number;
  frameCount?: number;
}

export interface V2Measure {
  distance_mm: number;
  distance_px: number;
  world_p1: Pt;
  world_p2: Pt;
}

const BASE = "/backend/calibration2";

function qs(o: Record<string, any>): string {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  return p.toString();
}

async function postJSON(path: string, body: any): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function fetchPngBase64(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Unified API hook for the calibration2 backend — ONE hook for every tab
 * (planar/stereo × dotboard/charuco). This replaces the v1 per-method hooks;
 * view state (which camera, current frame, fiducials) lives in the component.
 */
export function useCalibration2() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(
    async (body: any, opts?: { datum?: boolean }): Promise<V2Detected | null> => {
      setBusy(true);
      setError(null);
      try {
        const path = opts?.datum ? "/detect_datum" : "/detect_frame";
        const data = await postJSON(path, body);
        if (!data.success) {
          setError(data.error || "board not detected");
          return null;
        }
        return {
          points: data.image_points,
          grid: data.grid_indices,
          width: data.width,
          height: data.height,
          frame: data.frame,
          frameCount: data.frame_count,
        };
      } catch (e: any) {
        setError(String(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const loadFrameImage = useCallback(
    async (query: Record<string, any>, datum = false): Promise<string | null> => {
      try {
        const path = datum ? "/datum_image" : "/frame_image";
        return await fetchPngBase64(`${BASE}${path}?${qs(query)}`);
      } catch (e: any) {
        setError(String(e));
        return null;
      }
    },
    [],
  );

  const snap = useCallback(
    async (camera: number, x: number, y: number): Promise<Pt | null> => {
      try {
        const data = await postJSON("/snap_fiducial", { camera, click_x: x, click_y: y });
        if (data.snapped_x === undefined) {
          setError(data.error || "snap failed");
          return null;
        }
        return [data.snapped_x, data.snapped_y];
      } catch (e: any) {
        setError(String(e));
        return null;
      }
    },
    [],
  );

  const generate = useCallback(async (body: any): Promise<any> => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJSON("/generate_model", body);
      if (!data.success) {
        setError(data.error || "model generation failed");
        return null;
      }
      return data;
    } catch (e: any) {
      setError(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const generateScaleFactor = useCallback(async (body: any): Promise<any> => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJSON("/scale_factor/generate", body);
      if (!data.success) {
        setError(data.error || "scale-factor generation failed");
        return null;
      }
      return data;
    } catch (e: any) {
      setError(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const loadModel = useCallback(async (query: Record<string, any>): Promise<any> => {
    try {
      const res = await fetch(`${BASE}/model?${qs(query)}`);
      return await res.json();
    } catch (e: any) {
      setError(String(e));
      return null;
    }
  }, []);

  const measure = useCallback(async (body: any): Promise<V2Measure | null> => {
    try {
      const data = await postJSON("/measure", body);
      if (data.error) {
        setError(data.error);
        return null;
      }
      return data as V2Measure;
    } catch (e: any) {
      setError(String(e));
      return null;
    }
  }, []);

  const listFigures = useCallback(async (query: Record<string, any>): Promise<string[]> => {
    try {
      const res = await fetch(`${BASE}/figures?${qs(query)}`);
      const data = await res.json();
      return data.figures || [];
    } catch {
      return [];
    }
  }, []);

  const figureUrl = useCallback(
    (query: Record<string, any>, name: string): string =>
      `${BASE}/figure?${qs({ ...query, name })}`,
    [],
  );

  const validateSource = useCallback(async (body: any): Promise<any> => {
    try {
      return await postJSON("/validate", body);
    } catch (e: any) {
      setError(String(e));
      return { valid: false, error: String(e) };
    }
  }, []);

  const globalCompute = useCallback(async (body: any): Promise<any> => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJSON("/global/compute", body);
      if (data.error) {
        setError(data.error);
        return null;
      }
      return data;
    } catch (e: any) {
      setError(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const startApply = useCallback(async (body: any): Promise<any> => {
    setError(null);
    try {
      const data = await postJSON("/apply", body);
      if (!data.success) {
        setError(data.error || "apply failed to start");
        return null;
      }
      return data;
    } catch (e: any) {
      setError(String(e));
      return null;
    }
  }, []);

  const applyStatus = useCallback(async (jobId: string): Promise<any> => {
    // Never throw out of a poll loop: a transient network blip returns a failed status
    // so callers stop polling instead of leaving a spinner stuck forever.
    try {
      const res = await fetch(`${BASE}/apply/status/${jobId}`);
      return await res.json();
    } catch (e: any) {
      return { status: "failed", error: String(e) };
    }
  }, []);

  return {
    busy, error, setError,
    detect, loadFrameImage, snap, generate, generateScaleFactor, loadModel, measure,
    listFigures, figureUrl, validateSource, globalCompute, startApply, applyStatus,
  };
}
