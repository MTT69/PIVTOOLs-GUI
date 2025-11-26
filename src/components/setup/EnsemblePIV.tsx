"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, ChevronUp, ChevronDown, Save, Settings, ChevronRight, Cpu, HardDrive, Filter } from "lucide-react";
import { useEnsemblePivConfig } from "@/hooks/useEnsemblePivConfig";
import { useConfigUpdate } from "@/hooks/useConfigUpdate";
import ImagePairViewer from "@/components/viewer/ImagePairViewer";
import RunPIV from "./RunPIV";
import OutlierDetectionSettings from "@/components/shared/OutlierDetectionSettings";
import InfillingSettings from "@/components/shared/InfillingSettings";
import PerformanceSettings from "@/components/shared/PerformanceSettings";
import CameraSelector from "@/components/shared/CameraSelector";

interface EnsemblePIVProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function EnsemblePIV({ config, updateConfig }: EnsemblePIVProps) {
  const {
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
  } = useEnsemblePivConfig(config.ensemble_piv, updateConfig);

  const { updateConfig: updateConfigBackend } = useConfigUpdate();

  // Camera selection state
  const cameraCount = config?.paths?.camera_count || 1;
  const [selectedCameras, setSelectedCameras] = useState<number[]>([]);

  // Collapsible sections state
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [outlierOpen, setOutlierOpen] = useState(false);
  const [infillingOpen, setInfillingOpen] = useState(false);
  const [ensembleOptionsOpen, setEnsembleOptionsOpen] = useState(false);

  // Helper function to save camera selection to backend
  const saveCameraSelection = useCallback(async (cameras: number[]) => {
    const payload = {
      paths: {
        camera_numbers: cameras
      }
    };

    const result = await updateConfigBackend(payload);

    if (result.success && result.data?.updated?.paths) {
      updateConfig(['paths'], { ...config.paths, ...result.data.updated.paths });
    } else if (result.error) {
      console.error('Failed to save camera selection:', result.error);
    }
  }, [updateConfigBackend, updateConfig, config.paths]);

  useEffect(() => {
    // Sync selected cameras state with config
    const currentCameras = config?.paths?.camera_numbers || [];

    if (currentCameras.length > 0) {
      // Filter out invalid camera numbers
      const validCameras = currentCameras.filter((c: number) => c >= 1 && c <= cameraCount);

      if (validCameras.length > 0) {
        setSelectedCameras(validCameras);
      } else {
        // If no valid cameras, default to camera 1
        setSelectedCameras([1]);
      }
    } else {
      // If camera_numbers is empty, default to camera 1
      setSelectedCameras([1]);
    }
  }, [config?.paths?.camera_numbers, cameraCount]);

  const handleCameraSelectionChange = useCallback(async (cameras: number[]) => {
    setSelectedCameras(cameras);
    await saveCameraSelection(cameras);
  }, [saveCameraSelection]);

  // Helper function to update config - memoized to prevent re-renders
  const updateConfigValue = useCallback(async (path: string[], value: any) => {
    const pathParts = [...path];
    const payload: any = {};
    let current = payload;

    for (let i = 0; i < pathParts.length - 1; i++) {
      current[pathParts[i]] = {};
      current = current[pathParts[i]];
    }
    current[pathParts[pathParts.length - 1]] = value;

    const result = await updateConfigBackend(payload);

    if (result.success) {
      updateConfig(path, value);
    } else if (result.error) {
      console.error('Failed to update config:', result.error);
    }
  }, [updateConfigBackend, updateConfig]);

  return (
    <div className="space-y-6">
      {/* Image Pre-Processing & Viewer */}
      <ImagePairViewer
        backendUrl="/backend"
        config={config}
        updateConfig={updateConfig}
      />

      <Card>
        <CardHeader>
          <CardTitle>Ensemble PIV</CardTitle>
          <CardDescription>Configure ensemble processing passes and select cameras</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Camera Selection */}
          <CameraSelector
            cameraCount={cameraCount}
            selectedCameras={selectedCameras}
            onSelectionChange={handleCameraSelectionChange}
          />

          <div className="flex items-center gap-4 flex-wrap mb-6">
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">Configure passes, set type (std/single), and toggle which to store</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={addPass}><Plus className="h-4 w-4 mr-1" /> Add Pass</Button>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-x-2 text-xs font-semibold text-muted-foreground px-2">
            <div className="col-span-2">Window X</div>
            <div className="col-span-2">Window Y</div>
            <div className="col-span-2">Overlap %</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-1 text-center">Store</div>
            <div className="col-span-2 text-center">Actions</div>
            <div className="col-span-1 text-right">Pass #</div>
          </div>

