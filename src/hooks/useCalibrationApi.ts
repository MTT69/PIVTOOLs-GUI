"use client";

import { useCallback, useState } from "react";
import { fetchJson, postJson, errorMessage } from "@/lib/api";

export type Pt = [number, number];

export interface V2Fiducials {
  origin?: Pt;
  x_axis?: Pt;
  y_axis?: Pt;
}

const BASE = "/backend/calibration";

function qs(o: Record<string, any>): string {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  return p.toString();
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
 * Unified API hook for the calibration backend — ONE hook for every tab
 * (planar/stereo × dotboard/charuco). This replaces the v1 per-method hooks;
 * view state (which camera, current frame, fiducials) lives in the component.
 */
export function useCalibrationApi() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFrameImage = useCallback(
    async (query: Record<string, any>, datum = false): Promise<string | null> => {
      try {
        const path = datum ? "/datum_image" : "/frame_image";
        return await fetchPngBase64(`${BASE}${path}?${qs(query)}`);
      } catch (e: any) {
        setError(errorMessage(e));
        return null;
      }
    },
    [],
  );

  const snap = useCallback(
    async (camera: number, x: number, y: number): Promise<Pt | null> => {
      try {
        const data = await postJson(`${BASE}/snap_fiducial`, { camera, click_x: x, click_y: y });
        if (data.snapped_x === undefined) {
          setError(data.error || "snap failed");
          return null;
        }
        return [data.snapped_x, data.snapped_y];
      } catch (e: any) {
        setError(errorMessage(e));
        return null;
      }
    },
    [],
  );

  const generate = useCallback(async (body: any): Promise<any> => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson(`${BASE}/generate_model`, body);
      if (!data.success) {
        setError(data.error || "model generation failed");
        return null;
      }
      return data;
    } catch (e: any) {
      setError(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const generateScaleFactor = useCallback(async (body: any): Promise<any> => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson(`${BASE}/scale_factor/generate`, body);
      if (!data.success) {
        setError(data.error || "scale-factor generation failed");
        return null;
      }
      return data;
    } catch (e: any) {
      setError(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const loadModel = useCallback(async (query: Record<string, any>): Promise<any> => {
    try {
      return await fetchJson(`${BASE}/model?${qs(query)}`);
    } catch (e: any) {
      setError(errorMessage(e));
      return null;
    }
  }, []);

  const listFigures = useCallback(async (query: Record<string, any>): Promise<string[]> => {
    try {
      const data = await fetchJson(`${BASE}/figures?${qs(query)}`);
      return data.figures || [];
    } catch (e) {
      setError(`Could not list the figures: ${errorMessage(e)}`);
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
      return await postJson(`${BASE}/validate`, body);
    } catch (e: any) {
      setError(errorMessage(e));
      return { valid: false, error: errorMessage(e) };
    }
  }, []);

  const globalCompute = useCallback(async (body: any): Promise<any> => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson(`${BASE}/global/compute`, body);
      if (data.error) {
        setError(data.error);
        return null;
      }
      return data;
    } catch (e: any) {
      setError(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    busy, error, setError,
    loadFrameImage, snap, generate, generateScaleFactor, loadModel,
    listFigures, figureUrl, validateSource, globalCompute,
  };
}
