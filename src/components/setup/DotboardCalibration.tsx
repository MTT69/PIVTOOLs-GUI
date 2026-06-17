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
import { CalibrationFigureGallery } from "@/components/setup/CalibrationFigureGallery";
import CalibrationImageViewer, { FrameDetectionData } from "@/components/viewer/CalibrationImageViewer";
import {
  useWorldFrame,
  WorldFrameControls,
  getWorldFrameMarkers,
} from "@/components/setup/WorldFrameSetup";
import { JointMultiCamera } from "@/components/setup/JointMultiCamera";

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
    modelType,
    setModelType,

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
    detectError,
    hasModel,

    // Overlay toggle
    showOverlay,
    setShowOverlay,

    // Model restore
    loadedWorldFrame,
    persistWorldFrame,

    // Actions
    generateCameraModel,
    generateCameraModelAll,
    calibrateVectors,
    detectFrame,
  } = calibration;

  // Track the frame currently shown in the viewer (1-based, matches datumFrame).
  // Stable handler so the viewer's onFrameChange effect never re-fires from closure identity.
  const [currentFrame, setCurrentFrame] = useState<number>(Number(datumFrame) || 1);
  const handleFrameChange = useCallback((idx: number) => setCurrentFrame(idx), []);
  const datumNum = Number(datumFrame) || 1;
  const onDatumFrame = currentFrame === datumNum;

  // Multi-camera datasets are always solved jointly (one shared board); a single camera falls back
  // to a per-camera mono solve. The two share this tab — no toggle. JointMultiCamera owns the
  // multi-camera flow (per-view origin anchoring + cross-camera bridges); the mono UI below owns
  // the single-camera flow.
  const multiCam = cameraOptions.length >= 2;

  // World-frame (coordinate-system x,y) picker — datum frame only (single-camera mono solve).
  const wf = useWorldFrame({
    board: "dotboard", camera, sourcePathIdx, datumFrame,
    boardParams: () => ({ dot_spacing_mm: dotSpacingMm }),
    imageFormat, imageType,
  });
  const wfIsSelecting = onDatumFrame && wf.mode !== "none";

  // When a saved model loads, restore its world frame (origin/+X/+Y + origin mm) and
  // show the detected dots — so an existing model presents fully without re-picking.
  React.useEffect(() => {
    if (!hasModel) return;
    if (loadedWorldFrame) wf.restore(loadedWorldFrame);
    detectFrame(currentFrame);
    setShowOverlay(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasModel, loadedWorldFrame]);

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
          grid_indices: value.grid_indices,
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
                type="text" inputMode="numeric"
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

          {/* Suggested Subfolder Button */}
          {validation && !validation.valid && validation.suggested_subfolder && (() => {
            const sub = validation.suggested_subfolder!;
            const cams: number[] = config?.paths?.camera_numbers || [1, 2];
            // Infer per-camera subfolders by replacing the camera number in the suggestion
            const perCam = cams.map((c: number) => sub.replace(/\d+/, String(c)));
            const label = [...new Set(perCam)].join('" / "');
            return (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">Subfolder suggestion:</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setUseCameraSubfolders(true);
                    setCameraSubfolders(perCam);
                  }}
                  className="text-blue-600 border-blue-300 hover:bg-blue-50"
                >
                  Use "{label}"
                </Button>
              </div>
            );
          })()}

          {/* Section 4: Grid Parameters */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">Grid Detection Parameters</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Grid dimensions are automatically detected using RANSAC-based analysis.
            </p>
            <div className="mb-4 max-w-xs">
              <label className="text-sm font-medium">Camera Model</label>
              <Select value={modelType} onValueChange={(v) => setModelType(v as 'pinhole' | 'polynomial')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pinhole">Pinhole (OpenCV k1,k2,p1,p2)</SelectItem>
                  <SelectItem value="polynomial">Polynomial (3rd order, single plane)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {modelType === 'polynomial'
                  ? 'Single-plane image→world map fitted from the datum frame only.'
                  : '3D pinhole intrinsics + pose across all detected views.'}
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">Dot Spacing (mm)</label>
                <Input
                  type="text" inputMode="numeric"
                  step="any"
                  min={0}
                  value={dotSpacingMmInput}
                  onChange={e => setDotSpacingMmInput(e.target.value)}
                  onBlur={() => setDotSpacingMm(parseFloat(dotSpacingMmInput) || 15.0)}
                />
                <p className="text-xs text-muted-foreground mt-1">Physical spacing between dots</p>
              </div>
              <div>
                <label className="text-sm font-medium">Δt (seconds)</label>
                <Input
                  type="text" inputMode="numeric"
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
                  type="text" inputMode="numeric"
                  min={1}
                  value={datumFrameInput}
                  onChange={e => setDatumFrameInput(e.target.value)}
                  onBlur={() => setDatumFrame(parseInt(datumFrameInput) || 1)}
                />
                <p className="text-xs text-muted-foreground mt-1">Calibration image defining world origin</p>
              </div>
            </div>
          </div>

          {/* Multi-camera datasets are solved jointly against one shared board (no toggle). A single
              camera uses the per-camera mono solve below. */}
          {multiCam && (
            <JointMultiCamera
              board="dotboard"
              cameraOptions={cameraOptions}
              sourcePathIdx={sourcePathIdx}
              numImages={parseInt(numImages) || 10}
              imageFormat={imageFormat}
              imageType={imageType}
              modelType={modelType}
              validationValid={!!validation?.valid}
              datumFrame={Number(datumFrame) || 1}
              dotSpacingMm={dotSpacingMm}
              calibrateVectors={calibrateVectors}
              vectorJobStatus={vectorJobStatus}
              isVectorCalibrating={isVectorCalibrating}
            />
          )}

          {!multiCam && (
          <>
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

          {/* Section 6: Image Viewer with Overlay + world-frame / global-coords picking */}
          {showImageViewer && validation?.valid && (
            <CalibrationImageViewer
              backendUrl="/backend"
              sourcePathIdx={sourcePathIdx}
              camera={camera}
              numImages={parseInt(numImages) || 10}
              calibrationType="dotboard"
              refreshKey={`${validation?.camera_path}-${validation?.valid}`}
              onFrameChange={handleFrameChange}
              savedDetections={savedDetections}
              showSavedOverlay={showOverlay}
              onSavedOverlayChange={setShowOverlay}
              pointSelectMode={wfIsSelecting}
              onPointSelect={(px, py) => { if (wfIsSelecting) wf.handlePoint(px, py); }}
              selectedMarkers={onDatumFrame ? getWorldFrameMarkers(wf) : []}
              detectionLoading={modelLoading}
              settingsBarExtras={
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline" size="sm" disabled={wf.busy}
                    onClick={async () => { await wf.prepare(); detectFrame(currentFrame); setShowOverlay(true); }}
                  >
                    {wf.busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Detect Dots
                  </Button>
                  {onDatumFrame ? (
                    <WorldFrameControls wf={wf} />
                  ) : (
                    <span className="text-xs text-muted-foreground">World frame is set on the datum frame ({datumNum}).</span>
                  )}
                </div>
              }
            />
          )}

          {/* Section 7: Action Buttons */}
          <div className="border-t pt-4 space-y-4">
            {/* Unified Action Row */}
            <div className="flex gap-2 items-center flex-wrap">
              <Button
                onClick={async () => { await generateCameraModelAll(wf.payload); await persistWorldFrame(wf.payload); detectFrame(currentFrame); setShowOverlay(true); }}
                disabled={isCalibrating || isMultiCameraCalibrating || !validation?.valid || !wf.complete}
                title={!wf.complete ? "Set the world frame first: Detect Dots → Origin → +X → +Y" : undefined}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {(isCalibrating || isMultiCameraCalibrating) ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  cameraOptions.length > 1 ? 'Generate Model (All Cameras)' : 'Generate Model'
                )}
              </Button>

              {cameraOptions.length > 1 && (
                <Button
                  onClick={async () => { await generateCameraModel(wf.payload); await persistWorldFrame(wf.payload); detectFrame(currentFrame); setShowOverlay(true); }}
                  disabled={isCalibrating || isMultiCameraCalibrating || !validation?.valid || !wf.complete}
                  title={!wf.complete ? "Set the world frame first: Detect Dots → Origin → +X → +Y" : undefined}
                  variant="outline"
                >
                  This Camera Only
                </Button>
              )}

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

            {validation?.valid && !wf.complete && (
              <p className="text-xs text-muted-foreground">
                Set the coordinate frame before generating: open the viewer, click <strong>Detect Dots</strong>, then pick <strong>Origin → +X → +Y</strong> on the datum frame.
              </p>
            )}

            {modelLoadError && (
              <div className="text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {modelLoadError}
              </div>
            )}

            {detectError && (
              <div className="text-sm text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {detectError}
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
                Camera model generation completed!
                {jobStatus.rms_error && (
                  <span className="ml-2">RMS: {Number(jobStatus.rms_error).toFixed(4)} {jobStatus.rms_unit ?? 'px'}</span>
                )}
                {jobStatus.num_images_used && (
                  <span className="ml-2">({jobStatus.num_images_used} images used)</span>
                )}
              </div>
            )}

            {/* Calibration Warnings (e.g. polynomial datum-only) */}
            {jobStatus?.status === 'completed' && jobStatus.warnings && jobStatus.warnings.length > 0 && (
              <div className="mt-2 p-3 border rounded bg-amber-50 text-amber-800 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                {jobStatus.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
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
                  <span>Camera {multiCameraJobStatus.current_camera || '...'}</span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
                  <div
                    className="h-2 bg-blue-600 transition-all"
                    style={{ width: `${multiCameraJobStatus.current_camera_progress || 0}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {multiCameraJobStatus.processed_images !== undefined && (
                    <span>Images: {multiCameraJobStatus.processed_images}/{multiCameraJobStatus.total_images}</span>
                  )}
                  {multiCameraJobStatus.valid_images !== undefined && multiCameraJobStatus.valid_images > 0 && (
                    <span> | Valid: {multiCameraJobStatus.valid_images}</span>
                  )}
                  {multiCameraJobStatus.total_cameras > 0 && (
                    <span> | Cameras: {multiCameraJobStatus.processed_cameras}/{multiCameraJobStatus.total_cameras}</span>
                  )}
                </div>
              </div>
            )}

            {/* Multi-Camera Job Completed */}
            {multiCameraJobStatus?.status === 'completed' && (
              <div className="mt-4 p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Multi-camera model generation completed! ({multiCameraJobStatus.processed_cameras} cameras)
                {multiCameraJobStatus.camera_results && (
                  <div className="mt-1 text-xs">
                    {Object.entries(multiCameraJobStatus.camera_results).map(([cam, res]: [string, any]) => (
                      <span key={cam} className="mr-3">
                        {cam}: {res.status === 'completed' && res.rms_error
                          ? `RMS ${Number(res.rms_error).toFixed(4)} ${res.rms_unit ?? 'px'} (${res.num_images_used} images)`
                          : res.status}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Multi-Camera Warnings */}
            {multiCameraJobStatus?.status === 'completed' && multiCameraJobStatus.camera_results && (() => {
              const allWarnings: { cam: string; msg: string }[] = [];
              Object.entries(multiCameraJobStatus.camera_results).forEach(([cam, res]: [string, any]) => {
                if (cam === 'global_alignment') return;
                (res?.warnings || []).forEach((m: string) => allWarnings.push({ cam, msg: m }));
              });
              return allWarnings.length > 0 ? (
                <div className="mt-2 p-3 border rounded bg-amber-50 text-amber-800 text-sm">
                  <AlertTriangle className="h-4 w-4 inline mr-2" />
                  {allWarnings.map((w, i) => (
                    <div key={i}>{w.cam}: {w.msg}</div>
                  ))}
                </div>
              ) : null;
            })()}

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
          </>
          )}
        </CardContent>
      </Card>

      {/* Section 8: Camera Model Results (single-camera mono solve) */}
      {!multiCam && hasModel && cameraModel && (
        <Card>
          <CardHeader>
            <CardTitle>Camera Model Results</CardTitle>
            <CardDescription>
              Calibration model for Camera {camera}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cameraModel.model_type === 'polynomial' ? (
              <div className="grid md:grid-cols-2 gap-6">
                {/* Polynomial coefficients (X) */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Coefficients X (mm)</h4>
                  <div className="font-mono text-xs bg-muted p-2 rounded break-all">
                    [{cameraModel.coeffs_x?.map((c: number) => c?.toFixed(6) ?? 'null').join(', ')}]
                  </div>
                </div>

                {/* Polynomial coefficients (Y) */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Coefficients Y (mm)</h4>
                  <div className="font-mono text-xs bg-muted p-2 rounded break-all">
                    [{cameraModel.coeffs_y?.map((c: number) => c?.toFixed(6) ?? 'null').join(', ')}]
                  </div>
                </div>

                {/* Normalisation */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold mb-2">Normalisation (s,t)</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-muted-foreground">x0:</span><span className="ml-2 font-medium">{cameraModel.norm?.x0?.toFixed(1)} px</span></div>
                    <div><span className="text-muted-foreground">sx:</span><span className="ml-2 font-medium">{cameraModel.norm?.sx?.toFixed(1)} px</span></div>
                    <div><span className="text-muted-foreground">y0:</span><span className="ml-2 font-medium">{cameraModel.norm?.y0?.toFixed(1)} px</span></div>
                    <div><span className="text-muted-foreground">sy:</span><span className="ml-2 font-medium">{cameraModel.norm?.sy?.toFixed(1)} px</span></div>
                  </div>
                </div>

                {/* Fit quality */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold mb-2">Fit Quality</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-muted-foreground">RMS X:</span><span className="ml-2 font-medium">{cameraModel.rms_x_mm?.toFixed(4)} mm</span></div>
                    <div><span className="text-muted-foreground">RMS Y:</span><span className="ml-2 font-medium">{cameraModel.rms_y_mm?.toFixed(4)} mm</span></div>
                    <div><span className="text-muted-foreground">Plane:</span><span className="ml-2 font-medium">datum frame only</span></div>
                  </div>
                </div>
              </div>
            ) : (
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
            )}

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

            <CalibrationFigureGallery
              query={{ board: "dotboard", camera, source_path_idx: sourcePathIdx }}
              trigger={cameraModel}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
};
