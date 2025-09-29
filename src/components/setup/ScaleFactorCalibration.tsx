"use client";
import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useScaleFactorCalibration } from "@/hooks/useScaleFactorCalibration";

interface ScaleFactorCalibrationProps {
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
  return parts.filter(Boolean).pop() || p;
};

export const ScaleFactorCalibration: React.FC<ScaleFactorCalibrationProps> = ({
  config,
  updateConfig,
  setActive,
  isActive,
  cameraOptions,
  sourcePaths,
  imageCount = 1000,
}) => {
  const {
    dt,
    pxPerMm,
    xOffsets,
    yOffsets,
    sourcePathIdx,
    camera,
    calibrating,
    scaleFactorJobId,
    setDt,
    setPxPerMm,
    setXOffsets,
    setYOffsets,
    setSourcePathIdx,
    setCamera,
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
        <div className="grid md:grid-cols-2 gap-4">
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
            <label className="block text-xs font-medium">Camera</label>
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
        <div>
          <label className="block text-xs font-medium">Δt (seconds)</label>
          <Input
            type="text"
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
            value={dt}
            onChange={e => setDt(e.target.value)}
            onBlur={e => {
              // Only update config if valid number
              if (e.target.value !== "" && !isNaN(Number(e.target.value))) {
                setDt(e.target.value);
              }
            }}
            placeholder="1.0"
          />
        </div>
        <div>
          <label className="block text-xs font-medium">Pixels per mm</label>
          <Input
            type="text"
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
            value={pxPerMm}
            onChange={e => setPxPerMm(e.target.value)}
            onBlur={e => {
              if (e.target.value !== "" && !isNaN(Number(e.target.value))) {
                setPxPerMm(e.target.value);
              }
            }}
            placeholder="1.0"
          />
        </div>
        {/* Table/grid for X/Y offsets per camera */}
        <div>
          <label className="block text-xs font-medium mb-1">Camera Offsets (px) - Set to 0,0 for auto bottom-left origin</label>
          <div className="overflow-x-auto">
            <table className="min-w-[320px] border text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 border">Camera</th>
                  <th className="px-2 py-1 border">X Offset</th>
                  <th className="px-2 py-1 border">Y Offset</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({length: cameraOptions.length}).map((_,i)=>(
                  <tr key={i}>
                    <td className="px-2 py-1 border text-center">{i+1}</td>
                    <td className="px-2 py-1 border">
                      <Input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*\.?[0-9]*"
                        value={xOffsets[i]||""}
                        onChange={e=>{
                          const next = [...xOffsets]; next[i]=e.target.value; setXOffsets(next);
                        }}
                        onBlur={e=>{
                          if (e.target.value !== "" && !isNaN(Number(e.target.value))) {
                            const next = [...xOffsets]; next[i]=e.target.value; setXOffsets(next);
                          }
                        }}
                        className="w-24"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-2 py-1 border">
                      <Input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*\.?[0-9]*"
                        value={yOffsets[i]||""}
                        onChange={e=>{
                          const next = [...yOffsets]; next[i]=e.target.value; setYOffsets(next);
                        }}
                        onBlur={e=>{
                          if (e.target.value !== "" && !isNaN(Number(e.target.value))) {
                            const next = [...yOffsets]; next[i]=e.target.value; setYOffsets(next);
                          }
                        }}
                        className="w-24"
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          {status === "not_started" && (
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <span className="inline-block w-3 h-3 bg-gray-400 rounded-full"></span>
              Calibration not started.
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            onClick={calibrateVectors}
            disabled={false}
            className="bg-green-600 hover:bg-green-700 text-white px-6 py-3"
          >
            {calibrating ? "Calibrating..." : "Calibrate All Vectors"}
          </Button>
          {!isActive && <Button variant="outline" onClick={setActive}>Set as Active</Button>}
          {isActive && <span className="text-green-600 text-xs font-semibold ml-2">Active</span>}
        </div>
        <div className="text-xs text-gray-500 mt-2">
          This method calibrates all vectors using scale factor conversion: (pixels - offset) / px_per_mm / dt.<br />
          Set offsets to 0,0 to automatically place bottom-left corner at origin (0,0).<br />
          Updates the calibration.scale_factor block in config.yaml.
        </div>
      </CardContent>
    </Card>
  );
};