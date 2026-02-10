"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { useScaleFactorCalibration } from "@/hooks/useScaleFactorCalibration";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import CalibrationImageViewer from "@/components/viewer/CalibrationImageViewer";
import { ValidationAlert } from "@/components/setup/ValidationAlert";
import {
  GCInlineControls,
  useGlobalCoordinates,
  getGlobalCoordMarkers,
  getGlobalCoordViewerTarget,
  handleGlobalCoordPointSelect,
} from "@/components/setup/GlobalCoordinateSetup";

interface ScaleFactorCalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  cameraOptions: number[];
  sourcePaths: string[];
  imageCount?: number;
}

// Helper to show just the last segment of a path
const basename = (p: string) => {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.filter(Boolean).pop() || p;
};

export const ScaleFactorCalibration: React.FC<ScaleFactorCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
  imageCount = 1000,
}) => {
  const {
    dt,
    pxPerMm,
    sourcePathIdx,
    calibrating,
    scaleFactorJobId,
    setDt,
    setPxPerMm,
    setSourcePathIdx,
    status,
    scaleFactorJobStatus,
    scaleFactorJobDetails,
    calibrateVectors,
  } = useScaleFactorCalibration(
    config.calibration?.scale_factor || {},
    updateConfig,
    cameraOptions,
    sourcePaths,
    imageCount
  );

  // Global coordinate system
  const gc = useGlobalCoordinates(config, updateConfig, cameraOptions);
  const gcViewerTarget = getGlobalCoordViewerTarget(gc);
  const gcIsSelecting = gc.selectionMode !== "none";

  // Camera selector for viewer
  const [camera, setCamera] = useState(cameraOptions[0] || 1);

  // Image viewer toggle
  const [showImageViewer, setShowImageViewer] = useState(false);

  // Calibration image config (shared across all calibration methods)
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  const [imageFormat, setImageFormat] = useState('calib%05d.tif');
  const [imageType, setImageType] = useState('standard');
  const [numImages, setNumImages] = useState<string>("10");
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);
  const calConfigLoadedRef = useRef(false);
  const calConfigDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load calibration image config on mount
  useEffect(() => {
    const loadCalConfig = async () => {
      try {
        const res = await fetch('/backend/calibration/config');
        if (res.ok) {
          const data = await res.json();
          if (data.image_format) setImageFormat(data.image_format);
          if (data.image_type) setImageType(data.image_type);
          if (data.num_images) setNumImages(String(data.num_images));
          if (data.calibration_sources !== undefined) setCalibrationSources(data.calibration_sources);
          if (data.use_camera_subfolders !== undefined) setUseCameraSubfolders(data.use_camera_subfolders);
          if (data.camera_subfolders !== undefined) setCameraSubfolders(data.camera_subfolders);
        }
      } catch (e) {
        console.error('Failed to load calibration image config:', e);
      }
      calConfigLoadedRef.current = true;
    };
    loadCalConfig();
  }, []);

  // Debounced save of calibration image config
  const saveCalConfig = useCallback(() => {
    if (calConfigDebounceRef.current) clearTimeout(calConfigDebounceRef.current);
    calConfigDebounceRef.current = setTimeout(async () => {
      try {
        await fetch('/backend/calibration/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_format: imageFormat,
            image_type: imageType,
            num_images: parseInt(numImages) || 10,
            calibration_sources: calibrationSources,
            use_camera_subfolders: useCameraSubfolders,
            camera_subfolders: cameraSubfolders,
          }),
        });
      } catch (e) {
        console.error('Failed to save calibration image config:', e);
      }
    }, 500);
  }, [imageFormat, imageType, numImages, calibrationSources, useCameraSubfolders, cameraSubfolders]);

  // Auto-save when calibration image config changes (skip until initial load)
  useEffect(() => {
    if (!calConfigLoadedRef.current) return;
    saveCalConfig();
  }, [saveCalConfig]);

  // Validation state
  const [validation, setValidation] = useState<{
    valid: boolean;
    found_count: number | 'container';
    error?: string;
    suggested_pattern?: string;
  } | null>(null);
  const [validating, setValidating] = useState(false);
  const validationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Validate calibration images (debounced)
  const validateImages = useCallback(() => {
    if (validationDebounceRef.current) clearTimeout(validationDebounceRef.current);
    validationDebounceRef.current = setTimeout(async () => {
      setValidating(true);
      try {
        const res = await fetch('/backend/calibration/validate_images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_path_idx: sourcePathIdx,
            camera: camera,
          }),
        });
        const data = await res.json();
        setValidation(data);
      } catch (e) {
        setValidation({ valid: false, found_count: 0, error: String(e) });
      } finally {
        setValidating(false);
      }
    }, 500);
  }, [sourcePathIdx, camera]);

  // Auto-validate when relevant config changes
  useEffect(() => {
    if (!calConfigLoadedRef.current) return;
    validateImages();
  }, [validateImages, imageFormat, numImages, calibrationSources, imageType, useCameraSubfolders, cameraSubfolders]);

  // Vector type selector
  const [vectorTypeName, setVectorTypeName] = useState<'instantaneous' | 'ensemble'>('instantaneous');

  // Load piv_type from config on mount
  useEffect(() => {
    const pivType = config.calibration?.piv_type;
    if (pivType === 'instantaneous' || pivType === 'ensemble') {
      setVectorTypeName(pivType);
    }
  }, [config.calibration?.piv_type]);

  // Save piv_type when changed
  const handleVectorTypeChange = async (value: 'instantaneous' | 'ensemble') => {
    setVectorTypeName(value);
    try {
      const res = await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calibration: { piv_type: value }
        })
      });
      const json = await res.json();
      if (res.ok && json.updated?.calibration) {
        // Sync parent config state so other tabs see the update
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (e) {
      console.error('Failed to save piv_type:', e);
    }
  };

  const setAsActiveMethod = async () => {
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calibration: {
            active: "scale_factor",
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to set active method");
      if (json.updated?.calibration) {
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (err) {
      console.error("Failed to set active calibration method:", err);
    }
  };

  const isActive = config.calibration?.active === "scale_factor";

  return (
    <Card>
      {/* Add progress display if job is running */}
      {scaleFactorJobId && scaleFactorJobDetails && (
        <div className="mb-4 p-4 border rounded bg-blue-50">
          <div className="flex items-center gap-2 text-sm mb-2">
            <strong>Scale Factor Calibration Progress:</strong>
            <span className="font-medium">{scaleFactorJobStatus}</span>
          </div>
          {(scaleFactorJobStatus === 'running' || scaleFactorJobStatus === 'starting') && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full"></span>
              Processing files...
            </div>
          )}
          <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
            <div className={`h-2 bg-green-600`} style={{ width: `${scaleFactorJobDetails.progress || 0}%` }}></div>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Progress: {scaleFactorJobDetails.progress || 0}%
            {scaleFactorJobDetails.processed_files !== undefined && scaleFactorJobDetails.total_files !== undefined &&
              ` (Files: ${scaleFactorJobDetails.processed_files}/${scaleFactorJobDetails.total_files})`}
          </div>
          {scaleFactorJobStatus === 'completed' && (
            <div className="mt-2 text-xs text-green-600">
              Scale factor calibration completed! Processed {scaleFactorJobDetails.processed_files} files.
            </div>
          )}
          {scaleFactorJobStatus === 'failed' && scaleFactorJobDetails.error && (
            <div className="mt-2 text-xs text-red-600">
              Error: {scaleFactorJobDetails.error}
            </div>
          )}
        </div>
      )}

      <CardHeader>
        <CardTitle>Scale Factor Calibration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Section 1: Calibration Source Path */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Calibration Images Location</label>
          <Input
            value={calibrationSources[sourcePathIdx] || ""}
            onChange={e => {
              const newSources = [...calibrationSources];
              newSources[sourcePathIdx] = e.target.value;
              setCalibrationSources(newSources);
            }}
            placeholder="/path/to/calibration/images"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Full path to directory containing calibration images. Camera subfolders (if enabled) are relative to this path.
          </p>
        </div>

        {/* Section 2: Base Path */}
        <div>
          <label className="text-sm font-medium">Base Path</label>
          <Select value={String(sourcePathIdx)} onValueChange={v => setSourcePathIdx(Number(v))}>
            <SelectTrigger><SelectValue placeholder="Pick base path" /></SelectTrigger>
            <SelectContent>
              {sourcePaths.map((p, i) => (
                <SelectItem key={i} value={String(i)}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">Where calibration models are saved. Configured in Settings → Directories.</p>
        </div>

        {/* Section 3: Image Configuration */}
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium">Image Type</label>
            <Select value={imageType} onValueChange={setImageType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard (TIFF/PNG/JPG)</SelectItem>
                <SelectItem value="cine">Phantom CINE</SelectItem>
                <SelectItem value="lavision_set">LaVision SET</SelectItem>
                <SelectItem value="lavision_im7">LaVision IM7</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Image Format</label>
            <Input
              value={imageFormat}
              onChange={e => setImageFormat(e.target.value)}
              placeholder="calib%05d.tif"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Number of Images</label>
            <Input
              type="number"
              min={1}
              value={numImages}
              onChange={e => setNumImages(e.target.value)}
              onBlur={() => {
                const finalVal = parseInt(numImages) || 10;
                setNumImages(String(finalVal));
              }}
            />
          </div>
        </div>

        {/* Camera Subfolders Toggle */}
        {(imageType === "standard" || imageType === "lavision_im7") && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Switch
                id="sf-use-camera-subfolders"
                checked={useCameraSubfolders}
                onCheckedChange={setUseCameraSubfolders}
              />
              <Label htmlFor="sf-use-camera-subfolders" className="text-sm">
                Use camera subfolders
              </Label>
            </div>
            <p className="text-xs text-muted-foreground ml-10">
              {useCameraSubfolders
                ? "Images expected in camera subfolders (e.g., Cam1/, Cam2/)."
                : "Images in source directory without camera subfolders."
              }
            </p>
          </div>
        )}

        {/* Camera Subfolder Names */}
        {useCameraSubfolders && cameraOptions.length > 1 && (
          <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <h4 className="text-sm font-medium">Camera Subfolder Configuration</h4>
            <p className="text-xs text-muted-foreground">
              Camera subfolders are relative to the calibration source path.
              Example: {calibrationSources[sourcePathIdx] || '/path/to/calibration'}/{cameraSubfolders[0] || 'Cam1'}/
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {cameraOptions.map((cam, idx) => (
                <div key={cam}>
                  <label className="text-xs text-muted-foreground">Camera {cam}</label>
                  <Input
                    placeholder={`Cam${cam}`}
                    value={cameraSubfolders[idx] || ''}
                    onChange={e => {
                      const newSubfolders = [...cameraSubfolders];
                      while (newSubfolders.length < cameraOptions.length) {
                        newSubfolders.push('');
                      }
                      newSubfolders[idx] = e.target.value;
                      setCameraSubfolders(newSubfolders);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 4: Validation Status */}
        {validation && (
          <ValidationAlert
            validation={{
              valid: validation.valid,
              checked: !validating,
              error: validation.error || null,
              suggested_pattern: validation.suggested_pattern || null,
            }}
            customSuccessMessage={validation.valid
              ? `Found ${validation.found_count === 'container' ? 'container file' : `${validation.found_count} calibration images`}`
              : undefined}
            onApplySuggestedPattern={(pattern) => setImageFormat(pattern)}
          />
        )}

        {/* Section 5: Scale Factor Parameters */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Δt (seconds)</label>
            <Input
              type="number"
              value={dt}
              onChange={e => setDt(e.target.value)}
              step="any"
              min="0"
              placeholder="1.0"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Pixels per mm</label>
            <Input
              type="number"
              value={pxPerMm}
              onChange={e => setPxPerMm(e.target.value)}
              step="any"
              min="0"
              placeholder="1.0"
            />
          </div>
        </div>

        {/* Section 6: Image Viewer Toggle + Camera Selector */}
        {validation?.valid && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowImageViewer(!showImageViewer)}
              className="flex items-center gap-2"
            >
              {showImageViewer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showImageViewer ? 'Hide Image Viewer' : 'Browse Calibration Images'}
            </Button>
            {showImageViewer && cameraOptions.length > 1 && (
              <Select value={String(camera)} onValueChange={v => setCamera(Number(v))}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {cameraOptions.map(c => (
                    <SelectItem key={c} value={String(c)}>Camera {c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {/* Section 7: Image Viewer */}
        {showImageViewer && validation?.valid && (
          <CalibrationImageViewer
            backendUrl="/backend"
            sourcePathIdx={sourcePathIdx}
            camera={gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : camera}
            numImages={parseInt(numImages) || 10}
            calibrationType="dotboard"
            pointSelectMode={gcIsSelecting}
            onPointSelect={(px, py, cam, frame) => handleGlobalCoordPointSelect(gc, px, py, cam, frame)}
            selectedMarkers={getGlobalCoordMarkers(gc, gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : camera, 1)}
            externalCamera={gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : undefined}
            externalFrame={gcIsSelecting && gcViewerTarget ? gcViewerTarget.frame : undefined}
            settingsBarExtras={
              <GCInlineControls
                gc={gc}
                currentCamera={gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : camera}
                cameraOptions={cameraOptions}
                onCameraChange={setCamera}
              />
            }
          />
        )}

        {/* Global Coordinates toggle (when image viewer is hidden) */}
        {!showImageViewer && (
          <div className="flex items-center gap-2">
            <Switch checked={gc.enabled} onCheckedChange={gc.setEnabled} />
            <Label className="text-sm">Global Coordinate System</Label>
            {gc.enabled && (
              <span className="text-xs text-muted-foreground">
                (Show Image Viewer to set origin/feature points)
              </span>
            )}
          </div>
        )}

        {/* Status indicator (same as dotboard) */}
        <div className="mb-2">
          {status === "running" && (
            <div className="flex items-center gap-2 text-blue-600 text-sm">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></span>
              Calibration is running...
            </div>
          )}
          {status === "completed" && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <span className="inline-block w-3 h-3 bg-green-600 rounded-full"></span>
              Calibration completed!
            </div>
          )}
          {status === "error" && (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <span className="inline-block w-3 h-3 bg-red-600 rounded-full"></span>
              Calibration error!
            </div>
          )}
        </div>

        {/* Calibrate Vectors with type selector */}
        <div className="flex gap-2 items-center flex-wrap">
          {/* Calibrate Vectors with type selection */}
          <div className="flex items-center gap-1">
            <Button
              onClick={() => calibrateVectors(true, 1, vectorTypeName)}
              disabled={calibrating}
              className="bg-green-600 hover:bg-green-700 text-white rounded-r-none"
            >
              {calibrating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Calibrating...
                </>
              ) : (
                'Calibrate Vectors'
              )}
            </Button>
            <Select value={vectorTypeName} onValueChange={handleVectorTypeChange} disabled={calibrating}>
              <SelectTrigger className="w-[130px] rounded-l-none border-l-0 bg-green-600 hover:bg-green-700 text-white border-green-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instantaneous">Instantaneous</SelectItem>
                <SelectItem value="ensemble">Ensemble</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={setAsActiveMethod}
            disabled={isActive}
            className={isActive ? "bg-green-600 hover:bg-green-600 text-white" : ""}
            variant={isActive ? "default" : "outline"}
          >
            {isActive ? "Active" : "Set as Active Method"}
          </Button>
        </div>
        <div className="text-xs text-gray-500 mt-2">
          This method calibrates all vectors using scale factor conversion: pixels / px_per_mm / dt.<br />
          Automatically places bottom-left corner at origin (0,0).<br />
          Updates the calibration.scale_factor block in config.yaml.
        </div>
      </CardContent>
    </Card>
  );
};