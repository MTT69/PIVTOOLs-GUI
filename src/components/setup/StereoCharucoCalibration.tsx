"use client";
import React, { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Eye, EyeOff, CheckCircle2, Loader2, Camera } from "lucide-react";
import { useStereoCharucoCalibration, StereoCharucoFrameDetection, ARUCO_DICTS } from "@/hooks/useStereoCharucoCalibration";
import { ValidationAlert } from "@/components/setup/ValidationAlert";
import CalibrationImageViewer, { FrameDetectionData } from "@/components/viewer/CalibrationImageViewer";

interface StereoCharucoCalibrationProps {
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

export const StereoCharucoCalibration: React.FC<StereoCharucoCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
}) => {
  // Use the stereo ChArUco calibration hook
  const calibration = useStereoCharucoCalibration(cameraOptions, sourcePaths);

  const {
    // Source selection
    sourcePathIdx,
    setSourcePathIdx,
    cam1,
    setCam1,
    cam2,
    setCam2,

    // Active camera for viewer
    activeCam,
    setActiveCam,

    // Image config
    imageFormat,
    setImageFormat,
    imageType,
    setImageType,
    numImages,
    setNumImages,
    subfolder,
    setSubfolder,
    useCameraSubfolders,
    setUseCameraSubfolders,
    cameraSubfolders,
    setCameraSubfolders,
    pathOrder,
    setPathOrder,

    // ChArUco board params
    squaresH,
    setSquaresH,
    squaresV,
    setSquaresV,
    squareSize,
    setSquareSize,
    markerRatio,
    setMarkerRatio,
    arucoDict,
    setArucoDict,
    minCorners,
    setMinCorners,
    dt,
    setDt,

    // Validation
    validation,
    validating,

    // Calibration job tracking
    jobStatus,
    isCalibrating,

    // Reconstruction job tracking
    reconstructJobStatus,
    isReconstructing,

    // Model and detections
    stereoModel,
    detectionsCam1,
    detectionsCam2,
    modelLoading,
    hasModel,

    // Overlay toggle
    showOverlay,
    setShowOverlay,

    // Actions
    generateStereoModel,
    loadModel,
    reconstructVectors,
  } = calibration;

  // Local state
  const [showImageViewer, setShowImageViewer] = useState(false);
  const [reconstructTypeName, setReconstructTypeName] = useState<'instantaneous' | 'ensemble'>('instantaneous');

  // Load piv_type from config on mount
  useEffect(() => {
    const pivType = config.calibration?.piv_type;
    if (pivType === 'instantaneous' || pivType === 'ensemble') {
      setReconstructTypeName(pivType);
    }
  }, [config.calibration?.piv_type]);

  // Save piv_type when changed
  const handleReconstructTypeChange = async (value: 'instantaneous' | 'ensemble') => {
    setReconstructTypeName(value);
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

  // Set as active calibration method
  const setAsActiveMethod = async () => {
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calibration: { active: "stereo_charuco" },
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

  const isActive = config.calibration?.active === "stereo_charuco";

  // Local input state for debouncing
  const [squaresHInput, setSquaresHInput] = useState(String(squaresH));
  const [squaresVInput, setSquaresVInput] = useState(String(squaresV));
  const [squareSizeInput, setSquareSizeInput] = useState(String(squareSize));
  const [markerRatioInput, setMarkerRatioInput] = useState(String(markerRatio));
  const [minCornersInput, setMinCornersInput] = useState(String(minCorners));
  const [dtInput, setDtInput] = useState(String(dt));

  // Sync local inputs with hook state
  React.useEffect(() => {
    setSquaresHInput(String(squaresH));
  }, [squaresH]);

  React.useEffect(() => {
    setSquaresVInput(String(squaresV));
  }, [squaresV]);

  React.useEffect(() => {
    setSquareSizeInput(String(squareSize));
  }, [squareSize]);

  React.useEffect(() => {
    setMarkerRatioInput(String(markerRatio));
  }, [markerRatio]);

  React.useEffect(() => {
    setMinCornersInput(String(minCorners));
  }, [minCorners]);

  React.useEffect(() => {
    setDtInput(String(dt));
  }, [dt]);

  // Convert detections to format expected by CalibrationImageViewer
  // Use active camera's detections
  const savedDetections = useMemo((): Record<number, FrameDetectionData> | undefined => {
    const detections = activeCam === cam1 ? detectionsCam1 : detectionsCam2;
    if (!detections || Object.keys(detections).length === 0) return undefined;
    const result: Record<number, FrameDetectionData> = {};
    for (const [key, value] of Object.entries(detections)) {
      const frameIdx = parseInt(key, 10);
      if (!isNaN(frameIdx) && value.grid_points) {
        result[frameIdx] = {
          grid_points: value.grid_points,
        };
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }, [detectionsCam1, detectionsCam2, activeCam, cam1]);

  // Check if container format (unsupported on macOS)
  const isContainerFormat = imageFormat.includes('.set') || imageFormat.includes('.im7');
  const isMacOS = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac');

  return (
    <div className="space-y-6">
      {/* Main Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle>Stereo ChArUco Calibration</CardTitle>
          <CardDescription>
            Configure and run stereo ChArUco calibration for 3D velocity reconstruction
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Section 1: Source and Camera Selection */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Source Path</label>
              <Select value={String(sourcePathIdx)} onValueChange={v => setSourcePathIdx(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Pick source path" /></SelectTrigger>
                <SelectContent>
                  {sourcePaths.map((p, i) => (
                    <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Configured in Settings &rarr; Directories.</p>
            </div>
            <div>
              <label className="text-sm font-medium">Camera 1</label>
              <Select value={String(cam1)} onValueChange={v => setCam1(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Select camera 1" /></SelectTrigger>
                <SelectContent>
                  {cameraOptions.map((c) => (
                    <SelectItem key={c} value={String(c)} disabled={c === cam2}>
                      {`Camera ${c}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Camera 2</label>
              <Select value={String(cam2)} onValueChange={v => setCam2(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Select camera 2" /></SelectTrigger>
                <SelectContent>
                  {cameraOptions.map((c) => (
                    <SelectItem key={c} value={String(c)} disabled={c === cam1}>
                      {`Camera ${c}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Section 2: Image Configuration */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                onChange={e => setNumImages(Number(e.target.value) || 1)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Subfolder (optional)</label>
              <Input
                value={subfolder}
                onChange={e => setSubfolder(e.target.value)}
                placeholder="e.g., calibration"
              />
            </div>
          </div>

          {/* Use Camera Subfolders Toggle */}
          {(imageType === "standard" || imageType === "lavision_im7") && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="stereo-charuco-use-camera-subfolders"
                  checked={useCameraSubfolders}
                  onCheckedChange={setUseCameraSubfolders}
                />
                <Label htmlFor="stereo-charuco-use-camera-subfolders" className="text-sm">
                  Use camera subfolders
                </Label>
              </div>
              <p className="text-xs text-muted-foreground ml-10">
                {useCameraSubfolders
                  ? "Images expected in camera subfolders (e.g., Cam1/, Cam2/)."
                  : "Images in source directory without camera subfolders."}
              </p>
            </div>
          )}

          {/* Camera Subfolders & Path Order - only show when using camera subfolders */}
          {useCameraSubfolders && (
            <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
              <h4 className="text-sm font-medium">Calibration Path Configuration</h4>

              {/* Path Order Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Path Order</label>
                <Select value={pathOrder} onValueChange={setPathOrder}>
                  <SelectTrigger className="w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="camera_first">Camera folder first (source/Cam1/calibration/)</SelectItem>
                    <SelectItem value="calibration_first">Calibration folder first (source/calibration/Cam1/)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {pathOrder === "calibration_first"
                    ? `Example: ${sourcePaths[sourcePathIdx] ? basename(sourcePaths[sourcePathIdx]) : 'source'}/${subfolder || 'calibration'}/${cameraSubfolders[0] || `Cam${cam1}`}/`
                    : `Example: ${sourcePaths[sourcePathIdx] ? basename(sourcePaths[sourcePathIdx]) : 'source'}/${cameraSubfolders[0] || `Cam${cam1}`}/${subfolder || 'calibration'}/`
                  }
                </p>
              </div>

              {/* Custom Camera Subfolder Names */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Camera Subfolder Names (optional)</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Custom folder names for each camera. Leave empty to use defaults (Cam1, Cam2).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Camera {cam1}</label>
                    <Input
                      placeholder={`Cam${cam1}`}
                      value={cameraSubfolders[0] || ''}
                      onChange={e => {
                        const newSubfolders = [...cameraSubfolders];
                        while (newSubfolders.length < 2) newSubfolders.push('');
                        newSubfolders[0] = e.target.value;
                        setCameraSubfolders(newSubfolders);
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Camera {cam2}</label>
                    <Input
                      placeholder={`Cam${cam2}`}
                      value={cameraSubfolders[1] || ''}
                      onChange={e => {
                        const newSubfolders = [...cameraSubfolders];
                        while (newSubfolders.length < 2) newSubfolders.push('');
                        newSubfolders[1] = e.target.value;
                        setCameraSubfolders(newSubfolders);
                      }}
                    />
                  </div>
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

          {/* Section 3: Stereo Validation Status */}
          {validation && (
            <div className="space-y-2">
              <ValidationAlert
                validation={{
                  valid: validation.valid,
                  checked: !validating,
                  error: validation.error || null,
                }}
                customSuccessMessage={
                  validation.valid
                    ? `Found ${validation.matching_count === 'container' ? 'container files' : `${validation.matching_count} matching calibration image pairs`}`
                    : undefined
                }
              />
              {/* Per-camera details */}
              {validation.cam1 && validation.cam2 && (
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className={validation.cam1.valid ? "text-green-600" : "text-red-500"}>
                    Cam {cam1}: {validation.cam1.found_count === 'container' ? 'container' : `${validation.cam1.found_count} images`}
                    {validation.cam1.error && ` (${validation.cam1.error})`}
                  </span>
                  <span className={validation.cam2.valid ? "text-green-600" : "text-red-500"}>
                    Cam {cam2}: {validation.cam2.found_count === 'container' ? 'container' : `${validation.cam2.found_count} images`}
                    {validation.cam2.error && ` (${validation.cam2.error})`}
                  </span>
                </div>
              )}
              {/* Suggested Pattern Button */}
              {!validation.valid && (validation.cam1?.suggested_pattern || validation.cam2?.suggested_pattern) && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-600">Suggestion:</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setImageFormat(validation.cam1?.suggested_pattern || validation.cam2?.suggested_pattern || '')}
                    className="text-blue-600 border-blue-300 hover:bg-blue-50"
                  >
                    Use "{validation.cam1?.suggested_pattern || validation.cam2?.suggested_pattern}"
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Section 4: ChArUco Board Parameters */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">ChArUco Board Parameters</h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-sm font-medium">Squares Horizontal</label>
                <Input
                  type="number"
                  min={3}
                  value={squaresHInput}
                  onChange={e => setSquaresHInput(e.target.value)}
                  onBlur={() => setSquaresH(parseInt(squaresHInput) || 10)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Squares Vertical</label>
                <Input
                  type="number"
                  min={3}
                  value={squaresVInput}
                  onChange={e => setSquaresVInput(e.target.value)}
                  onBlur={() => setSquaresV(parseInt(squaresVInput) || 9)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Square Size (m)</label>
                <Input
                  type="number"
                  step="any"
                  min={0.001}
                  value={squareSizeInput}
                  onChange={e => setSquareSizeInput(e.target.value)}
                  onBlur={() => setSquareSize(parseFloat(squareSizeInput) || 0.03)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Marker Ratio</label>
                <Input
                  type="number"
                  step="0.1"
                  min={0.1}
                  max={1.0}
                  value={markerRatioInput}
                  onChange={e => setMarkerRatioInput(e.target.value)}
                  onBlur={() => setMarkerRatio(parseFloat(markerRatioInput) || 0.5)}
                />
              </div>
            </div>
          </div>

          {/* Section 5: Detection Parameters */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">Detection Parameters</h3>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">ArUco Dictionary</label>
                <Select value={arucoDict} onValueChange={setArucoDict}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ARUCO_DICTS.map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Min Corners</label>
                <Input
                  type="number"
                  min={4}
                  value={minCornersInput}
                  onChange={e => setMinCornersInput(e.target.value)}
                  onBlur={() => setMinCorners(parseInt(minCornersInput) || 6)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">&Delta;t (seconds)</label>
                <Input
                  type="number"
                  step="any"
                  min={0.001}
                  value={dtInput}
                  onChange={e => setDtInput(e.target.value)}
                  onBlur={() => setDt(parseFloat(dtInput) || 1.0)}
                />
              </div>
            </div>
          </div>

          {/* Section 6: Image Viewer Toggle */}
          {validation?.valid && (
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowImageViewer(!showImageViewer)}
                className="flex items-center gap-2"
              >
                {showImageViewer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showImageViewer ? 'Hide Image Viewer' : 'Browse Calibration Images'}
              </Button>

              {/* Camera Toggle (shown when viewer is visible) */}
              {showImageViewer && (
                <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                  <Button
                    variant={activeCam === cam1 ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setActiveCam(cam1)}
                    className="h-7 px-3"
                  >
                    <Camera className="h-3 w-3 mr-1" />
                    Cam {cam1}
                  </Button>
                  <Button
                    variant={activeCam === cam2 ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setActiveCam(cam2)}
                    className="h-7 px-3"
                  >
                    <Camera className="h-3 w-3 mr-1" />
                    Cam {cam2}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Section 7: Image Viewer with Overlay Support */}
          {showImageViewer && validation?.valid && (
            <CalibrationImageViewer
              backendUrl="/backend"
              sourcePathIdx={sourcePathIdx}
              camera={activeCam}
              numImages={numImages}
              calibrationType="stereo_charuco"
              calibrationParams={{
                squares_h: squaresH,
                squares_v: squaresV,
                square_size: squareSize,
                marker_ratio: markerRatio,
                aruco_dict: arucoDict,
              }}
              stereoParams={{ cam1, cam2 }}
              savedDetections={savedDetections}
              showSavedOverlay={showOverlay}
              onSavedOverlayChange={setShowOverlay}
            />
          )}

          {/* Section 8: Action Buttons */}
          <div className="border-t pt-4">
            <div className="flex gap-3 items-center flex-wrap">
              {/* Generate Stereo Model */}
              <Button
                onClick={generateStereoModel}
                disabled={isCalibrating || !validation?.valid}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isCalibrating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate Stereo Model'
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
                  'Load Saved Model'
                )}
              </Button>

              {/* Reconstruct 3D Vectors with type selector */}
              <div className="flex gap-2 items-center">
                <Select value={reconstructTypeName} onValueChange={handleReconstructTypeChange}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instantaneous">Instantaneous</SelectItem>
                    <SelectItem value="ensemble">Ensemble</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => reconstructVectors(reconstructTypeName)}
                  disabled={!hasModel || isReconstructing}
                  variant="outline"
                  className="border-green-500 text-green-700 hover:bg-green-50"
                  title={!hasModel ? "Generate or load a stereo model first" : "Reconstruct 3D velocity vectors"}
                >
                  {isReconstructing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Reconstructing...
                    </>
                  ) : (
                    'Reconstruct 3D Vectors'
                  )}
                </Button>
              </div>

              {/* Set as Active Method */}
              <Button
                onClick={setAsActiveMethod}
                disabled={isActive}
                className={isActive ? "bg-green-600 hover:bg-green-600 text-white" : ""}
                variant={isActive ? "default" : "outline"}
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

            {/* Calibration Job Progress */}
            {jobStatus && (jobStatus.status === 'running' || jobStatus.status === 'starting') && (
              <div className="mt-4 p-3 border rounded bg-blue-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <strong>Stereo ChArUco Calibration:</strong>
                  <span className="capitalize">{jobStatus.stage || jobStatus.status}</span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
                  <div
                    className="h-2 bg-blue-600 transition-all"
                    style={{ width: `${jobStatus.progress || 0}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Progress: {jobStatus.progress?.toFixed(0) || 0}%
                  {jobStatus.processed_pairs !== undefined && (
                    <span> | Pairs: {jobStatus.processed_pairs}/{jobStatus.total_pairs}</span>
                  )}
                  {jobStatus.valid_pairs !== undefined && jobStatus.valid_pairs > 0 && (
                    <span> | Valid: {jobStatus.valid_pairs}</span>
                  )}
                </div>
              </div>
            )}

            {/* Calibration Job Completed */}
            {jobStatus?.status === 'completed' && (
              <div className="mt-4 p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Stereo ChArUco calibration completed successfully!
                {jobStatus.stereo_rms_error && (
                  <span className="ml-2">RMS: {jobStatus.stereo_rms_error.toFixed(4)} px</span>
                )}
              </div>
            )}

            {/* Calibration Job Failed */}
            {jobStatus?.status === 'failed' && (
              <div className="mt-4 p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Error: {jobStatus.error || 'Stereo ChArUco calibration failed'}
              </div>
            )}

            {/* Reconstruction Job Progress */}
            {reconstructJobStatus && (reconstructJobStatus.status === 'running' || reconstructJobStatus.status === 'starting') && (
              <div className="mt-4 p-3 border rounded bg-green-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                  <strong>3D Reconstruction:</strong>
                  <span className="capitalize">{reconstructJobStatus.status}</span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
                  <div
                    className="h-2 bg-green-600 transition-all"
                    style={{ width: `${reconstructJobStatus.progress || 0}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Progress: {reconstructJobStatus.progress?.toFixed(0) || 0}%
                  {reconstructJobStatus.processed_frames !== undefined && (
                    <span> | Frames: {reconstructJobStatus.processed_frames}/{reconstructJobStatus.total_frames}</span>
                  )}
                  {reconstructJobStatus.successful_frames !== undefined && reconstructJobStatus.successful_frames > 0 && (
                    <span> | Successful: {reconstructJobStatus.successful_frames}</span>
                  )}
                </div>
              </div>
            )}

            {/* Reconstruction Job Completed */}
            {reconstructJobStatus?.status === 'completed' && (
              <div className="mt-4 p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                3D reconstruction completed!
              </div>
            )}

            {/* Reconstruction Job Failed */}
            {reconstructJobStatus?.status === 'failed' && (
              <div className="mt-4 p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Reconstruction error: {reconstructJobStatus.error || 'Unknown error'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section 9: Stereo Model Results */}
      {hasModel && stereoModel && (
        <Card>
          <CardHeader>
            <CardTitle>Stereo ChArUco Model Results</CardTitle>
            <CardDescription>
              Stereo calibration for Cameras {cam1} and {cam2}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Quality Metrics */}
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Stereo RMS Error</div>
                <div className="text-lg font-semibold">{stereoModel.stereo_rms_error?.toFixed(4)} px</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Relative Angle</div>
                <div className="text-lg font-semibold">{stereoModel.relative_angle_deg?.toFixed(2)}&deg;</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Baseline Distance</div>
                <div className="text-lg font-semibold">{stereoModel.baseline_distance_mm?.toFixed(2)} mm</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Image Pairs Used</div>
                <div className="text-lg font-semibold">{stereoModel.num_image_pairs}</div>
              </div>
            </div>

            {/* Per-Camera Quality */}
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <div className="p-3 border rounded">
                <h4 className="text-sm font-semibold mb-2">Camera {cam1}</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">RMS Error:</span>
                    <span className="ml-2 font-medium">{stereoModel.cam1_rms_error?.toFixed(4)} px</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Focal Length:</span>
                    <span className="ml-2 font-medium">
                      {stereoModel.focal_length_1?.[0]?.toFixed(1)} / {stereoModel.focal_length_1?.[1]?.toFixed(1)} px
                    </span>
                  </div>
                </div>
              </div>
              <div className="p-3 border rounded">
                <h4 className="text-sm font-semibold mb-2">Camera {cam2}</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">RMS Error:</span>
                    <span className="ml-2 font-medium">{stereoModel.cam2_rms_error?.toFixed(4)} px</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Focal Length:</span>
                    <span className="ml-2 font-medium">
                      {stereoModel.focal_length_2?.[0]?.toFixed(1)} / {stereoModel.focal_length_2?.[1]?.toFixed(1)} px
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Stereo Geometry (collapsible) */}
            <details className="border rounded">
              <summary className="p-3 cursor-pointer text-sm font-semibold">
                Stereo Geometry Matrices
              </summary>
              <div className="p-3 pt-0 grid md:grid-cols-2 gap-4">
                <div>
                  <h5 className="text-xs font-medium mb-1 text-muted-foreground">Rotation Matrix (R)</h5>
                  <div className="font-mono text-xs bg-muted p-2 rounded">
                    {stereoModel.rotation_matrix?.map((row: number[], i: number) => (
                      <div key={i}>[{row.map(v => v.toFixed(6)).join(', ')}]</div>
                    ))}
                  </div>
                </div>
                <div>
                  <h5 className="text-xs font-medium mb-1 text-muted-foreground">Translation Vector (T)</h5>
                  <div className="font-mono text-xs bg-muted p-2 rounded">
                    [{stereoModel.translation_vector?.map((v: number) => v.toFixed(4)).join(', ')}]
                  </div>
                </div>
              </div>
            </details>

            {/* Detection Summary */}
            {(Object.keys(detectionsCam1).length > 0 || Object.keys(detectionsCam2).length > 0) && (
              <div className="mt-4 pt-4 border-t">
                <h4 className="text-sm font-semibold mb-2">Detection Summary</h4>
                <p className="text-sm text-muted-foreground">
                  Cam {cam1}: {Object.keys(detectionsCam1).length} frames with detections |
                  Cam {cam2}: {Object.keys(detectionsCam2).length} frames with detections.
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
