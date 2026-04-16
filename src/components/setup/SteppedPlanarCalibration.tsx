"use client";
import React, { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Loader2,
  RotateCcw,
} from "lucide-react";
import {
  useSteppedPlanarCalibration,
  FiducialSet,
} from "@/hooks/useSteppedPlanarCalibration";
import { ValidationAlert } from "@/components/setup/ValidationAlert";
import CalibrationImageViewer from "@/components/viewer/CalibrationImageViewer";
import { MarkerPoint } from "@/components/viewer/zoomableCanvas";
import {
  GCInlineControls,
  useGlobalCoordinates,
  getGlobalCoordMarkers,
  getGlobalCoordViewerTarget,
  handleGlobalCoordPointSelect,
} from "@/components/setup/GlobalCoordinateSetup";

interface SteppedPlanarCalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  cameraOptions: number[];
  sourcePaths: string[];
}

type FiducialName = "origin" | "x_axis" | "y_axis";

const FIDUCIAL_LABELS: Record<FiducialName, string> = {
  origin: "Origin",
  x_axis: "+X",
  y_axis: "+Y",
};

const FIDUCIAL_COLORS: Record<FiducialName, string> = {
  origin: "#ff0000",
  x_axis: "#00ff00",
  y_axis: "#0000ff",
};

const FIDUCIAL_STEPS: FiducialName[] = ["origin", "x_axis", "y_axis"];

