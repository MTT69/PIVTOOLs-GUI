"use client";
import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useChArUcoCalibration, ARUCO_DICTS } from "@/hooks/useChArUcoCalibration";

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
    filePattern,
    squaresH,
    squaresV,
    squareSize,
    markerRatio,
    arucoDict,
    minCorners,
    dt,
    calibrating,
    jobId,
    validationResult,
    validating,
    detectionPreview,
    detecting,
    setSourcePathIdx,
    setCamera,
    setFilePattern,
    setSquaresH,
    setSquaresV,
    setSquareSize,
    setMarkerRatio,
    setArucoDict,
    setMinCorners,
    setDt,
    jobStatus,
    jobDetails,
    validateImages,
    detectInImage,
    startCalibration,
    calibrateAllCameras,
  } = useChArUcoCalibration(
    config.calibration?.charuco || {},
    updateConfig,
    cameraOptions,
    sourcePaths
  );

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
    <Card>
      {/* Progress display if job is running */}
      {jobId && jobDetails && (
        <div className="mb-4 p-4 border rounded bg-blue-50">
          <div className="flex items-center gap-2 text-sm mb-2">
            <strong>ChArUco Calibration Progress:</strong>
            <span className="font-medium">{jobStatus}</span>
          </div>
          {(jobStatus === 'running' || jobStatus === 'starting') && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full"></span>
              Processing images...
            </div>
          )}
          <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
            <div className="h-2 bg-green-600" style={{ width: `${jobDetails.progress || 0}%` }}></div>
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
          {jobStatus === 'failed' && jobDetails.error && (
            <div className="mt-2 text-xs text-red-600">
              Error: {jobDetails.error}
            </div>
          )}
        </div>
      )}

      <CardHeader>
        <CardTitle>ChArUco Board Calibration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Source Path */}
        <div>
          <label className="block text-xs font-medium">Source Path</label>
          <Select value={String(sourcePathIdx)} onValueChange={v => setSourcePathIdx(Number(v))}>
            <SelectTrigger><SelectValue placeholder="Pick source path" /></SelectTrigger>
            <SelectContent>
              {sourcePaths.map((p, i) => (
                <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Camera */}
        <div>
          <label className="block text-xs font-medium">Camera</label>
          <Select value={String(camera)} onValueChange={v => setCamera(Number(v))}>
            <SelectTrigger><SelectValue placeholder="Pick camera" /></SelectTrigger>
            <SelectContent>
              {cameraOptions.map((c) => (
                <SelectItem key={c} value={String(c)}>Camera {c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* File Pattern */}
        <div>
          <label className="block text-xs font-medium">File Pattern</label>
          <Input
            type="text"
            value={filePattern}
            onChange={e => setFilePattern(e.target.value)}
            placeholder="*.tif"
          />
          <p className="text-xs text-muted-foreground mt-1">Glob pattern for calibration images (e.g., *.tif, charuco_*.png)</p>
        </div>

        {/* Board Parameters */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium">Squares (Horizontal)</label>
            <Input
              type="number"
              value={squaresH}
              onChange={e => setSquaresH(e.target.value)}
              min="3"
              placeholder="10"
            />
          </div>
          <div>
            <label className="block text-xs font-medium">Squares (Vertical)</label>
            <Input
              type="number"
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
              type="number"
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
              type="number"
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
              type="number"
              value={minCorners}
              onChange={e => setMinCorners(e.target.value)}
              min="4"
              placeholder="6"
            />
          </div>
          <div>
            <label className="block text-xs font-medium">Δt (seconds)</label>
            <Input
              type="number"
              value={dt}
              onChange={e => setDt(e.target.value)}
              step="any"
              min="0"
              placeholder="1.0"
            />
          </div>
        </div>

        {/* Validation Section */}
        <div className="border-t pt-4 mt-4">
          <h4 className="font-medium text-sm mb-2">Image Validation</h4>
          <div className="flex gap-2">
            <Button
              onClick={validateImages}
              disabled={validating}
              variant="outline"
              size="sm"
            >
              {validating ? "Validating..." : "Validate Images"}
            </Button>
            <Button
              onClick={() => detectInImage(0)}
              disabled={detecting}
              variant="outline"
              size="sm"
            >
              {detecting ? "Detecting..." : "Detect in First Image"}
            </Button>
          </div>

          {validationResult && (
            <div className={`mt-2 p-2 rounded text-xs ${validationResult.valid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {validationResult.valid ? (
                <>
                  <span className="font-medium">Found {validationResult.found_count} images</span>
                  {validationResult.sample_files && (
                    <div className="mt-1 text-xs opacity-75">
                      {validationResult.sample_files.slice(0, 3).join(", ")}
                      {validationResult.sample_files.length > 3 && "..."}
                    </div>
                  )}
                </>
              ) : (
                <span>{validationResult.error || "Validation failed"}</span>
              )}
            </div>
          )}

          {detectionPreview && (
            <div className={`mt-2 p-2 rounded text-xs ${detectionPreview.found ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
              {detectionPreview.found ? (
                <>
                  <span className="font-medium">Detected {detectionPreview.corner_count} corners</span>
                  {detectionPreview.marker_count !== undefined && (
                    <span> ({detectionPreview.marker_count} markers)</span>
                  )}
                </>
              ) : (
                <span>{detectionPreview.message || detectionPreview.error || "Detection failed"}</span>
              )}
            </div>
          )}

          {detectionPreview?.detection_preview && (
            <div className="mt-2">
              <img
                src={`data:image/png;base64,${detectionPreview.detection_preview}`}
                alt="Detection preview"
                className="max-w-full border rounded"
              />
            </div>
          )}
        </div>

        {/* Calibration Buttons */}
        <div className="flex gap-2 pt-4 border-t">
          <Button
            onClick={startCalibration}
            disabled={calibrating}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {calibrating ? "Calibrating..." : "Calibrate Camera"}
          </Button>
          {cameraOptions.length > 1 && (
            <Button
              onClick={calibrateAllCameras}
              disabled={calibrating}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {calibrating ? "Calibrating..." : "Calibrate All Cameras"}
            </Button>
          )}
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
          ChArUco calibration uses ArUco markers combined with a chessboard pattern.<br />
          It aggregates corner detections across multiple images for robust camera calibration.<br />
          The output camera model is compatible with the Vector Calibrator.
        </div>
      </CardContent>
    </Card>
  );
};
