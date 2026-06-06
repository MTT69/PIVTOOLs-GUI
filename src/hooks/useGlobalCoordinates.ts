import { useState, useEffect, useCallback, useRef } from 'react';

export interface OverlapPair {
  camera_a: number;
  camera_b: number;
  pixel_on_a: [number, number] | null;
  pixel_on_b: [number, number] | null;
  frame_a: number;
  frame_b: number;
}

/** @deprecated Use OverlapPair instead */
export interface OverlapPoint {
  target_camera: number;
  pixel_on_datum_cam: [number, number] | null;
  pixel_on_target: [number, number] | null;
  target_frame: number;
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
 * This hook owns the datum + overlap state and persists it to
 * config.calibration.global_coordinates. The shared frame is BAKED INTO each camera's
 * model.mat (world_offset_mm) by saveGlobalFrame() -> POST /calibration/global/save;
 * the calibrate step then reads it. The mirror (a camera whose image x runs opposite
 * the global +x) is handled by that camera's calibration axis choice, not a flag here.
 */
export function useGlobalCoordinates(
  config: any,
  updateConfig: (path: string[], value: any) => void,
  cameraOptions: number[],
  calibrationSources?: string[]
) {
  const [enabled, setEnabled] = useState(false);
  const [datumPixel, setDatumPixel] = useState<[number, number] | null>(null);
  const [datumPhysicalX, setDatumPhysicalX] = useState('0');
  const [datumPhysicalY, setDatumPhysicalY] = useState('0');
  const [datumFrame, setDatumFrame] = useState(1);
  const [overlapPairs, setOverlapPairs] = useState<OverlapPair[]>([]);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none');

  // Result of the last "Compute + Save Global Frame" action (per-camera mm shifts).
  const [savedShifts, setSavedShifts] = useState<GlobalShiftResult | null>(null);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Debounce timer ref
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track calibration sources to clear stale feature data on source change.
  // Pixel-dependent data (datum_pixel, overlap pairs) becomes invalid when the
  // calibration images change.
  const prevCalibSourcesRef = useRef<string | null>(null);

  useEffect(() => {
    if (!calibrationSources || calibrationSources.length === 0) return;

    const currentKey = JSON.stringify(calibrationSources);

    if (prevCalibSourcesRef.current === null) {
      // First non-empty value after mount — just record, don't reset
      prevCalibSourcesRef.current = currentKey;
      return;
    }

    if (currentKey !== prevCalibSourcesRef.current) {
      prevCalibSourcesRef.current = currentKey;

      // Source changed — clear pixel-dependent feature data
      setDatumPixel(null);
      setOverlapPairs(generatePairs(cameraOptions));
      setSavedShifts(null);

      // Persist reset to backend (direct fetch to avoid saveToConfig dependency issues)
      const gc = config?.calibration?.global_coordinates;
      const resetPayload = {
        enabled: gc?.enabled ?? false,
        datum_camera: 1,
        datum_pixel: null,
        datum_physical: gc?.datum_physical ?? [0, 0],
        datum_frame: gc?.datum_frame ?? 1,
        overlap_pairs: [],
      };

      fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calibration: { global_coordinates: resetPayload }
        })
      }).catch(e => console.error('Failed to reset global coordinates:', e));

      updateConfig(["calibration", "global_coordinates"], resetPayload);
    }
  }, [calibrationSources, cameraOptions, updateConfig]);

  // Load from config on mount — always generate pairs for adjacent cameras, merging saved values
  useEffect(() => {
    const gc = config?.calibration?.global_coordinates;

    // Generate pairs from camera list
    const generated = generatePairs(cameraOptions);

    // Try to merge from saved overlap_pairs first, then fall back to old overlap_points
    const savedPairs: OverlapPair[] | undefined = gc?.overlap_pairs;
    const savedOldPoints: OverlapPoint[] | undefined = gc?.overlap_points;

    const merged = generated.map(gp => {
      // Try new format first
      if (Array.isArray(savedPairs)) {
        const saved = savedPairs.find(
          sp => sp.camera_a === gp.camera_a && sp.camera_b === gp.camera_b
        );
        if (saved) return { ...gp, ...saved };
      }
      // Fall back to old format: overlap_points were cam1→target
      if (Array.isArray(savedOldPoints) && gp.camera_a === 1) {
        const oldPoint = savedOldPoints.find(
          op => op.target_camera === gp.camera_b
        );
        if (oldPoint) {
          return {
            ...gp,
            pixel_on_a: oldPoint.pixel_on_datum_cam,
            pixel_on_b: oldPoint.pixel_on_target,
            frame_a: gc?.datum_frame ?? 1,
            frame_b: oldPoint.target_frame ?? 1,
          };
        }
      }
      return gp;
    });
    setOverlapPairs(merged);

    if (!gc) return;
    setEnabled(gc.enabled ?? false);
    setDatumPixel(gc.datum_pixel && gc.datum_pixel[0] != null && gc.datum_pixel[1] != null ? gc.datum_pixel : null);
    setDatumPhysicalX(String(gc.datum_physical?.[0] ?? 0));
    setDatumPhysicalY(String(gc.datum_physical?.[1] ?? 0));
    setDatumFrame(gc.datum_frame ?? 1);
  }, [config?.calibration?.global_coordinates, cameraOptions]);

  // Save to config (debounced)
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
          await fetch('/backend/update_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              calibration: { global_coordinates: payload }
            })
          });
        } catch (e) {
          console.error('Failed to save global coordinates config:', e);
        }

        updateConfig(["calibration", "global_coordinates"], payload);
      }, 300);
    },
    [enabled, datumPixel, datumPhysicalX, datumPhysicalY, datumFrame, overlapPairs, updateConfig]
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
    async (board: string, sourcePathIdx: number): Promise<GlobalShiftResult | null> => {
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
            source_path_idx: sourcePathIdx,
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
