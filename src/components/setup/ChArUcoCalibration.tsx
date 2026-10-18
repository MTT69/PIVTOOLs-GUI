"use client";
import React, { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Eye, EyeOff, CheckCircle2, Loader2 } from "lucide-react";
import { useChArUcoCalibration, ARUCO_DICTS } from "@/hooks/useChArUcoCalibration";
import { Progress } from "@/components/ui/progress";
import { ValidationAlert } from "@/components/setup/ValidationAlert";
import { ApplyDatasetButtons, ApplyJobsStatus, defaultDatasetIdx } from "@/components/setup/ApplyToDatasets";
import { FirstFrameNumber } from "@/components/setup/FirstFrameNumber";
import { CalibrationFigureGallery } from "@/components/setup/CalibrationFigureGallery";
import { CameraSubfolderInputs, SubfolderSuggestion } from "@/components/setup/CameraSubfolderInputs";
import { ChangedSinceGenerate } from "@/components/setup/ChangedSinceGenerate";
import CalibrationImageViewer, { FrameDetectionData } from "@/components/viewer/CalibrationImageViewer";
import {
  useWorldFrame,
  WorldFrameControls,
  getWorldFrameMarkers,
} from "@/components/setup/WorldFrameSetup";
import { JointMultiCamera } from "@/components/setup/JointMultiCamera";
import { postJson, errorMessage } from "@/lib/api";

interface ChArUcoCalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  cameraOptions: number[];
  sourcePaths: string[];
}

