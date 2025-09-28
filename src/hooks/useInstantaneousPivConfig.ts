import { useState, useEffect, useRef, useCallback } from 'react';

// --- Type Definitions ---
export interface PivPass {
  windowX: number;
  windowY: number;
  overlap: number;
}

export interface InstantaneousPivConfig {
  window_size?: [number, number][];
  overlap?: number[];
  runs?: number[];
}

// --- Helper Function ---
function passesEqual(a: PivPass[], b: PivPass[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].windowX !== b[i].windowX || a[i].windowY !== b[i].windowY || a[i].overlap !== b[i].overlap) {
      return false;
    }
  }
  return true;
}

/**
 * Manages the state and backend synchronization for the Instantaneous PIV configuration.
 * @param config The instantaneous_piv section from the global config.
 * @param updateConfig A function to update the global config state.
 */
export function useInstantaneousPivConfig(
  config: InstantaneousPivConfig = {},
  updateConfig: (path: string[], value: any) => void
) {
  // --- State Initialization ---
  const initialPasses = (config.window_size || []).map((w, i) => ({
    windowX: w[0] ?? 128,
    windowY: w[1] ?? 128,
    overlap: config.overlap?.[i] ?? 50,
  }));
  if (initialPasses.length === 0) {
    initialPasses.push({ windowX: 128, windowY: 128, overlap: 50 });
  }

  const [passes, setPasses] = useState<PivPass[]>(initialPasses);
  const [runs, setRuns] = useState<string>((config.runs || [6]).join(','));

  // --- Refs for Debouncing and Feedback Loop Prevention ---
  const saveTimerRef = useRef<number | null>(null);
  const suppressUntilRef = useRef<number>(0);
  const lastSavedRef = useRef({ passes: initialPasses, runs: runs });

  // --- Backend Synchronization ---
  const autoSave = useCallback((passesToSave: PivPass[], runsToSave: string) => {
    if (Date.now() < suppressUntilRef.current) return;
    
    if (passesEqual(passesToSave, lastSavedRef.current.passes) && runsToSave === lastSavedRef.current.runs) {
      return;
    }
    
    lastSavedRef.current = { passes: JSON.parse(JSON.stringify(passesToSave)), runs: runsToSave };

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = window.setTimeout(async () => {
      const payloadData: InstantaneousPivConfig = {
        window_size: passesToSave.map(p => [p.windowX, p.windowY]),
        overlap: passesToSave.map(p => p.overlap),
        runs: runsToSave.split(',').map(r => parseInt(r.trim(), 10)).filter(n => !isNaN(n)),
      };

      try {
        const res = await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instantaneous_piv: payloadData }),
        });
        if (res.ok) {
          updateConfig(['instantaneous_piv'], payloadData);
          suppressUntilRef.current = Date.now() + 1500; // Suppress updates for 1.5s
        } else {
          console.error('Failed to update config:', await res.json());
        }
      } catch (e) {
        console.error('Auto-save failed:', e);
      }
    }, 400);
  }, [updateConfig]);

  // --- Effects ---
  // Auto-save when local state changes
  useEffect(() => {
    autoSave(passes, runs);
  }, [passes, runs, autoSave]);

  // Sync with incoming config changes, avoiding feedback loops
  useEffect(() => {
    if (Date.now() < suppressUntilRef.current) return;
    
    const newPasses = (config.window_size || []).map((w, i) => ({
        windowX: w[0] ?? 128,
        windowY: w[1] ?? 128,
        overlap: config.overlap?.[i] ?? 50,
    }));
    
    if (newPasses.length > 0 && !passesEqual(newPasses, passes)) {
      setPasses(newPasses);
    }
    
    const newRuns = (config.runs || []).join(',');
    if (newRuns && newRuns !== runs) {
      setRuns(newRuns);
    }
  }, [config.window_size, config.overlap, config.runs]);

  // --- State Mutators ---
  const addPass = () => setPasses(p => {
    const last = p[p.length - 1];
    return [...p, { windowX: Math.max(8, Math.floor(last.windowX / 2)), windowY: Math.max(8, Math.floor(last.windowY / 2)), overlap: last.overlap }];
  });
  
  const removePass = (idx: number) => setPasses(p => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));
  
  const movePass = (idx: number, dir: -1 | 1) => setPasses(p => {
    const newIndex = idx + dir;
    if (newIndex < 0 || newIndex >= p.length) return p;
    const copy = [...p];
    [copy[idx], copy[newIndex]] = [copy[newIndex], copy[idx]];
    return copy;
  });

  const updatePassField = (i: number, field: keyof PivPass, val: number) => setPasses(p => {
    const copy = [...p];
    copy[i] = { ...copy[i], [field]: val };
    return copy;
  });

  return { passes, runs, setRuns, addPass, removePass, movePass, updatePassField };
}