"use client";
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InterpolatorSelect } from "./InterpolatorSelect";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Eye, EyeOff, CheckCircle2, Loader2, Camera } from "lucide-react";
import { useStereoCharucoCalibration, ARUCO_DICTS } from "@/hooks/useStereoCharucoCalibration";
import { SelfCalibrationSection } from "@/components/setup/SelfCalibrationSection";
import { ValidationAlert } from "@/components/setup/ValidationAlert";
import { ApplyDatasetButtons, ApplyJobsStatus, defaultDatasetIdx } from "@/components/setup/ApplyToDatasets";
import { FirstFrameNumber } from "@/components/setup/FirstFrameNumber";
import { CameraSubfolderInputs, SubfolderSuggestion, subfolderSuggestions } from "@/components/setup/CameraSubfolderInputs";
import { ChangedSinceGenerate } from "@/components/setup/ChangedSinceGenerate";
import { CalibrationFigureGallery } from "@/components/setup/CalibrationFigureGallery";
import CalibrationImageViewer, { FrameDetectionData } from "@/components/viewer/CalibrationImageViewer";
import { postJson, errorMessage } from "@/lib/api";
import {
  useWorldFrame,
  WorldFrameControls,
  getWorldFrameMarkers,
} from "@/components/setup/WorldFrameSetup";

interface StereoCharucoCalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  cameraOptions: number[];
  sourcePaths: string[];
}

