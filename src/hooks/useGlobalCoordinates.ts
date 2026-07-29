import { useState, useEffect, useCallback, useRef } from 'react';

export interface OverlapPair {
  camera_a: number;
  camera_b: number;
  pixel_on_a: [number, number] | null;
  pixel_on_b: [number, number] | null;
  frame_a: number;
  frame_b: number;
}

export type SelectionMode =
  | 'none'
  | 'datum'
  | `pair_${number}_${number}_a`
  | `pair_${number}_${number}_b`;

export interface GlobalShiftResult {
  camera_shifts: Record<string, [number, number]>;
  datum_physical: [number, number];
  cameras_saved: number[];
}

function generatePairs(cameras: number[]): OverlapPair[] {
  const sorted = [...cameras].sort((a, b) => a - b);
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    pairs.push({
      camera_a: sorted[i],
      camera_b: sorted[i + 1],
      pixel_on_a: null,
      pixel_on_b: null,
      frame_a: 1,
      frame_b: 1,
    });
  }
  return pairs;
}

/**
 * Multi-camera global coordinates: a datum (one camera's pixel -> physical mm) plus
 * an overlap-pair chain that places every camera in one shared rig frame.
 *
 * This hook owns the datum + overlap state and persists it to the per-source
 * settings sidecar (`global_coordinates` block) via GET/POST
 * `/calibration/settings`. Storage is per-source, so switching source swaps the
 * whole form — there is no reset-on-source-change bookkeeping. The shared frame
 * is BAKED INTO each camera's model.mat (world_offset_mm) by saveGlobalFrame()
 * -> POST /calibration/global/save; the calibrate step then reads it. The mirror
 * (a camera whose image x runs opposite the global +x) is handled by that
 * camera's calibration axis choice, not a flag here.
 */
