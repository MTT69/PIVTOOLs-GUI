"use client";
import React, { useState, useEffect, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Eye, EyeOff, CheckCircle2, Loader2, Camera } from "lucide-react";
import { useChArUcoCalibration, ARUCO_DICTS, FrameDetection } from "@/hooks/useChArUcoCalibration";
import { isContainerFormat, useIsMacOS } from "@/hooks/useCalibrationValidation";
import { useToast } from "@/components/ui/use-toast";
import { ValidationAlert } from "@/components/setup/ValidationAlert";
import CalibrationImageViewer, { FrameDetectionData } from "@/components/viewer/CalibrationImageViewer";
import {
  GCInlineControls,
  useGlobalCoordinates,
  getGlobalCoordMarkers,
  getGlobalCoordViewerTarget,
  handleGlobalCoordPointSelect,
} from "@/components/setup/GlobalCoordinateSetup";

interface ChArUcoCalibrationProps {
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

export const ChArUcoCalibration: React.FC<ChArUcoCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
}) => {
  const {
    sourcePathIdx,
    camera,
    squaresH,
    squaresV,
    squareSize,
    markerRatio,
    arucoDict,
    minCorners,
    dt,
    calibrating,
    jobId,

    // Image config (from hook)
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

    // Validation (from hook)
    validation,
    validating,

    // Model and detections (like dotboard)
    cameraModel,
    detections,
    modelLoading,
    modelLoadError,
    hasModel,

    // Overlay toggle
    showOverlay,
    setShowOverlay,

    // Vector calibration job tracking
    vectorJobStatus,
    isVectorCalibrating,

    setSourcePathIdx,
    setCamera,
    setSquaresH,
    setSquaresV,
    setSquareSize,
    setMarkerRatio,
    setArucoDict,
    setMinCorners,
    setDt,
    modelType,
    setModelType,
    jobStatus,
    jobDetails,
    startCalibration,
    calibrateAllCameras,
    loadModel,
    calibrateVectors,
  } = useChArUcoCalibration(
    cameraOptions,
    sourcePaths
  );

  const [showImageViewer, setShowImageViewer] = useState(false);

  // Global coordinate system — pass calibrationSources so stale features reset on source change
  const gc = useGlobalCoordinates(config, updateConfig, cameraOptions, calibrationSources);
  const gcViewerTarget = getGlobalCoordViewerTarget(gc);
  const gcIsSelecting = gc.selectionMode !== "none";
  const [currentViewerFrame, setCurrentViewerFrame] = useState(1);

  const [vectorTypeName, setVectorTypeName] = useState<'instantaneous' | 'ensemble'>('instantaneous');

  // Toast notifications
  const { toast } = useToast();

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

  const isMacOS = useIsMacOS();
  const hasUnsupportedFormat = isContainerFormat(imageFormat);

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

  // Show toast notification when model load error occurs
  useEffect(() => {
    if (modelLoadError) {
      toast({
        title: "Camera Model Error",
        description: modelLoadError,
        variant: "destructive",
      });
    }
  }, [modelLoadError, toast]);

  // Show toast notification when vector calibration fails
  useEffect(() => {
    if (vectorJobStatus?.status === 'failed') {
      toast({
        title: "Vector Calibration Failed",
        description: vectorJobStatus.error || "Unknown error occurred",
        variant: "destructive",
      });
    }
  }, [vectorJobStatus?.status, vectorJobStatus?.error, toast]);

  // Show toast notification when camera model calibration fails
  useEffect(() => {
    if (jobStatus === 'failed' || jobStatus === 'error') {
      toast({
        title: "Camera Model Calibration Failed",
        description: jobDetails?.error || "Calibration failed",
        variant: "destructive",
      });
    }
  }, [jobStatus, jobDetails?.error, toast]);

  const setAsActiveMethod = async () => {
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calibration: {
            active: "charuco",
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

  const isActive = config.calibration?.active === "charuco";

  return (
    <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>ChArUco Board Calibration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {/* Section 2: Base Path and Cameras */}
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
            <p className="text-xs text-muted-foreground mt-1">Where calibration models are saved.</p>
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
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium">Image Type</label>
            <Select
              value={imageType}
              onValueChange={setImageType}
            >
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
            <label className="block text-xs font-medium">Image Format</label>
            <Input
              type="text"
              value={imageFormat}
              onChange={e => setImageFormat(e.target.value)}
              placeholder="calib%05d.tif"
            />
          </div>
          <div>
            <label className="block text-xs font-medium">Number of Images</label>
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

        {/* Use Camera Subfolders Toggle */}
        {(imageType === "standard" || imageType === "lavision_im7") && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Switch
                id="charuco-use-camera-subfolders"
                checked={useCameraSubfolders}
                onCheckedChange={setUseCameraSubfolders}
              />
              <Label htmlFor="charuco-use-camera-subfolders" className="text-sm">
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

        {/* Camera Subfolder Names - only show when using camera subfolders */}
        {useCameraSubfolders && cameraOptions.length > 1 && (
          <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <h4 className="text-sm font-medium">Camera Subfolder Configuration</h4>
            <p className="text-xs text-muted-foreground">
              Camera subfolders are relative to the calibration source path.
              Example: {calibrationSources[sourcePathIdx] || '/path/to/calibration'}/{cameraSubfolders[0] || `Cam${cameraOptions[0]}`}/
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
                        while (newSubfolders.length < cameraOptions.length) newSubfolders.push('');
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

        {/* Board Parameters */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium">Squares (Horizontal)</label>
            <Input
              type="text" inputMode="numeric"
              value={squaresH}
              onChange={e => setSquaresH(e.target.value)}
              min="3"
              placeholder="10"
            />
          </div>
          <div>
            <label className="block text-xs font-medium">Squares (Vertical)</label>
            <Input
              type="text" inputMode="numeric"
              value={squaresV}
              onChange={e => setSquaresV(e.target.value)}
              min="3"
              placeholder="9"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium">Square Size (meters)</label>
            <Input
              type="text" inputMode="numeric"
              value={squareSize}
              onChange={e => setSquareSize(e.target.value)}
              step="0.001"
              min="0"
              placeholder="0.03"
            />
          </div>
          <div>
            <label className="block text-xs font-medium">Marker Ratio</label>
            <Input
              type="text" inputMode="numeric"
              value={markerRatio}
              onChange={e => setMarkerRatio(e.target.value)}
              step="0.1"
              min="0.1"
              max="1.0"
              placeholder="0.5"
            />
          </div>
        </div>

        {/* ArUco Dictionary */}
        <div>
          <label className="block text-xs font-medium">ArUco Dictionary</label>
          <Select value={arucoDict} onValueChange={setArucoDict}>
            <SelectTrigger><SelectValue placeholder="Select dictionary" /></SelectTrigger>
            <SelectContent>
              {ARUCO_DICTS.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium">Min Corners per Image</label>
            <Input
              type="text" inputMode="numeric"
              value={minCorners}
              onChange={e => setMinCorners(e.target.value)}
              min="4"
              placeholder="6"
            />
          </div>
          <div>
            <label className="block text-xs font-medium">Δt (seconds)</label>
            <Input
              type="text" inputMode="numeric"
              value={dt}
              onChange={e => setDt(e.target.value)}
              step="any"
              min="0"
              placeholder="1.0"
            />
          </div>
          <div>
            <label className="block text-xs font-medium">Model Type</label>
            <Select value={modelType} onValueChange={setModelType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pinhole">Pinhole (OpenCV)</SelectItem>
                <SelectItem value="polynomial">Polynomial (DaVis-compatible)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* macOS Warning for Unsupported Formats */}
        {hasUnsupportedFormat && isMacOS && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Unsupported File Format on macOS</AlertTitle>
            <AlertDescription>
              .set and .im7 container formats require Windows or Linux.
              These formats are not supported on macOS.
            </AlertDescription>
          </Alert>
        )}

        {/* Calibration Validation */}
        {validation && (
          <ValidationAlert
            validation={{
              valid: validation.valid,
              checked: !validating,
              error: validation.error || null,
            }}
            customSuccessMessage={
              validation.valid
                ? `Found ${validation.found_count === 'container' ? 'container file' : `${validation.found_count} calibration images`} in ${validation.camera_path?.split('/').pop()}`
                : undefined
            }
          />
        )}

        {/* Suggested Pattern Button - show when validation fails but a suggestion is available */}
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

        {/* Calibration Image Viewer Button */}
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

            {/* Camera Toggle (shown when viewer is visible and multiple cameras) */}
            {showImageViewer && cameraOptions.length > 1 && (
              <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                {cameraOptions.map((cam) => (
                  <Button
                    key={cam}
                    variant={camera === cam ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setCamera(cam)}
                    className="h-7 px-3"
                  >
                    <Camera className="h-3 w-3 mr-1" />
                    Cam {cam}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Calibration Image Viewer */}
        {showImageViewer && validation?.valid && (
          <CalibrationImageViewer
            backendUrl="/backend"
            sourcePathIdx={sourcePathIdx}
            camera={gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : camera}
            numImages={parseInt(numImages) || 10}
            calibrationType="charuco"
            refreshKey={`${validation?.camera_path}-${validation?.valid}`}
            calibrationParams={{
              squares_h: parseInt(squaresH) || 10,
              squares_v: parseInt(squaresV) || 9,
              square_length: parseFloat(squareSize) * 1000 || 30,  // Convert to mm
              marker_length: (parseFloat(squareSize) * parseFloat(markerRatio) * 1000) || 15,
              aruco_dict: arucoDict,
            }}
            onFrameChange={setCurrentViewerFrame}
            savedDetections={savedDetections}
            showSavedOverlay={showOverlay}
            onSavedOverlayChange={setShowOverlay}
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

        {/* Action Buttons */}
        <div className="border-t pt-4 space-y-4">
          {/* Unified Action Row */}
          <div className="flex gap-2 items-center flex-wrap">
            <Button
              onClick={() => calibrateAllCameras()}
              disabled={calibrating || !validation?.valid}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {calibrating ? (
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
        </div>

        {/* Progress display - shows when job is running */}
        {jobId && jobDetails && (
          <div className="mt-4 p-3 border rounded bg-green-50">
            <div className="flex items-center gap-2 text-sm mb-2">
              <strong>ChArUco Calibration Progress:</strong>
              <span className="font-medium capitalize">{jobStatus}</span>
            </div>
            {(jobStatus === 'running' || jobStatus === 'starting') && (
              <div className="flex items-center gap-2 text-green-600 text-sm mb-2">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full"></span>
                Processing images...
              </div>
            )}
            <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
              <div className="h-2 bg-green-600 transition-all" style={{ width: `${jobDetails.progress || 0}%` }}></div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Progress: {jobDetails.progress || 0}%
              {jobDetails.valid_images !== undefined && (
                <span> | Valid images: {jobDetails.valid_images}</span>
              )}
            </div>
            {jobStatus === 'completed' && (
              <div className="mt-2 text-xs text-green-600">
                Calibration completed!
                {jobDetails.rms_error && (
                  <span> RMS error: {Number(jobDetails.rms_error).toFixed(4)} pixels</span>
                )}
              </div>
            )}
            {jobStatus === 'completed' && Array.isArray(jobDetails.warnings) && jobDetails.warnings.length > 0 && (
              <div className="mt-2 p-2 border rounded bg-amber-50 text-amber-800 text-xs">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                {jobDetails.warnings.map((w: string, i: number) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            )}
            {(jobStatus === 'failed' || jobStatus === 'error') && (
              <div className="mt-2 text-xs text-red-600">
                Error: {jobDetails.error || 'Calibration failed'}
              </div>
            )}
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

      </CardContent>
    </Card>

    {/* Camera Model Results Card */}
    {hasModel && cameraModel && (
      <Card>
        <CardHeader>
          <CardTitle>Camera Model Results</CardTitle>
          <CardDescription>
            ChArUco calibration model for Camera {camera}
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
                {Object.keys(detections).length} frames with detected ChArUco corners.
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
