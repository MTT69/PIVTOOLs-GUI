"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, ChevronUp, ChevronDown, Save, Camera, Settings, ChevronRight, Cpu, HardDrive, Filter, CheckCircle } from "lucide-react";
import { useInstantaneousPivConfig, PivPass } from "@/hooks/useInstantaneousPivConfig"; // Adjust path
import ImagePairViewer from "@/components/viewer/ImagePairViewer";
import RunPIV from "./RunPIV";

interface InstantaneousPIVProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

// Outlier Detection Settings Component
interface OutlierDetectionSettingsProps {
  config: any;
  updateConfigValue: (path: string[], value: any) => void;
}

function OutlierDetectionSettings({ config, updateConfigValue }: OutlierDetectionSettingsProps) {
  const outlierConfig = config?.outlier_detection || { enabled: true, methods: [] };
  const methods = outlierConfig.methods || [];

  const [localMethods, setLocalMethods] = useState<any[]>([]);

  useEffect(() => {
    interface OutlierMethod {
      type: 'peak_mag' | 'median_2d';
      threshold?: number;
      epsilon?: number;
    }

    interface LocalOutlierMethod {
      type: 'peak_mag' | 'median_2d';
      threshold: string;
      epsilon: string;
    }

    const locals: LocalOutlierMethod[] = methods.map((m: OutlierMethod) => ({
      ...m,
      threshold: m.threshold?.toString() ?? (m.type === 'median_2d' ? '2.0' : '0.4'),
      epsilon: m.epsilon?.toString() ?? '0.2'
    }));
    setLocalMethods(locals);
  }, [methods]);

  const addOutlierMethod = () => {
    const newMethods = [...methods, { type: 'peak_mag', threshold: 0.4 }];
    updateConfigValue(['outlier_detection', 'methods'], newMethods);
  };

  const removeOutlierMethod = (index: number) => {
    const newMethods = methods.filter((_: any, i: number) => i !== index);
    updateConfigValue(['outlier_detection', 'methods'], newMethods);
  };

  const updateOutlierMethod = (index: number, field: string, value: any) => {
    const newMethods = [...methods];
    newMethods[index] = { ...newMethods[index], [field]: value };
    updateConfigValue(['outlier_detection', 'methods'], newMethods);
  };

  const toggleOutlierEnabled = () => {
    updateConfigValue(['outlier_detection', 'enabled'], !outlierConfig.enabled);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Enable Outlier Detection</Label>
        <Button
          variant={outlierConfig.enabled ? "default" : "outline"}
          size="sm"
          onClick={toggleOutlierEnabled}
        >
          {outlierConfig.enabled ? "Enabled" : "Disabled"}
        </Button>
      </div>

      {outlierConfig.enabled && (
        <>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Detection Methods</Label>
            <Button variant="outline" size="sm" onClick={addOutlierMethod}>
              <Plus className="h-3 w-3 mr-1" /> Add Method
            </Button>
          </div>

          <div className="space-y-3">
            {methods.map((method: any, i: number) => (
              <div key={i} className="p-3 bg-white border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Method {i + 1}</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeOutlierMethod(i)}
                  >
                    <X className="h-3 w-3 text-red-500" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={method.type || 'peak_mag'}
                      onValueChange={(value) => updateOutlierMethod(i, 'type', value)}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="peak_mag">Peak Magnitude</SelectItem>
                        <SelectItem value="median_2d">Median 2D</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {method.type === 'peak_mag' && (
                    <div className="space-y-1">
                      <Label className="text-xs">Threshold</Label>
                      <Input
                        className="h-8 text-sm"
                        type="text"
                        value={localMethods[i]?.threshold ?? '0.4'}
                        onChange={(e) => {
                          const val = e.target.value;
                          const newLocal = [...localMethods];
                          newLocal[i] = { ...newLocal[i], threshold: val };
                          setLocalMethods(newLocal);
                          const num = parseFloat(val);
                          if (!isNaN(num)) {
                            updateOutlierMethod(i, 'threshold', num);
                          }
                        }}
                        onBlur={() => {
                          const val = localMethods[i]?.threshold;
                          if (val === '' || val === undefined) {
                            const defaultVal = 0.4;
                            const newLocal = [...localMethods];
                            newLocal[i] = { ...newLocal[i], threshold: defaultVal.toString() };
                            setLocalMethods(newLocal);
                            updateOutlierMethod(i, 'threshold', defaultVal);
                          }
                        }}
                      />
                    </div>
                  )}

                  {method.type === 'median_2d' && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Epsilon</Label>
                        <Input
                          className="h-8 text-sm"
                          type="text"
                          value={localMethods[i]?.epsilon ?? '0.2'}
                          onChange={(e) => {
                            const val = e.target.value;
                            const newLocal = [...localMethods];
                            newLocal[i] = { ...newLocal[i], epsilon: val };
                            setLocalMethods(newLocal);
                            const num = parseFloat(val);
                            if (!isNaN(num)) {
                              updateOutlierMethod(i, 'epsilon', num);
                            }
                          }}
                          onBlur={() => {
                            const val = localMethods[i]?.epsilon;
                            if (val === '' || val === undefined) {
                              const defaultVal = 0.2;
                              const newLocal = [...localMethods];
                              newLocal[i] = { ...newLocal[i], epsilon: defaultVal.toString() };
                              setLocalMethods(newLocal);
                              updateOutlierMethod(i, 'epsilon', defaultVal);
                            }
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Threshold</Label>
                        <Input
                          className="h-8 text-sm"
                          type="text"
                          value={localMethods[i]?.threshold ?? '2.0'}
                          onChange={(e) => {
                            const val = e.target.value;
                            const newLocal = [...localMethods];
                            newLocal[i] = { ...newLocal[i], threshold: val };
                            setLocalMethods(newLocal);
                            const num = parseFloat(val);
                            if (!isNaN(num)) {
                              updateOutlierMethod(i, 'threshold', num);
                            }
                          }}
                          onBlur={() => {
                            const val = localMethods[i]?.threshold;
                            if (val === '' || val === undefined) {
                              const defaultVal = 2.0;
                              const newLocal = [...localMethods];
                              newLocal[i] = { ...newLocal[i], threshold: defaultVal.toString() };
                              setLocalMethods(newLocal);
                              updateOutlierMethod(i, 'threshold', defaultVal);
                            }
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {methods.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No detection methods configured. Click "Add Method" to add one.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// Infilling Settings Component
interface InfillingSettingsProps {
  config: any;
  updateConfigValue: (path: string[], value: any) => void;
}

function InfillingSettings({ config, updateConfigValue }: InfillingSettingsProps) {
  const infillingConfig = config?.infilling || { mid_pass: {}, final_pass: {} };
  
  const updateMidPass = (field: string, value: any) => {
    const updated = { ...infillingConfig.mid_pass, [field]: value };
    updateConfigValue(['infilling', 'mid_pass'], updated);
  };

  const updateMidPassParam = (param: string, value: any) => {
    const params = { ...(infillingConfig.mid_pass?.parameters || {}), [param]: value };
    updateMidPass('parameters', params);
  };

  const updateFinalPass = (field: string, value: any) => {
    const updated = { ...infillingConfig.final_pass, [field]: value };
    updateConfigValue(['infilling', 'final_pass'], updated);
  };

  const updateFinalPassParam = (param: string, value: any) => {
    const params = { ...(infillingConfig.final_pass?.parameters || {}), [param]: value };
    updateFinalPass('parameters', params);
  };

  return (
    <div className="space-y-6">
      {/* Mid-Pass Infilling */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold">Mid-Pass Infilling</Label>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Method</Label>
            <Select
              value={infillingConfig.mid_pass?.method || 'local_median'}
              onValueChange={(value) => updateMidPass('method', value)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local_median">Local Median</SelectItem>
                <SelectItem value="knn">K-Nearest Neighbors</SelectItem>
                <SelectItem value="biharmonic">Biharmonic</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {infillingConfig.mid_pass?.method === 'local_median' && (
            <div className="space-y-1">
              <Label className="text-xs">Kernel Size</Label>
              <Input
                className="h-8 text-sm"
                type="text"
                value={infillingConfig.mid_pass?.parameters?.ksize}
                onChange={(e) => updateMidPassParam('ksize', e.target.value)}
              />
            </div>
          )}

          {infillingConfig.mid_pass?.method === 'knn' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Neighbors</Label>
                <Input
                  className="h-8 text-sm"
                  type="text"
                  value={infillingConfig.mid_pass?.parameters?.n_neighbors}
                  onChange={(e) => updateMidPassParam('n_neighbors', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Weights</Label>
                <Select
                  value={infillingConfig.mid_pass?.parameters?.weights || 'distance'}
                  onValueChange={(value) => updateMidPassParam('weights', value)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="uniform">Uniform</SelectItem>
                    <SelectItem value="distance">Distance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Algorithm</Label>
                <Select
                  value={infillingConfig.mid_pass?.parameters?.algorithm || 'kd_tree'}
                  onValueChange={(value) => updateMidPassParam('algorithm', value)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="ball_tree">Ball Tree</SelectItem>
                    <SelectItem value="kd_tree">KD Tree</SelectItem>
                    <SelectItem value="brute">Brute Force</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Final Pass Infilling */}
      <div className="space-y-3 pt-3 border-t">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Final Pass Infilling</Label>
          <Button
            variant={infillingConfig.final_pass?.enabled ? "default" : "outline"}
            size="sm"
            onClick={() => updateFinalPass('enabled', !infillingConfig.final_pass?.enabled)}
          >
            {infillingConfig.final_pass?.enabled ? "Enabled" : "Disabled"}
          </Button>
        </div>

        {infillingConfig.final_pass?.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Method</Label>
              <Select
                value={infillingConfig.final_pass?.method || 'local_median'}
                onValueChange={(value) => updateFinalPass('method', value)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local_median">Local Median</SelectItem>
                  <SelectItem value="knn">K-Nearest Neighbors</SelectItem>
                  <SelectItem value="biharmonic">Biharmonic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {infillingConfig.final_pass?.method === 'local_median' && (
              <div className="space-y-1">
                <Label className="text-xs">Kernel Size</Label>
                <Input
                  className="h-8 text-sm"
                  type="text"
                  value={infillingConfig.final_pass?.parameters?.ksize}
                  onChange={(e) => updateFinalPassParam('ksize', e.target.value)}
                />
              </div>
            )}

            {infillingConfig.final_pass?.method === 'knn' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Neighbors</Label>
                  <Input
                    className="h-8 text-sm"
                    type="text"
                    value={infillingConfig.final_pass?.parameters?.n_neighbors}
                    onChange={(e) => updateFinalPassParam('n_neighbors', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Weights</Label>
                  <Select
                    value={infillingConfig.final_pass?.parameters?.weights || 'distance'}
                    onValueChange={(value) => updateFinalPassParam('weights', value)}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="uniform">Uniform</SelectItem>
                      <SelectItem value="distance">Distance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Algorithm</Label>
                  <Select
                    value={infillingConfig.final_pass?.parameters?.algorithm || 'kd_tree'}
                    onValueChange={(value) => updateFinalPassParam('algorithm', value)}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="ball_tree">Ball Tree</SelectItem>
                      <SelectItem value="kd_tree">KD Tree</SelectItem>
                      <SelectItem value="brute">Brute Force</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function InstantaneousPIV({ config, updateConfig }: InstantaneousPIVProps) {
  const { passes, addPass, removePass, movePass, updatePassField, toggleStore } = 
    useInstantaneousPivConfig(config.instantaneous_piv, updateConfig);

  // Camera selection state
  const cameraCount = config?.paths?.camera_count || 1;
  const [selectedCameras, setSelectedCameras] = useState<number[]>([]);
  
  // Collapsible sections state
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [outlierOpen, setOutlierOpen] = useState(false);
  const [infillingOpen, setInfillingOpen] = useState(false);
  const [peakFinderOpen, setPeakFinderOpen] = useState(false);

  // Memory per worker state
  const [memoryNumber, setMemoryNumber] = useState<string>('6');
  const [memoryUnit, setMemoryUnit] = useState<string>('GB');

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

  // Memory per worker initialization
  useEffect(() => {
    const mem = config?.processing?.dask_memory_limit || '6GB';
    const match = mem.match(/^(\d+)(MB|GB)?$/);
    if (match) {
      setMemoryNumber(match[1]);
      setMemoryUnit(match[2] || 'GB');
    } else {
      setMemoryNumber('6');
      setMemoryUnit('GB');
    }
  }, [config?.processing?.dask_memory_limit]);

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

  // Helper function to update config
  const updateConfigValue = async (path: string[], value: any) => {
    try {
      const pathParts = [...path];
      const payload: any = {};
      let current = payload;
      
      for (let i = 0; i < pathParts.length - 1; i++) {
        current[pathParts[i]] = {};
        current = current[pathParts[i]];
      }
      current[pathParts[pathParts.length - 1]] = value;
      
      const res = await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      if (res.ok) {
        const json = await res.json();
        updateConfig(path, value);
      }
    } catch (e) {
      console.error('Failed to update config:', e);
    }
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
                  <Input className="col-span-2" type="text" value={p.windowX} onChange={e => updatePassField(i, 'windowX', e.target.value)} />
                  <Input className="col-span-2" type="text" value={p.windowY} onChange={e => updatePassField(i, 'windowY', e.target.value)} />
                  <Input className="col-span-2" type="text" value={p.overlap} onChange={e => updatePassField(i, 'overlap', e.target.value)} />
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

      {/* Advanced Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Advanced PIV Settings
          </CardTitle>
          <CardDescription>Performance tuning, outlier detection, infilling, and peak finding</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="batch-size">Batch Size</Label>
                    <Input
                      id="batch-size"
                      type="text"
                      value={config?.batches?.size === '' ? '' : (config?.batches?.size ?? 10)}
                      onChange={(e) => {
                        const val = e.target.value;
                        const num = parseInt(val, 10);
                        updateConfigValue(['batches', 'size'], isNaN(num) ? '' : num);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">Number of images processed per batch</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="omp-threads">Threads (OMP)</Label>
                    <Input
                      id="omp-threads"
                      type="text"
                      value={config?.processing?.omp_threads === '' ? '' : (config?.processing?.omp_threads ?? 4)}
                      onChange={(e) => {
                        const val = e.target.value;
                        const num = parseInt(val, 10);
                        updateConfigValue(['processing', 'omp_threads'], isNaN(num) ? '' : num);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">OpenMP threads for parallel processing</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="dask-workers">Dask Workers</Label>
                    <Input
                      id="dask-workers"
                      type="text"
                      value={config?.processing?.dask_workers_per_node === '' ? '' : (config?.processing?.dask_workers_per_node ?? 10)}
                      onChange={(e) => {
                        const val = e.target.value;
                        const num = parseInt(val, 10);
                        updateConfigValue(['processing', 'dask_workers_per_node'], isNaN(num) ? '' : num);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">Number of Dask workers per node</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Memory per Worker</Label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={memoryNumber}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMemoryNumber(val);
                          const num = parseInt(val, 10);
                          if (!isNaN(num)) {
                            updateConfigValue(['processing', 'dask_memory_limit'], `${num}${memoryUnit}`);
                          }
                        }}
                        onBlur={() => {
                          if (memoryNumber === '') {
                            setMemoryNumber('6');
                            updateConfigValue(['processing', 'dask_memory_limit'], `6${memoryUnit}`);
                          }
                        }}
                        className="flex-1"
                      />
                      <Select
                        value={memoryUnit}
                        onValueChange={(value) => {
                          setMemoryUnit(value);
                          const num = parseInt(memoryNumber, 10);
                          if (!isNaN(num)) {
                            updateConfigValue(['processing', 'dask_memory_limit'], `${num}${value}`);
                          }
                        }}
                      >
                        <SelectTrigger className="w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MB">MB</SelectItem>
                          <SelectItem value="GB">GB</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">Memory limit per worker</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Peak Finder Settings */}
          <div>
            <Button variant="outline" className="w-full justify-between" onClick={() => setPeakFinderOpen(!peakFinderOpen)}>
              <span className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Peak Finding Method
              </span>
              <ChevronRight className={`h-4 w-4 transition-transform ${peakFinderOpen ? 'rotate-90' : ''}`} />
            </Button>
            {peakFinderOpen && (
              <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-lg">
                <div className="space-y-2">
                  <Label htmlFor="peak-finder">Peak Finder Algorithm</Label>
                  <Select
                    value={config?.instantaneous_piv?.peak_finder || 'gauss3'}
                    onValueChange={(value) => updateConfigValue(['instantaneous_piv', 'peak_finder'], value)}
                  >
                    <SelectTrigger id="peak-finder">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gauss3">Gaussian 3-point</SelectItem>
                      <SelectItem value="gauss4">Gaussian 4-point</SelectItem>
                      <SelectItem value="gauss5">Gaussian 5-point</SelectItem>
                      <SelectItem value="gauss6">Gaussian 6-point</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Subpixel peak detection method. Higher point counts provide better accuracy but slower processing.
                  </p>
                </div>
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
                <OutlierDetectionSettings config={config} updateConfigValue={updateConfigValue} />
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
                <InfillingSettings config={config} updateConfigValue={updateConfigValue} />
              </div>
            )}
          </div>        </CardContent>
      </Card>

      <ImagePairViewer
        backendUrl="/backend"
        config={config}  
      />

      <RunPIV config={config} />
    </div>
  );
}