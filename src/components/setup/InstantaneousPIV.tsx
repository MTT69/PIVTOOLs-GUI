"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, ChevronUp, ChevronDown, Save, Settings, ChevronRight, Cpu, HardDrive, Filter, CheckCircle, Sliders } from "lucide-react";
import { useInstantaneousPivConfig } from "@/hooks/useInstantaneousPivConfig";
import { useConfigUpdate } from "@/hooks/useConfigUpdate";
import ImagePairViewer from "@/components/viewer/ImagePairViewer";
import RunPIV from "./RunPIV";
import OutlierDetectionSettings from "@/components/shared/OutlierDetectionSettings";
import InfillingSettings from "@/components/shared/InfillingSettings";
import PerformanceSettings from "@/components/shared/PerformanceSettings";
import CameraSelector from "@/components/shared/CameraSelector";
import { useNumericInput } from "@/hooks/useNumericInput";

interface InstantaneousPIVProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function InstantaneousPIV({ config, updateConfig }: InstantaneousPIVProps) {
  const { passes, addPass, removePass, movePass, updatePassField, toggleStore } =
    useInstantaneousPivConfig(config.instantaneous_piv, updateConfig);

  const { updateConfig: updateConfigBackend } = useConfigUpdate();

  // Camera selection state
  const cameraCount = config?.paths?.camera_count || 1;
  const [selectedCameras, setSelectedCameras] = useState<number[]>([]);

  // Collapsible sections state
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [outlierOpen, setOutlierOpen] = useState(false);
  const [infillingOpen, setInfillingOpen] = useState(false);
  const [peakFinderOpen, setPeakFinderOpen] = useState(false);
  const [predictorOpen, setPredictorOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);

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

  // Local-buffered numeric input for num_peaks
  const numPeaks = useNumericInput({
    configValue: config?.instantaneous_piv?.num_peaks,
    defaultValue: 1,
    onCommit: (val) => updateConfigValue(['instantaneous_piv', 'num_peaks'], val),
    min: 1,
  });

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
          <CardTitle>Instantaneous PIV</CardTitle>
          <CardDescription>Configure processing passes and select cameras</CardDescription>
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
                <PerformanceSettings config={config} updateConfigValue={updateConfigValue} />
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
                      <SelectItem value="gauss3">Gaussian 3-parameter</SelectItem>
                      <SelectItem value="gauss4">Gaussian 4-parameter</SelectItem>
                      <SelectItem value="gauss5">Gaussian 5-parameter</SelectItem>
                      <SelectItem value="gauss6">Gaussian 6-parameter</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Subpixel peak detection method. Higher parameter counts provide better accuracy but slower processing.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Predictor & Peak Settings */}
          <div>
            <Button variant="outline" className="w-full justify-between" onClick={() => setPredictorOpen(!predictorOpen)}>
              <span className="flex items-center gap-2">
                <Sliders className="h-4 w-4" />
                Predictor & Peak Settings
              </span>
              <ChevronRight className={`h-4 w-4 transition-transform ${predictorOpen ? 'rotate-90' : ''}`} />
            </Button>
            {predictorOpen && (
              <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-lg">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Predictor Smoothing</Label>
                    <Button
                      variant={(config?.instantaneous_piv?.predictor_smoothing ?? true) ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfigValue(['instantaneous_piv', 'predictor_smoothing'], !(config?.instantaneous_piv?.predictor_smoothing ?? true))}
                    >
                      {(config?.instantaneous_piv?.predictor_smoothing ?? true) ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Gaussian-smooth the predictor field between multi-pass iterations. Reduces noise but blurs velocity gradients near walls. Recommended for instantaneous PIV where single-pair noise is significant.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Image Warp Interpolation</Label>
                  <Select
                    value={config?.instantaneous_piv?.image_warp_interpolation || 'cubic'}
                    onValueChange={(value) => updateConfigValue(['instantaneous_piv', 'image_warp_interpolation'], value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cubic">Cubic (4×4, fast)</SelectItem>
                      <SelectItem value="lanczos">Lanczos-3 (6×6, sharper)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Interpolation kernel for image warping during predictor-corrector passes. Cubic is faster; Lanczos-3 preserves sharper particle images.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Secondary Peak Detection</Label>
                    <Button
                      variant={config?.instantaneous_piv?.secondary_peak ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfigValue(['instantaneous_piv', 'secondary_peak'], !config?.instantaneous_piv?.secondary_peak)}
                    >
                      {config?.instantaneous_piv?.secondary_peak ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Extract the second-highest correlation peak per window. Useful for detecting reverse flow or regions with multiple particle populations.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="num-peaks">Number of Peaks</Label>
                  <Input
                    id="num-peaks"
                    type="text"
                    inputMode="numeric"
                    value={numPeaks.value}
                    onChange={numPeaks.onChange}
                    onFocus={numPeaks.onFocus}
                    onBlur={numPeaks.onBlur}
                  />
                  <p className="text-xs text-muted-foreground">
                    Number of correlation peaks to detect per interrogation window. Usually 1; increase for multi-peak analysis.
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
          </div>

          {/* Output Settings */}
          <div>
            <Button variant="outline" className="w-full justify-between" onClick={() => setOutputOpen(!outputOpen)}>
              <span className="flex items-center gap-2">
                <Save className="h-4 w-4" />
                Output Settings
              </span>
              <ChevronRight className={`h-4 w-4 transition-transform ${outputOpen ? 'rotate-90' : ''}`} />
            </Button>
            {outputOpen && (
              <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-lg">
                <div className="space-y-2">
                  <Label className="text-sm">Save Mode</Label>
                  <Select
                    value={config?.instantaneous_piv?.save_mode || 'full'}
                    onValueChange={(value) => updateConfigValue(['instantaneous_piv', 'save_mode'], value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">Full (all fields)</SelectItem>
                      <SelectItem value="minimal">Minimal (ux, uy, mask only)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Full saves all 11 fields per pass. Minimal saves only ux, uy, and mask — sufficient for calibration, statistics, and most post-processing. Minimal is significantly faster.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">File Compression</Label>
                    <Button
                      variant={(config?.instantaneous_piv?.save_compression ?? true) ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfigValue(['instantaneous_piv', 'save_compression'], !(config?.instantaneous_piv?.save_compression ?? true))}
                    >
                      {(config?.instantaneous_piv?.save_compression ?? true) ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Zlib compression reduces file size but adds CPU overhead per frame. Disable for faster saves when disk space is not a concern.
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PIV Runner */}
      <RunPIV config={config} mode="instantaneous" />
    </div>
  );
}