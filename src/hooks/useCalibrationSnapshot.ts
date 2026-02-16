import { useState, useEffect, useCallback } from 'react';

interface SnapshotInfo {
  exists: boolean;
  date?: string;
  calibration_method?: string;
}

export function useCalibrationSnapshot(basePathIdx: number = 0, refetchConfig?: () => Promise<void>) {
  const [snapshotInfo, setSnapshotInfo] = useState<SnapshotInfo>({ exists: false });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadSuccess, setLoadSuccess] = useState(false);

  const checkSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`/backend/calibration/snapshot?base_path_idx=${basePathIdx}`);
      if (res.ok) {
        const data = await res.json();
        setSnapshotInfo(data);
      } else {
        setSnapshotInfo({ exists: false });
      }
    } catch {
      setSnapshotInfo({ exists: false });
    }
  }, [basePathIdx]);

  useEffect(() => {
    checkSnapshot();
  }, [checkSnapshot]);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadSuccess(false);
    try {
      const res = await fetch('/backend/calibration/snapshot/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_path_idx: basePathIdx }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error || 'Failed to load snapshot');
        return;
      }
      // Re-fetch config to pick up restored calibration (no page reload)
      if (refetchConfig) {
        await refetchConfig();
      }
      setLoadSuccess(true);
      // Clear success message after 3 seconds
      setTimeout(() => setLoadSuccess(false), 3000);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load snapshot');
    } finally {
      setLoading(false);
    }
  }, [basePathIdx, refetchConfig]);

  return { snapshotInfo, loading, loadError, loadSuccess, loadSnapshot, checkSnapshot };
}
