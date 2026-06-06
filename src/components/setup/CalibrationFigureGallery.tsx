"use client";

import { useEffect, useState } from "react";

const BASE = "/backend/calibration";

function qs(o: Record<string, unknown>): string {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  return p.toString();
}

/**
 * Diagnostic-figure gallery for a saved calibration2 model. Lists the proof figures the
 * backend writes beside the model (reprojection scatter, coverage, residuals, ...) and
 * renders each one. Shared by every calibration tab so a fit is always verified by its
 * figure, not just a reported RMS.
 *
 * `query` is the model locator (mono: {board, camera, source_path_idx}; stereo adds
 * {stereo:1, camera_pair}). `trigger` should be the model object itself — a new reference
 * (on generate or restore) re-fetches the list and busts the image cache, so a fresh
 * calibration's overwritten figures are shown rather than the browser's stale copies.
 */
export function CalibrationFigureGallery({
  query,
  trigger,
  title = "Diagnostic Figures",
}: {
  query: Record<string, unknown>;
  trigger?: unknown;
  title?: string;
}) {
  const [figures, setFigures] = useState<string[]>([]);
  const [bust, setBust] = useState(0);
  const queryStr = qs(query);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/figures?${queryStr}`);
        const data = await res.json();
        if (!cancelled) {
          setFigures(data.figures || []);
          setBust(Date.now());
        }
      } catch {
        if (!cancelled) setFigures([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryStr, trigger]);

  if (figures.length === 0) return null;
  return (
    <div className="mt-4 pt-4 border-t">
      <h4 className="text-sm font-semibold mb-2">{title}</h4>
      <div className="grid md:grid-cols-2 gap-3">
        {figures.map((name) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={name}
            src={`${BASE}/figure?${qs({ ...query, name })}&_v=${bust}`}
            alt={name}
            className="w-full h-auto border rounded"
          />
        ))}
      </div>
    </div>
  );
}
