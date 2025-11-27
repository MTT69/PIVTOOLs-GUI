"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useStereoCalibration } from '@/hooks/useStereoCalibration';
import { useStereoValidation, isContainerFormat, useIsMacOS } from "@/hooks/useCalibrationValidation";

interface StereoCalibrationProps {
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
  // Show last two segments if possible
  if (parts.length >= 2) return parts.slice(-2).join("/");
  return parts.filter(Boolean).pop() || p;
};

export const StereoCalibration: React.FC<StereoCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
  imageCount = 1000,
}) => {
  const {
    sourcePathIdx,
    cameraPair,
    filePattern,
    patternCols,
    patternRows,
    dotSpacingMm,
    enhanceDots,
    asymmetric,
    dt,
    jobId,
    calibrationResults,
    vectorJob,
    isLoading,
    gridImages,
    currentGridIndex,
    vectorPollingActive,
    vectorJobId,
    showCompletionMessage,
    setSourcePathIdx,
    setCameraPair,
    setFilePattern,
    setPatternCols,
    setPatternRows,
    setDotSpacingMm,
    setEnhanceDots,
    setAsymmetric,
    setDt,
    setJobId,
    setCalibrationResults,
    setVectorJob,
    setIsLoading,
    setGridImages,
    setCurrentGridIndex,
    setVectorPollingActive,
    setVectorJobId,
    setShowCompletionMessage,
    calibrationStatus,
    calibrationDetails,
    vectorStatus,
    vectorDetails,
    camera1,
    camera2,
    startStereoCalibration,
    calibrateVectors,
    loadSavedCalibration,
  } = useStereoCalibration(
    config.calibration?.stereo || {},
    updateConfig,
    cameraOptions,
    sourcePaths,
    imageCount
  );

  // Validate calibration images for both cameras and get previews
  const validation = useStereoValidation(sourcePathIdx, camera1, camera2, filePattern);
  const isMacOS = useIsMacOS();
  const hasUnsupportedFormat = isContainerFormat(filePattern);

  // Get per-camera validation data
  const cam1Validation = validation.cameras[`cam${camera1}`];
  const cam2Validation = validation.cameras[`cam${camera2}`];

  const setAsActiveMethod = async () => {
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calibration: {
            active: "stereo",
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

  const isActive = config.calibration?.active === "stereo";

  return (
    <div className="space-y-6">
      {/* Vector Calibration Status */}
      {vectorJobId && vectorDetails && (
        <Card>
          <CardHeader><CardTitle>Stereo Vector Calibration Status</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">Status: <span className="font-medium">{vectorStatus}</span></div>
            {(vectorStatus === 'running' || vectorStatus === 'starting') && (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full"></span>
                Stereo vector calibration is running...
              </div>
            )}
            <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
              <div className={`h-2 bg-green-600`} style={{ width: `${vectorDetails.progress || 0}%` }}></div>
            </div>
            <div className="text-xs text-muted-foreground">Progress: {vectorDetails.progress || 0}% {vectorDetails.processed_frames !== undefined && vectorDetails.total_frames !== undefined && `(Frames: ${vectorDetails.processed_frames}/${vectorDetails.total_frames})`}</div>
            {vectorStatus === 'completed' && (
              <div className="mt-2 text-xs text-green-600">
                Stereo vector calibration completed successfully!
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
          <CardTitle>Stereo Calibration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
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
              <label className="text-sm font-medium">Camera Pair</label>
              <div className="flex gap-2">
                <Select value={String(camera1)} onValueChange={v => setCameraPair([Number(v), camera2])}>
                  <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cameraOptions.filter(c => c !== camera2).map((c) => (
                      <SelectItem key={c} value={String(c)}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(camera2)} onValueChange={v => setCameraPair([camera1, Number(v)])}>
                  <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cameraOptions.filter(c => c !== camera1).map((c) => (
                      <SelectItem key={c} value={String(c)}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
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
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">File Pattern</label>
              <Input
                value={filePattern}
                onChange={e => setFilePattern(e.target.value)}
                placeholder="planar_calibration_plate_*.tif"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pattern Cols</label>
              <Input
                type="number"
                value={patternCols}
                onChange={e => setPatternCols(e.target.value)}
                min="1"
                step="1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pattern Rows</label>
              <Input
                type="number"
                value={patternRows}
                onChange={e => setPatternRows(e.target.value)}
                min="1"
                step="1"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Dot Spacing (mm)</label>
              <Input
                type="number"
                value={dotSpacingMm}
                onChange={e => setDotSpacingMm(e.target.value)}
                step="any"
                min="0"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enhanceDots}
                onChange={e => setEnhanceDots(e.target.checked)}
                className="w-4 h-4"
              />
              <label className="text-sm font-medium">Enhance Dots</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={asymmetric}
                onChange={e => setAsymmetric(e.target.checked)}
                className="w-4 h-4"
              />
              <label className="text-sm font-medium">Asymmetric</label>
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

          {/* Per-Camera Validation Status */}
          {validation.checked && (
            <div className="space-y-2">
              {/* Overall status */}
              {!validation.checked ? (
                <Alert className="border-blue-500 bg-blue-50">
                  <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                  <AlertDescription className="text-sm text-blue-800">
                    Validating calibration images...
                  </AlertDescription>
                </Alert>
              ) : validation.valid ? (
                <Alert className="border-green-500 bg-green-50">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-sm text-green-800">
                    <div className="flex flex-col gap-1">
                      <div>Camera {camera1}: {cam1Validation?.valid ? `${cam1Validation.found_count === 'container' ? 'Container found' : `${cam1Validation.found_count} images found`}` : `Error: ${cam1Validation?.error || 'Unknown error'}`}</div>
                      <div>Camera {camera2}: {cam2Validation?.valid ? `${cam2Validation.found_count === 'container' ? 'Container found' : `${cam2Validation.found_count} images found`}` : `Error: ${cam2Validation?.error || 'Unknown error'}`}</div>
                      {validation.matching_pairs !== 'container' && (
                        <div className="font-medium mt-1">Matching pairs: {validation.matching_pairs}</div>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle>Validation Failed</AlertTitle>
                  <AlertDescription className="text-sm">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        {cam1Validation?.valid ? (
                          <CheckCircle className="h-3 w-3 text-green-600" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-600" />
                        )}
                        Camera {camera1}: {cam1Validation?.valid ? 'OK' : (cam1Validation?.error || 'Error')}
                      </div>
                      <div className="flex items-center gap-2">
                        {cam2Validation?.valid ? (
                          <CheckCircle className="h-3 w-3 text-green-600" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-600" />
                        )}
                        Camera {camera2}: {cam2Validation?.valid ? 'OK' : (cam2Validation?.error || 'Error')}
                      </div>
                      {validation.error && <div className="mt-1 font-medium">{validation.error}</div>}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Suggested Pattern Button - show when validation fails but a suggestion is available */}
          {!validation.valid && (cam1Validation?.suggested_pattern || cam2Validation?.suggested_pattern) && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Suggestion:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilePattern(cam1Validation?.suggested_pattern || cam2Validation?.suggested_pattern || filePattern)}
                className="text-blue-600 border-blue-300 hover:bg-blue-50"
              >
                Use "{cam1Validation?.suggested_pattern || cam2Validation?.suggested_pattern}"
              </Button>
            </div>
          )}

          {/* Side-by-Side Calibration Target Preview */}
          {validation.valid && (cam1Validation?.first_image_preview || cam2Validation?.first_image_preview) && (
            <Card className="border-green-200 bg-green-50/30">
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium text-green-800">
                  Calibration Target Previews
                </CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Camera 1 Preview */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-700">Camera {camera1}</div>
                    {cam1Validation?.first_image_preview ? (
                      <div className="relative border rounded overflow-hidden bg-white">
                        <img
                          src={`data:image/png;base64,${cam1Validation.first_image_preview}`}
                          alt={`Camera ${camera1} calibration preview`}
                          className="w-full h-auto"
                        />
                      </div>
                    ) : (
                      <div className="border rounded p-4 text-center text-gray-400 text-sm">
                        No preview available
                      </div>
                    )}
                    {cam1Validation?.image_size && (
                      <div className="text-xs text-gray-500">
                        {cam1Validation.image_size[0]} x {cam1Validation.image_size[1]} px
                      </div>
                    )}
                  </div>

                  {/* Camera 2 Preview */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-700">Camera {camera2}</div>
                    {cam2Validation?.first_image_preview ? (
                      <div className="relative border rounded overflow-hidden bg-white">
                        <img
                          src={`data:image/png;base64,${cam2Validation.first_image_preview}`}
                          alt={`Camera ${camera2} calibration preview`}
                          className="w-full h-auto"
                        />
                      </div>
                    ) : (
                      <div className="border rounded p-4 text-center text-gray-400 text-sm">
                        No preview available
                      </div>
                    )}
                    {cam2Validation?.image_size && (
                      <div className="text-xs text-gray-500">
                        {cam2Validation.image_size[0]} x {cam2Validation.image_size[1]} px
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Status Indicator */}
          <div className="mb-2">
            {calibrationStatus === "running" && (
              <div className="flex items-center gap-2 text-blue-600 text-sm">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></span>
                Stereo calibration is running...
              </div>
            )}
            {calibrationStatus === "completed" && (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <span className="inline-block w-3 h-3 bg-green-600 rounded-full"></span>
                Stereo calibration completed!
              </div>
            )}
            {calibrationStatus === "error" && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <span className="inline-block w-3 h-3 bg-red-600 rounded-full"></span>
                Stereo calibration error!
              </div>
            )}
            {calibrationStatus === "not_started" && (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <span className="inline-block w-3 h-3 bg-gray-400 rounded-full"></span>
                Stereo calibration not started.
              </div>
            )}
          </div>

          <div className="flex gap-4 items-center flex-wrap">
            <Button
              onClick={startStereoCalibration}
              disabled={isLoading || calibrationStatus === "running"}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3"
            >
              {isLoading ? 'Starting...' : 'Start Stereo Calibration'}
            </Button>
            <Button
              onClick={loadSavedCalibration}
              disabled={isLoading}
              variant="outline"
              className="px-6 py-3"
            >
              {isLoading ? 'Loading...' : 'Load Calibration'}
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
            <p><strong>Stereo Calibration:</strong> Process calibration images for both cameras to create stereo camera models.</p>
            <p><strong>Load Calibration:</strong> Load previously generated calibration results without recomputing.</p>
            <p><strong>Calibrate Vectors:</strong> Use stereo camera models to calibrate PIV vectors.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};