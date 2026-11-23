import { useEffect, useState } from 'react';
import { fetchJson, errorMessage } from '@/lib/api';

/**
 * Optional image types the backend tells the GUI to offer (`GET /backend/features`).
 *
 * `acquisitionRuns` gates the `.pivraw` acquisition-run type: its Image Type
 * dropdown entry and "Import acquisition run". The backend sets it from
 * `PIVTOOLS_ACQUISITION=1`; the reader itself works either way.
 *
 * Fetched once and cached at module scope. On failure `acquisitionRuns` is false
 * and `error` says why, so a stale backend shows as an error, not a missing option.
 */
interface FeaturesPayload {
  acquisitionRuns: boolean;
}

let cachedPromise: Promise<FeaturesPayload> | null = null;

function loadFeatures(): Promise<FeaturesPayload> {
  if (!cachedPromise) {
    cachedPromise = fetchJson('/backend/features')
      .then((data) => {
        if (typeof data?.acquisition_runs !== 'boolean') {
          throw new Error(
            '/backend/features response has no boolean "acquisition_runs"; restart the Flask backend to pick up the current build.'
          );
        }
        return { acquisitionRuns: data.acquisition_runs as boolean };
      })
      .catch((err) => {
        // Reset the cache so a later mount can retry instead of being stuck.
        cachedPromise = null;
        throw err;
      });
  }
  return cachedPromise;
}

export interface UseFeaturesResult {
  acquisitionRuns: boolean;
  error: string | null;
}

export function useFeatures(): UseFeaturesResult {
  const [acquisitionRuns, setAcquisitionRuns] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadFeatures()
      .then((payload) => {
        if (!cancelled) setAcquisitionRuns(payload.acquisitionRuns);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { acquisitionRuns, error };
}
