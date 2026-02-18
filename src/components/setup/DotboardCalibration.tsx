"use client";
import React, { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Eye, EyeOff, CheckCircle2, Loader2 } from "lucide-react";
import { useDotboardCalibration, FrameDetection } from "@/hooks/useDotboardCalibration";
import { ValidationAlert } from "@/components/setup/ValidationAlert";
import CalibrationImageViewer, { FrameDetectionData } from "@/components/viewer/CalibrationImageViewer";
import {
  GCInlineControls,
  useGlobalCoordinates,
  getGlobalCoordMarkers,
  getGlobalCoordViewerTarget,
  handleGlobalCoordPointSelect,
} from "@/components/setup/GlobalCoordinateSetup";

interface DotboardCalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  cameraOptions: number[];
  sourcePaths: string[];
}

// Helper to show just the last segment of a path
const basename = (p: string) => {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.filter(Boolean).pop() || p;
};

export const DotboardCalibration: React.FC<DotboardCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
}) => {
  // Use the new simplified hook
  const calibration = useDotboardCalibration(cameraOptions, sourcePaths);

  const {
    // Source selection
    sourcePathIdx,
    setSourcePathIdx,
    camera,
    setCamera,

    // Image config
    imageFormat,
    setImageFormat,
    imageType,
    setImageType,
    numImages,
    setNumImages,
    calibrationSources,
    setCalibrationSources,
    useCameraSubfolders,
    setUseCameraSubfolders,
    cameraSubfolders,
    setCameraSubfolders,

    // Grid params (pattern cols/rows auto-detected)
    dotSpacingMm,
    setDotSpacingMm,
    dt,
    setDt,
    datumFrame,
    setDatumFrame,

    // Validation
    validation,
    validating,

    // Single camera job tracking
    jobStatus,
    isCalibrating,

    // Multi-camera job tracking
    multiCameraJobStatus,
    isMultiCameraCalibrating,

    // Vector calibration job tracking
    vectorJobStatus,
    isVectorCalibrating,

    // Model and detections
    cameraModel,
    detections,
    modelLoading,
    modelLoadError,
    hasModel,

    // Overlay toggle
    showOverlay,
    setShowOverlay,

    // Actions
    generateCameraModel,
    generateCameraModelAll,
    loadModel,
    calibrateVectors,
  } = calibration;

  // Global coordinate system — pass calibrationSources so stale features reset on source change
  const gc = useGlobalCoordinates(config, updateConfig, cameraOptions, calibrationSources);
  const gcViewerTarget = getGlobalCoordViewerTarget(gc);
  const gcIsSelecting = gc.selectionMode !== "none";

  // Local state
  const [showImageViewer, setShowImageViewer] = useState(false);
  const [vectorTypeName, setVectorTypeName] = useState<'instantaneous' | 'ensemble'>('instantaneous');

  // Load piv_type from config on mount
  React.useEffect(() => {
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

  // Local input state for debouncing
  const [dotSpacingMmInput, setDotSpacingMmInput] = useState(String(dotSpacingMm));
  const [dtInput, setDtInput] = useState(String(dt));
  const [datumFrameInput, setDatumFrameInput] = useState(String(datumFrame));

  // Sync local inputs with hook state
  React.useEffect(() => {
    setDotSpacingMmInput(String(dotSpacingMm));
  }, [dotSpacingMm]);

  React.useEffect(() => {
    setDtInput(String(dt));
  }, [dt]);

  React.useEffect(() => {
    setDatumFrameInput(String(datumFrame));
  }, [datumFrame]);

  // Convert detections to format expected by CalibrationImageViewer
  const savedDetections = useMemo((): Record<number, FrameDetectionData> | undefined => {
    if (!detections || Object.keys(detections).length === 0) return undefined;
    const result: Record<number, FrameDetectionData> = {};
    for (const [key, value] of Object.entries(detections)) {
      const frameIdx = parseInt(key, 10);
      if (!isNaN(frameIdx) && value.grid_points) {
        result[frameIdx] = {
          grid_points: value.grid_points,
          reprojection_error: value.reprojection_error,
        };
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }, [detections]);

  // Set as active calibration method
  const setAsActiveMethod = useCallback(async () => {
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calibration: { active: "dotboard" },
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
  }, [config.calibration, updateConfig]);

  const isActive = config.calibration?.active === "dotboard";

  // Check if container format (unsupported on macOS)
  const isContainerFormat = imageFormat.includes('.set') || imageFormat.includes('.im7');
  const isMacOS = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac');

  return (
    <div className="space-y-6">
      {/* Main Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle>Dotboard Calibration (Planar)</CardTitle>
          <CardDescription>
            Configure and run dotboard calibration to generate camera model
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Section 1: Calibration Source Path (primary input) */}
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

          {/* Section 2: Base Path & Cameras */}
          <div className="grid md:grid-cols-2 gap-4">
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
            <div>
              <label className="text-sm font-medium">Cameras to Process</label>
              <div className="text-sm text-muted-foreground mt-2 p-2 bg-muted rounded">
                {cameraOptions.length > 0
                  ? `Cameras ${cameraOptions.join(', ')} (from config.camera_numbers)`
                  : 'No cameras configured'}
              </div>
            </div>
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

          {/* Use Camera Subfolders Toggle - for standard and IM7 formats */}
          {(imageType === "standard" || imageType === "lavision_im7") && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="dotboard-use-camera-subfolders"
                  checked={useCameraSubfolders}
                  onCheckedChange={setUseCameraSubfolders}
                />
                <Label htmlFor="dotboard-use-camera-subfolders" className="text-sm">
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

          {/* Camera Subfolder Names - only show when using camera subfolders */}
          {useCameraSubfolders && cameraOptions.length > 1 && (
            <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
              <h4 className="text-sm font-medium">Camera Subfolder Configuration</h4>
              <p className="text-xs text-muted-foreground">
                Camera subfolders are relative to the calibration source path.
                Example: {calibrationSources[sourcePathIdx] || '/path/to/calibration'}/{cameraSubfolders[0] || 'Cam1'}/
              </p>

              {/* Custom Camera Subfolder Names */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Camera Subfolder Names (optional)</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Custom folder names for each camera. Leave empty to use defaults (Cam1, Cam2, ...).
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
                          // Ensure array is long enough
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
            </div>
          )}

          {/* macOS Warning for Unsupported Formats */}
          {isContainerFormat && isMacOS && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Unsupported File Format on macOS</AlertTitle>
              <AlertDescription>
                .set and .im7 container formats require Windows or Linux.
              </AlertDescription>
            </Alert>
          )}

          {/* Section 3: Validation Status */}
          {validation && (
            <ValidationAlert
              validation={{
                valid: validation.valid,
                checked: !validating,
                error: validation.error || null,
              }}
              customSuccessMessage={
                validation.valid
                  ? `Found ${validation.found_count === 'container' ? 'container file' : `${validation.found_count} calibration images`}`
                  : undefined
              }
            />
          )}

          {/* Suggested Pattern Button */}
          {validation && !validation.valid && validation.suggested_pattern && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Suggestion:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImageFormat(validation.suggested_pattern!)}
                className="text-blue-600 border-blue-300 hover:bg-blue-50"
              >
                Use "{validation.suggested_pattern}"
              </Button>
            </div>
          )}

          {/* Section 4: Grid Parameters */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">Grid Detection Parameters</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Grid dimensions are automatically detected using RANSAC-based analysis.
            </p>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">Dot Spacing (mm)</label>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  value={dotSpacingMmInput}
                  onChange={e => setDotSpacingMmInput(e.target.value)}
                  onBlur={() => setDotSpacingMm(parseFloat(dotSpacingMmInput) || 28.89)}
                />
                <p className="text-xs text-muted-foreground mt-1">Physical spacing between dots</p>
              </div>
              <div>
                <label className="text-sm font-medium">Δt (seconds)</label>
                <Input
                  type="number"
                  step="any"
                  min={0.001}
                  value={dtInput}
                  onChange={e => setDtInput(e.target.value)}
                  onBlur={() => setDt(parseFloat(dtInput) || 1.0)}
                />
                <p className="text-xs text-muted-foreground mt-1">Time step between frames</p>
              </div>
              <div>
                <label className="text-sm font-medium">Datum Frame</label>
                <Input
                  type="number"
                  min={1}
                  value={datumFrameInput}
                  onChange={e => setDatumFrameInput(e.target.value)}
                  onBlur={() => setDatumFrame(parseInt(datumFrameInput) || 1)}
                />
                <p className="text-xs text-muted-foreground mt-1">Calibration image defining world origin</p>
              </div>
            </div>
          </div>

          {/* Section 5: Image Viewer Toggle */}
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
                    {cameraOptions.map((c) => (
                      <SelectItem key={c} value={String(c)}>Camera {c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Section 6: Image Viewer with Overlay Support */}
          {showImageViewer && validation?.valid && (
            <CalibrationImageViewer
              backendUrl="/backend"
              sourcePathIdx={sourcePathIdx}
              camera={gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : camera}
              numImages={parseInt(numImages) || 10}
              calibrationType="dotboard"
              calibrationParams={{
                // NOTE: pattern_cols/rows removed - auto-detected
              }}
              savedDetections={savedDetections}
              showSavedOverlay={showOverlay}
              onSavedOverlayChange={setShowOverlay}
              pointSelectMode={gcIsSelecting}
              onPointSelect={(px, py, cam, frame) => handleGlobalCoordPointSelect(gc, px, py, cam, frame)}
              selectedMarkers={getGlobalCoordMarkers(gc, gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : camera, 1)}
              externalCamera={gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : undefined}
              externalFrame={gcIsSelecting && gcViewerTarget ? gcViewerTarget.frame : undefined}
              detectionLoading={modelLoading}
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

          {/* Section 7: Action Buttons */}
          <div className="border-t pt-4 space-y-4">
            {/* Unified Action Row */}
            <div className="flex gap-2 items-center flex-wrap">
              <Button
                onClick={() => generateCameraModelAll()}
                disabled={isCalibrating || isMultiCameraCalibrating || !validation?.valid}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {(isCalibrating || isMultiCameraCalibrating) ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate Model'
                )}
              </Button>

              <Button
                onClick={loadModel}
                disabled={modelLoading}
                variant="outline"
              >
                {modelLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load Saved'
                )}
              </Button>

              {/* Calibrate Vectors with type selection */}
              <div className="flex items-center gap-1">
                <Button
                  onClick={() => calibrateVectors(true, vectorTypeName)}
                  disabled={!hasModel || isVectorCalibrating}
                  className="bg-green-600 hover:bg-green-700 text-white rounded-r-none"
                  title={!hasModel ? "Generate or load a camera model first" : "Calibrate vectors for all cameras"}
                >
                  {isVectorCalibrating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Calibrating...
                    </>
                  ) : (
                    'Calibrate Vectors'
                  )}
                </Button>
                <Select value={vectorTypeName} onValueChange={handleVectorTypeChange} disabled={isVectorCalibrating}>
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
                variant={isActive ? "default" : "outline"}
                className={isActive ? "bg-green-600 hover:bg-green-600" : ""}
              >
                {isActive ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Active
                  </>
                ) : (
                  'Set as Active'
                )}
              </Button>
            </div>

            {modelLoadError && (
              <div className="text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {modelLoadError}
              </div>
            )}

            {/* Job Progress */}
            {jobStatus && (jobStatus.status === 'running' || jobStatus.status === 'starting') && (
              <div className="mt-4 p-3 border rounded bg-blue-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <strong>Camera Model Generation:</strong>
                  <span className="capitalize">{jobStatus.status}</span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
                  <div
                    className="h-2 bg-blue-600 transition-all"
                    style={{ width: `${jobStatus.progress || 0}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Progress: {jobStatus.progress?.toFixed(0) || 0}%
                  {jobStatus.processed_images !== undefined && (
                    <span> | Images: {jobStatus.processed_images}/{jobStatus.total_images}</span>
                  )}
                  {jobStatus.valid_images !== undefined && jobStatus.valid_images > 0 && (
                    <span> | Valid: {jobStatus.valid_images}</span>
                  )}
                </div>
              </div>
            )}

            {/* Job Completed */}
            {jobStatus?.status === 'completed' && (
              <div className="mt-4 p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Camera model generation completed successfully!
              </div>
            )}

            {/* Job Failed */}
            {jobStatus?.status === 'failed' && (
              <div className="mt-4 p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Error: {jobStatus.error || 'Calibration failed'}
              </div>
            )}

            {/* Multi-Camera Job Progress */}
            {multiCameraJobStatus && (multiCameraJobStatus.status === 'running' || multiCameraJobStatus.status === 'starting') && (
              <div className="mt-4 p-3 border rounded bg-blue-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <strong>Multi-Camera Model Generation:</strong>
                  <span className="capitalize">{multiCameraJobStatus.status}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Processing camera {multiCameraJobStatus.current_camera}
                  {multiCameraJobStatus.total_cameras > 0 && (
                    <span> ({multiCameraJobStatus.processed_cameras}/{multiCameraJobStatus.total_cameras} completed)</span>
                  )}
                </div>
              </div>
            )}

            {/* Multi-Camera Job Completed */}
            {multiCameraJobStatus?.status === 'completed' && (
              <div className="mt-4 p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Multi-camera model generation completed! ({multiCameraJobStatus.processed_cameras} cameras)
              </div>
            )}

            {/* Vector Calibration Progress */}
            {vectorJobStatus && (vectorJobStatus.status === 'running' || vectorJobStatus.status === 'starting') && (
              <div className="mt-4 p-3 border rounded bg-green-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                  <strong>Vector Calibration:</strong>
                  <span className="capitalize">{vectorJobStatus.status}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Processing camera {vectorJobStatus.current_camera}
                  {vectorJobStatus.total_cameras > 0 && (
                    <span> ({vectorJobStatus.processed_cameras}/{vectorJobStatus.total_cameras} completed)</span>
                  )}
                  {vectorJobStatus.current_camera && vectorJobStatus.camera_progress?.[vectorJobStatus.current_camera] && (
                    <span> | Frames: {vectorJobStatus.camera_progress[vectorJobStatus.current_camera].current}/{vectorJobStatus.camera_progress[vectorJobStatus.current_camera].total}</span>
                  )}
                </div>
              </div>
            )}

            {/* Vector Calibration Completed */}
            {vectorJobStatus?.status === 'completed' && (
              <div className="mt-4 p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Vector calibration completed! ({vectorJobStatus.processed_cameras} cameras)
              </div>
            )}

            {/* Global Alignment Result */}
            {vectorJobStatus?.status === 'completed' && vectorJobStatus?.camera_results?.global_alignment && (
              <>
                {vectorJobStatus.camera_results.global_alignment.status === 'completed' && (
                  <div className="mt-2 p-3 border rounded bg-blue-50 text-blue-700 text-sm">
                    <CheckCircle2 className="h-4 w-4 inline mr-2" />
                    Global coordinate alignment applied
                    {vectorJobStatus.camera_results.global_alignment.cameras && (
                      <span> ({Object.keys(vectorJobStatus.camera_results.global_alignment.cameras).length} cameras)</span>
                    )}
                    {vectorJobStatus.camera_results.global_alignment.invert_ux && (
                      <span> + invert_ux</span>
                    )}
                  </div>
                )}
                {vectorJobStatus.camera_results.global_alignment.status === 'failed' && (
                  <div className="mt-2 p-3 border rounded bg-yellow-50 text-yellow-700 text-sm">
                    <AlertTriangle className="h-4 w-4 inline mr-2" />
                    Global alignment warning: {vectorJobStatus.camera_results.global_alignment.error}
                  </div>
                )}
                {vectorJobStatus.camera_results.global_alignment.status === 'skipped' && (
                  <div className="mt-2 p-2 text-xs text-muted-foreground">
                    Global coordinate alignment skipped (disabled in config)
                  </div>
                )}
              </>
            )}

            {/* Vector Calibration Failed */}
            {vectorJobStatus?.status === 'failed' && (
              <div className="mt-4 p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Vector calibration error: {vectorJobStatus.error || 'Unknown error'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section 8: Camera Model Results */}
      {hasModel && cameraModel && (
        <Card>
          <CardHeader>
            <CardTitle>Camera Model Results</CardTitle>
            <CardDescription>
              Calibration model for Camera {camera}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Camera Matrix */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Camera Matrix</h4>
                <div className="font-mono text-xs bg-muted p-2 rounded">
                  {cameraModel.camera_matrix?.map((row: number[], i: number) => (
                    <div key={i}>[{row.map(v => v?.toFixed(2) ?? 'null').join(', ')}]</div>
                  ))}
                </div>
              </div>

              {/* Intrinsic Parameters */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold mb-2">Intrinsic Parameters</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Focal Length (fx):</span>
                    <span className="ml-2 font-medium">{cameraModel.focal_length?.[0]?.toFixed(1)} px</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Focal Length (fy):</span>
                    <span className="ml-2 font-medium">{cameraModel.focal_length?.[1]?.toFixed(1)} px</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Principal Point (cx):</span>
                    <span className="ml-2 font-medium">{cameraModel.principal_point?.[0]?.toFixed(1)} px</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Principal Point (cy):</span>
                    <span className="ml-2 font-medium">{cameraModel.principal_point?.[1]?.toFixed(1)} px</span>
                  </div>
                </div>
              </div>

              {/* Distortion Coefficients */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Distortion Coefficients</h4>
                <div className="font-mono text-xs bg-muted p-2 rounded">
                  [{cameraModel.dist_coeffs?.map((d: number) => d?.toFixed(6) ?? 'null').join(', ')}]
                </div>
              </div>

              {/* Calibration Quality */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold mb-2">Calibration Quality</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">RMS Error:</span>
                    <span className="ml-2 font-medium">{cameraModel.reprojection_error?.toFixed(4)} px</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Images Used:</span>
                    <span className="ml-2 font-medium">{cameraModel.num_images_used}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Detection Summary */}
            {detections && Object.keys(detections).length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <h4 className="text-sm font-semibold mb-2">Detection Summary</h4>
                <p className="text-sm text-muted-foreground">
                  {Object.keys(detections).length} frames with detected grid points.
                  {showOverlay ? ' Toggle overlay in image viewer to visualize.' : ' Enable overlay in image viewer to visualize.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
