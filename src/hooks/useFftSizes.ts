import { useEffect, useState } from 'react';
import { fetchJson, errorMessage } from '@/lib/api';

/**
 * Valid PIV window axis lengths, served by the backend from the single source of
 * truth (`pivtools_core.fft_sizes`). The codelet FFT engine is only built for
 * `sizes`, so window-size dropdowns must be limited to them.
 *
 * `singleModeSizes` is the superset accepted for an ensemble `single` pass: there
 * the correlation FFT runs at sum_window, and window_size is only the Frame-A
 * mask support, so it also admits the small sizes (4, 6). Use it ONLY for a
 * single-type pass's window size — sum_window is a real FFT size and must keep
 * using `sizes`.
 *
 * Fetched once and cached at module scope so every Setup component shares one request.
 * That sharing is why a missing `single_mode_sizes` must not reject the promise: it
 * would blank the dropdowns of every consumer, instantaneous included.
 *
 * No hardcoded fallback list — nothing is defaulted or invented on failure. Callers get
 * an empty list plus a non-null `error` / `singleModeError`. NOTE: no component currently
 * renders `error`, so a total fetch failure shows only as empty dropdowns with every
 * stored value flagged "(unsupported)"; `singleModeError` IS rendered by EnsemblePIV.
 */
interface FftSizePayload {
  sizes: number[];
  singleModeSizes: number[];
  singleModeError: string | null;
}

let cachedPromise: Promise<FftSizePayload> | null = null;

function loadFftSizes(): Promise<FftSizePayload> {
  if (!cachedPromise) {
    cachedPromise = fetchJson('/backend/fft_sizes')
      .then((data) => {
        if (!Array.isArray(data?.sizes)) {
          throw new Error('/backend/fft_sizes response missing "sizes" array');
        }
        // A missing single_mode_sizes means the backend predates the Frame-A
        // size feature (deploy-before-restart skew, this project's normal
        // sequence). Report it, but do NOT reject: `sizes` feeds every window
        // dropdown in the app including instantaneous, which has nothing to do
        // with single mode, and must survive that skew window.
        //
        // Deliberately NOT defaulted to `sizes`: that would silently strip 4/6
        // from single-mode dropdowns with no indication why. An empty list
        // leaves the stored value flagged "(unsupported)" instead — visible.
        const hasSingleMode = Array.isArray(data?.single_mode_sizes);
        if (!hasSingleMode) {
          console.error(
            '/backend/fft_sizes response missing "single_mode_sizes" array — ' +
              'restart the Flask backend to pick up the current build.'
          );
        }
        return {
          sizes: data.sizes as number[],
          singleModeSizes: hasSingleMode ? (data.single_mode_sizes as number[]) : [],
          singleModeError: hasSingleMode
            ? null
            : 'Backend is out of date (no "single_mode_sizes"). Restart the Flask backend to select Frame-A sizes 4/6.',
        };
      })
      .catch((err) => {
        // Reset the cache so a later mount can retry instead of being stuck.
        cachedPromise = null;
        throw err;
      });
  }
  return cachedPromise;
}

export interface UseFftSizesResult {
  sizes: number[];
  singleModeSizes: number[];
  loading: boolean;
  error: string | null;
  /** Set when the backend served no `single_mode_sizes`; `sizes` is still valid. */
  singleModeError: string | null;
}

export function useFftSizes(): UseFftSizesResult {
  const [sizes, setSizes] = useState<number[]>([]);
  const [singleModeSizes, setSingleModeSizes] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [singleModeError, setSingleModeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadFftSizes()
      .then((payload) => {
        if (!cancelled) {
          setSizes(payload.sizes);
          setSingleModeSizes(payload.singleModeSizes);
          setSingleModeError(payload.singleModeError);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : errorMessage(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { sizes, singleModeSizes, loading, error, singleModeError };
}
