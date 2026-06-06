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
import { useSelfCalibration2 } from "@/hooks/useSelfCalibration2";
import ZoomableCanvas from "@/components/viewer/zoomableCanvas";
import { cn } from "@/lib/utils";

interface SelfCalibration2SectionProps {
  cam1: number;
  cam2: number;
  board: string;          // "dotboard" | "charuco"
  hasModel: boolean;
  sourcePathIdx?: number;
}

/**
 * Stereo self-calibration (Wieneke 2005) on the calibration2 backend. Slots into the
 * stereo tabs below the model results, gated on a saved stereo model. Mirrors the v1
 * SelfCalibrationSection UX (preview, run, history, manual, clear) and adds a
 * base_path (PIV dataset) selector, a filter toggle, and a gallery of the six saved
 * diagnostic figures from the calibration source folder.
 */
export const SelfCalibration2Section: React.FC<SelfCalibration2SectionProps> = ({
  cam1, cam2, board, hasModel, sourcePathIdx = 0,
}) => {
  const sc = useSelfCalibration2(cam1, cam2, board, sourcePathIdx);
  const [nImagesInput, setNImagesInput] = useState(String(sc.nImages));
  const [frameInputValue, setFrameInputValue] = useState(String(sc.previewFrameIdx));

  // Shared zoom for side-by-side mode.
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const handleZoomChange = (zl: number, px: number, py: number) => {
    setZoomLevel(zl); setPanX(px); setPanY(py);
  };

  React.useEffect(() => { setFrameInputValue(String(sc.previewFrameIdx)); }, [sc.previewFrameIdx]);
  React.useEffect(() => { setNImagesInput(String(sc.nImages)); }, [sc.nImages]);

  if (!hasModel) return null;

  const hasPreview = sc.previewImage || sc.cam1Image || sc.cam2Image;
  const canShowCorrected = sc.hasSelfCal || sc.result !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Self-Calibration
          {sc.hasSelfCal && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Applied
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Correct laser-sheet misalignment (Wieneke 2005) from the recorded particle
          images. Recovers the sheet Z-offset and tilt and stores them in the stereo
          model, so 3C reconstruction sits on the true sheet.
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

        {/* Dewarp Preview */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Dewarp Preview</h4>

          <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-md">
            <Button size="sm" variant="outline" className="px-2"
              onClick={() => sc.setPreviewFrameIdx(Math.max(1, sc.previewFrameIdx - 1))}
              disabled={sc.previewFrameIdx <= 1}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4L6 10l6 6" /></svg>
            </Button>
            <input type="range" min={1} max={sc.totalFrames} value={sc.previewFrameIdx}
              onChange={e => sc.setPreviewFrameIdx(Number(e.target.value))} className="w-32" />
            <Input type="text" inputMode="numeric" value={frameInputValue}
              onChange={e => {
                setFrameInputValue(e.target.value);
                const num = parseInt(e.target.value);
                if (!isNaN(num) && num >= 1) sc.setPreviewFrameIdx(Math.min(num, sc.totalFrames));
              }}
              onBlur={() => {
                const num = parseInt(frameInputValue);
                if (isNaN(num) || num < 1) { setFrameInputValue(String(sc.previewFrameIdx)); }
                else { const c = Math.max(1, Math.min(num, sc.totalFrames)); sc.setPreviewFrameIdx(c); setFrameInputValue(String(c)); }
              }}
              className="w-16 h-8" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">/ {sc.totalFrames}</span>
            <Button size="sm" variant="outline" className="px-2"
              onClick={() => sc.setPreviewFrameIdx(Math.min(sc.totalFrames, sc.previewFrameIdx + 1))}
              disabled={sc.previewFrameIdx >= sc.totalFrames}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 4l6 6-6 6" /></svg>
            </Button>

            <div className="border-l h-6 mx-1" />
            <div className="flex items-center gap-1">
              <span className={cn("text-xs font-medium", sc.subFrame === "A" ? "text-primary" : "text-muted-foreground")}>A</span>
              <Switch checked={sc.subFrame === "B"} onCheckedChange={(c) => sc.setSubFrame(c ? "B" : "A")} />
              <span className={cn("text-xs font-medium", sc.subFrame === "B" ? "text-primary" : "text-muted-foreground")}>B</span>
            </div>

            <div className="border-l h-6 mx-1" />
            <div className="flex gap-1">
              <Button size="sm" variant={sc.viewMode === "overlay" ? "default" : "outline"}
                onClick={() => sc.setViewMode("overlay")} className="h-7 px-2 text-xs">Overlay</Button>
              <Button size="sm" variant={sc.viewMode === "side_by_side" ? "default" : "outline"}
                onClick={() => sc.setViewMode("side_by_side")} className="h-7 px-2 text-xs">Side by Side</Button>
            </div>

            <div className="border-l h-6 mx-1" />
            <div className="flex items-center gap-2">
              <Switch id="sc2-corrected" checked={sc.showCorrected} onCheckedChange={sc.setShowCorrected} disabled={!canShowCorrected} />
              <Label htmlFor="sc2-corrected" className="text-xs">{sc.showCorrected ? "Corrected" : "Uncorrected"}</Label>
            </div>

            <div className="border-l h-6 mx-1" />
            <Button onClick={() => sc.loadDewarpPreview(sc.showCorrected)} disabled={sc.previewLoading} variant="outline" size="sm">
              {sc.previewLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}
              Load Preview
            </Button>
          </div>

          {hasPreview && (
            sc.viewMode === "overlay" ? (
              <div className="border rounded overflow-hidden bg-black">
                <div className="h-[480px]">
                  <ZoomableCanvas src={sc.previewImage} vmin={0} vmax={100} colormap="gray"
                    title="Dewarp Overlay" zoomLevel={zoomLevel} panX={panX} panY={panY} onZoomChange={handleZoomChange} />
                </div>
                <div className="px-3 py-1.5 bg-muted text-xs text-muted-foreground">
                  Red = Camera {cam1}, Cyan = Camera {cam2}. Grey = aligned, colour fringing = misalignment.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="border rounded overflow-hidden bg-black">
                  <div className="h-[480px]">
                    <ZoomableCanvas src={sc.cam1Image} vmin={0} vmax={100} colormap="gray"
                      title={`Camera ${cam1}`} zoomLevel={zoomLevel} panX={panX} panY={panY} onZoomChange={handleZoomChange} />
                  </div>
                  <div className="px-3 py-1.5 bg-muted text-xs text-muted-foreground text-center">Camera {cam1}</div>
                </div>
                <div className="border rounded overflow-hidden bg-black">
                  <div className="h-[480px]">
                    <ZoomableCanvas src={sc.cam2Image} vmin={0} vmax={100} colormap="gray"
                      title={`Camera ${cam2}`} zoomLevel={zoomLevel} panX={panX} panY={panY} onZoomChange={handleZoomChange} />
                  </div>
                  <div className="px-3 py-1.5 bg-muted text-xs text-muted-foreground text-center">Camera {cam2}</div>
                </div>
              </div>
            )
          )}
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
              Results
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

        {/* Saved status (no fresh result, but the record carries self-cal) */}
        {!sc.result && sc.hasSelfCal && sc.status && (
          <div className="p-3 bg-muted rounded text-sm">
            <div className="flex items-center justify-between mb-1">
              <div className="font-semibold">Saved Self-Calibration{sc.status.source === "manual" ? " (manual)" : ""}</div>
              <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => sc.clearSelfCal()}>Clear</Button>
            </div>
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

        {/* Manual sheet entry — for rigs where automatic self-cal cannot run */}
        <ManualSelfCalInput
          onSave={sc.saveManual}
          onClear={sc.clearSelfCal}
          currentZ={sc.status?.z_offset}
          hasSavedValues={sc.hasSelfCal}
        />
      </CardContent>
    </Card>
  );
};

const ManualSelfCalInput: React.FC<{
  onSave: (z: number, tiltXDeg: number, tiltYDeg: number) => Promise<void>;
  onClear: () => Promise<void>;
  currentZ?: number;
  hasSavedValues: boolean;
}> = ({ onSave, onClear, currentZ, hasSavedValues }) => {
  const [zStr, setZStr] = useState(currentZ?.toFixed(4) ?? "0");
  const [txStr, setTxStr] = useState("0");
  const [tyStr, setTyStr] = useState("0");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(parseFloat(zStr) || 0, parseFloat(txStr) || 0, parseFloat(tyStr) || 0);
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
        Manual laser-sheet offset / tilt
      </summary>
      <div className="mt-2 p-3 border rounded space-y-3">
        <p className="text-xs text-muted-foreground">
          Set the laser-sheet Z-offset (mm) and tilts (degrees) by hand. Z=0 is the
          calibration plane. Used when automatic self-calibration cannot run.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32"><Label className="text-xs">Z-offset (mm)</Label>
            <Input type="text" inputMode="numeric" value={zStr} onChange={(e) => setZStr(e.target.value)}
              onBlur={() => setZStr((parseFloat(zStr) || 0).toFixed(4))} className="h-8 text-sm font-mono" /></div>
          <div className="w-28"><Label className="text-xs">Tilt X (deg)</Label>
            <Input type="text" inputMode="numeric" value={txStr} onChange={(e) => setTxStr(e.target.value)}
              onBlur={() => setTxStr((parseFloat(txStr) || 0).toFixed(4))} className="h-8 text-sm font-mono" /></div>
          <div className="w-28"><Label className="text-xs">Tilt Y (deg)</Label>
            <Input type="text" inputMode="numeric" value={tyStr} onChange={(e) => setTyStr(e.target.value)}
              onBlur={() => setTyStr((parseFloat(tyStr) || 0).toFixed(4))} className="h-8 text-sm font-mono" /></div>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}Save
          </Button>
          {hasSavedValues && (<Button size="sm" variant="outline" onClick={onClear}>Clear</Button>)}
        </div>
      </div>
    </details>
  );
};

export default SelfCalibration2Section;