export const StereoCharucoCalibration: React.FC<StereoCharucoCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
}) => {
  const calibration = useStereoCharucoCalibration(cameraOptions, sourcePaths);

  const {
    // Source selection
    sourcePathIdx,
    setSourcePathIdx,
    cam1,
    setCam1,
    cam2,
    setCam2,

    // Active camera for viewer
    activeCam,
    setActiveCam,

    // Image config
    imageFormat,
    setImageFormat,
    imageType,
    setImageType,
    numImages,
    setNumImages,
    zeroBasedIndexing,
    setZeroBasedIndexing,
    suggestedZeroBased,
    calibrationSources,
    setCalibrationSources,
    useCameraSubfolders,
    setUseCameraSubfolders,
    cameraSubfolders,
    setSubfolderFor,
    applySubfolderSuggestions,
    frameCount,
    autoViewCountText,

    // ChArUco board params
    squaresH,
    setSquaresH,
    squaresV,
    setSquaresV,
    squareSize,
    setSquareSize,
    markerRatio,
    setMarkerRatio,
    arucoDict,
    setArucoDict,
    minCorners,
    setMinCorners,
    dt,
    setDt,
    datumFrame,
    setDatumFrame,

    // Validation
    validation,
    viewerRefreshKey,
    validating,

    // Calibration job tracking
    jobStatus,
    isCalibrating,

    // Reconstruction job tracking
    applyJobs,
    isReconstructing,
    cancelApply,
    changedSinceGenerate,
    modelLoadError,

    // Model and detections
    stereoModel,
    detectionsCam1,
    detectionsCam2,
    modelLoading,
    detectError,
    detectionsStale,
    detecting,
    hasModel,

    // Overlay toggle
    showOverlay,
    setShowOverlay,

    // Model restore
    loadedWorldFrame,

    // Actions
    generateStereoModel,
    reconstructVectors,
    interpolator,
    setInterpolator,
    detectFrame,
    detectAllViews,
  } = calibration;

  // Track the frame currently shown in the viewer (1-based, matches datumFrame).
  // Stable handler so the viewer's onFrameChange effect never re-fires from closure identity.
  const [currentFrame, setCurrentFrame] = useState<number>(Number(datumFrame) || 1);
  const handleFrameChange = useCallback((idx: number) => setCurrentFrame(idx), []);
  const datumNum = Number(datumFrame) || 1;
  const onDatumFrame = currentFrame === datumNum;

  // World-frame (coordinate-system x,y) picker — camera 1 datum frame only.
  const wf = useWorldFrame({
    board: "charuco", camera: cam1, sourcePathIdx, datumFrame,
    // Empty fields are omitted — the backend falls to the sidecar value or errors.
    boardParams: () => {
      const p: Record<string, unknown> = {};
      const sh = parseInt(squaresH); if (Number.isFinite(sh)) p.squares_h = sh;
      const sv = parseInt(squaresV); if (Number.isFinite(sv)) p.squares_v = sv;
      const ss = parseFloat(squareSize); if (Number.isFinite(ss)) p.square_size = ss;
      const mr = parseFloat(markerRatio); if (Number.isFinite(mr)) p.marker_ratio = mr;
      if (arucoDict) p.aruco_dict = arucoDict;
      const mc = parseInt(minCorners); if (Number.isFinite(mc)) p.min_corners = mc;
      return p;
    },
    imageFormat, imageType,
  });
  const wfActive = activeCam === cam1;
  const wfOnDatum = wfActive && onDatumFrame;
  const wfIsSelecting = wfOnDatum && wf.mode !== "none";
  // ChArUco corner ids are absolute, so the backend's default frame is board-anchored and no
  // clicks are needed. A PARTLY picked frame would be dropped in favour of that default, so
  // Generate waits until the pick is either empty or complete.
  const wfPartial = !wf.complete && !!(wf.clicks.origin || wf.clicks.x_axis || wf.clicks.y_axis);

  // When a saved stereo model loads, restore its world frame (cam1) + show the overlay.
  // The dots themselves are restored from inputs.mat by the hook's own effect,
  // independently of whether a model exists -- detections survive a model delete,
  // and re-detecting them here was the whole cost this change removes.
  React.useEffect(() => {
    if (loadedWorldFrame) wf.restore(loadedWorldFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedWorldFrame]);
  React.useEffect(() => {
    if (hasModel) setShowOverlay(true);
  }, [hasModel, setShowOverlay]);

  // Local state
  // Open by default (2026-09-16): frames are warmed on validation and the dot
  // overlay is restored from the sidecar, so the viewer costs nothing to show.
  const [showImageViewer, setShowImageViewer] = useState(true);
  // PIV result type for the apply step — rig.piv_type in the per-source settings
  // sidecar, hydrated and persisted (debounced) by the calibration hook.
  const reconstructTypeName = calibration.pivType;
  // PIV datasets the saved model can be applied to (Settings → Directories).
  const basePaths: string[] = config?.paths?.base_paths ?? [];
  const handleReconstructTypeChange = (value: 'instantaneous' | 'ensemble') =>
    calibration.setPivType(value);

  // Set as active calibration method
  const setAsActiveMethod = async () => {
    try {
      const json = await postJson("/backend/update_config", {
        calibration: { active: "stereo_charuco" },
      });
      if (json.updated?.calibration) {
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (err) {
      console.error("Failed to set active calibration method:", errorMessage(err));
    }
  };

  const isActive = config.calibration?.active === "stereo_charuco";

  // Local input state for dt / datum frame (numeric hook state).
  const [dtInput, setDtInput] = useState(String(dt));
  const [datumFrameInput, setDatumFrameInput] = useState(String(datumFrame));
  React.useEffect(() => { setDtInput(String(dt)); }, [dt]);
  React.useEffect(() => { setDatumFrameInput(String(datumFrame)); }, [datumFrame]);

  // Convert active camera's detections to viewer format.
  const savedDetections = useMemo((): Record<number, FrameDetectionData> | undefined => {
    const detections = activeCam === cam1 ? detectionsCam1 : detectionsCam2;
    if (!detections || Object.keys(detections).length === 0) return undefined;
    const result: Record<number, FrameDetectionData> = {};
    for (const [key, value] of Object.entries(detections)) {
      const frameIdx = parseInt(key, 10);
      if (!isNaN(frameIdx) && value.grid_points) {
        result[frameIdx] = {
          grid_points: value.grid_points,
          grid_indices: value.grid_indices,
        };
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }, [detectionsCam1, detectionsCam2, activeCam, cam1]);

  return (
    <div className="space-y-6">
      {/* Main Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle>Stereo ChArUco Calibration</CardTitle>
          <CardDescription>
            Configure and run stereo ChArUco calibration for 3D velocity reconstruction
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Section 1: Calibration Source Path (primary input) */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Calibration Images Location</label>
            <Input
              value={calibrationSources[sourcePathIdx] || ""}
              onChange={e => {
                const newSources = [...calibrationSources];
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

          {/* Section 2: Base Path and Camera Selection */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Base Path</label>
              <Select value={String(sourcePathIdx)} onValueChange={v => setSourcePathIdx(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Pick base path" /></SelectTrigger>
                <SelectContent>
                  {sourcePaths.map((p, i) => (
                    <SelectItem key={i} value={String(i)}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Picks which calibration source this tab edits, one per PIV source path (Settings → Directories). Models are saved in the calibration source folder.</p>
            </div>
            <div>
              <label className="text-sm font-medium">Camera 1 (world-frame reference)</label>
              <Select value={String(cam1)} onValueChange={v => setCam1(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Select camera 1" /></SelectTrigger>
                <SelectContent>
                  {cameraOptions.map((c) => (
                    <SelectItem key={c} value={String(c)} disabled={c === cam2}>
                      {`Camera ${c}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Camera 2</label>
              <Select value={String(cam2)} onValueChange={v => setCam2(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Select camera 2" /></SelectTrigger>
                <SelectContent>
                  {cameraOptions.map((c) => (
                    <SelectItem key={c} value={String(c)} disabled={c === cam1}>
                      {`Camera ${c}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Section 3: Image Configuration */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Image Type</label>
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
              <label className="text-sm font-medium">Image Format</label>
              <Input
                value={imageFormat}
                onChange={e => setImageFormat(e.target.value)}
                placeholder="calib%05d.tif"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Number of Images</label>
              <Input
                type="text" inputMode="numeric"
                min={1}
                value={numImages}
                placeholder="auto"
                onChange={e => setNumImages(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Leave blank to count the images found.</p>
              {autoViewCountText && <p className="text-xs text-muted-foreground">{autoViewCountText}</p>}
            </div>
          </div>

          <FirstFrameNumber imageType={imageType} zeroBased={zeroBasedIndexing} onChange={setZeroBasedIndexing}
            suggestedZeroBased={suggestedZeroBased} />

          {/* Use Camera Subfolders Toggle */}
          {(imageType === "standard" || imageType === "lavision_im7") && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="stereo-charuco-use-camera-subfolders"
                  checked={useCameraSubfolders}
                  onCheckedChange={setUseCameraSubfolders}
                />
                <Label htmlFor="stereo-charuco-use-camera-subfolders" className="text-sm">
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

          {/* Camera Subfolder Names - only show when using camera subfolders */}
          {useCameraSubfolders && (
            <CameraSubfolderInputs
              cameras={[cam1, cam2]}
              cameraSubfolders={cameraSubfolders}
              setSubfolderFor={setSubfolderFor}
              sourcePath={calibrationSources[sourcePathIdx] || ""}
            />
          )}

          {/* Section 3: Stereo Validation Status */}
          {validation && (
            <div className="space-y-2">
              <ValidationAlert
                validation={{
                  valid: validation.valid,
                  checked: !validating,
                  error: validation.error || null,
                }}
                pendingLabel="Validating…"
                customSuccessMessage={
                  validation.valid
                    ? `Found ${validation.matching_count} matching calibration image pairs`
                    : undefined
                }
              />
              {!validating && validation.cam1 && validation.cam2 && (
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className={validation.cam1.valid ? "text-green-600" : "text-red-500"}>
                    Cam {cam1}: {validation.cam1.found_count} images
                    {validation.cam1.error && ` (${validation.cam1.error})`}
                  </span>
                  <span className={validation.cam2.valid ? "text-green-600" : "text-red-500"}>
                    Cam {cam2}: {validation.cam2.found_count} images
                    {validation.cam2.error && ` (${validation.cam2.error})`}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Suggested Pattern Button */}
          {validation && !validating && !validation.valid && (validation.cam1?.suggested_pattern || validation.cam2?.suggested_pattern) && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Suggestion:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImageFormat(validation.cam1?.suggested_pattern || validation.cam2?.suggested_pattern || '')}
                className="text-blue-600 border-blue-300 hover:bg-blue-50"
              >
                Use "{validation.cam1?.suggested_pattern || validation.cam2?.suggested_pattern}"
              </Button>
            </div>
          )}

          {/* Suggested Subfolder Button: each camera's own suggestion, written to its own slot */}
          {validation && !validating && !validation.valid && (
            <SubfolderSuggestion
              suggestions={subfolderSuggestions({ [cam1]: validation.cam1, [cam2]: validation.cam2 })}
              onApply={applySubfolderSuggestions}
            />
          )}

          {/* Section 4: ChArUco Board Parameters */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">ChArUco Board Parameters</h3>
            <p className="text-xs text-muted-foreground mb-3">
              The world frame is defined on Camera 1 (optionally refined with the picker below).
            </p>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">Squares (Horizontal)</label>
                <Input type="text" inputMode="numeric" value={squaresH} onChange={e => setSquaresH(e.target.value)} min="3" placeholder="10" />
              </div>
              <div>
                <label className="text-sm font-medium">Squares (Vertical)</label>
                <Input type="text" inputMode="numeric" value={squaresV} onChange={e => setSquaresV(e.target.value)} min="3" placeholder="9" />
              </div>
              <div>
                <label className="text-sm font-medium">Square Size (meters)</label>
                <Input type="text" inputMode="numeric" value={squareSize} onChange={e => setSquareSize(e.target.value)} step="0.001" min="0" placeholder="0.03" />
              </div>
              <div>
                <label className="text-sm font-medium">Marker Ratio</label>
                <Input type="text" inputMode="numeric" value={markerRatio} onChange={e => setMarkerRatio(e.target.value)} step="0.1" min="0.1" max="1.0" placeholder="0.5" />
              </div>
              <div>
                <label className="text-sm font-medium">Min Corners per Image</label>
                <Input type="text" inputMode="numeric" value={minCorners} onChange={e => setMinCorners(e.target.value)} min="4" placeholder="6" />
              </div>
              <div>
                <label className="text-sm font-medium">ArUco Dictionary</label>
                <Select value={arucoDict} onValueChange={setArucoDict}>
                  <SelectTrigger><SelectValue placeholder="Select dictionary" /></SelectTrigger>
                  <SelectContent>
                    {ARUCO_DICTS.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Δt (seconds)</label>
                <Input
                  type="text" inputMode="numeric"
                  step="any"
                  min={0.001}
                  value={dtInput}
                  onChange={e => setDtInput(e.target.value)}
                  onBlur={() => setDt(dtInput)}
                />
                <p className="text-xs text-muted-foreground mt-1">Time step between frames</p>
              </div>
              <div>
                <label className="text-sm font-medium">Datum Frame</label>
                <Input
                  type="text" inputMode="numeric"
                  min={1}
                  value={datumFrameInput}
                  onChange={e => setDatumFrameInput(e.target.value)}
                  onBlur={() => setDatumFrame(parseInt(datumFrameInput) || 1)}
                />
                <p className="text-xs text-muted-foreground mt-1">World origin image (1-based)</p>
              </div>
            </div>
          </div>

          {/* Section 5: Image Viewer Toggle */}
          {validation?.valid && (
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowImageViewer(!showImageViewer)}
                className="flex items-center gap-2"
              >
                {showImageViewer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showImageViewer ? 'Hide Image Viewer' : 'Browse Calibration Images'}
              </Button>

              {showImageViewer && (
                <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                  <Button
                    variant={activeCam === cam1 ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setActiveCam(cam1)}
                    className="h-7 px-3"
                  >
                    <Camera className="h-3 w-3 mr-1" />
                    Cam {cam1}
                  </Button>
                  <Button
                    variant={activeCam === cam2 ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setActiveCam(cam2)}
                    className="h-7 px-3"
                  >
                    <Camera className="h-3 w-3 mr-1" />
                    Cam {cam2}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Section 6: Image Viewer with Overlay + world-frame picking (cam1 only) */}
          {showImageViewer && validation?.valid && (
            <CalibrationImageViewer
              backendUrl="/backend"
              sourcePathIdx={sourcePathIdx}
              camera={activeCam}
              numImages={frameCount}
              refreshKey={viewerRefreshKey}
              stereoParams={{ cam1, cam2 }}
              onFrameChange={handleFrameChange}
              savedDetections={savedDetections}
              showSavedOverlay={showOverlay}
              onSavedOverlayChange={setShowOverlay}
              pointSelectMode={wfIsSelecting}
              onPointSelect={(px, py) => { if (wfIsSelecting) wf.handlePoint(px, py); }}
              selectedMarkers={wfOnDatum ? getWorldFrameMarkers(wf) : []}
              detectionLoading={modelLoading}
              settingsBarExtras={
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline" size="sm" disabled={wf.busy || detecting}
                    onClick={async () => { await wf.prepare(); await detectAllViews(); setShowOverlay(true); }}
                  >
                    {(wf.busy || detecting) && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Detect Markers
                  </Button>
                  {wfOnDatum ? (
                    <WorldFrameControls wf={wf} />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      World frame is set on Camera {cam1}, datum frame {datumNum}.
                    </span>
                  )}
                </div>
              }
            />
          )}

          {/* Section 7: Action Buttons */}
          <div className="border-t pt-4">
            <div className="flex gap-3 items-center flex-wrap">
              <Button
                onClick={async () => { await generateStereoModel(wf.payload); detectFrame(currentFrame, cam1); detectFrame(currentFrame, cam2); setShowOverlay(true); }}
                disabled={isCalibrating || !validation?.valid || wfPartial}
                title={wfPartial ? `Finish the world frame on Camera ${cam1} (Origin → +X → +Y) or clear it to use the board's default frame` : undefined}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isCalibrating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate Stereo Model'
                )}
              </Button>

              {/* Re-detect: ignore the cached detections and detect fresh, then recalibrate */}
              <Button
                variant="outline"
                onClick={async () => { await generateStereoModel(wf.payload, { forceRedetect: true }); detectFrame(currentFrame, cam1); detectFrame(currentFrame, cam2); setShowOverlay(true); }}
                disabled={isCalibrating || !validation?.valid || wfPartial}
                title="Ignore cached detections and re-detect from the images, then recalibrate"
              >
                Re-detect
              </Button>

              {/* Reconstruct 3D Vectors: PIV type, cam2 interpolator, target datasets */}
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-sm font-medium">Reconstruct 3D vectors:</span>
                <Select value={reconstructTypeName} onValueChange={handleReconstructTypeChange} disabled={isReconstructing}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instantaneous">Instantaneous</SelectItem>
                    <SelectItem value="ensemble">Ensemble</SelectItem>
                  </SelectContent>
                </Select>
                <InterpolatorSelect value={interpolator} onValueChange={setInterpolator} disabled={isReconstructing} />
                <ApplyDatasetButtons
                  basePaths={basePaths}
                  defaultIdx={defaultDatasetIdx(config)}
                  jobs={applyJobs}
                  onApply={datasets => reconstructVectors(reconstructTypeName, datasets)}
                  disabled={!hasModel}
                  title={!hasModel ? "Generate or load a stereo model first" : "Reconstruct 3D velocity vectors"}
                  buttonClassName="border border-green-500 bg-white text-green-700 hover:bg-green-50"
                />
              </div>

              {/* Set as Active Method */}
              <Button
                onClick={setAsActiveMethod}
                disabled={isActive}
                className={isActive ? "bg-green-600 hover:bg-green-600 text-white" : ""}
                variant={isActive ? "default" : "outline"}
              >
                {isActive ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Active
                  </>
                ) : (
                  'Set as Active'
                )}
              </Button>
            </div>

            {validation?.valid && !wf.complete && (
              <p className="text-xs text-muted-foreground mt-2">
                {wfPartial
                  ? <>Finish the world frame on Camera {cam1} (<strong>Origin → +X → +Y</strong>) or clear it before generating.</>
                  : <>No world frame picked: the model uses the board&apos;s default frame (origin at the lowest-index corner, axes along the board). To set your own, open the viewer on Camera {cam1}, click <strong>Detect Markers</strong> and pick <strong>Origin → +X → +Y</strong> on the datum frame.</>}
              </p>
            )}

            <ChangedSinceGenerate fields={changedSinceGenerate} />

            {modelLoadError && (
              <div className="text-sm text-red-600 flex items-center gap-1 mt-2">
                <AlertTriangle className="h-4 w-4" />
                {modelLoadError}
              </div>
            )}

            {detectionsStale && (
              <div className="text-sm text-gray-500">
                {detectionsStale}
              </div>
            )}

            {detectError && (
              <div className="text-sm text-amber-600 flex items-center gap-1 mt-2">
                <AlertTriangle className="h-4 w-4" />
                {detectError}
              </div>
            )}

            {/* Calibration Job Progress */}
            {jobStatus && (jobStatus.status === 'running' || jobStatus.status === 'starting') && (
              <div className="mt-4 p-3 border rounded bg-blue-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <strong>Stereo Calibration:</strong>
                  <span className="capitalize">{jobStatus.stage || jobStatus.status}</span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
                  <div
                    className="h-2 bg-blue-600 transition-all"
                    style={{ width: `${jobStatus.progress || 0}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Progress: {jobStatus.progress?.toFixed(0) || 0}%
                  {jobStatus.processed_pairs !== undefined && (
                    <span> | Pairs: {jobStatus.processed_pairs}/{jobStatus.total_pairs}</span>
                  )}
                </div>
              </div>
            )}

            {/* Calibration Job Completed */}
            {jobStatus?.status === 'completed' && (
              <div className="mt-4 p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Stereo calibration completed successfully!
                {jobStatus.cam1_rms_error !== undefined && (
                  <span className="ml-2">RMS Cam {jobStatus.cam1}: {jobStatus.cam1_rms_error?.toFixed(4)} px</span>
                )}
                {jobStatus.cam2_rms_error !== undefined && (
                  <span className="ml-2">| RMS Cam {jobStatus.cam2}: {jobStatus.cam2_rms_error?.toFixed(4)} px</span>
                )}
              </div>
            )}

            {/* Calibration Job Failed */}
            {jobStatus?.status === 'failed' && (
              <div className="mt-4 p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Error: {jobStatus.error || 'Stereo calibration failed'}
              </div>
            )}

            {/* 3D reconstruction progress / results, one per target dataset selection */}
            <ApplyJobsStatus jobs={applyJobs} basePaths={basePaths} title="3D reconstruction"
              onCancel={cancelApply} />
          </div>
        </CardContent>
      </Card>

      {/* Section 8: Stereo Model Results */}
      {hasModel && stereoModel && (
        <Card>
          <CardHeader>
            <CardTitle>Stereo Model Results</CardTitle>
            <CardDescription>
              Stereo ChArUco calibration for Cameras {stereoModel.cam1} and {stereoModel.cam2} (solve order)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">RMS Cam {stereoModel.cam1}</div>
                <div className="text-lg font-semibold">{stereoModel.rms_cam1?.toFixed(4)} px</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">RMS Cam {stereoModel.cam2}</div>
                <div className="text-lg font-semibold">{stereoModel.rms_cam2?.toFixed(4)} px</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Relative Angle</div>
                <div className="text-lg font-semibold">{stereoModel.relative_angle_deg?.toFixed(2)}&deg;</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Baseline Distance</div>
                <div className="text-lg font-semibold">{stereoModel.baseline_distance_mm?.toFixed(2)} mm</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xs text-muted-foreground">Stereo RMS</div>
                <div className="text-lg font-semibold">
                  {stereoModel.stereo_rms_px != null ? `${stereoModel.stereo_rms_px.toFixed(4)} px` : '—'}
                </div>
              </div>
            </div>

            {stereoModel.method && (
              <p className="text-xs text-muted-foreground mb-4">
                Cross-camera pose: joint fit (<span className="font-mono">{stereoModel.method}</span>)
              </p>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              {[
                { num: stereoModel.cam1, intr: stereoModel.intrinsics1 },
                { num: stereoModel.cam2, intr: stereoModel.intrinsics2 },
              ].map(({ num, intr }) => (
                <div key={num} className="p-3 border rounded space-y-2">
                  <h4 className="text-sm font-semibold">Camera {num}</h4>
                  {intr ? (
                    <>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Focal (fx/fy):</span>
                          <span className="ml-2 font-medium">{intr.fx?.toFixed(1)} / {intr.fy?.toFixed(1)} px</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Principal (cx/cy):</span>
                          <span className="ml-2 font-medium">{intr.cx?.toFixed(1)} / {intr.cy?.toFixed(1)} px</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">RMS:</span>
                          <span className="ml-2 font-medium">{intr.rms?.toFixed(4)} px</span>
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Distortion:</span>
                        <div className="font-mono text-xs bg-muted p-2 rounded mt-1">
                          [{intr.dist_coeffs?.map((d: number) => d?.toFixed(6) ?? 'null').join(', ')}]
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No intrinsics available.</p>
                  )}
                </div>
              ))}
            </div>

            {(Object.keys(detectionsCam1).length > 0 || Object.keys(detectionsCam2).length > 0) && (
              <div className="mt-4 pt-4 border-t">
                <h4 className="text-sm font-semibold mb-2">Detection Summary</h4>
                <p className="text-sm text-muted-foreground">
                  Cam {cam1}: {Object.keys(detectionsCam1).length} frames with detections |
                  Cam {cam2}: {Object.keys(detectionsCam2).length} frames with detections.
                  {showOverlay ? ' Toggle overlay in image viewer to visualize.' : ' Enable overlay in image viewer to visualize.'}
                </p>
              </div>
            )}

            {stereoModel.world_frame_mode && (
              <p className="mt-3 text-xs text-muted-foreground">World frame: {stereoModel.world_frame_mode}</p>
            )}

            <CalibrationFigureGallery
              query={{ stereo: 1, board: "charuco", camera_pair: `${cam1},${cam2}`, source_path_idx: sourcePathIdx }}
              trigger={stereoModel}
            />
          </CardContent>
        </Card>
      )}

      {/* Stereo self-calibration (Wieneke) — recovers the laser-sheet offset/tilt */}
      <SelfCalibrationSection
        cam1={cam1} cam2={cam2} board="charuco"
        hasModel={hasModel} sourcePathIdx={sourcePathIdx} />
    </div>
  );
};
