"use client";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Loader2, Crosshair, Ruler } from "lucide-react";
import { MarkerPoint, OverlayLine } from "@/components/viewer/zoomableCanvas";
import CalibrationImageViewer from "@/components/viewer/CalibrationImageViewer";
import { CalibrationFigureGallery } from "@/components/setup/CalibrationFigureGallery";
import { ValidationAlert } from "@/components/setup/ValidationAlert";
import { useCalibrationApi } from "@/hooks/useCalibrationApi";
import {
  GCInlineControls,
  GlobalFrameSummary,
  useGlobalCoordinates,
  getGlobalCoordMarkers,
  getGlobalCoordViewerTarget,
  handleGlobalCoordPointSelect,
} from "@/components/setup/GlobalCoordinateSetup";

interface ScaleFactorCalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  cameraOptions: number[];
  sourcePaths: string[];
}

type AxisDirX = "right" | "left";
type AxisDirY = "up" | "down";
type PickMode = "none" | "origin" | "measure";

const BASE = "/backend/calibration";

export const ScaleFactorCalibration: React.FC<ScaleFactorCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
}) => {
  const c2 = useCalibrationApi();

  // --- Source + image selection -------------------------------------------------
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState(cameraOptions[0] || 1);
  const [imageFormat, setImageFormat] = useState<string>(
    config?.calibration?.image_format || "calib%05d.tif");
  const [imageType, setImageType] = useState<string>(
    config?.calibration?.image_type || "standard");
  const [calibrationSources, setCalibrationSources] = useState<string[]>(
    () => config?.calibration?.calibration_sources || []);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState<boolean>(
    Boolean(config?.calibration?.use_camera_subfolders));
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>(
    () => config?.calibration?.camera_subfolders || []);
  const [frameIdx, setFrameIdx] = useState(1);

  // --- Scale-factor params ------------------------------------------------------
  const [pxPerMm, setPxPerMm] = useState<string>(
    String(config?.calibration?.scale_factor?.px_per_mm ?? 1.0));
  const [dt, setDt] = useState<string>(
    String(config?.calibration?.scale_factor?.dt ?? 1.0));
  const [originPx, setOriginPx] = useState<[number, number] | null>(null);
  const [xDir, setXDir] = useState<AxisDirX>("right");
  const [yDir, setYDir] = useState<AxisDirY>("up");
  const [swapAxes, setSwapAxes] = useState(false);
  // World (X, Y) mm assigned to the picked origin pixel — same semantics as the board
  // tabs' world-frame "Origin is at X/Y mm" inputs (baked into the model at generate).
  const [originMmX, setOriginMmX] = useState("0");
  const [originMmY, setOriginMmY] = useState("0");

  // Buffered numeric origin entry (commit on blur), kept in sync with picked origin.
  const [originXInput, setOriginXInput] = useState("");
  const [originYInput, setOriginYInput] = useState("");
  useEffect(() => {
    setOriginXInput(originPx ? originPx[0].toFixed(1) : "");
    setOriginYInput(originPx ? originPx[1].toFixed(1) : "");
  }, [originPx]);
  const commitOrigin = useCallback(() => {
    const x = parseFloat(originXInput);
    const y = parseFloat(originYInput);
    if (Number.isFinite(x) && Number.isFinite(y)) setOriginPx([x, y]);
  }, [originXInput, originYInput]);

  // --- Viewer interaction ---------------------------------------------------------
  const [pickMode, setPickMode] = useState<PickMode>("none");
  const [measureP1, setMeasureP1] = useState<[number, number] | null>(null);
  const [measureP2, setMeasureP2] = useState<[number, number] | null>(null);
  const [measureMm, setMeasureMm] = useState<string>("");

  // --- Result + figures ---------------------------------------------------------
  // Figures are rendered by the shared CalibrationFigureGallery (keyed on `result`), so
  // there is no local figure-list state — it fetches the list for the model locator.
  const [result, setResult] = useState<any>(null);
  const [applyJob, setApplyJob] = useState<any>(null);

  // --- Vector calibration type (shared calibration.piv_type key) -----------------
  const [vectorTypeName, setVectorTypeName] = useState<"instantaneous" | "ensemble">("instantaneous");
  useEffect(() => {
    const pivType = config?.calibration?.piv_type;
    if (pivType === "instantaneous" || pivType === "ensemble") setVectorTypeName(pivType);
  }, [config?.calibration?.piv_type]);
  const handleVectorTypeChange = useCallback(async (value: "instantaneous" | "ensemble") => {
    setVectorTypeName(value);
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calibration: { piv_type: value } }),
      });
      const json = await res.json();
      if (res.ok && json.updated?.calibration) {
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (e) {
      console.error("Failed to save piv_type:", e);
    }
  }, [config, updateConfig]);

  // --- Source path validation (folder/pattern "Did you mean" suggestions) -------
  interface SFValidation {
    valid: boolean;
    error?: string;
    found_count?: number | "container";
    camera_path?: string;
    image_size?: [number, number];
    suggested_pattern?: string;
    suggested_subfolder?: string;
  }
  const [validation, setValidation] = useState<SFValidation | null>(null);
  const [validating, setValidating] = useState(false);

  // --- Multi-camera global coordinates (shared chain) ---------------------------
  const gcSources = calibrationSources.length ? calibrationSources : sourcePaths;
  const gc = useGlobalCoordinates(config, updateConfig, cameraOptions, gcSources);
  const gcViewerTarget = getGlobalCoordViewerTarget(gc);
  const gcIsSelecting = gc.selectionMode !== "none";

  // The viewer follows the GC target camera/frame while a GC pick is active.
  const viewCamera = gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : camera;
  const viewFrame = gcIsSelecting && gcViewerTarget ? gcViewerTarget.frame : frameIdx;

  const locator = useCallback(
    () => ({ board: "scale_factor", camera, source_path_idx: sourcePathIdx }),
    [camera, sourcePathIdx]);

  // --- Persist image/source config (shared calibration.* keys the other tabs use) ---
  // CalibrationImageViewer fetches frames WITHOUT image_format/image_type params — the
  // backend reads them (and calibration_sources / camera subfolders) from config, so
  // edits must land there before the viewer or validation can see them.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/backend/update_config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            calibration: {
              image_format: imageFormat,
              image_type: imageType,
              calibration_sources: calibrationSources,
              use_camera_subfolders: useCameraSubfolders,
              camera_subfolders: cameraSubfolders,
            },
          }),
        });
        const json = await res.json();
        if (res.ok && json.updated?.calibration) {
          updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
        }
      } catch (e) {
        console.error("persist calibration image config failed", e);
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageFormat, imageType, calibrationSources, useCameraSubfolders, cameraSubfolders]);

  // --- Validate the camera's source path/pattern (same route the other tabs use) ----
  const validate = useCallback(async () => {
    setValidating(true);
    try {
      const res = await fetch(`${BASE}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera, source_path_idx: sourcePathIdx,
          image_format: imageFormat, image_type: imageType, frame_total: 1,
        }),
      });
      setValidation(await res.json());
    } catch (e) {
      setValidation({ valid: false, error: String(e) });
    } finally {
      setValidating(false);
    }
  }, [camera, sourcePathIdx, imageFormat, imageType]);

  // Debounced past the 500 ms config persist above: source dir + subfolders are resolved
  // from config on the backend, so validation must run after the persist lands.
  useEffect(() => {
    const t = setTimeout(validate, 800);
    return () => clearTimeout(t);
  }, [validate, calibrationSources, useCameraSubfolders, cameraSubfolders]);

  // Image dimensions for overlay geometry: validation reports [W, H]; a restored/generated
  // model carries image_width/height as a fallback before validation completes.
  const dims: { w: number; h: number } | null =
    validation?.valid && Array.isArray(validation.image_size)
      ? { w: Number(validation.image_size[0]), h: Number(validation.image_size[1]) }
      : result?.image_width
        ? { w: result.image_width, h: result.image_height }
        : null;

  // Apply-poll timer; cleared on unmount so a switched-away tab stops polling.
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  // --- Restore saved model on camera/source change ------------------------------
  const restoredFor = useRef<string>("");
  useEffect(() => {
    const key = `${sourcePathIdx}:${camera}`;
    if (restoredFor.current === key) return;
    restoredFor.current = key;
    (async () => {
      const m = await c2.loadModel(locator());
      if (m?.exists && m.model_type === "scale_factor" && Array.isArray(m.origin_px)) {
        setResult(m);
        setOriginPx([Number(m.origin_px[0]), Number(m.origin_px[1])]);
        setPxPerMm(String(m.px_per_mm));
        setDt(String(m.dt));
        // Restore the frame the origin was picked on, so the overlay lands on the
        // same image rather than always frame 1.
        if (m.frame_idx) setFrameIdx(Number(m.frame_idx));
        setXDir(m.x_dir === "left" ? "left" : "right");
        setYDir(m.y_dir === "down" ? "down" : "up");
        setSwapAxes(Boolean(m.swap_axes));
        if (Array.isArray(m.origin_mm)) {
          setOriginMmX(String(m.origin_mm[0]));
          setOriginMmY(String(m.origin_mm[1]));
        }
      } else {
        setResult(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePathIdx, camera]);

  // --- Click routing ------------------------------------------------------------
  // Receives the camera/frame the viewer attributed the click to (it may be driven to
  // the GC target while a GC pick is active).
  const onImageClick = useCallback((x: number, y: number, cam?: number, frame?: number) => {
    if (gcIsSelecting) {
      handleGlobalCoordPointSelect(gc, x, y, cam ?? viewCamera, frame ?? viewFrame);
      return;
    }
    if (pickMode === "origin") {
      setOriginPx([x, y]);
      setPickMode("none");
    } else if (pickMode === "measure") {
      if (!measureP1 || (measureP1 && measureP2)) {
        setMeasureP1([x, y]); setMeasureP2(null);
      } else {
        setMeasureP2([x, y]);
      }
    }
  }, [gc, gcIsSelecting, viewCamera, viewFrame, pickMode, measureP1, measureP2]);

  const measureDistPx =
    measureP1 && measureP2
      ? Math.hypot(measureP2[0] - measureP1[0], measureP2[1] - measureP1[1])
      : null;

  const applyMeasuredScale = useCallback(() => {
    const mm = parseFloat(measureMm);
    if (measureDistPx && mm > 0) {
      setPxPerMm(String(measureDistPx / mm));
      setPickMode("none");
    }
  }, [measureDistPx, measureMm]);

  // --- Axis preview markers + lines ---------------------------------------------
  const markerPoints: MarkerPoint[] = [];
  const overlayLines: OverlayLine[] = [];
  if (gcIsSelecting) {
    markerPoints.push(...getGlobalCoordMarkers(gc, viewCamera, viewFrame));
  } else {
    if (originPx) {
      markerPoints.push({ x: originPx[0], y: originPx[1], color: "#facc15", label: "Origin" });
      const L = dims ? 0.12 * Math.max(dims.w, dims.h) : 80;
      // Pixel-space direction of each world axis (mirrors ScaleFactorModel).
      const cs = xDir === "right" ? 1 : -1;
      const rs = yDir === "up" ? -1 : 1;
      const xd = swapAxes ? [0, cs] : [cs, 0];
      const yd = swapAxes ? [rs, 0] : [0, rs];
      const xt: [number, number] = [originPx[0] + xd[0] * L, originPx[1] + xd[1] * L];
      const yt: [number, number] = [originPx[0] + yd[0] * L, originPx[1] + yd[1] * L];
      overlayLines.push({ x1: originPx[0], y1: originPx[1], x2: xt[0], y2: xt[1], color: "#ef4444" });
      overlayLines.push({ x1: originPx[0], y1: originPx[1], x2: yt[0], y2: yt[1], color: "#38bdf8" });
      markerPoints.push({ x: xt[0], y: xt[1], color: "#ef4444", label: "+X" });
      markerPoints.push({ x: yt[0], y: yt[1], color: "#38bdf8", label: "+Y" });
    }
    if (measureP1) markerPoints.push({ x: measureP1[0], y: measureP1[1], color: "#22c55e", label: "A" });
    if (measureP2) markerPoints.push({ x: measureP2[0], y: measureP2[1], color: "#22c55e", label: "B" });
    if (measureP1 && measureP2) {
      overlayLines.push({
        x1: measureP1[0], y1: measureP1[1], x2: measureP2[0], y2: measureP2[1], color: "#22c55e",
      });
    }
  }

  // --- Generate -----------------------------------------------------------------
  const generate = useCallback(async () => {
    if (!originPx) { c2.setError("Pick the origin on the image first."); return; }
    const data = await c2.generateScaleFactor({
      ...locator(),
      px_per_mm: parseFloat(pxPerMm) || 1.0,
      dt: parseFloat(dt) || 1.0,
      origin_px: originPx,
      origin_mm: [parseFloat(originMmX) || 0, parseFloat(originMmY) || 0],
      x_dir: xDir, y_dir: yDir, swap_axes: swapAxes,
      frame_idx: frameIdx, image_format: imageFormat, image_type: imageType,
    });
    if (data) {
      setResult(data);
    }
  }, [originPx, originMmX, originMmY, pxPerMm, dt, xDir, yDir, swapAxes, frameIdx,
      imageFormat, imageType, locator]);

  // --- Apply (model-agnostic mono apply job) ------------------------------------
  const runApply = useCallback(async () => {
    const started = await c2.startApply({
      board: "scale_factor", stereo: false, source_path_idx: sourcePathIdx,
      type_name: vectorTypeName, dt: parseFloat(dt) || 1.0,
    });
    if (!started?.job_id) return;
    setApplyJob({ status: "running" });
    const poll = async () => {
      const st = await c2.applyStatus(started.job_id);  // never throws (returns failed status)
      setApplyJob(st);
      if (st.status === "running" || st.status === "starting") {
        pollTimer.current = setTimeout(poll, 1000);
      }
    };
    poll();
  }, [dt, vectorTypeName, sourcePathIdx]);

  // --- Set as active ------------------------------------------------------------
  const isActive = config?.calibration?.active === "scale_factor";
  const setAsActive = useCallback(async () => {
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calibration: { active: "scale_factor" } }),
      });
      const json = await res.json();
      if (res.ok && json.updated?.calibration) {
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (e) { console.error("set active failed", e); }
  }, [config, updateConfig]);

  const clickActive = pickMode !== "none" || gcIsSelecting;
  const handleFrameChange = useCallback((idx: number) => setFrameIdx(idx), []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Scale Factor Calibration (Planar)</CardTitle>
          <CardDescription>
            Pick a world origin and axes on the image, then set scale (px/mm) and Δt.
            World mm = (pixel − origin) / px_per_mm; velocity = displacement / px_per_mm / Δt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Section 1: Calibration Source Path (primary input) */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Calibration Images Location</Label>
            <Input
              value={calibrationSources[sourcePathIdx] || ""}
              onChange={e => {
                const newSources = [...calibrationSources];
                while (newSources.length <= sourcePathIdx) newSources.push("");
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

          {/* Section 2: Base path + camera */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Base Path</Label>
              <Select value={String(sourcePathIdx)} onValueChange={v => setSourcePathIdx(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Pick base path" /></SelectTrigger>
                <SelectContent>
                  {sourcePaths.map((p, i) => (
                    <SelectItem key={i} value={String(i)}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Where calibration models are saved. Configured in Settings → Directories.</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Camera</Label>
              <Select value={String(camera)} onValueChange={v => setCamera(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {cameraOptions.map(c => (
                    <SelectItem key={c} value={String(c)}>Camera {c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Scale-factor models are generated per camera.</p>
            </div>
          </div>

          {/* Section 3: Image configuration */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Image Type</Label>
              <Select value={imageType} onValueChange={setImageType}>
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
              <Label className="text-sm font-medium">Image Format</Label>
              <Input value={imageFormat} onChange={e => setImageFormat(e.target.value)}
                     placeholder="calib%05d.tif" />
            </div>
          </div>

          {/* Camera subfolders toggle — for standard and IM7 formats */}
          {(imageType === "standard" || imageType === "lavision_im7") && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="sf-use-camera-subfolders"
                  checked={useCameraSubfolders}
                  onCheckedChange={setUseCameraSubfolders}
                />
                <Label htmlFor="sf-use-camera-subfolders" className="text-sm">
                  Use camera subfolders
                </Label>
              </div>
              <p className="text-xs text-muted-foreground ml-10">
                {useCameraSubfolders
                  ? "Images expected in camera subfolders (e.g., Cam1/, Cam2/)."
                  : "Images in source directory without camera subfolders."
                }
              </p>
            </div>
          )}

          {/* Camera subfolder names — only when using camera subfolders */}
          {useCameraSubfolders && cameraOptions.length > 1 && (
            <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
              <h4 className="text-sm font-medium">Camera Subfolder Configuration</h4>
              <p className="text-xs text-muted-foreground">
                Camera subfolders are relative to the calibration source path.
                Example: {calibrationSources[sourcePathIdx] || '/path/to/calibration'}/{cameraSubfolders[0] || 'Cam1'}/
              </p>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Camera Subfolder Names (optional)</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Custom folder names for each camera. Leave empty to use defaults (Cam1, Cam2, ...).
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {cameraOptions.map((cam, idx) => (
                    <div key={cam}>
                      <Label className="text-xs text-muted-foreground">Camera {cam}</Label>
                      <Input
                        placeholder={`Cam${cam}`}
                        value={cameraSubfolders[idx] || ''}
                        onChange={e => {
                          const newSubfolders = [...cameraSubfolders];
                          while (newSubfolders.length < cameraOptions.length) {
                            newSubfolders.push('');
                          }
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

          {/* Source validation + "Did you mean" suggestions */}
          {validation && (
            <ValidationAlert
              validation={{
                valid: validation.valid,
                checked: !validating,
                error: validation.error || null,
              }}
              customSuccessMessage={
                validation.valid
                  ? `Found ${validation.found_count === 'container' ? 'container file' : `${validation.found_count} calibration images`}`
                  : undefined
              }
            />
          )}

          {validation && !validation.valid && validation.suggested_pattern && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Suggestion:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImageFormat(validation.suggested_pattern!)}
                className="text-blue-600 border-blue-300 hover:bg-blue-50"
              >
                Use &quot;{validation.suggested_pattern}&quot;
              </Button>
            </div>
          )}

          {validation && !validation.valid && validation.suggested_subfolder && (() => {
            const sub = validation.suggested_subfolder!;
            const perCam = cameraOptions.map(c => sub.replace(/\d+/, String(c)));
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
                  Use &quot;{label}&quot;
                </Button>
              </div>
            );
          })()}

          {/* Image viewer with origin/measure picking (shared component — same as other tabs) */}
          <CalibrationImageViewer
            backendUrl="/backend"
            sourcePathIdx={sourcePathIdx}
            camera={viewCamera}
            numImages={typeof validation?.found_count === "number" ? validation.found_count : 1}
            calibrationType="scale_factor"
            refreshKey={`${validation?.camera_path}-${validation?.valid}`}
            onFrameChange={handleFrameChange}
            externalFrame={viewFrame}
            externalCamera={gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : undefined}
            pointSelectMode={clickActive}
            onPointSelect={onImageClick}
            selectedMarkers={markerPoints}
            externalOverlayLines={overlayLines.length ? overlayLines : undefined}
            settingsBarExtras={
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant={pickMode === "origin" ? "default" : "outline"} size="sm"
                        onClick={() => { setPickMode(pickMode === "origin" ? "none" : "origin"); gc.setSelectionMode("none"); }}>
                  <Crosshair className="h-4 w-4 mr-1" />
                  {pickMode === "origin" ? "Click the origin…" : "Pick Origin"}
                </Button>
                <Button variant={pickMode === "measure" ? "default" : "outline"} size="sm"
                        onClick={() => {
                          const next = pickMode === "measure" ? "none" : "measure";
                          setPickMode(next);
                          if (next === "measure") { setMeasureP1(null); setMeasureP2(null); }
                        }}>
                  <Ruler className="h-4 w-4 mr-1" />
                  {pickMode === "measure" ? "Click two points…" : "Measure Scale"}
                </Button>
                {originPx && (
                  <span className="text-xs text-muted-foreground">
                    origin = ({originPx[0].toFixed(1)}, {originPx[1].toFixed(1)}) px
                    {(parseFloat(originMmX) || parseFloat(originMmY))
                      ? ` = (${parseFloat(originMmX) || 0}, ${parseFloat(originMmY) || 0}) mm`
                      : ""}
                  </span>
                )}
                {cameraOptions.length > 1 && (
                  <GCInlineControls gc={gc} currentCamera={viewCamera}
                                    cameraOptions={cameraOptions} onCameraChange={setCamera}
                                    board="scale_factor" sourcePathIdx={sourcePathIdx} />
                )}
              </div>
            }
          />

          {measureDistPx && pickMode === "measure" && (
            <div className="flex items-center gap-2 text-sm bg-muted/40 p-2 rounded">
              <span>{measureDistPx.toFixed(1)} px =</span>
              <Input className="w-24" placeholder="mm" value={measureMm}
                     onChange={e => setMeasureMm(e.target.value)} />
              <span>mm</span>
              <Button size="sm" variant="outline" onClick={applyMeasuredScale}
                      disabled={!(parseFloat(measureMm) > 0)}>
                Use as px/mm ({(parseFloat(measureMm) > 0 ? (measureDistPx / parseFloat(measureMm)).toFixed(3) : "—")})
              </Button>
            </div>
          )}

          {/* Origin + scale + axes */}
          <div className="border-t pt-4 grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label className="text-sm font-medium">Origin X (px)</Label>
              <Input type="text" inputMode="numeric" value={originXInput}
                     placeholder="click or type"
                     onChange={e => setOriginXInput(e.target.value)}
                     onBlur={commitOrigin} />
              <p className="text-xs text-muted-foreground mt-1">Pixel column of world origin</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Origin Y (px)</Label>
              <Input type="text" inputMode="numeric" value={originYInput}
                     placeholder="click or type"
                     onChange={e => setOriginYInput(e.target.value)}
                     onBlur={commitOrigin} />
              <p className="text-xs text-muted-foreground mt-1">Pixel row of world origin</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Origin X (mm)</Label>
              <Input type="text" inputMode="numeric" value={originMmX}
                     onChange={e => setOriginMmX(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">World X of the origin pixel</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Origin Y (mm)</Label>
              <Input type="text" inputMode="numeric" value={originMmY}
                     onChange={e => setOriginMmY(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">World Y of the origin pixel</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Scale (px/mm)</Label>
              <Input type="text" inputMode="numeric" value={pxPerMm}
                     onChange={e => setPxPerMm(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Pixels per millimetre</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Δt (seconds)</Label>
              <Input type="text" inputMode="numeric" value={dt}
                     onChange={e => setDt(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Time between frames</p>
            </div>
            <div>
              <Label className="text-sm font-medium">+X direction</Label>
              <Select value={xDir} onValueChange={(v) => setXDir(v as AxisDirX)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="right">Right</SelectItem>
                  <SelectItem value="left">Left</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">+Y direction</Label>
              <Select value={yDir} onValueChange={(v) => setYDir(v as AxisDirY)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="up">Up</SelectItem>
                  <SelectItem value="down">Down</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="sf-swap" checked={swapAxes} onCheckedChange={setSwapAxes} />
            <Label htmlFor="sf-swap" className="text-sm">Swap axes (+X follows the vertical pixel axis)</Label>
          </div>

          {c2.error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{c2.error}</AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          <div className="border-t pt-4 flex gap-2 items-center flex-wrap">
            <Button onClick={generate} disabled={c2.busy || !originPx}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    title={!originPx ? "Pick the origin first" : undefined}>
              {c2.busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</> : "Generate Model"}
            </Button>

            {/* Calibrate Vectors with type selection (same split control as the other tabs) */}
            <div className="flex items-center gap-1">
              <Button onClick={runApply}
                      disabled={!result || applyJob?.status === "running" || applyJob?.status === "starting"}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-r-none"
                      title={!result ? "Generate the model first" : "Calibrate vectors"}>
                {applyJob && (applyJob.status === "running" || applyJob.status === "starting")
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Calibrating…</>
                  : "Calibrate Vectors"}
              </Button>
              <Select value={vectorTypeName} onValueChange={handleVectorTypeChange}
                      disabled={applyJob?.status === "running" || applyJob?.status === "starting"}>
                <SelectTrigger className="w-[130px] rounded-l-none border-l-0 bg-green-600 hover:bg-green-700 text-white border-green-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instantaneous">Instantaneous</SelectItem>
                  <SelectItem value="ensemble">Ensemble</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={setAsActive} disabled={isActive}
                    variant={isActive ? "default" : "outline"}
                    className={isActive ? "bg-green-600 hover:bg-green-600" : ""}>
              {isActive ? <><CheckCircle2 className="h-4 w-4 mr-1" />Active</> : "Set as Active"}
            </Button>
          </div>

          {applyJob?.status === "completed" && (
            <div className="p-3 border rounded bg-green-50 text-green-700 text-sm">
              <CheckCircle2 className="h-4 w-4 inline mr-2" />Vector calibration completed.
            </div>
          )}
          {applyJob?.status === "failed" && (
            <div className="p-3 border rounded bg-red-50 text-red-700 text-sm">
              <AlertTriangle className="h-4 w-4 inline mr-2" />Apply failed: {applyJob.error || "unknown"}
            </div>
          )}

          <GlobalFrameSummary
            gc={gc} cameraOptions={cameraOptions} board="scale_factor" sourcePathIdx={sourcePathIdx} />
        </CardContent>
      </Card>

      {/* Results */}
      {result && result.model_type === "scale_factor" && (
        <Card>
          <CardHeader>
            <CardTitle>Scale-Factor Model — Camera {result.camera ?? camera}</CardTitle>
            <CardDescription className="font-mono text-xs break-all">{result.model_path}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div><span className="text-muted-foreground">Origin (px):</span>
                <span className="ml-2 font-medium">({result.origin_px?.[0]?.toFixed(1)}, {result.origin_px?.[1]?.toFixed(1)})</span></div>
              <div><span className="text-muted-foreground">Origin (mm):</span>
                <span className="ml-2 font-medium">({result.origin_mm?.[0] ?? 0}, {result.origin_mm?.[1] ?? 0})</span></div>
              <div><span className="text-muted-foreground">Scale:</span>
                <span className="ml-2 font-medium">{result.px_per_mm?.toFixed(4)} px/mm</span></div>
              <div><span className="text-muted-foreground">Δt:</span>
                <span className="ml-2 font-medium">{result.dt} s</span></div>
              <div><span className="text-muted-foreground">Axes:</span>
                <span className="ml-2 font-medium">+X {result.x_dir}, +Y {result.y_dir}{result.swap_axes ? ", swapped" : ""}</span></div>
            </div>
            <CalibrationFigureGallery query={locator()} trigger={result} />
          </CardContent>
        </Card>
      )}
    </div>
  );
};
