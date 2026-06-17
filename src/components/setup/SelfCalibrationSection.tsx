"use client";
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useSelfCalibration } from "@/hooks/useSelfCalibration";

interface SelfCalibrationSectionProps {
  cam1: number;
  cam2: number;
  board: string;          // "dotboard" | "charuco"
  hasModel: boolean;
  sourcePathIdx?: number;
}

/**
 * Stereo self-calibration (Wieneke 2005) on the calibration backend. Slots into the
 * stereo tabs below the model results, gated on a saved stereo model. Recovers the
 * laser-sheet Z-offset and tilt from the recorded particle images and bakes that
 * correction into both camera models (the DaVis convention), so 3C reconstruction sits
 * on the true sheet. To undo, regenerate the stereo model and re-run.
 */
export const SelfCalibrationSection: React.FC<SelfCalibrationSectionProps> = ({
  cam1, cam2, board, hasModel, sourcePathIdx = 0,
}) => {
  const sc = useSelfCalibration(cam1, cam2, board, sourcePathIdx);
  const [nImagesInput, setNImagesInput] = useState(String(sc.nImages));

  React.useEffect(() => { setNImagesInput(String(sc.nImages)); }, [sc.nImages]);

  if (!hasModel) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Self-Calibration
          {sc.hasSelfCal && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Baked into model
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Correct laser-sheet misalignment (Wieneke 2005) from the recorded particle
          images. Recovers the sheet Z-offset and tilt and bakes the correction into
          both camera models, so 3C reconstruction sits on the true sheet. To undo,
          regenerate the stereo model and re-run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Source dataset for the correlation frames */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Particle-image dataset (base path)</Label>
            <Select
              value={String(sc.basePathIdx)}
              onValueChange={(v) => sc.setBasePathIdx(parseInt(v))}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="base path 0" />
              </SelectTrigger>
              <SelectContent>
                {(sc.basePaths.length ? sc.basePaths : ["base path 0"]).map((p, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {p.split("/").slice(-2).join("/") || `base path ${i}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2 pb-1">
            <Switch id="sc-filters" checked={sc.applyFilters} onCheckedChange={sc.setApplyFilters} />
            <Label htmlFor="sc-filters" className="text-xs">
              Apply PIV pre-filters (recommended; removes static background)
            </Label>
          </div>
        </div>

        {/* Parameters */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Parameters</h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Number of Images</Label>
              <Input type="text" inputMode="numeric" value={nImagesInput}
                onChange={(e) => setNImagesInput(e.target.value)}
                onBlur={() => {
                  const n = parseInt(nImagesInput);
                  const c = isNaN(n) ? 20 : Math.max(5, Math.min(200, n));
                  sc.setNImages(c); setNImagesInput(String(c));
                }} className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Window Size (px)</Label>
              <Select value={String(sc.windowSize)} onValueChange={(v) => sc.setWindowSize(parseInt(v))}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="32">32</SelectItem>
                  <SelectItem value="64">64</SelectItem>
                  <SelectItem value="128">128</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Overlap (%)</Label>
              <Select value={String(sc.overlap)} onValueChange={(v) => sc.setOverlap(parseFloat(v))}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25%</SelectItem>
                  <SelectItem value="50">50%</SelectItem>
                  <SelectItem value="75">75%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Button onClick={sc.runSelfCalibration} disabled={sc.isRunning} className="bg-blue-600 hover:bg-blue-700 text-white">
          {sc.isRunning ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running Self-Calibration...</>) : "Run Self-Calibration"}
        </Button>

        {sc.isRunning && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{sc.jobStatus || "Starting..."}</span>
              <span className="font-medium">{sc.jobProgress}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${sc.jobProgress}%` }} />
            </div>
          </div>
        )}

        {sc.error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{sc.error}</AlertDescription>
          </Alert>
        )}

        {/* Results */}
        {sc.result && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              Recovered sheet (baked into both camera models)
              {sc.result.converged ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Converged</span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Did not converge</span>
              )}
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 bg-muted rounded"><div className="text-xs text-muted-foreground">Z-offset</div><div className="text-sm font-semibold">{sc.result.z_offset.toFixed(4)} mm</div></div>
              <div className="p-3 bg-muted rounded"><div className="text-xs text-muted-foreground">Tilt X</div><div className="text-sm font-semibold">{sc.result.tilt_x_deg.toFixed(4)}&deg;</div></div>
              <div className="p-3 bg-muted rounded"><div className="text-xs text-muted-foreground">Tilt Y</div><div className="text-sm font-semibold">{sc.result.tilt_y_deg.toFixed(4)}&deg;</div></div>
              <div className="p-3 bg-muted rounded"><div className="text-xs text-muted-foreground">Final RMS</div><div className="text-sm font-semibold">{sc.result.final_rms_disparity.toFixed(4)} px</div></div>
              <div className="p-3 bg-muted rounded"><div className="text-xs text-muted-foreground">Iterations</div><div className="text-sm font-semibold">{sc.result.n_iterations}</div></div>
              <div className="p-3 bg-muted rounded"><div className="text-xs text-muted-foreground">Converged</div><div className="text-sm font-semibold">{sc.result.converged ? "Yes" : "No"}</div></div>
            </div>

            {sc.result.history.length > 0 && (
              <details className="border rounded">
                <summary className="p-3 cursor-pointer text-sm font-semibold">Convergence History ({sc.result.history.length} iterations)</summary>
                <div className="p-3 pt-0 overflow-x-auto">
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
                      {sc.result.history.map((h) => (
                        <tr key={h.iteration} className="border-b last:border-0">
                          <td className="p-1.5">{h.iteration}</td>
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
              </details>
            )}
          </div>
        )}

        {/* Saved status (no fresh result, but the record already carries a baked correction) */}
        {!sc.result && sc.hasSelfCal && sc.status && (
          <div className="p-3 bg-muted rounded text-sm">
            <div className="font-semibold mb-1">Baked Self-Calibration{sc.status.source === "manual" ? " (manual)" : ""}</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>Z-offset: <span className="font-mono">{sc.status.z_offset.toFixed(4)} mm</span></div>
              <div>Tilt X: <span className="font-mono">{sc.status.tilt_x_deg.toFixed(4)}&deg;</span></div>
              <div>Tilt Y: <span className="font-mono">{sc.status.tilt_y_deg.toFixed(4)}&deg;</span></div>
              <div>RMS: <span className="font-mono">{sc.status.final_rms_disparity.toFixed(4)} px</span></div>
              <div>Iterations: <span className="font-mono">{sc.status.n_iterations}</span></div>
              <div>Converged: <span className="font-mono">{sc.status.converged ? "Yes" : "No"}</span></div>
            </div>
          </div>
        )}

        {/* Diagnostic figures gallery (saved into the calibration source folder) */}
        {sc.figures.length > 0 && (
          <details className="border rounded" open>
            <summary className="p-3 cursor-pointer text-sm font-semibold">Diagnostic Figures ({sc.figures.length})</summary>
            <div className="p-3 pt-0 grid grid-cols-1 md:grid-cols-2 gap-3">
              {sc.figures.map((name) => (
                <a key={name} href={sc.figureUrl(name)} target="_blank" rel="noreferrer"
                  className="border rounded overflow-hidden bg-white hover:ring-2 hover:ring-blue-400">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sc.figureUrl(name)} alt={name} className="w-full h-auto" />
                  <div className="px-2 py-1 bg-muted text-xs text-muted-foreground">{name}</div>
                </a>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
};

export default SelfCalibrationSection;
