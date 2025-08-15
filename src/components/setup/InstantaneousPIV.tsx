"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, ChevronUp, ChevronDown, Save } from "lucide-react";
import ImagePairViewer from "@/components/viewer/ImagePairViewer";
import RunPIV from "./RunPIV"; // Added run/test PIV controls

interface InstantaneousPIVProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

type Pass = { windowX: number; windowY: number; overlap: number };

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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const markDirty = () => setDirty(true);

  const addPass = () => {
    setPasses(p => {
      const last = p[p.length - 1];
      return [...p, { windowX: Math.max(4, last.windowX / 2 | 0), windowY: Math.max(4, last.windowY / 2 | 0), overlap: last.overlap }];
    });
    markDirty();
  };
  const removePass = (idx: number) => {
    setPasses(p => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));
    markDirty();
  };
  const move = (idx: number, dir: -1 | 1) => {
    setPasses(p => {
      const ni = idx + dir;
      if (ni < 0 || ni >= p.length) return p;
      const copy = [...p];
      [copy[idx], copy[ni]] = [copy[ni], copy[idx]];
      return copy;
    });
    markDirty();
  };
  const updateField = (i: number, field: keyof Pass, val: number) => {
    setPasses(p => {
      const copy = [...p];
      copy[i] = { ...copy[i], [field]: val };
      return copy;
    });
    markDirty();
  };

  async function save() {
    setSaving(true);
    try {
      const payload = {
        window_size: passes.map(p => [p.windowX, p.windowY]),
        overlap: passes.map(p => p.overlap),
        runs: runs
          .split(',')
          .map((r: string) => parseInt(r.trim(), 10))
          .filter((n: number) => !isNaN(n)),
      };
      const res = await fetch('/backend/update_instantaneous', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      updateConfig(['instantaneous_piv'], json.instantaneous_piv);
      setDirty(false);
    } catch (e) {
      console.error('instantaneous_piv save failed', e);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (config.instantaneous_piv?.runs) {
      setRuns(config.instantaneous_piv.runs.join(','));
    }
  }, [config.instantaneous_piv?.runs]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Instantaneous PIV (YAML)</CardTitle>
          <Button variant="outline" disabled={!dirty || saving} onClick={save} className="flex items-center gap-2">
            <Save className="h-4 w-4" /> {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-end gap-4">
            <div className="flex flex-col w-full max-w-xs">
              <label className="text-sm font-semibold mb-1">Runs</label>
              <Input value={runs} onChange={e => { setRuns(e.target.value); markDirty(); }} placeholder="6" />
              <p className="text-xs text-muted-foreground mt-1">Comma-separated list of run numbers</p>
            </div>
            <div className="flex items-center gap-2 mt-4 md:mt-0">
              <Button variant="outline" onClick={addPass}><Plus className="h-4 w-4" /> Pass</Button>
              <Button variant="outline" disabled={passes.length <= 1} onClick={() => removePass(passes.length - 1)}>
                <X className="h-4 w-4" /> Last
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            {passes.map((p, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end bg-gray-50 p-3 rounded">
                <div className="col-span-2">
                  <label className="text-xs font-semibold">Window X</label>
                  <Input type="number" value={p.windowX} onChange={e => updateField(i, 'windowX', parseInt(e.target.value)||0)} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold">Window Y</label>
                  <Input type="number" value={p.windowY} onChange={e => updateField(i, 'windowY', parseInt(e.target.value)||0)} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold">Overlap (%)</label>
                  <Input type="number" value={p.overlap} onChange={e => updateField(i, 'overlap', parseInt(e.target.value)||0)} />
                </div>
                <div className="col-span-3 flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i===0}><ChevronUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i===passes.length-1}><ChevronDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => removePass(i)} disabled={passes.length<=1}><X className="h-4 w-4 text-red-500" /></Button>
                </div>
                <div className="col-span-3 text-xs text-muted-foreground">Pass {i+1}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">Changes apply only after Save (writes instantaneous_piv in YAML).</p>
        </CardContent>
      </Card>

      {/* Image loading & preprocessing viewer inserted below the PIV config */}
  <ImagePairViewer backendUrl="/backend" />

  {/* PIV execution controls (includes dummy Test PIV button for temporal-batch run) */}
  <RunPIV />
    </div>
  );
}