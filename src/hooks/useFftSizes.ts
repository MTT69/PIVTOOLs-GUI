import { useEffect, useState } from 'react';

/**
 * Valid PIV window axis lengths, served by the backend from the single source of
 * truth (`pivtools_core.fft_sizes.BUILT_FFT_SIZES`). The codelet FFT engine is only
 * built for these sizes, so window-size dropdowns must be limited to them.
 *
 * Fetched once and cached at module scope so every Setup component shares one request.
 * No hardcoded fallback list — if the fetch fails we surface the error (the dropdowns
 * render empty) rather than silently drifting out of sync with the backend.
 */
let cachedPromise: Promise<number[]> | null = null;

function loadFftSizes(): Promise<number[]> {
  if (!cachedPromise) {
    cachedPromise = fetch('/backend/fft_sizes')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`/backend/fft_sizes returned ${res.status}`);
        }
        const data = await res.json();
        if (!Array.isArray(data?.sizes)) {
          throw new Error('/backend/fft_sizes response missing "sizes" array');
        }
        return data.sizes as number[];
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
  loading: boolean;
  error: string | null;
}

export function useFftSizes(): UseFftSizesResult {
  const [sizes, setSizes] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadFftSizes()
      .then((s) => {
        if (!cancelled) {
          setSizes(s);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { sizes, loading, error };
}
