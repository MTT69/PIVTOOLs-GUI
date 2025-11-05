"use client";
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePinholeCalibration } from "@/hooks/usePinholeCalibration";

interface PinholeCalibrationProps {
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

export const PinholeCalibration: React.FC<PinholeCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
  imageCount = 1000,
}) => {
  const {
    sourcePathIdx,
    camera,
    filePattern,
    patternCols,
    patternRows,
    dotSpacingMm,
    enhanceDots,
    asymmetric,
    dt,
    imageB64,
    totalImages,
    gridPoints,
    showIndices,
    dewarpedB64,
    cameraModel,
    gridData,
    nativeSize,
    generating,
    vectorJobId,
    planarJobId,
    loadingResults,
    setSourcePathIdx,
    setCamera,
    setFilePattern,
    setPatternCols,
    setPatternRows,
    setDotSpacingMm,
    setEnhanceDots,
    setAsymmetric,
    setDt,
    calibrationStatus,
    calibrationDetails,
    vectorStatus,
    vectorDetails,
    generateCameraModel,
    calibrateVectors,
  } = usePinholeCalibration(
    config.calibration?.pinhole || {},
    updateConfig,
    cameraOptions,
    sourcePaths,
    imageCount
  );

  // Local state for inputs to prevent debouncing issues
  const [dtInput, setDtInput] = useState(String(dt));
  const [dotSpacingMmInput, setDotSpacingMmInput] = useState(String(dotSpacingMm));
  const [patternColsInput, setPatternColsInput] = useState(String(patternCols));
  const [patternRowsInput, setPatternRowsInput] = useState(String(patternRows));

  useEffect(() => {
    setDtInput(String(dt));
  }, [dt]);

  useEffect(() => {
    setDotSpacingMmInput(String(dotSpacingMm));
  }, [dotSpacingMm]);

  useEffect(() => {
    setPatternColsInput(String(patternCols));
  }, [patternCols]);

  useEffect(() => {
    setPatternRowsInput(String(patternRows));
  }, [patternRows]);

  const setAsActiveMethod = async () => {
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calibration: {
            active: "pinhole",
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

  const isActive = config.calibration?.active === "pinhole";

  return (
    <div className="space-y-6">
      {/* Vector Calibration Status - moved above main card */}
      {vectorJobId && vectorDetails && (
        <Card className="mb-4">
          <CardHeader><CardTitle>Vector Calibration Status</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">Status: <span className="font-medium">{vectorStatus}</span></div>
            {(vectorStatus === 'running' || vectorStatus === 'starting') && (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full"></span>
                Vector calibration is running...
              </div>
            )}
            <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
              <div className={`h-2 bg-green-600`} style={{ width: `${vectorDetails.progress || 0}%` }}></div>
            </div>
            <div className="text-xs text-muted-foreground">Progress: {vectorDetails.progress || 0}% {vectorDetails.processed_frames !== undefined && vectorDetails.total_frames !== undefined && `(Frames: ${vectorDetails.processed_frames}/${vectorDetails.total_frames})`}</div>
            {vectorStatus === 'completed' && (
              <div className="mt-2 text-xs text-green-600">
                Vector calibration completed successfully! All runs with valid data were processed.
              </div>
            )}
            {vectorStatus === 'failed' && vectorDetails.error && (
              <div className="mt-2 text-xs text-red-600">
                Error: {vectorDetails.error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pinhole Calibration (Planar)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Source Path</label>
              <Select value={String(sourcePathIdx)} onValueChange={v => setSourcePathIdx(Number(v))}>
                <SelectTrigger id="srcpath"><SelectValue placeholder="Pick source path" /></SelectTrigger>
                <SelectContent>
                  {sourcePaths.map((p, i) => (
                    <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Configured in Settings → Directories.</p>
            </div>
            <div>
              <label className="text-sm font-medium">Camera</label>
              <Select value={String(camera)} onValueChange={v => setCamera(Number(v))}>
                <SelectTrigger id="camera"><SelectValue placeholder="Select camera" /></SelectTrigger>
                <SelectContent>
                  {cameraOptions.map((c, i) => (
                    <SelectItem key={i} value={String(c)}>{`Camera ${c}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">File Pattern:</label>
              <Input
                value={filePattern}
                onChange={e => setFilePattern(e.target.value)}
                placeholder="calib%05d.tif"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pattern Cols:</label>
              <Input
                type="number"
                value={patternColsInput}
                onChange={e => setPatternColsInput(e.target.value)}
                onBlur={() => setPatternCols(patternColsInput)}
                min="1"
                step="1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pattern Rows:</label>
              <Input
                type="number"
                value={patternRowsInput}
                onChange={e => setPatternRowsInput(e.target.value)}
                onBlur={() => setPatternRows(patternRowsInput)}
                min="1"
                step="1"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Dot Spacing (mm):</label>
              <Input
                type="number"
                value={dotSpacingMmInput}
                onChange={e => setDotSpacingMmInput(e.target.value)}
                onBlur={() => setDotSpacingMm(dotSpacingMmInput)}
                step="any"
                min="0"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Δt (seconds):</label>
              <Input
                type="number"
                value={dtInput}
                onChange={e => setDtInput(e.target.value)}
                onBlur={() => setDt(dtInput)}
                step="any"
                min="0.001"
              />
            </div>
            <div>
              <label className="block text-xs font-medium">
                <input
                  type="checkbox"
                  checked={enhanceDots}
                  onChange={e => setEnhanceDots(e.target.checked)}
                  className="mr-2"
                />
                Enhance Dots
              </label>
            </div>
          </div>
          {/* Calibration Status Indicator */}
          <div className="mb-2">
            {calibrationStatus === "running" && (
              <div className="flex items-center gap-2 text-blue-600 text-sm">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></span>
                Calibration is running...
              </div>
            )}
            {calibrationStatus === "completed" && (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <span className="inline-block w-3 h-3 bg-green-600 rounded-full"></span>
                Calibration completed!
              </div>
            )}
            {calibrationStatus === "error" && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <span className="inline-block w-3 h-3 bg-red-600 rounded-full"></span>
                Calibration error: {calibrationDetails?.error}
              </div>
            )}
            {calibrationStatus === "not_started" && (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <span className="inline-block w-3 h-3 bg-gray-400 rounded-full"></span>
                Calibration not started.
              </div>
            )}
          </div>

          {/* THREE MAIN BUTTONS */}
          <div className="border-t pt-4">
            <div className="flex gap-4 items-center">
              <Button
                onClick={generateCameraModel}
                disabled={generating || vectorStatus === "running" || calibrationStatus === "running"}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3"
              >
                {generating ? 'Generating...' : 'Generate Camera Model'}
              </Button>
              <Button
                onClick={calibrateVectors}
                disabled={vectorStatus === "running" || vectorStatus === "starting"}
                className="bg-green-600 hover:bg-green-700 text-white px-6 py-3"
              >
                {vectorStatus === "running" || vectorStatus === "starting" ? 'Calibrating...' : 'Calibrate Vectors'}
              </Button>
              <Button
                onClick={setAsActiveMethod}
                disabled={isActive}
                className={isActive ? "bg-green-600 hover:bg-green-600 text-white px-6 py-3" : ""}
                variant={isActive ? "default" : "outline"}
              >
                {isActive ? "Active" : "Set as Active Method"}
              </Button>
            </div>
            <div className="text-xs text-gray-500 mt-2">
              <p><strong>Generate Camera Model:</strong> Process all calibration images to create camera models.</p>
              <p><strong>Calibrate Vectors:</strong> Use camera model to calibrate PIV vectors.</p>
              <p><strong>Load Results:</strong> Load existing calibration results.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Image Display Section - Show grid visualization if available */}
      {loadingResults && (
        <div className="flex items-center justify-center py-8">
          <span className="animate-spin inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full"></span>
          <span className="ml-3 text-blue-600 text-sm">Loading calibration results...</span>
        </div>
      )}
      {gridData && gridData.grid_png && !loadingResults && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Grid Visualization (Detected Indices)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative border rounded inline-block">
                <img
                  src={`data:image/png;base64,${gridData.grid_png}`}
                  alt="Grid visualization"
                  style={{ maxWidth: "512px", width: "100%" }}
                />
                <div className="absolute top-2 right-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded text-xs">
                  Calibration Model ({totalImages} images found)
                </div>
              </div>
              {gridPoints.length > 0 && (
                <div className="text-xs text-gray-600 mt-2">
                  Grid points detected: {gridPoints.length}
                </div>
              )}
            </CardContent>
          </Card>
          {/* Consolidated Camera Metrics Panel */}
          <Card>
            <CardHeader>
              <CardTitle>Camera Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs space-y-2">
                {gridData && (
                  <>
                    <div><b>Reprojection Error (overall):</b> {gridData.reprojection_error?.toFixed(3)} px</div>
                    <div><b>Mean |x| Error:</b> {gridData.reprojection_error_x_mean?.toFixed(3)} px</div>
                    <div><b>Mean |y| Error:</b> {gridData.reprojection_error_y_mean?.toFixed(3)} px</div>
                    <div><b>Pattern Size:</b> {gridData.pattern_size?.join(' x ')}</div>
                    <div><b>Dot Spacing:</b> {gridData.dot_spacing_mm} mm</div>
                    <div><b>Estimated Pixels per mm:</b> {gridData.pixels_per_mm ? gridData.pixels_per_mm.toFixed(3) : 'N/A'}</div>
                    <div><b>Image Name:</b> {gridData.original_filename}</div>
                    <div><b>Timestamp:</b> {gridData.timestamp}</div>
                  </>
                )}
                {cameraModel && (
                  <>
                    <div><b>Camera Matrix:</b></div>
                    {cameraModel.camera_matrix && cameraModel.camera_matrix.map((row: number[], i: number) => (
                      <div key={i}>[{row.map(v => v.toFixed(3)).join(', ')}]</div>
                    ))}
                    <div><b>Focal Length:</b> fx={cameraModel.focal_length?.[0]?.toFixed(1)}, fy={cameraModel.focal_length?.[1]?.toFixed(1)}</div>
                    <div><b>Principal Point:</b> cx={cameraModel.principal_point?.[0]?.toFixed(1)}, cy={cameraModel.principal_point?.[1]?.toFixed(1)}</div>
                    <div><b>Distortion Coeffs:</b> [{cameraModel.dist_coeffs?.map((d: number) => d.toFixed(4)).join(', ')}]</div>
                    <div><b>Reprojection Error:</b> {cameraModel.reprojection_error?.toFixed(3)} px</div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};