export const SteppedPlanarCalibration: React.FC<SteppedPlanarCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
}) => {
  const calibration = useSteppedPlanarCalibration(cameraOptions, sourcePaths);

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
    calibrationSources,
    setCalibrationSources,
    useCameraSubfolders,
    setUseCameraSubfolders,
    cameraSubfolders,
    setCameraSubfolders,

    // Board geometry
    dotSpacingMm,
    setDotSpacingMm,
    stepHeightMm,
    setStepHeightMm,
    boardThicknessMm,
    setBoardThicknessMm,
    dt,
    setDt,

    // Sequence controls
    numCalibrationFrames,
    setNumCalibrationFrames,
    datumFrame,
    setDatumFrame,

    // Validation
    validation,
    validating,

    // Per-camera sequence state
    sequenceId,
    sequenceStatus,
    sequencePoses,
    sequenceError,
    detectionProgress,

    // Per-camera fiducials
    fiducials,
    clickedLevel,
    setClickedLevel,
    poseLevels,
    setPoseLevel,

    // Per-camera fit/model
    fitJobStatus,
    cameraModel,
    modelLoading,
    modelLoadError,

    // Multi-camera / vector
    multiCameraJobStatus,
    isMultiCameraCalibrating,
    vectorJobStatus,
    isVectorCalibrating,

    // Actions
    detectSequence,
    snapFiducial,
    generateCameraModel,
    generateCameraModelAll,
    loadModel,
    calibrateVectors,
    fetchPoseDetection,
    identifyPoseLevel,

    // Overlay helpers
    getDetectionOverlayPoints,
    getDetectionOverlayLines,
    getFiducialMarkers,
  } = calibration;

  // Global coordinate system
  const gc = useGlobalCoordinates(config, updateConfig, cameraOptions, calibrationSources);
  const gcViewerTarget = getGlobalCoordViewerTarget(gc);
  const gcIsSelecting = gc.selectionMode !== "none";

  // ---- Local state ----
  const [vectorTypeName, setVectorTypeName] = useState<'instantaneous' | 'ensemble'>('instantaneous');
  const [fiducialSelectMode, setFiducialSelectMode] = useState(false);
  const [fiducialStepIdx, setFiducialStepIdx] = useState(0);

  // Local debounced inputs
  const [dotSpacingInput, setDotSpacingInput] = useState(String(dotSpacingMm));
  const [stepHeightInput, setStepHeightInput] = useState(String(stepHeightMm));
  const [boardThicknessInput, setBoardThicknessInput] = useState(String(boardThicknessMm));
  const [dtInput, setDtInput] = useState(String(dt));
  const [datumFrameInput, setDatumFrameInput] = useState(String(datumFrame));
  const [numFramesInput, setNumFramesInput] = useState(String(numCalibrationFrames));
  const [labelTarget, setLabelTarget] = useState<{ frameIdx: number } | null>(null);
  const [displayedFrame, setDisplayedFrame] = useState<number>(datumFrame);

  // Verification derived from poseLevels — persists to config.yaml
  const isVerified = useCallback((frameIdx: number) =>
    (poseLevels?.[camera] || {})[frameIdx] !== undefined,
  [poseLevels, camera]);

  React.useEffect(() => { setDotSpacingInput(String(dotSpacingMm)); }, [dotSpacingMm]);
  React.useEffect(() => { setStepHeightInput(String(stepHeightMm)); }, [stepHeightMm]);
  React.useEffect(() => { setBoardThicknessInput(String(boardThicknessMm)); }, [boardThicknessMm]);
  React.useEffect(() => { setDtInput(String(dt)); }, [dt]);
  React.useEffect(() => { setDatumFrameInput(String(datumFrame)); }, [datumFrame]);
  React.useEffect(() => { setNumFramesInput(String(numCalibrationFrames)); }, [numCalibrationFrames]);

  // Sync piv_type from config
  React.useEffect(() => {
    const pivType = config.calibration?.piv_type;
    if (pivType === 'instantaneous' || pivType === 'ensemble') {
      setVectorTypeName(pivType);
    }
  }, [config.calibration?.piv_type]);

  const handleVectorTypeChange = async (value: 'instantaneous' | 'ensemble') => {
    setVectorTypeName(value);
    try {
      const res = await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calibration: { piv_type: value } }),
      });
      const json = await res.json();
      if (res.ok && json.updated?.calibration) {
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (e) {
      console.error('Failed to save piv_type:', e);
    }
  };

  // ---- Active camera slices ----
  const activeSequenceId = sequenceId[camera] ?? null;
  const activeSequenceStatus = sequenceStatus[camera] ?? 'idle';
  const activeSequencePoses = sequencePoses[camera] ?? null;
  const activeSequenceError = sequenceError[camera] ?? null;
  const activeDetectionProgress = detectionProgress[camera] ?? 0;
  const activeFiducials: FiducialSet = fiducials[camera] ?? { origin: null, x_axis: null, y_axis: null };
  const activeClickedLevel = clickedLevel[camera] ?? null;
  const activeFitJob = fitJobStatus[camera] ?? null;
  const activeCameraModel = cameraModel[camera] ?? null;
  const activeModelLoading = modelLoading[camera] ?? false;
  const activeModelLoadError = modelLoadError[camera] ?? null;

  const hasAllFiducials = useMemo(() => {
    return activeFiducials.origin != null && activeFiducials.x_axis != null && activeFiducials.y_axis != null;
  }, [activeFiducials]);

  const canGenerateForActive = useMemo(() => {
    return (
      activeSequenceStatus === 'ready' &&
      activeSequenceId !== null &&
      hasAllFiducials &&
      (activeClickedLevel === 'peak' || activeClickedLevel === 'trough') &&
      activeFitJob?.status !== 'running' &&
      activeFitJob?.status !== 'starting'
    );
  }, [activeSequenceStatus, activeSequenceId, hasAllFiducials, activeClickedLevel, activeFitJob]);

  const canGenerateForAll = useMemo(() => {
    if (cameraOptions.length === 0) return false;
    for (const cam of cameraOptions) {
      const sid = sequenceId[cam];
      const fids = fiducials[cam];
      const level = clickedLevel[cam];
      if (!sid) return false;
      if (!fids?.origin || !fids?.x_axis || !fids?.y_axis) return false;
      if (level !== 'peak' && level !== 'trough') return false;
    }
    return !isMultiCameraCalibrating;
  }, [cameraOptions, sequenceId, fiducials, clickedLevel, isMultiCameraCalibrating]);

  const hasActiveModel = activeCameraModel !== null;

  // ---- Fiducial click handling ----
  const currentFiducialName = fiducialStepIdx < FIDUCIAL_STEPS.length
    ? FIDUCIAL_STEPS[fiducialStepIdx]
    : null;

  const handlePointSelect = useCallback(async (
    pixelX: number,
    pixelY: number,
    _cam: number,
    _frame: number,
  ) => {
    if (gcIsSelecting) {
      handleGlobalCoordPointSelect(gc, pixelX, pixelY, _cam, _frame);
      return;
    }
    if (!fiducialSelectMode || !currentFiducialName) return;
    await snapFiducial(camera, currentFiducialName, pixelX, pixelY);
    const nextIdx = fiducialStepIdx + 1;
    if (nextIdx < FIDUCIAL_STEPS.length) {
      setFiducialStepIdx(nextIdx);
    } else {
      setFiducialSelectMode(false);
      setFiducialStepIdx(0);
    }
  }, [gcIsSelecting, gc, fiducialSelectMode, currentFiducialName, snapFiducial, camera, fiducialStepIdx]);

  const resetActiveFiducials = useCallback(() => {
    // Use hook-level API: snap_fiducial mutates fiducials, but there's no explicit
    // "reset" on the hook beyond clearCameraState. We want to keep the sequence,
    // just clear the three clicks, so we manually overwrite via the hook-internal
    // mechanism — since we can't, just reset via the component's step state and
    // instruct the user. A clean way is to call clearCameraState, but that also
    // clears the sequence. The cleanest behavior matching the stepped stereo UX
    // is to allow re-clicking: the next click will overwrite, so just reset the
    // step index + mode.
    setFiducialSelectMode(false);
    setFiducialStepIdx(0);
  }, []);

  // ---- Fiducial markers for overlay ----
  // Fiducial markers — only shown on the datum frame
  const markerPoints = useMemo((): MarkerPoint[] => {
    if (displayedFrame !== datumFrame) return [];
    const m: MarkerPoint[] = [];
    if (activeFiducials.origin) {
      m.push({ x: activeFiducials.origin[0], y: activeFiducials.origin[1], color: FIDUCIAL_COLORS.origin, label: 'O' });
    }
    if (activeFiducials.x_axis) {
      m.push({ x: activeFiducials.x_axis[0], y: activeFiducials.x_axis[1], color: FIDUCIAL_COLORS.x_axis, label: 'X' });
    }
    if (activeFiducials.y_axis) {
      m.push({ x: activeFiducials.y_axis[0], y: activeFiducials.y_axis[1], color: FIDUCIAL_COLORS.y_axis, label: 'Y' });
    }
    return m;
  }, [activeFiducials, displayedFrame, datumFrame]);

  const mergedMarkers = useMemo((): MarkerPoint[] => {
    if (gcIsSelecting) {
      const gcMarkers = getGlobalCoordMarkers(
        gc,
        gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : camera,
        1,
      );
      return [...markerPoints, ...(gcMarkers ?? [])];
    }
    return markerPoints;
  }, [gcIsSelecting, gc, gcViewerTarget, camera, markerPoints]);

  // ---- Detection overlay for current camera (pose-level-aware) ----
  const overlayPoints = useMemo(() => {
    const raw = getDetectionOverlayPoints(camera);
    if (raw.length === 0) return raw;
    const poseLevel = (poseLevels?.[camera] || {})[displayedFrame];
    if (!poseLevel || poseLevel === 'peak') return raw;
    return raw.map(pt => ({
      ...pt,
      color: pt.color === 'blue' ? 'red' : pt.color === 'red' ? 'blue' : pt.color,
    }));
  }, [getDetectionOverlayPoints, camera, poseLevels, displayedFrame]);

  const overlayLines = useMemo(() => {
    const raw = getDetectionOverlayLines(camera);
    if (raw.length === 0) return raw;
    const poseLevel = (poseLevels?.[camera] || {})[displayedFrame];
    if (!poseLevel || poseLevel === 'peak') return raw;
    return raw.map(ln => ({
      ...ln,
      color: ln.color?.includes('80, 140, 255') ? 'rgba(255, 120, 120, 1)'
           : ln.color?.includes('255, 120, 120') ? 'rgba(80, 140, 255, 1)'
           : ln.color,
    }));
  }, [getDetectionOverlayLines, camera, poseLevels, displayedFrame]);

  // Handle frame change — fetch detection overlay for that frame
  const handleFrameChange = useCallback((frameIdx: number) => {
    setDisplayedFrame(frameIdx);
    const seqId = sequenceId?.[camera];
    if (seqId && sequenceStatus?.[camera] === 'ready') {
      fetchPoseDetection(camera, frameIdx);
    }
  }, [camera, sequenceId, sequenceStatus, fetchPoseDetection]);

  // Handle click-to-label: identify level, set pose_level (persists to
  // config.yaml), then auto-advance to next unverified pose.
  const handleLabelClick = useCallback(async (pixelX: number, pixelY: number) => {
    if (!labelTarget) return;
    const level = await identifyPoseLevel(camera, labelTarget.frameIdx, pixelX, pixelY);
    if (!level) { setLabelTarget(null); return; }

    setPoseLevel(camera, labelTarget.frameIdx, level);

    // Find next unverified pose for this camera
    const activePoses = (sequencePoses?.[camera] || []) as Array<{ frame_idx: number; is_datum?: boolean; ok?: boolean }>;
    const nextPose = activePoses.find(p =>
      !p.is_datum && p.ok &&
      p.frame_idx !== labelTarget.frameIdx &&
      !isVerified(p.frame_idx)
    );
    if (nextPose) {
      setLabelTarget({ frameIdx: nextPose.frame_idx });
      fetchPoseDetection(camera, nextPose.frame_idx);
      return;
    }

    setLabelTarget(null);
  }, [labelTarget, camera, identifyPoseLevel, setPoseLevel, sequencePoses, isVerified, fetchPoseDetection]);

  const fmtCoord = (coord: [number, number] | null): string => {
    if (!coord) return 'Not set';
    return `(${coord[0].toFixed(1)}, ${coord[1].toFixed(1)})`;
  };

  // ---- Set as active method ----
  const setAsActiveMethod = useCallback(async () => {
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calibration: { active: "stepped_planar" } }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to set active method");
      if (json.updated?.calibration) {
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (err) {
      console.error("Failed to set active calibration method:", err);
    }
  }, [config.calibration, updateConfig]);

  const isActive = config.calibration?.active === "stepped_planar";

  // macOS container format detection
  const isContainerFormat = imageFormat.includes('.set') || imageFormat.includes('.im7');
  const isMacOS = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Stepped Board as Planar Calibration</CardTitle>
          <CardDescription>
            Per-camera sequence-based planar calibration using both Z levels of a stepped dot target.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* ============================================= */}
          {/* Section 1: Source Configuration                */}
          {/* ============================================= */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Source Configuration</h3>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Calibration Images Location</Label>
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

            <div className="grid md:grid-cols-3 gap-4">
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
                <p className="text-xs text-muted-foreground mt-1">Where calibration models are saved.</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Active Camera</Label>
                <Select value={String(camera)} onValueChange={v => setCamera(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cameraOptions.map(c => (
                      <SelectItem key={c} value={String(c)}>Camera {c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">All actions apply to this camera.</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Cameras Configured</Label>
                <div className="text-sm text-muted-foreground mt-2 p-2 bg-muted rounded">
                  {cameraOptions.length > 0
                    ? `Cameras ${cameraOptions.join(', ')}`
                    : 'No cameras configured'}
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
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
                <Input
                  value={imageFormat}
                  onChange={e => setImageFormat(e.target.value)}
                  placeholder="calib%05d.tif"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Number of Images</Label>
                <Input
                  type="text" inputMode="numeric"
                  value={numImages}
                  onChange={e => setNumImages(e.target.value)}
                  onBlur={() => {
                    const finalVal = parseInt(numImages) || 10;
                    setNumImages(String(finalVal));
                  }}
                />
              </div>
            </div>

            {isContainerFormat && isMacOS && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Unsupported File Format on macOS</AlertTitle>
                <AlertDescription>.set and .im7 container formats require Windows or Linux.</AlertDescription>
              </Alert>
            )}

            {(imageType === "standard" || imageType === "lavision_im7") && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="stepped-planar-use-camera-subfolders"
                    checked={useCameraSubfolders}
                    onCheckedChange={setUseCameraSubfolders}
                  />
                  <Label htmlFor="stepped-planar-use-camera-subfolders" className="text-sm">
                    Use camera subfolders
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground ml-10">
                  {useCameraSubfolders
                    ? "Images expected in camera subfolders (e.g., Cam1/, Cam2/)."
                    : "Images in source directory without camera subfolders."}
                </p>
              </div>
            )}

            {useCameraSubfolders && cameraOptions.length > 0 && (
              <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                <h4 className="text-sm font-medium">Camera Subfolder Configuration</h4>
                <p className="text-xs text-muted-foreground">
                  Camera subfolders are relative to the calibration source path.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {cameraOptions.map((cam, idx) => (
                    <div key={cam}>
                      <label className="text-xs text-muted-foreground">Camera {cam}</label>
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
            )}

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
          </div>

          {/* ============================================= */}
          {/* Section 2: Board Geometry                     */}
          {/* ============================================= */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold">Board Geometry</h3>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <Label className="text-sm font-medium">Dot Spacing (mm)</Label>
                <Input
                  type="text" inputMode="numeric"
                  value={dotSpacingInput}
                  onChange={e => setDotSpacingInput(e.target.value)}
                  onBlur={() => setDotSpacingMm(parseFloat(dotSpacingInput) || 28.89)}
                />
                <p className="text-xs text-muted-foreground mt-1">Physical spacing between dots</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Step Height (mm)</Label>
                <Input
                  type="text" inputMode="numeric"
                  value={stepHeightInput}
                  onChange={e => setStepHeightInput(e.target.value)}
                  onBlur={() => setStepHeightMm(parseFloat(stepHeightInput) || 3.0)}
                />
                <p className="text-xs text-muted-foreground mt-1">Height between peak and trough levels</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Board Thickness (mm)</Label>
                <Input
                  type="text" inputMode="numeric"
                  value={boardThicknessInput}
                  onChange={e => setBoardThicknessInput(e.target.value)}
                  onBlur={() => setBoardThicknessMm(parseFloat(boardThicknessInput) || 14.8)}
                />
                <p className="text-xs text-muted-foreground mt-1">Total thickness of the board</p>
              </div>
              <div>
                <Label className="text-sm font-medium">&Delta;t (s)</Label>
                <Input
                  type="text" inputMode="numeric"
                  value={dtInput}
                  onChange={e => setDtInput(e.target.value)}
                  onBlur={() => setDt(parseFloat(dtInput) || 1.0)}
                />
                <p className="text-xs text-muted-foreground mt-1">Time step between frames</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <Label className="text-sm font-medium">Datum Frame</Label>
                <Input
                  type="text" inputMode="numeric"
                  value={datumFrameInput}
                  onChange={e => setDatumFrameInput(e.target.value)}
                  onBlur={() => {
                    const n = parseInt(datumFrameInput);
                    if (!isNaN(n) && n >= 1) setDatumFrame(n);
                    else setDatumFrameInput(String(datumFrame));
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">World origin image (1-based)</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Number of Frames</Label>
                <Input
                  type="text" inputMode="numeric"
                  value={numFramesInput}
                  onChange={e => setNumFramesInput(e.target.value)}
                  onBlur={() => {
                    const n = parseInt(numFramesInput);
                    if (!isNaN(n) && n >= 1) setNumCalibrationFrames(n);
                    else setNumFramesInput(String(numCalibrationFrames));
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">&ge; 5 recommended for good fx recovery</p>
              </div>
            </div>
          </div>

          {/* ============================================= */}
          {/* Section 3: Detection + Fiducials              */}
          {/* ============================================= */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold">Detection + Fiducials</h3>

            <p className="text-xs text-muted-foreground">
              Detects dots on {numCalibrationFrames} frames and runs a joint pinhole fit using BOTH
              Z levels. The datum frame&apos;s fiducial clicks anchor the world frame. Per-camera.
            </p>

            {/* Detect button */}
            <div className="flex items-center gap-3">
              <Button
                onClick={() => detectSequence(camera)}
                disabled={activeSequenceStatus === 'detecting' || !validation?.valid}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {activeSequenceStatus === 'detecting' ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Detecting sequence...
                  </>
                ) : (
                  `Detect sequence for Cam ${camera}`
                )}
              </Button>
              {activeSequenceStatus === 'ready' && activeSequenceId && activeSequencePoses && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Sequence ready ({activeSequencePoses.length} poses)
                </span>
              )}
            </div>

            {activeSequenceStatus === 'detecting' && (
              <Progress value={activeDetectionProgress} className="w-full" />
            )}

            {activeSequenceError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{activeSequenceError}</AlertDescription>
              </Alert>
            )}

            {/* Per-pose peak/trough verification (single camera) */}
            {activeSequencePoses && activeSequencePoses.length > 0 && (() => {
              const nonDatum = activeSequencePoses.filter(p => !p.is_datum && p.ok);
              const verified = nonDatum.filter(p => isVerified(p.frame_idx)).length;
              const total = nonDatum.length;
              const allDone = verified === total;
              const firstUnverified = nonDatum.find(p => !isVerified(p.frame_idx));
              return (
              <div className="p-3 border rounded space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">
                    Peak/trough verification (Cam {camera})
                  </h4>
                  {allDone ? (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> All verified
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {verified}/{total} verified
                    </span>
                  )}
                </div>

                {!allDone && !labelTarget && firstUnverified && (
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => {
                      setLabelTarget({ frameIdx: firstUnverified.frame_idx });
                      fetchPoseDetection(camera, firstUnverified.frame_idx);
                    }}
                  >
                    {verified === 0
                      ? `Verify all poses (click ${activeClickedLevel || 'peak'} dots)`
                      : `Continue verification (${total - verified} remaining)`
                    }
                  </Button>
                )}
                {labelTarget && (
                  <div className="flex items-center gap-3">
                    <Alert className="flex-1">
                      <Crosshair className="h-4 w-4" />
                      <AlertDescription className="font-medium">
                        Frame {labelTarget.frameIdx}: click a
                        <span className="font-bold text-blue-600 mx-1">{activeClickedLevel || 'peak'}</span>
                        dot &mdash; blue = peak, red = trough
                      </AlertDescription>
                    </Alert>
                    <Button variant="outline" size="sm" onClick={() => setLabelTarget(null)}>
                      Stop
                    </Button>
                  </div>
                )}

                {/* Per-pose grid — each level cell is clickable to (re)verify */}
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 items-center max-w-sm">
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">Frame</div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">Level</div>
                  {activeSequencePoses.map((pose) => {
                    const ok = pose.ok === true;
                    const v = pose.is_datum || isVerified(pose.frame_idx);
                    const isActive = labelTarget?.frameIdx === pose.frame_idx;
                    const label = (poseLevels?.[camera] || {})[pose.frame_idx];
                    return (
                      <React.Fragment key={`v_${pose.frame_idx}`}>
                        <div className={`text-xs tabular-nums ${
                          pose.is_datum ? 'font-bold text-blue-600' :
                          isActive ? 'font-bold' : ''
                        }`}>
                          {pose.frame_idx}{pose.is_datum ? ' (datum)' : ''}
                        </div>
                        <div
                          className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${
                            !ok ? '' :
                            isActive ? 'bg-blue-50 ring-1 ring-blue-400' :
                            pose.is_datum ? '' :
                            v ? 'hover:bg-muted cursor-pointer' :
                            'hover:bg-amber-50 cursor-pointer'
                          }`}
                          onClick={() => {
                            if (ok && !pose.is_datum) {
                              setLabelTarget({ frameIdx: pose.frame_idx });
                              fetchPoseDetection(camera, pose.frame_idx);
                            }
                          }}
                        >
                          <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                            !ok ? 'bg-gray-300' :
                            isActive ? 'bg-blue-500 animate-pulse' :
                            v ? 'bg-green-500' : 'bg-amber-400'
                          }`} />
                          <span className={`text-[11px] ${!ok ? 'text-muted-foreground italic' : v ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {!ok ? 'no detection' :
                             pose.is_datum ? (activeClickedLevel || 'peak') :
                             label ?? 'click to set'}
                          </span>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {/* Fiducial panel */}
            {activeSequenceStatus === 'ready' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  {!fiducialSelectMode ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFiducialSelectMode(true);
                        setFiducialStepIdx(0);
                      }}
                      className="flex items-center gap-2"
                    >
                      <Crosshair className="h-4 w-4" />
                      Select Fiducials
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFiducialSelectMode(false);
                        setFiducialStepIdx(0);
                      }}
                      className="flex items-center gap-2 border-orange-400 text-orange-700"
                    >
                      Cancel Selection
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetActiveFiducials}
                    className="flex items-center gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset Step
                  </Button>

                  {/* Peak / Trough radio */}
                  <div className="flex items-center gap-2 ml-auto">
                    <Label className="text-xs text-muted-foreground">Clicked face on Cam {camera}:</Label>
                    <Select
                      value={activeClickedLevel ?? ''}
                      onValueChange={v => setClickedLevel(camera, v as 'peak' | 'trough')}
                    >
                      <SelectTrigger className="w-[120px] h-8 text-xs">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="peak">Peak (raised)</SelectItem>
                        <SelectItem value="trough">Trough (recessed)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="p-3 border rounded space-y-2">
                  <h4 className="text-sm font-medium">Cam {camera} Fiducials</h4>
                  <div className="space-y-1 text-sm">
                    {FIDUCIAL_STEPS.map((name) => (
                      <div key={name} className="flex items-center gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-full"
                          style={{ backgroundColor: FIDUCIAL_COLORS[name] }}
                        />
                        <span className="text-muted-foreground">{FIDUCIAL_LABELS[name]}:</span>
                        <span className={activeFiducials[name] ? 'font-medium' : 'text-muted-foreground italic'}>
                          {fmtCoord(activeFiducials[name])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {fiducialSelectMode && currentFiducialName && (
                  <Alert>
                    <Crosshair className="h-4 w-4" />
                    <AlertDescription className="font-medium">
                      Click {FIDUCIAL_LABELS[currentFiducialName].toUpperCase()} on Cam {camera}
                      <span className="ml-2 text-muted-foreground text-sm">
                        (Step {fiducialStepIdx + 1} of {FIDUCIAL_STEPS.length})
                      </span>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>

          {/* ============================================= */}
          {/* Section 4: CalibrationImageViewer              */}
          {/* ============================================= */}
          {validation?.valid && (
            <div className="border-t pt-4">
              <CalibrationImageViewer
                key={`stepped-planar-${camera}-${sourcePathIdx}`}
                backendUrl="/backend"
                sourcePathIdx={sourcePathIdx}
                camera={gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : camera}
                numImages={parseInt(numImages) || 10}
                calibrationType="dotboard"
                refreshKey={`${validation?.camera_path}-${validation?.valid}`}
                calibrationParams={{}}
                pointSelectMode={fiducialSelectMode || gcIsSelecting || labelTarget !== null}
                onPointSelect={(px, py, cam, frame) => {
                  if (labelTarget) {
                    handleLabelClick(px, py);
                  } else {
                    handlePointSelect(px, py, cam, frame);
                  }
                }}
                onFrameChange={handleFrameChange}
                selectedMarkers={mergedMarkers}
                externalCamera={gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : undefined}
                externalFrame={
                  gcIsSelecting && gcViewerTarget
                    ? gcViewerTarget.frame
                    : (fiducialSelectMode ? datumFrame : undefined)
                }
                externalOverlayPoints={overlayPoints}
                externalOverlayLines={overlayLines}
                detectionLoading={activeModelLoading}
                settingsBarExtras={
                  <GCInlineControls
                    gc={gc}
                    currentCamera={gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : camera}
                    cameraOptions={cameraOptions}
                    onCameraChange={setCamera}
                  />
                }
              />
            </div>
          )}

          {/* ============================================= */}
          {/* Section 5: Generate Model                     */}
          {/* ============================================= */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold">Generate Model</h3>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => generateCameraModel(camera)}
                disabled={!canGenerateForActive}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                title={
                  canGenerateForActive
                    ? `Fit pinhole model for Cam ${camera}`
                    : 'Need sequence + all 3 fiducials + clicked level for this camera'
                }
              >
                {activeFitJob?.status === 'running' || activeFitJob?.status === 'starting' ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating…
                  </>
                ) : (
                  `Generate for Cam ${camera}`
                )}
              </Button>

              <Button
                onClick={() => generateCameraModelAll()}
                disabled={!canGenerateForAll}
                variant="outline"
                className="border-blue-400 text-blue-700 hover:bg-blue-50"
                title={
                  canGenerateForAll
                    ? 'Fit pinhole models for all configured cameras in parallel'
                    : 'All cameras need sequence + all 3 fiducials + clicked level'
                }
              >
                {isMultiCameraCalibrating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating all…
                  </>
                ) : (
                  `Generate for all cameras (${cameraOptions.length})`
                )}
              </Button>

              <Button
                onClick={() => loadModel(camera)}
                disabled={activeModelLoading}
                variant="outline"
              >
                {activeModelLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading…
                  </>
                ) : (
                  'Load Saved'
                )}
              </Button>

              <Button
                onClick={setAsActiveMethod}
                disabled={isActive}
                variant={isActive ? "default" : "outline"}
                className={isActive ? "bg-green-600 hover:bg-green-600 text-white" : ""}
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

              {/* Calibrate Vectors */}
              <div className="flex items-center gap-1">
                <Button
                  onClick={() => calibrateVectors(true, vectorTypeName)}
                  disabled={!hasActiveModel || isVectorCalibrating}
                  className="bg-green-600 hover:bg-green-700 text-white rounded-r-none"
                  title={!hasActiveModel ? "Generate or load a camera model first" : "Calibrate vectors for all cameras"}
                >
                  {isVectorCalibrating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Calibrating…
                    </>
                  ) : (
                    'Calibrate Vectors'
                  )}
                </Button>
                <Select value={vectorTypeName} onValueChange={handleVectorTypeChange} disabled={isVectorCalibrating}>
                  <SelectTrigger className="w-[130px] rounded-l-none border-l-0 bg-green-600 hover:bg-green-700 text-white border-green-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instantaneous">Instantaneous</SelectItem>
                    <SelectItem value="ensemble">Ensemble</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(activeFitJob?.status === 'running' || activeFitJob?.status === 'starting') && (
              <Progress value={activeFitJob?.progress ?? 0} className="w-full" />
            )}

            {activeFitJob?.status === 'failed' && (
              <div className="p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Cam {camera} fit failed: {activeFitJob?.error || 'Unknown error'}
              </div>
            )}

            {activeModelLoadError && (
              <div className="text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {activeModelLoadError}
              </div>
            )}

            {/* Multi-camera job progress + results */}
            {multiCameraJobStatus && (multiCameraJobStatus.status === 'running' || multiCameraJobStatus.status === 'starting') && (
              <div className="p-3 border rounded bg-blue-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <strong>Multi-Camera Fit:</strong>
                  <span>Camera {multiCameraJobStatus.current_camera ?? '…'}</span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
                  <div
                    className="h-2 bg-blue-600 transition-all"
                    style={{ width: `${multiCameraJobStatus.current_camera_progress ?? 0}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Cameras: {multiCameraJobStatus.processed_cameras}/{multiCameraJobStatus.total_cameras}
                </div>
              </div>
            )}

            {multiCameraJobStatus?.status === 'completed' && (
              <div className="p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Multi-camera fit completed ({multiCameraJobStatus.processed_cameras} cameras).
                {multiCameraJobStatus.camera_results && (
                  <div className="mt-1 text-xs">
                    {Object.entries(multiCameraJobStatus.camera_results)
                      .filter(([k]) => k !== 'global_alignment')
                      .map(([cam, res]: [string, any]) => (
                        <span key={cam} className="mr-3">
                          Cam {cam}: {res.status === 'completed' && res.rms != null
                            ? `RMS ${Number(res.rms).toFixed(4)} px (${res.num_poses} poses)`
                            : res.status}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            )}

            {multiCameraJobStatus?.status === 'failed' && (
              <div className="p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Multi-camera fit failed: {multiCameraJobStatus.error || 'Unknown error'}
              </div>
            )}

            {/* Vector calibration progress + results */}
            {vectorJobStatus && (vectorJobStatus.status === 'running' || vectorJobStatus.status === 'starting') && (
              <div className="p-3 border rounded bg-green-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                  <strong>Vector Calibration:</strong>
                  <span className="capitalize">{vectorJobStatus.status}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Cameras: {vectorJobStatus.processed_cameras}/{vectorJobStatus.total_cameras}
                </div>
              </div>
            )}

            {vectorJobStatus?.status === 'completed' && (
              <div className="p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Vector calibration completed ({vectorJobStatus.processed_cameras} cameras).
              </div>
            )}

            {vectorJobStatus?.status === 'failed' && (
              <div className="p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Vector calibration error: {vectorJobStatus.error || 'Unknown error'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ============================================= */}
      {/* Section 6: Camera Model Result                */}
      {/* ============================================= */}
      {hasActiveModel && activeCameraModel && (
        <Card>
          <CardHeader>
            <CardTitle>Camera Model Results</CardTitle>
            <CardDescription>Pinhole calibration model for Camera {camera}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <h4 className="text-sm font-semibold mb-2">Intrinsic Parameters</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Focal Length (fx):</span>
                    <span className="ml-2 font-medium">
                      {activeCameraModel.focal_length?.[0]?.toFixed(1) ?? '—'} px
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Focal Length (fy):</span>
                    <span className="ml-2 font-medium">
                      {activeCameraModel.focal_length?.[1]?.toFixed(1) ?? '—'} px
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Principal (cx):</span>
                    <span className="ml-2 font-medium">
                      {activeCameraModel.principal_point?.[0]?.toFixed(1) ?? '—'} px
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Principal (cy):</span>
                    <span className="ml-2 font-medium">
                      {activeCameraModel.principal_point?.[1]?.toFixed(1) ?? '—'} px
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold mb-2">Calibration Quality</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">RMS Error:</span>
                    <span className="ml-2 font-medium">
                      {activeCameraModel.reprojection_error?.toFixed(4) ?? '—'} px
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Poses Used:</span>
                    <span className="ml-2 font-medium">
                      {activeCameraModel.num_poses ?? '—'}
                    </span>
                  </div>
                  {activeCameraModel.image_width != null && activeCameraModel.image_height != null && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Image Size:</span>
                      <span className="ml-2 font-medium">
                        {activeCameraModel.image_width} &times; {activeCameraModel.image_height}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {activeCameraModel.camera_matrix && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Camera Matrix</h4>
                  <div className="font-mono text-xs bg-muted p-2 rounded">
                    {activeCameraModel.camera_matrix.map((row: number[], i: number) => (
                      <div key={i}>[{row.map(v => v?.toFixed(2) ?? 'null').join(', ')}]</div>
                    ))}
                  </div>
                </div>
              )}

              {activeCameraModel.dist_coeffs && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Distortion Coefficients</h4>
                  <div className="font-mono text-xs bg-muted p-2 rounded">
                    [{activeCameraModel.dist_coeffs.map((d: number) => d?.toFixed(6) ?? 'null').join(', ')}]
                  </div>
                </div>
              )}

              {activeCameraModel.model_path && (
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground">Saved to:</span>
                  <span className="ml-2 font-mono text-xs">{activeCameraModel.model_path}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