export const ChArUcoCalibration: React.FC<ChArUcoCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
}) => {
  const calibration = useChArUcoCalibration(cameraOptions, sourcePaths);

  const {
    // Source selection
    sourcePathIdx,
    setSourcePathIdx,
    camera,
    setCamera,

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

    // Board params
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
    modelType,
    setModelType,

    // Validation
    validation,
    viewerRefreshKey,
    validating,

    // Single camera job tracking
    jobStatus,
    isCalibrating,

    // Multi-camera job tracking
    multiCameraJobStatus,
    isMultiCameraCalibrating,

    // Vector calibration job tracking
    applyJobs,
    isVectorCalibrating,
    cancelApply,
    changedSinceGenerate,

    // Model and detections
    cameraModel,
    detections,
    modelLoading,
    modelLoadError,
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
    generateCameraModel,
    generateCameraModelAll,
    calibrateVectors,
    detectFrame,
    detectAllViews,
  } = calibration;

  // Track the frame currently shown in the viewer (1-based, matches datumFrame).
  // Stable handler so the viewer's onFrameChange effect never re-fires from closure identity.
  const [currentFrame, setCurrentFrame] = useState<number>(datumFrame);
  const handleFrameChange = useCallback((idx: number) => setCurrentFrame(idx), []);
  const datumNum = datumFrame;
  const onDatumFrame = currentFrame === datumNum;

  // Multi-camera datasets are always solved jointly (one shared board); a single camera uses the
  // per-camera mono solve. No toggle — the path is chosen by camera count. ChArUco continuity across
  // images is automatic from corner ids; the user only sets the world origin.
  const multiCam = cameraOptions.length >= 2;

  // World-frame (coordinate-system x,y) picker — datum frame only (single-camera mono solve).
  const wf = useWorldFrame({
    board: "charuco", camera, sourcePathIdx, datumFrame,
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
  const wfIsSelecting = onDatumFrame && wf.mode !== "none";
  // ChArUco corner ids are absolute, so the backend's default frame is board-anchored and no
  // clicks are needed. A PARTLY picked frame would be dropped in favour of that default, so
  // Generate waits until the pick is either empty or complete.
  const wfPartial = !wf.complete && !!(wf.clicks.origin || wf.clicks.x_axis || wf.clicks.y_axis);
  const partialTitle = wfPartial ? "Finish the world frame (Origin → +X → +Y) or clear it to use the board's default frame" : undefined;

  // Restore the saved world frame whenever one is stored — from the model, or from inputs.mat
  // after a model delete. The dots are restored from inputs.mat by the hook. A loaded model
  // also shows the overlay.
  React.useEffect(() => {
    if (loadedWorldFrame) wf.restore(loadedWorldFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedWorldFrame]);
  React.useEffect(() => {
    if (hasModel) setShowOverlay(true);
  }, [hasModel, setShowOverlay]);

  // Datum frame commits on blur (a half-typed number must not re-target the world frame).
  const [datumFrameInput, setDatumFrameInput] = useState(String(datumFrame));
  React.useEffect(() => { setDatumFrameInput(String(datumFrame)); }, [datumFrame]);

  // Local state
  // Open by default (2026-09-16): frames are warmed on validation and the dot
  // overlay is restored from the sidecar, so the viewer costs nothing to show.
  const [showImageViewer, setShowImageViewer] = useState(true);
  // PIV result type for the apply step — rig.piv_type in the per-source settings
  // sidecar, hydrated and persisted (debounced) by the calibration hook.
  const vectorTypeName = calibration.pivType;
  // PIV datasets the saved model can be applied to (Settings → Directories).
  const basePaths: string[] = config?.paths?.base_paths ?? [];
  const handleVectorTypeChange = (value: 'instantaneous' | 'ensemble') =>
    calibration.setPivType(value);

  // Convert detections to format expected by CalibrationImageViewer
  const savedDetections = useMemo((): Record<number, FrameDetectionData> | undefined => {
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
  }, [detections]);

  // Set as active calibration method
  const setAsActiveMethod = useCallback(async () => {
    try {
      const json = await postJson("/backend/update_config", {
        calibration: { active: "charuco" },
      });
      if (json.updated?.calibration) {
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (err) {
      console.error("Failed to set active calibration method:", errorMessage(err));
    }
  }, [config.calibration, updateConfig]);

  const isActive = config.calibration?.active === "charuco";

  return (
    <div className="space-y-6">
      {/* Main Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle>ChArUco Calibration (Planar)</CardTitle>
          <CardDescription>
            Configure and run ChArUco calibration to generate camera model
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

          {/* Section 2: Base Path & Cameras */}
          <div className="grid md:grid-cols-2 gap-4">
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
              <label className="text-sm font-medium">Cameras to Process</label>
              <div className="text-sm text-muted-foreground mt-2 p-2 bg-muted rounded">
                {cameraOptions.length > 0
                  ? `Cameras ${cameraOptions.join(', ')} (from config.camera_numbers)`
                  : 'No cameras configured'}
              </div>
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

          {/* Use Camera Subfolders Toggle - for standard and IM7 formats; hidden for a one-camera rig, which
              always resolves at the source root (rig size, not the selected cameras) */}
          {(imageType === "standard" || imageType === "lavision_im7") && config?.paths?.camera_count !== 1 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="charuco-use-camera-subfolders"
                  checked={useCameraSubfolders}
                  onCheckedChange={setUseCameraSubfolders}
                />
                <Label htmlFor="charuco-use-camera-subfolders" className="text-sm">
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
          {useCameraSubfolders && cameraOptions.length > 1 && (
            <CameraSubfolderInputs
              cameras={cameraOptions}
              cameraSubfolders={cameraSubfolders}
              setSubfolderFor={setSubfolderFor}
              sourcePath={calibrationSources[sourcePathIdx] || ""}
            />
          )}

          {/* Section 3: Validation Status */}
          {validation && (
            <ValidationAlert
              validation={{
                valid: validation.valid,
                checked: !validating,
                error: validation.error || null,
              }}
              pendingLabel="Validating…"
              customSuccessMessage={
                validation.valid
                  ? `Found ${validation.found_count} calibration images`
                  : undefined
              }
            />
          )}

          {/* Suggested Pattern Button */}
          {validation && !validating && !validation.valid && validation.suggested_pattern && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Suggestion:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImageFormat(validation.suggested_pattern!)}
                className="text-blue-600 border-blue-300 hover:bg-blue-50"
              >
                Use "{validation.suggested_pattern}"
              </Button>
            </div>
          )}

          {/* Suggested Subfolder Button. Only the selected camera is validated, so the other
              cameras' folders are inferred by swapping the camera number into its suggestion;
              each is written to its own camera's slot. */}
          {validation && !validating && !validation.valid && validation.suggested_subfolder && (() => {
            const sub = validation.suggested_subfolder!;
            const perCam: Record<number, string> = {};
            for (const c of cameraOptions) perCam[c] = sub.replace(/\d+/, String(c));
            return <SubfolderSuggestion suggestions={perCam} onApply={applySubfolderSuggestions} />;
          })()}

          {/* Section 4: ChArUco Board Parameters */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">ChArUco Board Parameters</h3>
            <div className="mb-4 max-w-xs">
              <label className="text-sm font-medium">Camera Model</label>
              <Select value={modelType} onValueChange={(v) => setModelType(v as 'pinhole' | 'polynomial')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pinhole">Pinhole (OpenCV k1,k2,p1,p2)</SelectItem>
                  <SelectItem value="polynomial">Polynomial (3rd order, single plane)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {modelType === 'polynomial'
                  ? 'Single-plane image→world map fitted from the datum frame only.'
                  : '3D pinhole intrinsics + pose across all detected views.'}
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">Squares (Horizontal)</label>
                <Input
                  type="text" inputMode="numeric"
                  value={squaresH}
                  onChange={e => setSquaresH(e.target.value)}
                  min="3"
                  placeholder="10"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Squares (Vertical)</label>
                <Input
                  type="text" inputMode="numeric"
                  value={squaresV}
                  onChange={e => setSquaresV(e.target.value)}
                  min="3"
                  placeholder="9"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Square Size (meters)</label>
                <Input
                  type="text" inputMode="numeric"
                  value={squareSize}
                  onChange={e => setSquareSize(e.target.value)}
                  step="0.001"
                  min="0"
                  placeholder="0.03"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Marker Ratio</label>
                <Input
                  type="text" inputMode="numeric"
                  value={markerRatio}
                  onChange={e => setMarkerRatio(e.target.value)}
                  step="0.1"
                  min="0.1"
                  max="1.0"
                  placeholder="0.5"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Min Corners per Image</label>
                <Input
                  type="text" inputMode="numeric"
                  value={minCorners}
                  onChange={e => setMinCorners(e.target.value)}
                  min="4"
                  placeholder="6"
                />
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
                  value={dt}
                  onChange={e => setDt(e.target.value)}
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
                  onBlur={() => {
                    const v = parseInt(datumFrameInput, 10);
                    if (Number.isFinite(v) && v >= 1) setDatumFrame(v);
                    else setDatumFrameInput(String(datumFrame));
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">Calibration image defining world origin</p>
              </div>
            </div>
          </div>

          {/* Multi-camera datasets are solved jointly against one shared board (no toggle). A single
              camera uses the per-camera mono solve below. ChArUco corner ids give the grid; the
              cross-camera linking dotboard needs is automatic here. */}
          {multiCam && (
            <JointMultiCamera
              board="charuco"
              cameraOptions={cameraOptions}
              sourcePathIdx={sourcePathIdx}
              numImages={frameCount}
              imageFormat={imageFormat}
              imageType={imageType}
              modelType={modelType}
              validationValid={!!validation?.valid}
              viewerRefreshKey={viewerRefreshKey}
              datumFrame={datumFrame}
              dt={Number.isFinite(parseFloat(dt)) ? parseFloat(dt) : null}
              calibrateVectors={calibrateVectors}
              applyJobs={applyJobs}
              isVectorCalibrating={isVectorCalibrating}
              onCancelApply={cancelApply}
              basePaths={basePaths}
              defaultDatasetIdx={defaultDatasetIdx(config)}
            />
          )}

          {!multiCam && (
          <>
          {/* Section 5: Image Viewer Toggle */}
          {validation?.valid && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowImageViewer(!showImageViewer)}
                className="flex items-center gap-2"
              >
                {showImageViewer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showImageViewer ? 'Hide Image Viewer' : 'Browse Calibration Images'}
              </Button>
              {showImageViewer && cameraOptions.length > 1 && (
                <Select value={String(camera)} onValueChange={v => setCamera(Number(v))}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cameraOptions.map((c) => (
                      <SelectItem key={c} value={String(c)}>Camera {c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Section 6: Image Viewer with Overlay + world-frame / global-coords picking */}
          {showImageViewer && validation?.valid && (
            <CalibrationImageViewer
              backendUrl="/backend"
              sourcePathIdx={sourcePathIdx}
              camera={camera}
              numImages={frameCount}
              refreshKey={viewerRefreshKey}
              onFrameChange={handleFrameChange}
              savedDetections={savedDetections}
              showSavedOverlay={showOverlay}
              onSavedOverlayChange={setShowOverlay}
              pointSelectMode={wfIsSelecting}
              onPointSelect={(px, py) => { if (wfIsSelecting) wf.handlePoint(px, py); }}
              selectedMarkers={onDatumFrame ? getWorldFrameMarkers(wf) : []}
              detectionLoading={modelLoading}
              settingsBarExtras={
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline" size="sm" disabled={wf.busy || detecting}
                    onClick={async () => {
                      await wf.prepare();
                      if (modelType === 'polynomial') detectFrame(datumNum);
                      else await detectAllViews();
                      setShowOverlay(true);
                    }}
                  >
                    {(wf.busy || detecting) && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Detect Markers
                  </Button>
                  {onDatumFrame ? (
                    <WorldFrameControls wf={wf} />
                  ) : (
                    <span className="text-xs text-muted-foreground">World frame is set on the datum frame ({datumNum}).</span>
                  )}
                </div>
              }
            />
          )}

          {/* Section 7: Action Buttons */}
          <div className="border-t pt-4 space-y-4">
            <div className="flex gap-2 items-center flex-wrap">
              <Button
                onClick={async () => { await generateCameraModelAll(wf.payload); detectFrame(currentFrame); setShowOverlay(true); }}
                disabled={isCalibrating || isMultiCameraCalibrating || !validation?.valid || wfPartial}
                title={partialTitle}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {(isCalibrating || isMultiCameraCalibrating) ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  cameraOptions.length > 1 ? 'Generate Model (All Cameras)' : 'Generate Model'
                )}
              </Button>

              {cameraOptions.length > 1 && (
                <Button
                  onClick={async () => { await generateCameraModel(wf.payload); detectFrame(currentFrame); setShowOverlay(true); }}
                  disabled={isCalibrating || isMultiCameraCalibrating || !validation?.valid || wfPartial}
                  title={partialTitle}
                  variant="outline"
                >
                  This Camera Only
                </Button>
              )}

              {/* Calibrate Vectors: PIV type + target datasets */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">Calibrate vectors:</span>
                <Select value={vectorTypeName} onValueChange={handleVectorTypeChange} disabled={isVectorCalibrating}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instantaneous">Instantaneous</SelectItem>
                    <SelectItem value="ensemble">Ensemble</SelectItem>
                  </SelectContent>
                </Select>
                <ApplyDatasetButtons
                  basePaths={basePaths}
                  defaultIdx={defaultDatasetIdx(config)}
                  jobs={applyJobs}
                  onApply={datasets => calibrateVectors(vectorTypeName, datasets)}
                  disabled={!hasModel}
                  title={!hasModel ? "Generate or load a camera model first" : "Calibrate vectors for all cameras"}
                  buttonClassName="bg-green-600 hover:bg-green-700 text-white"
                />
              </div>

              <Button
                onClick={setAsActiveMethod}
                disabled={isActive}
                variant={isActive ? "default" : "outline"}
                className={isActive ? "bg-green-600 hover:bg-green-600" : ""}
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
              <p className="text-xs text-muted-foreground">
                {wfPartial
                  ? <>Finish the world frame (<strong>Origin → +X → +Y</strong>) or clear it before generating.</>
                  : <>No world frame picked: the model uses the board&apos;s default frame (origin at the lowest-index corner, axes along the board). To set your own, click <strong>Detect Markers</strong> in the viewer and pick <strong>Origin → +X → +Y</strong> on the datum frame.</>}
              </p>
            )}

            <ChangedSinceGenerate fields={changedSinceGenerate} />

            {modelLoadError && (
              <div className="text-sm text-red-600 flex items-center gap-1">
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
              <div className="text-sm text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {detectError}
              </div>
            )}

            {/* Job Progress */}
            {jobStatus && (jobStatus.status === 'running' || jobStatus.status === 'starting') && (
              <div className="mt-4 p-3 border rounded bg-blue-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <strong>Camera Model Generation:</strong>
                  <span className="capitalize">{jobStatus.status}</span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
                  <div
                    className="h-2 bg-blue-600 transition-all"
                    style={{ width: `${jobStatus.progress || 0}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Progress: {jobStatus.progress?.toFixed(0) || 0}%
                  {jobStatus.processed_images !== undefined && (
                    <span> | Images: {jobStatus.processed_images}/{jobStatus.total_images}</span>
                  )}
                  {jobStatus.valid_images !== undefined && jobStatus.valid_images > 0 && (
                    <span> | Valid: {jobStatus.valid_images}</span>
                  )}
                </div>
              </div>
            )}

            {/* Job Completed */}
            {jobStatus?.status === 'completed' && (
              <div className="mt-4 p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Camera model generation completed!
                {jobStatus.rms_error != null && (
                  <span className="ml-2">RMS: {Number(jobStatus.rms_error).toFixed(4)} {jobStatus.rms_unit ?? 'px'}</span>
                )}
                {jobStatus.num_images_used && (
                  <span className="ml-2">({jobStatus.num_images_used} images used)</span>
                )}
              </div>
            )}

            {/* Job Failed */}
            {jobStatus?.status === 'failed' && (
              <div className="mt-4 p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Error: {jobStatus.error || 'Calibration failed'}
              </div>
            )}

            {/* Multi-Camera Job Progress */}
            {multiCameraJobStatus && (multiCameraJobStatus.status === 'running' || multiCameraJobStatus.status === 'starting') && (
              <div className="mt-4 p-3 border rounded bg-blue-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <strong>Multi-Camera Model Generation:</strong>
                  <span>Camera {multiCameraJobStatus.current_camera || '...'}</span>
                </div>
                {/* Cameras-complete is the only real signal: generate_model is synchronous, so
                    there is no within-camera progress to report. */}
                <Progress
                  value={multiCameraJobStatus.total_cameras > 0
                    ? (multiCameraJobStatus.processed_cameras / multiCameraJobStatus.total_cameras) * 100
                    : 0}
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Cameras: {multiCameraJobStatus.processed_cameras}/{multiCameraJobStatus.total_cameras}
                </div>
              </div>
            )}

            {/* Multi-Camera Job Completed */}
            {multiCameraJobStatus?.status === 'completed' && (
              <div className={`mt-4 p-3 border rounded text-sm ${multiCameraJobStatus.succeeded_cameras
                ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {multiCameraJobStatus.succeeded_cameras
                  ? <CheckCircle2 className="h-4 w-4 inline mr-2" />
                  : <AlertTriangle className="h-4 w-4 inline mr-2" />}
                Multi-camera model generation finished: {multiCameraJobStatus.succeeded_cameras ?? 0} of {multiCameraJobStatus.total_cameras} cameras succeeded
                {multiCameraJobStatus.camera_results && (
                  <div className="mt-1 text-xs">
                    {Object.entries(multiCameraJobStatus.camera_results).map(([cam, res]: [string, any]) => (
                      <span key={cam} className="mr-3">
                        {cam}: {res.status === 'completed' && res.rms_error != null
                          ? `RMS ${Number(res.rms_error).toFixed(4)} ${res.rms_unit ?? 'px'} (${res.num_images_used} images)`
                          : `${res.status}${res.error ? `: ${res.error}` : ""}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Vector Calibration progress / results, one per target dataset selection */}
            <ApplyJobsStatus jobs={applyJobs} basePaths={basePaths} title="Vector calibration"
              onCancel={cancelApply} />
          </div>
          </>
          )}
        </CardContent>
      </Card>

      {/* Section 8: Camera Model Results (single-camera mono solve) */}
      {!multiCam && hasModel && cameraModel && (
        <Card>
          <CardHeader>
            <CardTitle>Camera Model Results</CardTitle>
            <CardDescription>
              Calibration model for Camera {camera}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cameraModel.model_type === 'polynomial' ? (
              <div className="grid md:grid-cols-2 gap-6">
                {/* Polynomial coefficients (X) */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Coefficients X (mm)</h4>
                  <div className="font-mono text-xs bg-muted p-2 rounded break-all">
                    [{cameraModel.coeffs_x?.map((c: number) => c?.toFixed(6) ?? 'null').join(', ')}]
                  </div>
                </div>

                {/* Polynomial coefficients (Y) */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Coefficients Y (mm)</h4>
                  <div className="font-mono text-xs bg-muted p-2 rounded break-all">
                    [{cameraModel.coeffs_y?.map((c: number) => c?.toFixed(6) ?? 'null').join(', ')}]
                  </div>
                </div>

                {/* Normalisation */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold mb-2">Normalisation (s,t)</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-muted-foreground">x0:</span><span className="ml-2 font-medium">{cameraModel.norm?.x0?.toFixed(1)} px</span></div>
                    <div><span className="text-muted-foreground">sx:</span><span className="ml-2 font-medium">{cameraModel.norm?.sx?.toFixed(1)} px</span></div>
                    <div><span className="text-muted-foreground">y0:</span><span className="ml-2 font-medium">{cameraModel.norm?.y0?.toFixed(1)} px</span></div>
                    <div><span className="text-muted-foreground">sy:</span><span className="ml-2 font-medium">{cameraModel.norm?.sy?.toFixed(1)} px</span></div>
                  </div>
                </div>

                {/* Fit quality */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold mb-2">Fit Quality</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-muted-foreground">RMS X:</span><span className="ml-2 font-medium">{cameraModel.rms_x_mm?.toFixed(4)} mm</span></div>
                    <div><span className="text-muted-foreground">RMS Y:</span><span className="ml-2 font-medium">{cameraModel.rms_y_mm?.toFixed(4)} mm</span></div>
                    <div><span className="text-muted-foreground">Plane:</span><span className="ml-2 font-medium">datum frame only</span></div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                {/* Camera Matrix */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Camera Matrix</h4>
                  <div className="font-mono text-xs bg-muted p-2 rounded">
                    {cameraModel.camera_matrix?.map((row: number[], i: number) => (
                      <div key={i}>[{row.map(v => v?.toFixed(2) ?? 'null').join(', ')}]</div>
                    ))}
                  </div>
                </div>

                {/* Intrinsic Parameters */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold mb-2">Intrinsic Parameters</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Focal Length (fx):</span>
                      <span className="ml-2 font-medium">{cameraModel.focal_length?.[0]?.toFixed(1)} px</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Focal Length (fy):</span>
                      <span className="ml-2 font-medium">{cameraModel.focal_length?.[1]?.toFixed(1)} px</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Principal Point (cx):</span>
                      <span className="ml-2 font-medium">{cameraModel.principal_point?.[0]?.toFixed(1)} px</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Principal Point (cy):</span>
                      <span className="ml-2 font-medium">{cameraModel.principal_point?.[1]?.toFixed(1)} px</span>
                    </div>
                  </div>
                </div>

                {/* Distortion Coefficients */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Distortion Coefficients</h4>
                  <div className="font-mono text-xs bg-muted p-2 rounded">
                    [{cameraModel.dist_coeffs?.map((d: number) => d?.toFixed(6) ?? 'null').join(', ')}]
                  </div>
                </div>

                {/* Calibration Quality */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold mb-2">Calibration Quality</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">RMS Error:</span>
                      <span className="ml-2 font-medium">{cameraModel.reprojection_error?.toFixed(4)} px</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Images Used:</span>
                      <span className="ml-2 font-medium">{cameraModel.num_images_used}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Detection Summary */}
            {detections && Object.keys(detections).length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <h4 className="text-sm font-semibold mb-2">Detection Summary</h4>
                <p className="text-sm text-muted-foreground">
                  {Object.keys(detections).length} frames with detected ChArUco corners.
                  {showOverlay ? ' Toggle overlay in image viewer to visualize.' : ' Enable overlay in image viewer to visualize.'}
                </p>
              </div>
            )}

            <CalibrationFigureGallery
              query={{ board: "charuco", camera, source_path_idx: sourcePathIdx }}
              trigger={cameraModel}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
};
