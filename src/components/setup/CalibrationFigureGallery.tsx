"use client";

import { useEffect, useState } from "react";
import { errorMessage, fetchJson } from "@/lib/api";

const BASE = "/backend/calibration";

function qs(o: Record<string, unknown>): string {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  return p.toString();
}

/**
 * Diagnostic-figure gallery for a saved calibration model. Lists the proof figures the
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
  // The listing is tagged with the query it was fetched for: after a source/camera switch the
  // previous listing must not be rendered against the new query (its names 404 there).
  // `error` is why the listing failed; a failure is shown, never rendered as "no figures".
  const [listing, setListing] = useState<{ query: string; figures: string[]; error: string | null }>(
    { query: "", figures: [], error: null });
  const [bust, setBust] = useState(0);
  const queryStr = qs(query);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJson(`${BASE}/figures?${queryStr}`);
        if (!cancelled) {
          setListing({ query: queryStr, figures: data.figures || [], error: null });
          setBust(Date.now());
        }
      } catch (e) {
        if (!cancelled) setListing({ query: queryStr, figures: [], error: errorMessage(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryStr, trigger]);

  const current = listing.query === queryStr;
  const figures = current ? listing.figures : [];
  if (current && listing.error) {
    return (
      <div className="mt-4 pt-4 border-t text-xs text-red-600">
        {title}: could not list the figures ({listing.error})
      </div>
    );
  }
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
