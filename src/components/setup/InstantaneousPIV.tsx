"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Plus, ChevronUp, ChevronDown, Save, Camera } from "lucide-react";
import { useInstantaneousPivConfig, PivPass } from "@/hooks/useInstantaneousPivConfig"; // Adjust path
import ImagePairViewer from "@/components/viewer/ImagePairViewer";
import RunPIV from "./RunPIV";

interface InstantaneousPIVProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function InstantaneousPIV({ config, updateConfig }: InstantaneousPIVProps) {
  const { passes, addPass, removePass, movePass, updatePassField, toggleStore } = 
    useInstantaneousPivConfig(config.instantaneous_piv, updateConfig);

  // Camera selection state
  const cameraCount = config?.paths?.camera_count || 1;
  const [selectedCameras, setSelectedCameras] = useState<number[]>([]);

  // Helper function to save camera selection to backend
  const saveCameraSelection = async (cameras: number[]) => {
    try {
      const res = await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          paths: { 
            ...config.paths,
            camera_numbers: cameras 
          } 
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.updated?.paths) {
          updateConfig(['paths'], { ...config.paths, ...json.updated.paths });
        }
      }
    } catch (e) {
      console.error('Failed to save camera selection:', e);
    }
  };

  useEffect(() => {
    // Initialize selected cameras from config
    const currentCameras = config?.paths?.camera_numbers || [];
    if (currentCameras.length > 0) {
      // Filter out invalid camera numbers (like 0 or out of range)
      const validCameras = currentCameras.filter((c: number) => c >= 1 && c <= cameraCount);
      if (validCameras.length > 0) {
        setSelectedCameras(validCameras);
      } else {
        // Default to camera 1 if no valid cameras, and save it
        const defaultCameras = [1];
        setSelectedCameras(defaultCameras);
        saveCameraSelection(defaultCameras);
      }
    } else {
      // Default to camera 1 if none selected, and save it
      const defaultCameras = [1];
      setSelectedCameras(defaultCameras);
      saveCameraSelection(defaultCameras);
    }
  }, [config?.paths?.camera_numbers, cameraCount]);

  const toggleCamera = async (cameraNum: number) => {
    let newSelectedCameras: number[];
    if (selectedCameras.includes(cameraNum)) {
      // Don't allow deselecting all cameras
      if (selectedCameras.length === 1) return;
      newSelectedCameras = selectedCameras.filter((c: number) => c !== cameraNum);
    } else {
      newSelectedCameras = [...selectedCameras, cameraNum].sort((a, b) => a - b);
    }
    
    setSelectedCameras(newSelectedCameras);
    
    // Save to backend using the helper function
    await saveCameraSelection(newSelectedCameras);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Instantaneous PIV</CardTitle>
          <CardDescription>Configure processing passes and select cameras</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Camera Selection */}
          {cameraCount > 1 && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <Camera className="h-5 w-5 text-soton-blue" />
                <Label className="text-sm font-semibold">Select Cameras to Process</Label>
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: cameraCount }, (_, i) => i + 1).map(camNum => (
                  <Button
                    key={camNum}
                    variant={selectedCameras.includes(camNum) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleCamera(camNum)}
                    className="min-w-[80px]"
                  >
                    Camera {camNum}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Selected cameras: {selectedCameras.join(', ')} (at least one required)
              </p>
            </div>
          )}

          <div className="flex items-center gap-4 flex-wrap mb-6">
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">Configure passes and toggle which to store (final pass always stored)</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={addPass}><Plus className="h-4 w-4 mr-1" /> Add Pass</Button>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-x-2 text-xs font-semibold text-muted-foreground px-2">
            <div className="col-span-2">Window X</div>
            <div className="col-span-2">Window Y</div>
            <div className="col-span-2">Overlap %</div>
            <div className="col-span-1 text-center">Store</div>
            <div className="col-span-3 text-center">Actions</div>
            <div className="col-span-2 text-right">Pass #</div>
          </div>
          
          <div className="space-y-2">
            {passes.map((p, i) => {
              const isLastPass = i === passes.length - 1;
              return (
                <div key={i} className="grid grid-cols-12 gap-x-2 items-center bg-gray-50 p-2 rounded-md">
                  <Input className="col-span-2" type="number" value={p.windowX} onChange={e => updatePassField(i, 'windowX', parseInt(e.target.value, 10) || 0)} />
                  <Input className="col-span-2" type="number" value={p.windowY} onChange={e => updatePassField(i, 'windowY', parseInt(e.target.value, 10) || 0)} />
                  <Input className="col-span-2" type="number" value={p.overlap} onChange={e => updatePassField(i, 'overlap', parseInt(e.target.value, 10) || 0)} />
                  <div className="col-span-1 flex justify-center">
                    <Button 
                      variant={p.store ? "default" : "outline"} 
                      size="sm" 
                      onClick={() => toggleStore(i)}
                      disabled={isLastPass}
                      className="h-8 px-2"
                      title={isLastPass ? "Final pass always stored" : p.store ? "Click to disable storing" : "Click to enable storing"}
                    >
                      <Save className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="col-span-3 flex justify-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => movePass(i, -1)} disabled={i === 0}><ChevronUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => movePass(i, 1)} disabled={i === passes.length - 1}><ChevronDown className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => removePass(i)} disabled={passes.length <= 1}><X className="h-4 w-4 text-red-500" /></Button>
                  </div>
                  <div className="col-span-2 text-sm font-medium text-muted-foreground text-right">Pass {i + 1}</div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 pt-2">Changes are saved automatically.</p>
        </CardContent>
      </Card>

      <ImagePairViewer
        backendUrl="/backend"
        config={config}  
      />

      <RunPIV config={config} />
    </div>
  );
}