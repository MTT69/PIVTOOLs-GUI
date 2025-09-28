"use client";

import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, ChevronUp, ChevronDown } from "lucide-react";
import { useInstantaneousPivConfig, PivPass } from "@/hooks/useInstantaneousPivConfig"; // Adjust path
import ImagePairViewer from "@/components/viewer/ImagePairViewer";
import RunPIV from "./RunPIV";

interface InstantaneousPIVProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function InstantaneousPIV({ config, updateConfig }: InstantaneousPIVProps) {
  const { passes, runs, setRuns, addPass, removePass, movePass, updatePassField } = 
    useInstantaneousPivConfig(config.instantaneous_piv, updateConfig);

  const handleFiltersChange = async (filters: any[]) => {
    try {
      await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      });
      // The global config will update, and our components will react automatically.
    } catch (e) {
      console.error('Failed to save filters to backend', e);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Instantaneous PIV</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap mb-6">
            <div className="flex items-center gap-3">
              <label htmlFor="runs-input" className="text-sm font-semibold">Runs</label>
              <Input
                id="runs-input"
                className="w-48"
                value={runs}
                onChange={e => setRuns(e.target.value)}
                placeholder="e.g., 6,5,4"
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={addPass}><Plus className="h-4 w-4 mr-1" /> Add Pass</Button>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-x-2 text-xs font-semibold text-muted-foreground px-2">
            <div className="col-span-2">Window X</div>
            <div className="col-span-2">Window Y</div>
            <div className="col-span-2">Overlap %</div>
            <div className="col-span-3 text-center">Actions</div>
            <div className="col-span-3 text-right">Pass #</div>
          </div>
          
          <div className="space-y-2">
            {passes.map((p, i) => (
              <div key={i} className="grid grid-cols-12 gap-x-2 items-center bg-gray-50 p-2 rounded-md">
                <Input className="col-span-2" type="number" value={p.windowX} onChange={e => updatePassField(i, 'windowX', parseInt(e.target.value, 10) || 0)} />
                <Input className="col-span-2" type="number" value={p.windowY} onChange={e => updatePassField(i, 'windowY', parseInt(e.target.value, 10) || 0)} />
                <Input className="col-span-2" type="number" value={p.overlap} onChange={e => updatePassField(i, 'overlap', parseInt(e.target.value, 10) || 0)} />
                <div className="col-span-3 flex justify-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => movePass(i, -1)} disabled={i === 0}><ChevronUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => movePass(i, 1)} disabled={i === passes.length - 1}><ChevronDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => removePass(i)} disabled={passes.length <= 1}><X className="h-4 w-4 text-red-500" /></Button>
                </div>
                <div className="col-span-3 text-sm font-medium text-muted-foreground text-right">Pass {i + 1}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 pt-2">Changes are saved automatically.</p>
        </CardContent>
      </Card>

      <ImagePairViewer
        backendUrl="/backend"
        onFiltersChange={handleFiltersChange}
        config={config}  
      />

      <RunPIV config={config} />
    </div>
  );
}