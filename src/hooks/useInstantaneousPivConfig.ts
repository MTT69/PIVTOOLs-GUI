import { useState, useEffect, useRef, useCallback } from 'react';

// --- Type Definitions ---
export interface PivPass {
  windowX: number | string;
  windowY: number | string;
  overlap: number | string;
  store: boolean;
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
    if (a[i].windowX !== b[i].windowX || a[i].windowY !== b[i].windowY || a[i].overlap !== b[i].overlap || a[i].store !== b[i].store) {
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
  const runsArray = config.runs || [6];
  const initialPasses = (config.window_size || []).map((w, i) => ({
    windowX: w[0] ?? 128,
    windowY: w[1] ?? 128,
    overlap: config.overlap?.[i] ?? 50,
    store: runsArray.includes(i + 1), // Convert runs array to store flags
  }));
  if (initialPasses.length === 0) {
    initialPasses.push({ windowX: 128, windowY: 128, overlap: 50, store: true });
  }
  // Ensure last pass is always set to store
  if (initialPasses.length > 0) {
    initialPasses[initialPasses.length - 1].store = true;
  }

  const [passes, setPasses] = useState<PivPass[]>(initialPasses);

  // --- Refs for Debouncing and Feedback Loop Prevention ---
  const saveTimerRef = useRef<number | null>(null);
  const suppressUntilRef = useRef<number>(0);
  const lastSavedRef = useRef({ passes: initialPasses });

  // --- Backend Synchronization ---
  const autoSave = useCallback((passesToSave: PivPass[]) => {
    if (Date.now() < suppressUntilRef.current) return;
    
    if (passesEqual(passesToSave, lastSavedRef.current.passes)) {
      return;
    }
    
    lastSavedRef.current = { passes: JSON.parse(JSON.stringify(passesToSave)) };

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = window.setTimeout(async () => {
      // Convert store flags to runs array (1-indexed)
      const runsArray = passesToSave
        .map((p, i) => p.store ? i + 1 : null)
        .filter((n): n is number => n !== null);

      const payloadData: InstantaneousPivConfig = {
        window_size: passesToSave.map(p => [typeof p.windowX === 'number' ? p.windowX : parseInt(p.windowX as string) || 128, typeof p.windowY === 'number' ? p.windowY : parseInt(p.windowY as string) || 128]),
        overlap: passesToSave.map(p => typeof p.overlap === 'number' ? p.overlap : parseInt(p.overlap as string) || 50),
        runs: runsArray,
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
    autoSave(passes);
  }, [passes, autoSave]);

  // Sync with incoming config changes, avoiding feedback loops
  useEffect(() => {
    if (Date.now() < suppressUntilRef.current) return;
    
    const runsArray = config.runs || [];
    const newPasses = (config.window_size || []).map((w, i) => ({
        windowX: w[0] ?? 128,
        windowY: w[1] ?? 128,
        overlap: config.overlap?.[i] ?? 50,
        store: runsArray.includes(i + 1),
    }));
    
    // Ensure last pass is always set to store
    if (newPasses.length > 0) {
      newPasses[newPasses.length - 1].store = true;
    }
    
    if (newPasses.length > 0 && !passesEqual(newPasses, passes)) {
      setPasses(newPasses);
    }
  }, [config.window_size, config.overlap, config.runs]);

  // --- State Mutators ---
  const addPass = () => setPasses(p => {
    const last = p[p.length - 1];
    const lastX = typeof last.windowX === 'number' ? last.windowX : parseInt(last.windowX as string) || 128;
    const lastY = typeof last.windowY === 'number' ? last.windowY : parseInt(last.windowY as string) || 128;
    const newPasses = p.map((pass, i) => 
      i === p.length - 1 ? { ...pass, store: false } : pass
    );
    return [...newPasses, { windowX: Math.max(8, Math.floor(lastX / 2)), windowY: Math.max(8, Math.floor(lastY / 2)), overlap: last.overlap, store: true }];
  });
  
  const removePass = (idx: number) => setPasses(p => {
    if (p.length <= 1) return p;
    const newPasses = p.filter((_, i) => i !== idx);
    // Ensure last pass is always set to store
    if (newPasses.length > 0) {
      newPasses[newPasses.length - 1].store = true;
    }
    return newPasses;
  });
  
  const movePass = (idx: number, dir: -1 | 1) => setPasses(p => {
    const newIndex = idx + dir;
    if (newIndex < 0 || newIndex >= p.length) return p;
    const copy = [...p];
    [copy[idx], copy[newIndex]] = [copy[newIndex], copy[idx]];
    // Ensure last pass is always set to store
    if (copy.length > 0) {
      copy.forEach((pass, i) => {
        if (i === copy.length - 1) {
          pass.store = true;
        }
      });
    }
    return copy;
  });

  const updatePassField = (i: number, field: keyof PivPass, val: number | string | boolean) => setPasses(p => {
    const copy = [...p];
    copy[i] = { ...copy[i], [field]: val };
    // Ensure last pass is always set to store
    if (field === 'store' && copy.length > 0) {
      copy[copy.length - 1].store = true;
    }
    return copy;
  });

  const toggleStore = (i: number) => setPasses(p => {
    // Don't allow toggling the last pass
    if (i === p.length - 1) return p;
    const copy = [...p];
    copy[i] = { ...copy[i], store: !copy[i].store };
    return copy;
  });

  return { passes, addPass, removePass, movePass, updatePassField, toggleStore };
}