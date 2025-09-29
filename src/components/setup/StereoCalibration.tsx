"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStereoCalibration } from '@/hooks/useStereoCalibration';

interface StereoCalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  setActive: () => void;
  isActive: boolean;
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
  setActive,
  isActive,
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
  } = useStereoCalibration(
    config.calibration?.stereo || {},
    updateConfig,
    cameraOptions,
    sourcePaths,
    imageCount
  );

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
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                value={dt}
                onChange={e => setDt(e.target.value)}
                onBlur={e => {
                  if (e.target.value !== "" && !isNaN(Number(e.target.value))) {
                    setDt(e.target.value);
                  }
                }}
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
                type="text"
                inputMode="numeric"
                value={patternCols}
                onChange={e => setPatternCols(e.target.value)}
                onBlur={e => {
                  if (e.target.value !== "" && !isNaN(Number(e.target.value))) {
                    setPatternCols(e.target.value);
                  }
                }}
                min="1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pattern Rows</label>
              <Input
                type="text"
                inputMode="numeric"
                value={patternRows}
                onChange={e => setPatternRows(e.target.value)}
                onBlur={e => {
                  if (e.target.value !== "" && !isNaN(Number(e.target.value))) {
                    setPatternRows(e.target.value);
                  }
                }}
                min="1"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Dot Spacing (mm)</label>
              <Input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                value={dotSpacingMm}
                onChange={e => setDotSpacingMm(e.target.value)}
                onBlur={e => {
                  if (e.target.value !== "" && !isNaN(Number(e.target.value))) {
                    setDotSpacingMm(e.target.value);
                  }
                }}
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

          <div className="flex gap-4 items-center">
            <Button
              onClick={startStereoCalibration}
              disabled={isLoading || calibrationStatus === "running"}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3"
            >
              {isLoading ? 'Starting...' : 'Start Stereo Calibration'}
            </Button>
            <Button
              onClick={calibrateVectors}
              disabled={vectorStatus === "running" || vectorStatus === "starting"}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-3"
            >
              {vectorStatus === "running" || vectorStatus === "starting" ? 'Calibrating...' : 'Calibrate Vectors'}
            </Button>
            {!isActive && <Button variant="outline" onClick={setActive}>Set as Active</Button>}
            {isActive && <span className="text-green-600 text-xs font-semibold ml-2">Active</span>}
          </div>

          <div className="text-xs text-gray-500 mt-2">
            <p><strong>Stereo Calibration:</strong> Process calibration images for both cameras to create stereo camera models.</p>
            <p><strong>Calibrate Vectors:</strong> Use stereo camera models to calibrate PIV vectors.</p>
            <p>Updates the calibration.stereo block in config.yaml.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};