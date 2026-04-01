"use client";
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, CheckCircle2, Loader2, Eye } from "lucide-react";
import { useSelfCalibration } from "@/hooks/useSelfCalibration";
import ZoomableCanvas from "@/components/viewer/zoomableCanvas";
import { cn } from "@/lib/utils";

interface SelfCalibrationSectionProps {
  cam1: number;
  cam2: number;
  method: string;
  hasModel: boolean;
  sourcePathIdx?: number;
}

export const SelfCalibrationSection: React.FC<SelfCalibrationSectionProps> = ({
  cam1,
  cam2,
  method,
  hasModel,
  sourcePathIdx = 0,
}) => {
  const selfCal = useSelfCalibration(cam1, cam2, method, sourcePathIdx);

  // Shared zoom state for side-by-side mode
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const handleZoomChange = (zl: number, px: number, py: number) => {
    setZoomLevel(zl);
    setPanX(px);
    setPanY(py);
  };

  // Frame input value (string for clearable input)
  const [frameInputValue, setFrameInputValue] = useState(String(selfCal.previewFrameIdx));

  // Sync frame input with state
  React.useEffect(() => {
    setFrameInputValue(String(selfCal.previewFrameIdx));
  }, [selfCal.previewFrameIdx]);

  if (!hasModel) return null;

  const hasPreview = selfCal.previewImage || selfCal.cam1Image || selfCal.cam2Image;
  const canShowCorrected = selfCal.hasSelfCal || (selfCal.result !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Self-Calibration
          {selfCal.hasSelfCal && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Applied
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Correct laser sheet misalignment (Wieneke 2005). Recovers Z-offset and tilt angles
          from stereo disparity in particle images.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Dewarp Preview */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Dewarp Preview</h4>

          {/* Navigation Bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-md">
            {/* Prev/Next + Slider + Frame Input */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const newIdx = Math.max(1, selfCal.previewFrameIdx - 1);
                selfCal.setPreviewFrameIdx(newIdx);
              }}
              disabled={selfCal.previewFrameIdx <= 1}
              className="px-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 4L6 10l6 6" />
              </svg>
            </Button>

            <input
              type="range"
              min={1}
              max={selfCal.totalFrames}
              value={selfCal.previewFrameIdx}
              onChange={e => selfCal.setPreviewFrameIdx(Number(e.target.value))}
              className="w-32"
            />

            <Input
              type="text"
              inputMode="numeric"
              value={frameInputValue}
              onChange={e => {
                setFrameInputValue(e.target.value);
                const num = parseInt(e.target.value);
                if (!isNaN(num) && num >= 1) {
                  selfCal.setPreviewFrameIdx(Math.min(num, selfCal.totalFrames));
                }
              }}
              onBlur={() => {
                const num = parseInt(frameInputValue);
                if (isNaN(num) || num < 1) {
                  setFrameInputValue(String(selfCal.previewFrameIdx));
                } else {
                  const clamped = Math.max(1, Math.min(num, selfCal.totalFrames));
                  selfCal.setPreviewFrameIdx(clamped);
                  setFrameInputValue(String(clamped));
                }
              }}
              className="w-16 h-8"
            />

            <span className="text-xs text-muted-foreground whitespace-nowrap">/ {selfCal.totalFrames}</span>

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const newIdx = Math.min(selfCal.totalFrames, selfCal.previewFrameIdx + 1);
                selfCal.setPreviewFrameIdx(newIdx);
              }}
              disabled={selfCal.previewFrameIdx >= selfCal.totalFrames}
              className="px-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 4l6 6-6 6" />
              </svg>
            </Button>

            <div className="border-l h-6 mx-1" />

            {/* Frame A/B toggle */}
            <div className="flex items-center gap-1">
              <span className={cn("text-xs font-medium", selfCal.subFrame === "A" ? "text-primary" : "text-muted-foreground")}>A</span>
              <Switch
                checked={selfCal.subFrame === "B"}
                onCheckedChange={(checked) => selfCal.setSubFrame(checked ? "B" : "A")}
              />
              <span className={cn("text-xs font-medium", selfCal.subFrame === "B" ? "text-primary" : "text-muted-foreground")}>B</span>
            </div>

            <div className="border-l h-6 mx-1" />

            {/* View mode toggle */}
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={selfCal.viewMode === "overlay" ? "default" : "outline"}
                onClick={() => selfCal.setViewMode("overlay")}
                className="h-7 px-2 text-xs"
              >
                Overlay
              </Button>
              <Button
                size="sm"
                variant={selfCal.viewMode === "side_by_side" ? "default" : "outline"}
                onClick={() => selfCal.setViewMode("side_by_side")}
                className="h-7 px-2 text-xs"
              >
                Side by Side
              </Button>
            </div>

            <div className="border-l h-6 mx-1" />

            {/* Pre/Post self-cal toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id="corrected-toggle"
                checked={selfCal.showCorrected}
                onCheckedChange={selfCal.setShowCorrected}
                disabled={!canShowCorrected}
              />
              <Label htmlFor="corrected-toggle" className="text-xs">
                {selfCal.showCorrected ? "Corrected" : "Uncorrected"}
              </Label>
            </div>

            <div className="border-l h-6 mx-1" />

            {/* Load Preview button */}
            <Button
              onClick={() => selfCal.loadDewarpPreview(selfCal.showCorrected)}
              disabled={selfCal.previewLoading}
              variant="outline"
              size="sm"
            >
              {selfCal.previewLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Eye className="h-4 w-4 mr-1" />
              )}
              Load Preview
            </Button>
          </div>

          {/* Image Display */}
          {hasPreview && (
            <>
              {selfCal.viewMode === "overlay" ? (
                /* Overlay mode: single ZoomableCanvas */
                <div className="border rounded overflow-hidden bg-black">
                  <div className="h-[480px]">
                    <ZoomableCanvas
                      src={selfCal.previewImage}
                      vmin={0}
                      vmax={100}
                      colormap="gray"
                      title="Dewarp Overlay"
                      zoomLevel={zoomLevel}
                      panX={panX}
                      panY={panY}
                      onZoomChange={handleZoomChange}
                    />
                  </div>
                  <div className="px-3 py-1.5 bg-muted text-xs text-muted-foreground">
                    Red = Camera {cam1}, Cyan = Camera {cam2}.
                    Grey = aligned, color fringing = misalignment.
                  </div>
                </div>
              ) : (
                /* Side-by-side mode: two ZoomableCanvases with shared zoom */
                <div className="grid grid-cols-2 gap-2">
                  <div className="border rounded overflow-hidden bg-black">
                    <div className="h-[480px]">
                      <ZoomableCanvas
                        src={selfCal.cam1Image}
                        vmin={0}
                        vmax={100}
                        colormap="gray"
                        title={`Camera ${cam1}`}
                        zoomLevel={zoomLevel}
                        panX={panX}
                        panY={panY}
                        onZoomChange={handleZoomChange}
                      />
                    </div>
                    <div className="px-3 py-1.5 bg-muted text-xs text-muted-foreground text-center">
                      Camera {cam1}
                    </div>
                  </div>
                  <div className="border rounded overflow-hidden bg-black">
                    <div className="h-[480px]">
                      <ZoomableCanvas
                        src={selfCal.cam2Image}
                        vmin={0}
                        vmax={100}
                        colormap="gray"
                        title={`Camera ${cam2}`}
                        zoomLevel={zoomLevel}
                        panX={panX}
                        panY={panY}
                        onZoomChange={handleZoomChange}
                      />
                    </div>
                    <div className="px-3 py-1.5 bg-muted text-xs text-muted-foreground text-center">
                      Camera {cam2}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Parameters */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Parameters</h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Number of Images</Label>
              <Input
                type="number"
                min={5}
                max={200}
                value={selfCal.nImages}
                onChange={(e) => selfCal.setNImages(Math.max(5, parseInt(e.target.value) || 20))}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Window Size (px)</Label>
              <Select
                value={String(selfCal.windowSize)}
                onValueChange={(v) => selfCal.setWindowSize(parseInt(v))}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="32">32</SelectItem>
                  <SelectItem value="64">64</SelectItem>
                  <SelectItem value="128">128</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Overlap (%)</Label>
              <Select
                value={String(selfCal.overlap)}
                onValueChange={(v) => selfCal.setOverlap(parseFloat(v))}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25%</SelectItem>
                  <SelectItem value="50">50%</SelectItem>
                  <SelectItem value="75">75%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Run Button */}
        <Button
          onClick={selfCal.runSelfCalibration}
          disabled={selfCal.isRunning}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          {selfCal.isRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Running Self-Calibration...
            </>
          ) : (
            "Run Self-Calibration"
          )}
        </Button>

        {/* Progress */}
        {selfCal.isRunning && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{selfCal.jobStatus || "Starting..."}</span>
              <span className="font-medium">{selfCal.jobProgress}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${selfCal.jobProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {selfCal.error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{selfCal.error}</AlertDescription>
          </Alert>
        )}

        {/* Results */}
        {selfCal.result && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              Results
              {selfCal.result.converged ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Converged
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                  Did not converge
                </span>
              )}
            </h4>

            {/* Summary Table */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Z-offset</div>
                <div className="text-sm font-semibold">{selfCal.result.z_offset.toFixed(4)} mm</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Tilt X</div>
                <div className="text-sm font-semibold">{selfCal.result.tilt_x_deg.toFixed(4)}&deg;</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Tilt Y</div>
                <div className="text-sm font-semibold">{selfCal.result.tilt_y_deg.toFixed(4)}&deg;</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Final RMS</div>
                <div className="text-sm font-semibold">{selfCal.result.final_rms_disparity.toFixed(4)} px</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Iterations</div>
                <div className="text-sm font-semibold">{selfCal.result.n_iterations}</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Converged</div>
                <div className="text-sm font-semibold">{selfCal.result.converged ? "Yes" : "No"}</div>
              </div>
            </div>

            {/* Convergence History */}
            {selfCal.result.history.length > 0 && (
              <details className="border rounded">
                <summary className="p-3 cursor-pointer text-sm font-semibold">
                  Convergence History ({selfCal.result.history.length} iterations)
                </summary>
                <div className="p-3 pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-1.5">Iter</th>
                          <th className="text-right p-1.5">RMS (px)</th>
                          <th className="text-right p-1.5">&Delta;Z (mm)</th>
                          <th className="text-right p-1.5">&Delta;tilt_x (rad)</th>
                          <th className="text-right p-1.5">&Delta;tilt_y (rad)</th>
                          <th className="text-right p-1.5">Z total (mm)</th>
                          <th className="text-right p-1.5">tilt_x total (rad)</th>
                          <th className="text-right p-1.5">tilt_y total (rad)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selfCal.result.history.map((h) => (
                          <tr
                            key={h.iteration}
                            className={cn(
                              "border-b last:border-0",
                              h.iteration === 0 && "bg-muted/50"
                            )}
                          >
                            <td className="p-1.5">
                              {h.iteration === 0 ? (
                                <span className="text-muted-foreground">0 (baseline)</span>
                              ) : (
                                h.iteration
                              )}
                            </td>
                            <td className="text-right p-1.5 font-mono">{h.rms_disparity.toFixed(4)}</td>
                            <td className="text-right p-1.5 font-mono">{h.delta_z.toFixed(4)}</td>
                            <td className="text-right p-1.5 font-mono">{h.delta_tilt_x.toFixed(6)}</td>
                            <td className="text-right p-1.5 font-mono">{h.delta_tilt_y.toFixed(6)}</td>
                            <td className="text-right p-1.5 font-mono">{h.cumulative_z.toFixed(4)}</td>
                            <td className="text-right p-1.5 font-mono">{h.cumulative_tilt_x.toFixed(6)}</td>
                            <td className="text-right p-1.5 font-mono">{h.cumulative_tilt_y.toFixed(6)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            )}
          </div>
        )}

        {/* Saved status (no fresh result, but config has self-cal) */}
        {!selfCal.result && selfCal.hasSelfCal && selfCal.status && (
          <div className="p-3 bg-muted rounded text-sm">
            <div className="font-semibold mb-1">Saved Self-Calibration</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>Z-offset: <span className="font-mono">{selfCal.status.z_offset.toFixed(4)} mm</span></div>
              <div>Tilt X: <span className="font-mono">{selfCal.status.tilt_x_deg.toFixed(4)}&deg;</span></div>
              <div>Tilt Y: <span className="font-mono">{selfCal.status.tilt_y_deg.toFixed(4)}&deg;</span></div>
              <div>RMS: <span className="font-mono">{selfCal.status.final_rms_disparity.toFixed(4)} px</span></div>
              <div>Iterations: <span className="font-mono">{selfCal.status.n_iterations}</span></div>
              <div>Converged: <span className="font-mono">{selfCal.status.converged ? "Yes" : "No"}</span></div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/**
 * Warning alert shown before Reconstruct 3D Vectors button when
 * a stereo model exists but self-calibration hasn't been run.
 */
export const SelfCalibrationWarning: React.FC<{ hasModel: boolean; hasSelfCal: boolean }> = ({
  hasModel,
  hasSelfCal,
}) => {
  if (!hasModel || hasSelfCal) return null;

  return (
    <Alert className="border-amber-300 bg-amber-50">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertDescription className="text-amber-700 text-sm">
        Self-calibration has not been run. Velocity accuracy may be reduced.
      </AlertDescription>
    </Alert>
  );
};