export function useGlobalCoordinates(
  cameraOptions: number[],
  sourcePathIdx: number,
) {
  const [enabled, setEnabled] = useState(false);
  const [datumPixel, setDatumPixel] = useState<[number, number] | null>(null);
  const [datumPhysicalX, setDatumPhysicalX] = useState('0');
  const [datumPhysicalY, setDatumPhysicalY] = useState('0');
  const [datumFrame, setDatumFrame] = useState(1);
  const [overlapPairs, setOverlapPairs] = useState<OverlapPair[]>([]);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none');

  // The last-loaded sidecar block, kept so the pair merge below can re-run when
  // the configured camera set changes without re-fetching.
  const [loadedGC, setLoadedGC] = useState<any>(null);

  // Result of the last "Compute + Save Global Frame" action (per-camera mm shifts).
  const [savedShifts, setSavedShifts] = useState<GlobalShiftResult | null>(null);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Debounce timer ref
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // False while (re)hydrating from a source's sidecar — a pending save must never
  // write one source's picks into another source's sidecar.
  const readyRef = useRef(false);
  // Monotonic load sequence; a stale response must not overwrite a newer load.
  const seqRef = useRef(0);

  // Load the per-source global_coordinates block (server seeds when absent; GET
  // never writes) on mount and whenever the selected source changes.
  useEffect(() => {
    const seq = ++seqRef.current;
    readyRef.current = false;
    (async () => {
      try {
        const res = await fetch(`/backend/calibration/settings?source_path_idx=${sourcePathIdx}`);
        const data = await res.json();
        if (seq !== seqRef.current) return;  // superseded by a newer load
        if (!res.ok || !data.settings) {
          // Guard stays CLOSED: the form still holds another source's picks and
          // an open guard would let the debounced save write them into THIS
          // source's sidecar. Surface the failure instead of console-only.
          setGlobalError(`Failed to load global coordinates: ${data.error ?? res.status}`);
          return;
        }
        const gc = data.settings.global_coordinates || {};
        setLoadedGC(gc);
        setEnabled(gc.enabled ?? false);
        setDatumPixel(
          gc.datum_pixel && gc.datum_pixel[0] != null && gc.datum_pixel[1] != null
            ? gc.datum_pixel : null,
        );
        setDatumPhysicalX(String(gc.datum_physical?.[0] ?? 0));
        setDatumPhysicalY(String(gc.datum_physical?.[1] ?? 0));
        setDatumFrame(gc.datum_frame ?? 1);
        // Drop the previous source's live picks so the pair merge below rebuilds
        // purely from this source's saved pairs (live-wins must not leak across
        // sources).
        setOverlapPairs([]);
        setSavedShifts(null);  // shifts shown belonged to the previous source
        setGlobalError(null);
        // A save scheduled before/during hydration captured the OLD picks —
        // cancel it; user actions after hydration reschedule.
        if (saveTimer.current) clearTimeout(saveTimer.current);
        readyRef.current = true;
      } catch (e) {
        if (seq !== seqRef.current) return;
        setGlobalError(`Failed to load global coordinates: ${String(e)}`);
      }
    })();
  }, [sourcePathIdx]);

  // Always generate pairs for adjacent cameras, merging saved values in. LIVE
  // picks win over the loaded snapshot: the parent re-renders with a fresh
  // cameraOptions identity, and rebuilding purely from loadedGC (a hydration-time
  // snapshot) would silently revert every pair picked since.
  useEffect(() => {
    const savedPairs: OverlapPair[] | undefined = loadedGC?.overlap_pairs;
    setOverlapPairs(prev =>
      generatePairs(cameraOptions).map(gp => {
        const live = prev.find(
          p => p.camera_a === gp.camera_a && p.camera_b === gp.camera_b
        );
        if (live && (live.pixel_on_a || live.pixel_on_b)) return live;
        const saved = Array.isArray(savedPairs)
          ? savedPairs.find(
              sp => sp.camera_a === gp.camera_a && sp.camera_b === gp.camera_b
            )
          : undefined;
        return saved ? { ...gp, ...saved } : gp;
      })
    );
  }, [loadedGC, cameraOptions]);

  // Save the block to the source's sidecar (debounced).
  const saveToConfig = useCallback(
    (overrides?: Partial<{
      enabled: boolean;
      datum_pixel: [number, number] | null;
      datum_physical: [number, number];
      datum_frame: number;
      overlap_pairs: OverlapPair[];
    }>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);

      saveTimer.current = setTimeout(async () => {
        // Mid-hydration there is nothing user-driven to save, and writing would
        // put stale form state into the newly selected source's sidecar.
        if (!readyRef.current) return;
        const physX = overrides?.datum_physical?.[0] ?? (parseFloat(datumPhysicalX) || 0);
        const physY = overrides?.datum_physical?.[1] ?? (parseFloat(datumPhysicalY) || 0);

        const payload = {
          enabled: overrides?.enabled ?? enabled,
          datum_camera: 1,
          datum_pixel: overrides?.datum_pixel !== undefined ? overrides.datum_pixel : datumPixel,
          datum_physical: [physX, physY],
          datum_frame: overrides?.datum_frame ?? datumFrame,
          overlap_pairs: (overrides?.overlap_pairs ?? overlapPairs).filter(
            p => p.pixel_on_a !== null || p.pixel_on_b !== null
          ),
        };

        try {
          await fetch('/backend/calibration/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_path_idx: sourcePathIdx,
              settings: { global_coordinates: payload },
            }),
          });
        } catch (e) {
          console.error('Failed to save global coordinates:', e);
        }
      }, 300);
    },
    [enabled, datumPixel, datumPhysicalX, datumPhysicalY, datumFrame, overlapPairs, sourcePathIdx]
  );

  // Toggle enabled
  const handleSetEnabled = useCallback(
    (val: boolean) => {
      setEnabled(val);
      saveToConfig({ enabled: val });
    },
    [saveToConfig]
  );

  // Handle datum point selection from image click
  const handleDatumPointSelect = useCallback(
    (px: number, py: number) => {
      const pixel: [number, number] = [px, py];
      setDatumPixel(pixel);
      setSelectionMode('none');
      saveToConfig({ datum_pixel: pixel });
    },
    [saveToConfig]
  );

  // Handle pair point selection: sets one side of a specific pair
  const handlePairPointSelect = useCallback(
    (px: number, py: number, cameraA: number, cameraB: number, side: 'a' | 'b') => {
      setOverlapPairs(prev => {
        const updated = prev.map(pair => {
          if (pair.camera_a !== cameraA || pair.camera_b !== cameraB) return pair;
          if (side === 'a') {
            return { ...pair, pixel_on_a: [px, py] as [number, number] };
          } else {
            return { ...pair, pixel_on_b: [px, py] as [number, number] };
          }
        });
        saveToConfig({ overlap_pairs: updated });
        return updated;
      });
      setSelectionMode('none');
    },
    [saveToConfig]
  );

  // Clear datum point
  const clearDatum = useCallback(() => {
    setDatumPixel(null);
    saveToConfig({ datum_pixel: null });
  }, [saveToConfig]);

  // Save physical coordinates on blur
  const handlePhysicalBlur = useCallback(() => {
    saveToConfig({
      datum_physical: [parseFloat(datumPhysicalX) || 0, parseFloat(datumPhysicalY) || 0],
    });
  }, [datumPhysicalX, datumPhysicalY, saveToConfig]);

  // Save datum frame on blur
  const handleDatumFrameChange = useCallback(
    (frame: number) => {
      setDatumFrame(frame);
      saveToConfig({ datum_frame: frame });
    },
    [saveToConfig]
  );

  // Compute the datum-chain shifts AND bake them into each camera's model.mat, so the
  // calibrate step reads them. The board + source identify which models to update.
  const saveGlobalFrame = useCallback(
    async (board: string, srcIdx: number): Promise<GlobalShiftResult | null> => {
      if (!datumPixel) {
        setGlobalError('Set the datum point on the datum camera first.');
        return null;
      }
      setSavingGlobal(true);
      setGlobalError(null);
      try {
        const res = await fetch('/backend/calibration/global/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            board,
            source_path_idx: srcIdx,
            datum_camera: 1,
            datum_pixel: datumPixel,
            datum_physical: [parseFloat(datumPhysicalX) || 0, parseFloat(datumPhysicalY) || 0],
            overlap_pairs: overlapPairs.filter(p => p.pixel_on_a && p.pixel_on_b),
          }),
        });
        const data = await res.json();
        if (data.error || !data.success) {
          setGlobalError(data.error || 'Failed to save global frame');
          return null;
        }
        setSavedShifts(data as GlobalShiftResult);
        return data as GlobalShiftResult;
      } catch (e: any) {
        setGlobalError(String(e));
        return null;
      } finally {
        setSavingGlobal(false);
      }
    },
    [datumPixel, datumPhysicalX, datumPhysicalY, overlapPairs]
  );

  return {
    enabled,
    setEnabled: handleSetEnabled,
    datumPixel,
    datumPhysicalX,
    datumPhysicalY,
    setDatumPhysicalX,
    setDatumPhysicalY,
    handlePhysicalBlur,
    datumFrame,
    setDatumFrame: handleDatumFrameChange,
    overlapPairs,
    selectionMode,
    setSelectionMode,
    handleDatumPointSelect,
    handlePairPointSelect,
    clearDatum,
    saveGlobalFrame,
    savedShifts,
    savingGlobal,
    globalError,
  };
}
