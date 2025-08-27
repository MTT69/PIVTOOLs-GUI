"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, ChevronUp, ChevronDown } from "lucide-react";
import ImagePairViewer from "@/components/viewer/ImagePairViewer";
import RunPIV from "./RunPIV";

interface InstantaneousPIVProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

type Pass = { windowX: number; windowY: number; overlap: number };

function passesEqual(a: Pass[], b: Pass[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; ++i) {
    if (
      a[i].windowX !== b[i].windowX ||
      a[i].windowY !== b[i].windowY ||
      a[i].overlap !== b[i].overlap
    ) {
      return false;
    }
  }
  return true;
}

export default function InstantaneousPIV({ config, updateConfig }: InstantaneousPIVProps) {
  const inst = config.instantaneous_piv || {};
  const initWindow = Array.isArray(inst.window_size) ? inst.window_size : [];
  const initOverlap = Array.isArray(inst.overlap) ? inst.overlap : [];
  const initRuns = Array.isArray(inst.runs) ? inst.runs : [6];

  const initialPasses: Pass[] = initWindow.length
    ? initWindow.map((w: any, i: number) => ({
        windowX: Number(w?.[0] ?? 128),
        windowY: Number(w?.[1] ?? 128),
        overlap: Number(initOverlap[i] ?? 50),
      }))
    : [{ windowX: 128, windowY: 128, overlap: 50 }];

  const [passes, setPasses] = useState<Pass[]>(initialPasses);
  const [runs, setRuns] = useState(initRuns.join(","));

  // Debounce timer for autosave
  const saveTimer = useRef<number | null>(null);

  // When we write config to the backend we set this to Date.now() + ms to ignore
  // the incoming config update that reflects our own write. Helps avoid a loop.
  const suppressUntil = useRef<number | null>(null);

  // Track last saved values to avoid feedback loop
  const lastSaved = useRef<{ passes: Pass[]; runs: string }>({
    passes: initialPasses,
    runs: initRuns.join(","),
  });

  // Save to backend and update YAML automatically
  function autoSave(passesVal: Pass[], runsVal: string) {
    // If we're currently suppressing autosave because we just wrote config, skip.
    if (suppressUntil.current && Date.now() < suppressUntil.current) return;

    // Prevent continual POSTs if nothing changed
    if (
      passesEqual(passesVal, lastSaved.current.passes) &&
      runsVal === lastSaved.current.runs
    ) {
      return;
    }
    lastSaved.current = { passes: passesVal.map(p => ({ ...p })), runs: runsVal };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const instantaneous_piv = {
          window_size: passesVal.map(p => [p.windowX, p.windowY]),
          overlap: passesVal.map(p => p.overlap),
          runs: runsVal
            .split(',')
            .map((r: string) => parseInt(r.trim(), 10))
            .filter((n: number) => !isNaN(n)),
        };

        const payload = { instantaneous_piv };

        const res = await fetch('/backend/update_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (res.ok) {
          // Reflect the same instantaneous_piv we sent into local config
          updateConfig(['instantaneous_piv'], instantaneous_piv);
          // Suppress reacting to the incoming config update for a short window
          suppressUntil.current = Date.now() + 1500; // 1.5s suppression
        } else {
          // eslint-disable-next-line no-console
          console.error('update_config failed', json);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('instantaneous_piv auto-save failed', e);
      }
      saveTimer.current = null;
    }, 400) as unknown as number;
  }

  // Auto-save on passes/runs change
  useEffect(() => {
    autoSave(passes, runs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passes, runs]);

  // Only update local state from config if different (avoid feedback loop)
  useEffect(() => {
    // If we recently wrote config and are suppressing reactions, skip syncing.
    if (suppressUntil.current && Date.now() < suppressUntil.current) return;

    const newPasses =
      config.instantaneous_piv?.window_size?.map((w: any, i: number) => ({
        windowX: Number(w?.[0] ?? 128),
        windowY: Number(w?.[1] ?? 128),
        overlap: Number(config.instantaneous_piv.overlap?.[i] ?? 50),
      })) || initialPasses;
    const newRuns = config.instantaneous_piv?.runs
      ? config.instantaneous_piv.runs.join(",")
      : runs;
    if (!passesEqual(newPasses, passes)) setPasses(newPasses);
    if (newRuns !== runs) setRuns(newRuns);
  }, [config.instantaneous_piv?.window_size, config.instantaneous_piv?.overlap, config.instantaneous_piv?.runs]);

  const addPass = () => {
    setPasses(p => {
      const last = p[p.length - 1];
      return [...p, { windowX: Math.max(4, last.windowX / 2 | 0), windowY: Math.max(4, last.windowY / 2 | 0), overlap: last.overlap }];
    });
  };
  const removePass = (idx: number) => {
    setPasses(p => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));
  };
  const move = (idx: number, dir: -1 | 1) => {
    setPasses(p => {
      const ni = idx + dir;
      if (ni < 0 || ni >= p.length) return p;
      const copy = [...p];
      [copy[idx], copy[ni]] = [copy[ni], copy[idx]];
      return copy;
    });
  };
  const updateField = (i: number, field: keyof Pass, val: number) => {
    setPasses(p => {
      const copy = [...p];
      copy[i] = { ...copy[i], [field]: val };
      return copy;
    });
  };

  // --- Filter YAML update for processed pair viewer ---
  // Assume ImagePairViewer accepts an onFiltersChange callback
  const handleFiltersChange = async (filters: any[]) => {
    // Save filters to backend/YAML as the new config
    try {
      const payload = {
        filters,
        paths: {
          base_paths: config.paths?.base_paths || config.paths?.base_dir || [],
          source_paths: config.paths?.source_paths || config.paths?.source || [],
        },
      };
      const res = await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save filters');
      // Optionally reflect into local state:
      // updateConfig(['filters'], filters);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save filters to backend', e);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Instantaneous PIV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap mb-10">
            <div className="flex items-center space-x-3 min-w-0">
              <label className="text-sm font-semibold w-24">Runs</label>
              <div className="min-w-0 relative">
                <Input
                  className="min-w-0 w-48 md:w-64"
                  value={runs}
                  onChange={e => setRuns(e.target.value)}
                  placeholder="6"
                />
                <p className="text-xs text-muted-foreground mt-1 md:mt-0 md:absolute md:left-0 md:top-full md:translate-y-1">
                  Comma-separated list of run numbers
                </p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" className="h-9 px-3 text-sm" onClick={addPass}>
                <Plus className="h-4 w-4 mr-1" /> Add Pass
              </Button>
               <Button variant="outline" className="h-9 px-3 text-sm" disabled={passes.length <= 1} onClick={() => removePass(passes.length - 1)}>
                 <X className="h-4 w-4 mr-1" /> Remove Last
               </Button>
             </div>
          </div>
          {/* Compact header for passes */}
          <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground items-center px- py-0">
            <div className="col-span-2">Window X</div>
            <div className="col-span-2">Window Y</div>
            <div className="col-span-2">Overlap (%)</div>
            <div className="col-span-3 text-center">Actions</div>
            <div className="col-span-3 text-right">Pass</div>
          </div>
          <div className="space-y-1">
            {passes.map((p, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center bg-gray-50 p-1 rounded">
                <div className="col-span-2">
                  <Input className="w-full" type="number" value={p.windowX} onChange={e => updateField(i, 'windowX', parseInt(e.target.value)||0)} />
                </div>
                <div className="col-span-2">
                  <Input className="w-full" type="number" value={p.windowY} onChange={e => updateField(i, 'windowY', parseInt(e.target.value)||0)} />
                </div>
                <div className="col-span-2">
                  <Input className="w-full" type="number" value={p.overlap} onChange={e => updateField(i, 'overlap', parseInt(e.target.value)||0)} />
                </div>
                <div className="col-span-3 flex items-center justify-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i===0}><ChevronUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i===passes.length-1}><ChevronDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => removePass(i)} disabled={passes.length<=1}><X className="h-4 w-4 text-red-500" /></Button>
                </div>
                <div className="col-span-3 text-xs text-muted-foreground text-right">Pass {i+1}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            Changes are saved automatically.
          </p>
        </CardContent>
      </Card>

      {/* Image loading & preprocessing viewer inserted below the PIV config */}
      <ImagePairViewer
        backendUrl="/backend"
        onFiltersChange={handleFiltersChange}
        config={config}  
      />

      {/* PIV execution controls */}
      <RunPIV />
    </div>
  );
}