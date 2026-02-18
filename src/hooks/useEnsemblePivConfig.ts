import { useState, useEffect, useRef, useCallback } from 'react';

// --- Type Definitions ---
export interface EnsemblePass {
  windowX: number | string;
  windowY: number | string;
  overlap: number | string;
  type: 'std' | 'single';
  store: boolean;
}

export interface EnsemblePivConfig {
  window_size?: [number, number][];
  overlap?: number[];
  type?: ('std' | 'single')[];
  runs?: number[];
  sum_window?: [number, number];
  store_planes?: boolean;
  save_diagnostics?: boolean;
  resume_from_pass?: number;
}

// --- Helper Function ---
function passesEqual(a: EnsemblePass[], b: EnsemblePass[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].windowX !== b[i].windowX ||
      a[i].windowY !== b[i].windowY ||
      a[i].overlap !== b[i].overlap ||
      a[i].type !== b[i].type ||
      a[i].store !== b[i].store
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Manages the state and backend synchronization for the Ensemble PIV configuration.
 * @param config The ensemble_piv section from the global config.
 * @param updateConfig A function to update the global config state.
 */
export function useEnsemblePivConfig(
  config: EnsemblePivConfig = {},
  updateConfig: (path: string[], value: any) => void
) {
  // --- State Initialization ---
  const runsArray = config.runs || [6];
  const typeArray = config.type || [];
  const initialPasses = (config.window_size || []).map((w, i) => ({
    windowX: w[1] ?? 128,  // w[1] is width (X) in backend (height, width) convention
    windowY: w[0] ?? 128,  // w[0] is height (Y) in backend (height, width) convention
    overlap: config.overlap?.[i] ?? 50,
    type: (typeArray[i] || 'std') as 'std' | 'single',
    store: runsArray.includes(i + 1),
  }));
  if (initialPasses.length === 0) {
    initialPasses.push({ windowX: 128, windowY: 128, overlap: 50, type: 'std' as const, store: true });
  }
  // Ensure last pass is always set to store
  if (initialPasses.length > 0) {
    initialPasses[initialPasses.length - 1].store = true;
  }

  const [passes, setPasses] = useState<EnsemblePass[]>(initialPasses);

  // Sum window state - sumWindow[0] is X (width), sumWindow[1] is Y (height)
  const [sumWindow, setSumWindow] = useState<[number | string, number | string]>([
    config.sum_window?.[1] ?? 16,  // sum_window[1] is width (X) in backend (height, width) convention
    config.sum_window?.[0] ?? 16   // sum_window[0] is height (Y) in backend (height, width) convention
  ]);

  // Additional ensemble options
  const [storePlanes, setStorePlanes] = useState<boolean>(config.store_planes ?? false);
  const [saveDiagnostics, setSaveDiagnostics] = useState<boolean>(config.save_diagnostics ?? false);
  const [resumeFromPass, setResumeFromPass] = useState<number | string>(config.resume_from_pass ?? 0);

  // --- Refs for Debouncing and Feedback Loop Prevention ---
  const saveTimerRef = useRef<number | null>(null);
  const suppressUntilRef = useRef<number>(0);
  const lastSavedRef = useRef<{
    passes: EnsemblePass[];
    sumWindow: [number | string, number | string];
    storePlanes: boolean;
    saveDiagnostics: boolean;
    resumeFromPass: number | string;
  }>({
    passes: initialPasses,
    sumWindow: [config.sum_window?.[1] ?? 16, config.sum_window?.[0] ?? 16],  // Frontend: (X, Y)
    storePlanes: config.store_planes ?? false,
    saveDiagnostics: config.save_diagnostics ?? false,
    resumeFromPass: config.resume_from_pass ?? 0
  });

  // --- Backend Synchronization ---
  const autoSave = useCallback((
    passesToSave: EnsemblePass[],
    sumWindowToSave: [number | string, number | string],
    storePlanesToSave: boolean,
    saveDiagnosticsToSave: boolean,
    resumeFromPassToSave: number | string
  ) => {
    if (Date.now() < suppressUntilRef.current) return;

    // Check if anything changed
    const passesChanged = !passesEqual(passesToSave, lastSavedRef.current.passes as EnsemblePass[]);
    const sumWindowChanged =
      sumWindowToSave[0] !== lastSavedRef.current.sumWindow[0] ||
      sumWindowToSave[1] !== lastSavedRef.current.sumWindow[1];
    const storePlanesChanged = storePlanesToSave !== lastSavedRef.current.storePlanes;
    const saveDiagnosticsChanged = saveDiagnosticsToSave !== lastSavedRef.current.saveDiagnostics;
    const resumeFromPassChanged = resumeFromPassToSave !== lastSavedRef.current.resumeFromPass;

    if (!passesChanged && !sumWindowChanged && !storePlanesChanged && !saveDiagnosticsChanged && !resumeFromPassChanged) {
      return;
    }

    lastSavedRef.current = {
      passes: JSON.parse(JSON.stringify(passesToSave)),
      sumWindow: [sumWindowToSave[0], sumWindowToSave[1]],
      storePlanes: storePlanesToSave,
      saveDiagnostics: saveDiagnosticsToSave,
      resumeFromPass: resumeFromPassToSave
    };

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = window.setTimeout(async () => {
      // Convert store flags to runs array (1-indexed)
      const runsArray = passesToSave
        .map((p, i) => p.store ? i + 1 : null)
        .filter((n): n is number => n !== null);

      const payloadData: EnsemblePivConfig = {
        window_size: passesToSave.map(p => [
          typeof p.windowY === 'number' ? p.windowY : parseInt(p.windowY as string) || 128,  // Backend convention: height (Y) first
          typeof p.windowX === 'number' ? p.windowX : parseInt(p.windowX as string) || 128   // width (X) second
        ]),
        overlap: passesToSave.map(p => typeof p.overlap === 'number' ? p.overlap : parseInt(p.overlap as string) || 50),
        type: passesToSave.map(p => p.type),
        runs: runsArray,
        sum_window: [
          typeof sumWindowToSave[1] === 'number' ? sumWindowToSave[1] : parseInt(sumWindowToSave[1] as string) || 16,  // Backend convention: height (Y) first
          typeof sumWindowToSave[0] === 'number' ? sumWindowToSave[0] : parseInt(sumWindowToSave[0] as string) || 16   // width (X) second
        ],
        store_planes: storePlanesToSave,
        save_diagnostics: saveDiagnosticsToSave,
        resume_from_pass: typeof resumeFromPassToSave === 'number' ? resumeFromPassToSave : parseInt(resumeFromPassToSave as string) || 0,
      };

      try {
        const res = await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ensemble_piv: payloadData }),
        });
        if (res.ok) {
          updateConfig(['ensemble_piv'], payloadData);
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
    autoSave(passes, sumWindow, storePlanes, saveDiagnostics, resumeFromPass);
  }, [passes, sumWindow, storePlanes, saveDiagnostics, resumeFromPass, autoSave]);

  // Sync with incoming config changes, avoiding feedback loops
  useEffect(() => {
    if (Date.now() < suppressUntilRef.current) return;

    const runsArray = config.runs || [];
    const typeArray = config.type || [];
    const newPasses = (config.window_size || []).map((w, i) => ({
      windowX: w[1] ?? 128,  // w[1] is width (X) in backend (height, width) convention
      windowY: w[0] ?? 128,  // w[0] is height (Y) in backend (height, width) convention
      overlap: config.overlap?.[i] ?? 50,
      type: (typeArray[i] || 'std') as 'std' | 'single',
      store: runsArray.includes(i + 1),
    }));

    // Ensure last pass is always set to store
    if (newPasses.length > 0) {
      newPasses[newPasses.length - 1].store = true;
    }

    if (newPasses.length > 0 && !passesEqual(newPasses, passes)) {
      setPasses(newPasses);
    }

    // Sync sum_window - swap from backend (height, width) to frontend (X, Y) convention
    if (config.sum_window) {
      const newSumWindow: [number | string, number | string] = [
        config.sum_window[1] ?? 16,  // width (X) from backend index 1
        config.sum_window[0] ?? 16   // height (Y) from backend index 0
      ];
      if (newSumWindow[0] !== sumWindow[0] || newSumWindow[1] !== sumWindow[1]) {
        setSumWindow(newSumWindow);
      }
    }

    // Sync other options
    if (config.store_planes !== undefined && config.store_planes !== storePlanes) {
      setStorePlanes(config.store_planes);
    }
    if (config.save_diagnostics !== undefined && config.save_diagnostics !== saveDiagnostics) {
      setSaveDiagnostics(config.save_diagnostics);
    }
    if (config.resume_from_pass !== undefined && config.resume_from_pass !== resumeFromPass) {
      setResumeFromPass(config.resume_from_pass);
    }
  }, [config.window_size, config.overlap, config.runs, config.type, config.sum_window, config.store_planes, config.save_diagnostics, config.resume_from_pass]);

  // --- State Mutators ---
  const addPass = () => setPasses(p => {
    const last = p[p.length - 1];
    const lastX = typeof last.windowX === 'number' ? last.windowX : parseInt(last.windowX as string) || 128;
    const lastY = typeof last.windowY === 'number' ? last.windowY : parseInt(last.windowY as string) || 128;
    const newPasses = p.map((pass, i) =>
      i === p.length - 1 ? { ...pass, store: false } : pass
    );
    return [...newPasses, {
      windowX: Math.max(8, Math.floor(lastX / 2)),
      windowY: Math.max(8, Math.floor(lastY / 2)),
      overlap: last.overlap,
      type: 'std' as const,
      store: true
    }];
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

  const updatePassField = (i: number, field: keyof EnsemblePass, val: number | string | boolean) => setPasses(p => {
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

  const updateSumWindow = (idx: 0 | 1, val: number | string) => {
    setSumWindow(prev => {
      const newWindow: [number | string, number | string] = [...prev];
      newWindow[idx] = val;
      return newWindow;
    });
  };

  const toggleStorePlanes = () => setStorePlanes(prev => !prev);
  const toggleSaveDiagnostics = () => setSaveDiagnostics(prev => !prev);
  const updateResumeFromPass = (val: number | string) => setResumeFromPass(val);

  // Check if any pass has type 'single' (to show sum_window input)
  const hasSinglePass = passes.some(p => p.type === 'single');

  return {
    passes,
    addPass,
    removePass,
    movePass,
    updatePassField,
    toggleStore,
    sumWindow,
    updateSumWindow,
    storePlanes,
    toggleStorePlanes,
    saveDiagnostics,
    toggleSaveDiagnostics,
    resumeFromPass,
    updateResumeFromPass,
    hasSinglePass
  };
}
