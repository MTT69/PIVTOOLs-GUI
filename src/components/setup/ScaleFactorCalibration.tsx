"use client";
import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useScaleFactorCalibration } from "@/hooks/useScaleFactorCalibration";

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

  // Scope selectors for vector calibration
  const [vectorScope, setVectorScope] = useState<'current' | 'all'>('all');
  const [selectedCamera, setSelectedCamera] = useState<number>(cameraOptions[0] || 1);
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
      await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calibration: { piv_type: value }
        })
      });
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
      <CardContent className="space-y-4">
        <div>
          <label className="block text-xs font-medium">Source Path</label>
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
        <div>
          <label className="block text-xs font-medium">Pixels per mm</label>
          <Input
            type="number"
            value={pxPerMm}
            onChange={e => setPxPerMm(e.target.value)}
            step="any"
            min="0"
            placeholder="1.0"
          />
        </div>


        {/* Status indicator (same as pinhole) */}
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

        {/* Calibrate Vectors with scope and type selectors */}
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={vectorScope} onValueChange={(v) => setVectorScope(v as 'current' | 'all')}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cameras</SelectItem>
              <SelectItem value="current">Single Camera</SelectItem>
            </SelectContent>
          </Select>

          {vectorScope === 'current' && (
            <Select value={String(selectedCamera)} onValueChange={(v) => setSelectedCamera(Number(v))}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cameraOptions.map((cam) => (
                  <SelectItem key={cam} value={String(cam)}>Camera {cam}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={vectorTypeName} onValueChange={handleVectorTypeChange}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="instantaneous">Instantaneous</SelectItem>
              <SelectItem value="ensemble">Ensemble</SelectItem>
            </SelectContent>
          </Select>

          <Button
            onClick={() => calibrateVectors(vectorScope === 'all', selectedCamera, vectorTypeName)}
            disabled={calibrating}
            className="bg-green-600 hover:bg-green-700 text-white"
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