          <div className="space-y-2">
            {passes.map((p, i) => {
              const isLastPass = i === passes.length - 1;
              return (
                <div key={i} className="grid grid-cols-12 gap-x-2 items-center bg-gray-50 p-2 rounded-md">
                  <Input
                    className="col-span-2"
                    type="text"
                    value={p.windowX}
                    onChange={e => updatePassField(i, 'windowX', e.target.value)}
                  />
                  <Input
                    className="col-span-2"
                    type="text"
                    value={p.windowY}
                    onChange={e => updatePassField(i, 'windowY', e.target.value)}
                  />
                  <Input
                    className="col-span-2"
                    type="text"
                    value={p.overlap}
                    onChange={e => updatePassField(i, 'overlap', e.target.value)}
                  />
                  <div className="col-span-2">
                    <Select
                      value={p.type}
                      onValueChange={(value: 'std' | 'single') => updatePassField(i, 'type', value)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="std">Standard</SelectItem>
                        <SelectItem value="single">Single</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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
                  <div className="col-span-2 flex justify-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => movePass(i, -1)} disabled={i === 0}><ChevronUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => movePass(i, 1)} disabled={i === passes.length - 1}><ChevronDown className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => removePass(i)} disabled={passes.length <= 1}><X className="h-4 w-4 text-red-500" /></Button>
                  </div>
                  <div className="col-span-1 text-sm font-medium text-muted-foreground text-right">Pass {i + 1}</div>
                </div>
              );
            })}
          </div>

          {/* Sum Window - shown when any pass has type 'single' */}
          {hasSinglePass && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <Label className="text-sm font-semibold text-blue-800">Sum Window (for single-type passes)</Label>
              <p className="text-xs text-blue-600 mb-2">
                Defines the interrogation window used for summing correlation planes in single-type passes.
              </p>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="space-y-1">
                  <Label className="text-xs">Width (X)</Label>
                  <Input
                    type="text"
                    value={sumWindow[0]}
                    onChange={e => updateSumWindow(0, e.target.value)}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Height (Y)</Label>
                  <Input
                    type="text"
                    value={sumWindow[1]}
                    onChange={e => updateSumWindow(1, e.target.value)}
                    className="h-8"
                  />
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-gray-500 pt-2">Changes are saved automatically.</p>
        </CardContent>
      </Card>

      {/* Advanced Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Advanced Ensemble Settings
          </CardTitle>
          <CardDescription>Ensemble options, performance tuning, outlier detection, and infilling</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Ensemble-specific Options */}
          <div>
            <Button variant="outline" className="w-full justify-between" onClick={() => setEnsembleOptionsOpen(!ensembleOptionsOpen)}>
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Ensemble Options
              </span>
              <ChevronRight className={`h-4 w-4 transition-transform ${ensembleOptionsOpen ? 'rotate-90' : ''}`} />
            </Button>
            {ensembleOptionsOpen && (
              <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Store Planes</Label>
                      <Button
                        variant={storePlanes ? "default" : "outline"}
                        size="sm"
                        onClick={toggleStorePlanes}
                      >
                        {storePlanes ? "Enabled" : "Disabled"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Save intermediate correlation planes</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Save Diagnostics</Label>
                      <Button
                        variant={saveDiagnostics ? "default" : "outline"}
                        size="sm"
                        onClick={toggleSaveDiagnostics}
                      >
                        {saveDiagnostics ? "Enabled" : "Disabled"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Output diagnostic information</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Resume From Pass</Label>
                    <Input
                      type="text"
                      value={resumeFromPass}
                      onChange={e => {
                        const val = e.target.value;
                        const num = parseInt(val, 10);
                        updateResumeFromPass(isNaN(num) ? val : num);
                      }}
                      className="h-8"
                      placeholder="0 = fresh start"
                    />
                    <p className="text-xs text-muted-foreground">0 = fresh start, N = resume from pass N</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Performance Settings */}
          <div>
            <Button variant="outline" className="w-full justify-between" onClick={() => setPerformanceOpen(!performanceOpen)}>
              <span className="flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Performance & Compute Settings
              </span>
              <ChevronRight className={`h-4 w-4 transition-transform ${performanceOpen ? 'rotate-90' : ''}`} />
            </Button>
            {performanceOpen && (
              <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-lg">
                <PerformanceSettings
                  config={config}
                  updateConfigValue={updateConfigValue}
                  showFilterWorkerCount={true}
                />
              </div>
            )}
          </div>

          {/* Outlier Detection Settings */}
          <div>
            <Button variant="outline" className="w-full justify-between" onClick={() => setOutlierOpen(!outlierOpen)}>
              <span className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Outlier Detection
              </span>
              <ChevronRight className={`h-4 w-4 transition-transform ${outlierOpen ? 'rotate-90' : ''}`} />
            </Button>
            {outlierOpen && (
              <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-lg">
                <OutlierDetectionSettings
                  config={config}
                  updateConfigValue={updateConfigValue}
                  configPath="ensemble_outlier_detection"
                />
              </div>
            )}
          </div>

          {/* Infilling Settings */}
          <div>
            <Button variant="outline" className="w-full justify-between" onClick={() => setInfillingOpen(!infillingOpen)}>
              <span className="flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Infilling Methods
              </span>
              <ChevronRight className={`h-4 w-4 transition-transform ${infillingOpen ? 'rotate-90' : ''}`} />
            </Button>
            {infillingOpen && (
              <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-lg">
                <InfillingSettings
                  config={config}
                  updateConfigValue={updateConfigValue}
                  configPath="ensemble_infilling"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PIV Runner - Simplified for Ensemble */}
      <RunPIV
        config={config}
        showProgressBar={false}
        showFrameViewer={false}
        showSimpleStatus={true}
        title="Run Ensemble PIV"
      />
    </div>
  );
}
