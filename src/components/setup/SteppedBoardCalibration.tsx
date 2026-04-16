"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, CheckCircle2, Loader2, Camera, Crosshair, RotateCcw } from "lucide-react";
import { useSteppedBoardCalibration } from "@/hooks/useSteppedBoardCalibration";
import { ValidationAlert } from "@/components/setup/ValidationAlert";
import CalibrationImageViewer from "@/components/viewer/CalibrationImageViewer";
import { MarkerPoint } from "@/components/viewer/zoomableCanvas";
import { SelfCalibrationSection, SelfCalibrationWarning } from "@/components/setup/SelfCalibrationSection";
import { useSelfCalibration } from "@/hooks/useSelfCalibration";

interface SteppedBoardCalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  cameraOptions: number[];
  sourcePaths: string[];
}

// Helper to show just the last segment of a path
const basename = (p: string) => {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.filter(Boolean).pop() || p;
};

type FiducialName = "origin" | "plusX" | "plusY";
type FiducialStep = { camera: number; point: FiducialName };

const FIDUCIAL_STEPS: FiducialStep[] = [
  { camera: 1, point: "origin" },
  { camera: 1, point: "plusX" },
  { camera: 1, point: "plusY" },
  { camera: 2, point: "origin" },
  { camera: 2, point: "plusX" },
  { camera: 2, point: "plusY" },
];

const FIDUCIAL_LABELS: Record<FiducialName, string> = {
  origin: "Origin",
  plusX: "+X",
  plusY: "+Y",
};

const FIDUCIAL_COLORS: Record<FiducialName, string> = {
  origin: "#ff0000",
  plusX: "#00ff00",
  plusY: "#0000ff",
};

export const SteppedBoardCalibration: React.FC<SteppedBoardCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
}) => {
  const calibration = useSteppedBoardCalibration(cameraOptions, sourcePaths);

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

    // Calibration source config
    calibrationSources,
    setCalibrationSources,
    useCameraSubfolders,
    setUseCameraSubfolders,
    cameraSubfolders,
    setCameraSubfolders,

    // Validation
    validation,
    validating,

    // Board params
    dotSpacingMm,
    setDotSpacingMm,
    stepHeightMm,
    setStepHeightMm,
    boardThicknessMm,
    setBoardThicknessMm,
    dt,
    setDt,

    // Detection
    detectionProgress,
    detectionStats,

    // Fiducials
    fiducials,
    setFiducial,
    resetFiducials,
    clickedLevel,
    setClickedLevel,

    // Detection overlay data
    getDetectionOverlayPoints,
    getDetectionOverlayLines,
    getFiducialMarkers,

    // Model generation
    generating,
    generationProgress,
    generateModel,
    modelResults,
    hasModel,
    loadModel,
    modelLoading,
    modelLoadError,

    // Reconstruction
    reconstructVectors,
    isReconstructing,
    reconstructJobStatus,

    // Datum controls
    datumCamera,
    setDatumCamera,
    datumFrame,
    setDatumFrame,

    // Multi-view sequence
    numCalibrationFrames,
    setNumCalibrationFrames,
    sequenceId,
    sequencePoses,
    sequenceStatus,
    sequenceError,
    detect,
    poseLevels,
    setPoseLevel,
    fetchPoseDetection,
    identifyPoseLevel,
  } = calibration;

  // Self-calibration (Step 4)
  const selfCal = useSelfCalibration(cam1, cam2, "stepped_board");

  // ---- Local state ----
  const [fiducialSelectMode, setFiducialSelectMode] = useState(false);
  const [fiducialStepIdx, setFiducialStepIdx] = useState(0);

  // Reconstruct type selector
  const [reconstructTypeName, setReconstructTypeName] = useState<'instantaneous' | 'ensemble'>('instantaneous');

  // Click-to-label mode: {frameIdx, camera} when active, null when idle.
  // Auto-advances cam1 → cam2 within the same pose, then to next unverified pose.
  const [labelTarget, setLabelTarget] = useState<{ frameIdx: number; camera: number } | null>(null);

  // Verification is derived from poseLevels — a pose/camera is "verified"
  // if it has an entry. This persists to config.yaml automatically.
  const isVerified = useCallback((cam: number, frameIdx: number) =>
    (poseLevels?.[cam] || {})[frameIdx] !== undefined,
  [poseLevels]);

  // Track which frame is currently displayed in the viewer
  const [displayedFrame, setDisplayedFrame] = useState<number>(datumFrame);

  // Local debounced input state
  const [dotSpacingInput, setDotSpacingInput] = useState(String(dotSpacingMm));
  const [stepHeightInput, setStepHeightInput] = useState(String(stepHeightMm));
  const [boardThicknessInput, setBoardThicknessInput] = useState(String(boardThicknessMm));
  const [dtInput, setDtInput] = useState(String(dt));
  const [datumFrameInput, setDatumFrameInput] = useState(String(datumFrame));
  const [numFramesInput, setNumFramesInput] = useState(String(numCalibrationFrames));

  // Sync local inputs with hook state
  React.useEffect(() => { setDotSpacingInput(String(dotSpacingMm)); }, [dotSpacingMm]);
  React.useEffect(() => { setStepHeightInput(String(stepHeightMm)); }, [stepHeightMm]);
  React.useEffect(() => { setBoardThicknessInput(String(boardThicknessMm)); }, [boardThicknessMm]);
  React.useEffect(() => { setDtInput(String(dt)); }, [dt]);
  React.useEffect(() => { setDatumFrameInput(String(datumFrame)); }, [datumFrame]);
  React.useEffect(() => { setNumFramesInput(String(numCalibrationFrames)); }, [numCalibrationFrames]);

  // Sync piv_type from config
  useEffect(() => {
    const pivType = config.calibration?.piv_type;
    if (pivType === 'instantaneous' || pivType === 'ensemble') setReconstructTypeName(pivType);
  }, [config.calibration?.piv_type]);

  // Current fiducial step info
  const currentStep = fiducialStepIdx < FIDUCIAL_STEPS.length ? FIDUCIAL_STEPS[fiducialStepIdx] : null;
  const activeFiducialCamera = currentStep
    ? (currentStep.camera === 1 ? cam1 : cam2)
    : cam1;

  // When in fiducial mode, auto-switch to the camera that needs the next fiducial
  React.useEffect(() => {
    if (fiducialSelectMode && currentStep) {
      const targetCam = currentStep.camera === 1 ? cam1 : cam2;
      if (activeCam !== targetCam) {
        setActiveCam(targetCam);
      }
    }
  }, [fiducialSelectMode, fiducialStepIdx, currentStep, cam1, cam2, activeCam, setActiveCam]);

  // Check if all 6 fiducials are set
  const allFiducialsSet = useMemo(() => {
    if (!fiducials) return false;
    const cam1Fids = fiducials[cam1];
    const cam2Fids = fiducials[cam2];
    if (!cam1Fids || !cam2Fids) return false;
    return (
      cam1Fids.origin != null &&
      cam1Fids.plusX != null &&
      cam1Fids.plusY != null &&
      cam2Fids.origin != null &&
      cam2Fids.plusX != null &&
      cam2Fids.plusY != null
    );
  }, [fiducials, cam1, cam2]);

  // Handle point selection (fiducial click) — snaps via backend
  const handlePointSelect = async (pixelX: number, pixelY: number, camera: number, frame: number) => {
    if (!fiducialSelectMode || !currentStep) return;

    const targetCam = currentStep.camera === 1 ? cam1 : cam2;

    try {
      // Snap to nearest blob/ring via backend
      const res = await fetch('/backend/calibrate/stepped_board/snap_fiducial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: targetCam,
          cam1: cam1,
          cam2: cam2,
          frame_idx: 1,
          click_x: pixelX,
          click_y: pixelY,
        }),
      });
      const data = await res.json();
      const sx = data.snapped_x ?? pixelX;
      const sy = data.snapped_y ?? pixelY;
      setFiducial(targetCam, currentStep.point, [sx, sy]);
    } catch {
      // Fallback to raw click if snap fails
      setFiducial(targetCam, currentStep.point, [pixelX, pixelY]);
    }

    // Advance to next step
    const nextIdx = fiducialStepIdx + 1;
    if (nextIdx < FIDUCIAL_STEPS.length) {
      setFiducialStepIdx(nextIdx);
    } else {
      setFiducialSelectMode(false);
      setFiducialStepIdx(0);
    }
  };

  // Handle click-to-label: identifies the level, sets pose_level (which
  // persists to config.yaml), then auto-advances:
  //   cam1 → cam2 on same frame → next unverified frame's cam1 → ...
  const handleLabelClick = async (pixelX: number, pixelY: number) => {
    if (!labelTarget) return;
    const { frameIdx, camera: targetCam } = labelTarget;
    const level = await identifyPoseLevel(frameIdx, targetCam, pixelX, pixelY);
    if (!level) { setLabelTarget(null); return; }

    setPoseLevel(targetCam, frameIdx, level);

    // Auto-advance: other camera on same frame first
    const otherCam = targetCam === cam1 ? cam2 : cam1;
    const pose = sequencePoses.find(p => p.frame_idx === frameIdx);
    const otherOk = targetCam === cam1 ? pose?.cam2?.ok : pose?.cam1?.ok;
    if (otherOk && !isVerified(otherCam, frameIdx)) {
      setLabelTarget({ frameIdx, camera: otherCam });
      setActiveCam(otherCam);
      return;
    }

    // Both cameras done for this frame — find next unverified pose
    const nextPose = sequencePoses.find(p =>
      !p.is_datum && p.cam1?.ok && p.cam2?.ok &&
      p.frame_idx !== frameIdx &&
      (!isVerified(cam1, p.frame_idx) || !isVerified(cam2, p.frame_idx))
    );
    if (nextPose) {
      const nextCam = !isVerified(cam1, nextPose.frame_idx) ? cam1 : cam2;
      setLabelTarget({ frameIdx: nextPose.frame_idx, camera: nextCam });
      setActiveCam(nextCam);
      fetchPoseDetection(nextPose.frame_idx);
      return;
    }

    // All done
    setLabelTarget(null);
  };

  // Handle frame change in the viewer — fetch detection overlay for that frame
  const handleFrameChange = useCallback((frameIdx: number) => {
    setDisplayedFrame(frameIdx);
    if (sequenceId && sequenceStatus === 'ready') {
      fetchPoseDetection(frameIdx);
    }
  }, [sequenceId, sequenceStatus, fetchPoseDetection]);

  // Resolve overlay colors based on the pose_level for the displayed frame.
  // Before labelling: level_A = grey-blue, level_B = grey-red (neutral).
  // After labelling: peak = blue (#508cff), trough = red (#ff7878).
  const overlayPoints = useMemo(() => {
    const raw = getDetectionOverlayPoints(activeCam);
    if (raw.length === 0) return raw;
    // What does the current pose_level say about level_A for this frame?
    const poseLevel = (poseLevels?.[activeCam] || {})[displayedFrame];
    if (!poseLevel) return raw; // not labelled yet — keep default A=blue, B=red
    // poseLevel = 'peak' means level_A is peak → A should be blue, B red (default)
    // poseLevel = 'trough' means level_A is trough → A should be red, B blue (swap)
    if (poseLevel === 'peak') return raw; // already correct
    // Swap: blue→red, red→blue
    return raw.map(pt => ({
      ...pt,
      color: pt.color === 'blue' ? 'red' : pt.color === 'red' ? 'blue' : pt.color,
    }));
  }, [getDetectionOverlayPoints, activeCam, poseLevels, displayedFrame]);

  // Overlay lines — same color swap logic
  const overlayLines = useMemo(() => {
    const raw = getDetectionOverlayLines(activeCam);
    if (raw.length === 0) return raw;
    const poseLevel = (poseLevels?.[activeCam] || {})[displayedFrame];
    if (!poseLevel || poseLevel === 'peak') return raw;
    return raw.map(ln => ({
      ...ln,
      color: ln.color?.includes('80, 140, 255') ? 'rgba(255, 120, 120, 1)'
           : ln.color?.includes('255, 120, 120') ? 'rgba(80, 140, 255, 1)'
           : ln.color,
    }));
  }, [getDetectionOverlayLines, activeCam, poseLevels, displayedFrame]);

  // Fiducial marker points — only shown on the datum frame
  const markerPoints = useMemo((): MarkerPoint[] => {
    if (displayedFrame !== datumFrame) return [];
    return getFiducialMarkers(activeCam);
  }, [getFiducialMarkers, activeCam, displayedFrame, datumFrame]);

  // Helper: format fiducial coordinate for display
  const fmtCoord = (coord: [number, number] | null | undefined): string => {
    if (!coord) return "Not set";
    return `(${coord[0].toFixed(1)}, ${coord[1].toFixed(1)})`;
  };

  // Fiducial status for a given camera
  const renderFiducialStatus = (camId: number) => {
    const fids = fiducials?.[camId];
    return (
      <div className="space-y-1 text-sm">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: FIDUCIAL_COLORS.origin }}
          />
          <span className="text-muted-foreground">Origin:</span>
          <span className={fids?.origin ? "font-medium" : "text-muted-foreground italic"}>
            {fmtCoord(fids?.origin)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: FIDUCIAL_COLORS.plusX }}
          />
          <span className="text-muted-foreground">+X:</span>
          <span className={fids?.plusX ? "font-medium" : "text-muted-foreground italic"}>
            {fmtCoord(fids?.plusX)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: FIDUCIAL_COLORS.plusY }}
          />
          <span className="text-muted-foreground">+Y:</span>
          <span className={fids?.plusY ? "font-medium" : "text-muted-foreground italic"}>
            {fmtCoord(fids?.plusY)}
          </span>
        </div>
      </div>
    );
  };

  // Detection stats badge helper
  const renderDetectionStats = (camId: number) => {
    const stats = detectionStats?.[camId];
    if (!stats) return <span className="text-xs text-muted-foreground italic">No detection data</span>;
    return (
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          {stats.nBlobs} blobs
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          {stats.nLevelA} level A
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
          {stats.nLevelB} level B
        </span>
      </div>
    );
  };

  // Set as active calibration method (Step 2)
  const setAsActiveMethod = async () => {
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calibration: { active: "stepped_board" } }),
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
  const isActive = config.calibration?.active === "stepped_board";

  // Save piv_type when changed (Step 3)
  const handleReconstructTypeChange = async (value: 'instantaneous' | 'ensemble') => {
    setReconstructTypeName(value);
    try {
      const res = await fetch('/backend/update_config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calibration: { piv_type: value } })
      });
      const json = await res.json();
      if (res.ok && json.updated?.calibration) {
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (e) { console.error('Failed to save piv_type:', e); }
  };

  // macOS container format detection (Step 6)
  const isContainerFormat = imageFormat.includes('.set') || imageFormat.includes('.im7');
  const isMacOS = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Stepped Board Stereo Calibration</CardTitle>
          <CardDescription>
            Configure and run stepped board calibration for 3D velocity reconstruction
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
                      <SelectItem key={i} value={String(i)}>{basename(p) || p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Where calibration models are saved.</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Camera 1</Label>
                <Select value={String(cam1)} onValueChange={v => setCam1(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="Select camera 1" /></SelectTrigger>
                  <SelectContent>
                    {cameraOptions.map((c) => (
                      <SelectItem key={c} value={String(c)} disabled={c === cam2}>
                        Camera {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Camera 2</Label>
                <Select value={String(cam2)} onValueChange={v => setCam2(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="Select camera 2" /></SelectTrigger>
                  <SelectContent>
                    {cameraOptions.map((c) => (
                      <SelectItem key={c} value={String(c)} disabled={c === cam1}>
                        Camera {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  type="text"
                  inputMode="numeric"
                  value={numImages}
                  onChange={e => setNumImages(e.target.value)}
                  onBlur={() => {
                    const finalVal = parseInt(numImages) || 1;
                    setNumImages(String(finalVal));
                  }}
                />
              </div>
            </div>

            {/* macOS container format warning (Step 6) */}
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
                    id="stepped-use-camera-subfolders"
                    checked={useCameraSubfolders}
                    onCheckedChange={setUseCameraSubfolders}
                  />
                  <Label htmlFor="stepped-use-camera-subfolders" className="text-sm">
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

            {useCameraSubfolders && (
              <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                <h4 className="text-sm font-medium">Camera Subfolder Configuration</h4>
                <p className="text-xs text-muted-foreground">
                  Camera subfolders are relative to the calibration source path.
                  Example: {calibrationSources[sourcePathIdx] || '/path/to/calibration'}/{cameraSubfolders[0] || `Cam${cam1}`}/
                </p>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Camera Subfolder Names (optional)</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Custom folder names for each camera. Leave empty to use defaults (Cam1, Cam2, ...).
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[cam1, cam2].map((cam, idx) => (
                      <div key={cam}>
                        <label className="text-xs text-muted-foreground">Camera {cam}</label>
                        <Input
                          placeholder={`Cam${cam}`}
                          value={cameraSubfolders[idx] || ''}
                          onChange={e => {
                            const newSubfolders = [...cameraSubfolders];
                            while (newSubfolders.length < 2) {
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

            {validation && (
              <div className="space-y-2">
                <ValidationAlert
                  validation={{
                    valid: validation.valid,
                    checked: !validating,
                    error: validation.error || null,
                  }}
                  customSuccessMessage={
                    validation.valid
                      ? `Found ${validation.matching_count === 'container' ? 'container files' : `${validation.matching_count} matching calibration image pairs`}`
                      : undefined
                  }
                />
                {validation.cam1 && validation.cam2 && (
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span className={validation.cam1.valid ? "text-green-600" : "text-red-500"}>
                      Cam {cam1}: {validation.cam1.found_count === 'container' ? 'container' : `${validation.cam1.found_count} images`}
                      {validation.cam1.error && ` (${validation.cam1.error})`}
                    </span>
                    <span className={validation.cam2.valid ? "text-green-600" : "text-red-500"}>
                      Cam {cam2}: {validation.cam2.found_count === 'container' ? 'container' : `${validation.cam2.found_count} images`}
                      {validation.cam2.error && ` (${validation.cam2.error})`}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Suggested Pattern Button */}
            {validation && !validation.valid && (validation.cam1?.suggested_pattern || validation.cam2?.suggested_pattern) && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">Suggestion:</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImageFormat(validation.cam1?.suggested_pattern || validation.cam2?.suggested_pattern || '')}
                  className="text-blue-600 border-blue-300 hover:bg-blue-50"
                >
                  Use &quot;{validation.cam1?.suggested_pattern || validation.cam2?.suggested_pattern}&quot;
                </Button>
              </div>
            )}

            {/* Suggested Subfolder Button */}
            {validation && !validation.valid && (validation.cam1?.suggested_subfolder || validation.cam2?.suggested_subfolder) && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">Subfolder suggestion:</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setUseCameraSubfolders(true);
                    setCameraSubfolders([
                      validation.cam1?.suggested_subfolder || validation.cam2?.suggested_subfolder || '',
                      validation.cam2?.suggested_subfolder || validation.cam1?.suggested_subfolder || '',
                    ]);
                  }}
                  className="text-blue-600 border-blue-300 hover:bg-blue-50"
                >
                  Use &quot;{validation.cam1?.suggested_subfolder}&quot; / &quot;{validation.cam2?.suggested_subfolder}&quot;
                </Button>
              </div>
            )}
          </div>

          {/* ============================================= */}
          {/* Section 2: Board Parameters                   */}
          {/* ============================================= */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold">Board Parameters</h3>

            <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <Label className="text-sm font-medium">Dot Spacing (mm)</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={dotSpacingInput}
                  onChange={e => setDotSpacingInput(e.target.value)}
                  onBlur={() => setDotSpacingMm(parseFloat(dotSpacingInput) || 10.0)}
                />
                <p className="text-xs text-muted-foreground mt-1">Physical spacing between dots</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Step Height (mm)</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={stepHeightInput}
                  onChange={e => setStepHeightInput(e.target.value)}
                  onBlur={() => setStepHeightMm(parseFloat(stepHeightInput) || 5.0)}
                />
                <p className="text-xs text-muted-foreground mt-1">Height difference between levels</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Board Thickness (mm)</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={boardThicknessInput}
                  onChange={e => setBoardThicknessInput(e.target.value)}
                  onBlur={() => setBoardThicknessMm(parseFloat(boardThicknessInput) || 10.0)}
                />
                <p className="text-xs text-muted-foreground mt-1">Total thickness of the calibration board</p>
              </div>
              <div>
                <Label className="text-sm font-medium">&Delta;t (s)</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={dtInput}
                  onChange={e => setDtInput(e.target.value)}
                  onBlur={() => setDt(parseFloat(dtInput) || 1.0)}
                />
                <p className="text-xs text-muted-foreground mt-1">Time step between frames</p>
              </div>
            </div>

            <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div>
                <Label className="text-sm font-medium">Reference Camera</Label>
                <Select value={String(datumCamera)} onValueChange={v => setDatumCamera(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Camera 1</SelectItem>
                    <SelectItem value="2">Camera 2</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Coordinate system origin</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Datum Frame</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={datumFrameInput}
                  onChange={e => setDatumFrameInput(e.target.value)}
                  onBlur={() => setDatumFrame(parseInt(datumFrameInput) || 1)}
                />
                <p className="text-xs text-muted-foreground mt-1">World origin image (1-based)</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Number of Frames</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={numFramesInput}
                  onChange={e => setNumFramesInput(e.target.value)}
                  onBlur={() => setNumCalibrationFrames(parseInt(numFramesInput) || 1)}
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
              Detects dots on {numCalibrationFrames} frames and runs a joint pinhole fit.
              The datum frame&apos;s fiducial clicks anchor the world frame for stereo composition.
            </p>

            {/* Detect button */}
            <div className="flex items-center gap-3">
              <Button
                onClick={detect}
                disabled={sequenceStatus === 'detecting'}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {sequenceStatus === 'detecting' ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Detecting sequence...
                  </>
                ) : (
                  "Detect sequence"
                )}
              </Button>
              {sequenceStatus === 'ready' && sequenceId && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Sequence ready ({sequencePoses.length} poses)
                </span>
              )}
            </div>

            {sequenceStatus === 'detecting' && (
              <Progress value={detectionProgress} className="w-full" />
            )}

            {sequenceError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{sequenceError}</AlertDescription>
              </Alert>
            )}

            {/* Per-pose peak/trough verification */}
            {sequencePoses.length > 0 && (() => {
              const nonDatum = sequencePoses.filter(p => !p.is_datum && p.cam1?.ok && p.cam2?.ok);
              const v1 = nonDatum.filter(p => isVerified(cam1, p.frame_idx)).length;
              const v2 = nonDatum.filter(p => isVerified(cam2, p.frame_idx)).length;
              const total = nonDatum.length;
              const allDone = v1 === total && v2 === total;
              const firstUnverified = nonDatum.find(p =>
                !isVerified(cam1, p.frame_idx) || !isVerified(cam2, p.frame_idx)
              );
              return (
              <div className="p-3 border rounded space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Peak/trough verification</h4>
                  {allDone ? (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> All poses verified
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Cam {cam1}: {v1}/{total} &middot; Cam {cam2}: {v2}/{total}
                    </span>
                  )}
                </div>

                {/* Start / continue button */}
                {!allDone && !labelTarget && firstUnverified && (
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => {
                      const startCam = !isVerified(cam1, firstUnverified.frame_idx) ? cam1 : cam2;
                      setLabelTarget({ frameIdx: firstUnverified.frame_idx, camera: startCam });
                      setActiveCam(startCam);
                      fetchPoseDetection(firstUnverified.frame_idx);
                    }}
                  >
                    {v1 === 0 && v2 === 0
                      ? `Verify all poses (click ${clickedLevel[cam1] || 'peak'} dots)`
                      : `Continue verification (${total - Math.min(v1, v2)} remaining)`
                    }
                  </Button>
                )}
                {labelTarget && (
                  <div className="flex items-center gap-3">
                    <Alert className="flex-1">
                      <Crosshair className="h-4 w-4" />
                      <AlertDescription className="font-medium">
                        Frame {labelTarget.frameIdx}, Cam {labelTarget.camera}: click a
                        <span className="font-bold text-blue-600 mx-1">{clickedLevel[labelTarget.camera] || 'peak'}</span>
                        dot &mdash; blue = peak, red = trough
                      </AlertDescription>
                    </Alert>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLabelTarget(null)}
                    >
                      Stop
                    </Button>
                  </div>
                )}

                {/* Per-pose grid — each cam cell is clickable to (re)verify */}
                <div className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 items-center">
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">Frame</div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">Cam {cam1}</div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">Cam {cam2}</div>
                  {sequencePoses.map((pose) => {
                    const c1ok = pose.cam1?.ok;
                    const c2ok = pose.cam2?.ok;
                    const c1v = pose.is_datum || isVerified(cam1, pose.frame_idx);
                    const c2v = pose.is_datum || isVerified(cam2, pose.frame_idx);
                    const isActive = labelTarget?.frameIdx === pose.frame_idx;
                    const activeCam1 = isActive && labelTarget?.camera === cam1;
                    const activeCam2 = isActive && labelTarget?.camera === cam2;
                    const c1label = (poseLevels?.[cam1] || {})[pose.frame_idx];
                    const c2label = (poseLevels?.[cam2] || {})[pose.frame_idx];

                    const cellClass = (ok: boolean | undefined, verified: boolean, active: boolean) =>
                      `flex items-center gap-1.5 px-2 py-0.5 rounded ${
                        !ok ? '' :
                        active ? 'bg-blue-50 ring-1 ring-blue-400' :
                        verified ? 'hover:bg-muted cursor-pointer' :
                        'hover:bg-amber-50 cursor-pointer'
                      }`;

                    const dotClass = (ok: boolean | undefined, verified: boolean, active: boolean) =>
                      `inline-block w-2.5 h-2.5 rounded-full ${
                        !ok ? 'bg-gray-300' :
                        active ? 'bg-blue-500 animate-pulse' :
                        verified ? 'bg-green-500' : 'bg-amber-400'
                      }`;

                    const startLabel = (camNum: number, frameIdx: number) => {
                      setLabelTarget({ frameIdx, camera: camNum });
                      setActiveCam(camNum);
                      fetchPoseDetection(frameIdx);
                    };

                    return (
                      <React.Fragment key={`v_${pose.frame_idx}`}>
                        <div className={`text-xs tabular-nums ${
                          pose.is_datum ? 'font-bold text-blue-600' :
                          isActive ? 'font-bold' : ''
                        }`}>
                          {pose.frame_idx}{pose.is_datum ? ' (datum)' : ''}
                        </div>
                        <div
                          className={cellClass(c1ok, c1v, activeCam1)}
                          onClick={() => { if (c1ok && !pose.is_datum) startLabel(cam1, pose.frame_idx); }}
                        >
                          <span className={dotClass(c1ok, c1v, activeCam1)} />
                          <span className={`text-[11px] ${!c1ok ? 'text-muted-foreground italic' : c1v ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {!c1ok ? 'no detection' :
                             pose.is_datum ? clickedLevel[cam1] :
                             c1label ?? 'click to set'}
                          </span>
                        </div>
                        <div
                          className={cellClass(c2ok, c2v, activeCam2)}
                          onClick={() => { if (c2ok && !pose.is_datum) startLabel(cam2, pose.frame_idx); }}
                        >
                          <span className={dotClass(c2ok, c2v, activeCam2)} />
                          <span className={`text-[11px] ${!c2ok ? 'text-muted-foreground italic' : c2v ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {!c2ok ? 'no detection' :
                             pose.is_datum ? clickedLevel[cam2] :
                             c2label ?? 'click to set'}
                          </span>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {/* Detection stats summary per camera */}
            {(detectionStats[cam1] || detectionStats[cam2]) && (
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-3 border rounded space-y-2">
                  <h4 className="text-sm font-medium">Camera {cam1} Detection</h4>
                  {renderDetectionStats(cam1)}
                </div>
                <div className="p-3 border rounded space-y-2">
                  <h4 className="text-sm font-medium">Camera {cam2} Detection</h4>
                  {renderDetectionStats(cam2)}
                </div>
              </div>
            )}

            {/* Two-column fiducial panel */}
            {(detectionStats[cam1] || detectionStats[cam2]) && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
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
                    onClick={() => {
                      resetFiducials();
                      setFiducialStepIdx(0);
                    }}
                    className="flex items-center gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset
                  </Button>
                  {/* Datum face label — sets default for all poses */}
                  <div className="flex items-center gap-4 ml-auto">
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-muted-foreground">Cam {cam1} datum face:</Label>
                      <Select value={clickedLevel[cam1] || 'peak'} onValueChange={v => setClickedLevel(cam1, v)}>
                        <SelectTrigger className="w-[100px] h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="peak">Peak</SelectItem>
                          <SelectItem value="trough">Trough</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-muted-foreground">Cam {cam2} datum face:</Label>
                      <Select value={clickedLevel[cam2] || 'peak'} onValueChange={v => setClickedLevel(cam2, v)}>
                        <SelectTrigger className="w-[100px] h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="peak">Peak</SelectItem>
                          <SelectItem value="trough">Trough</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Fiducial status: Cam1 | Cam2 */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="p-3 border rounded space-y-2">
                    <h4 className="text-sm font-medium">Cam {cam1} Fiducials</h4>
                    {renderFiducialStatus(cam1)}
                  </div>
                  <div className="p-3 border rounded space-y-2">
                    <h4 className="text-sm font-medium">Cam {cam2} Fiducials</h4>
                    {renderFiducialStatus(cam2)}
                  </div>
                </div>

                {/* Active click instruction banner */}
                {fiducialSelectMode && currentStep && (
                  <Alert>
                    <Crosshair className="h-4 w-4" />
                    <AlertDescription className="font-medium">
                      Click {FIDUCIAL_LABELS[currentStep.point].toUpperCase()} on Cam {currentStep.camera === 1 ? cam1 : cam2}
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
          <div className="border-t pt-4 space-y-3">
            {/* Camera toggle buttons */}
            <div className="flex items-center gap-1 bg-muted rounded-md p-1 w-fit">
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

            <CalibrationImageViewer
              key={`stepped-${activeCam}-${sourcePathIdx}`}
              backendUrl="/backend"
              sourcePathIdx={sourcePathIdx}
              camera={activeCam}
              numImages={parseInt(numImages) || 1}
              calibrationType="stepped_board"
              refreshKey={`${validation?.cam1?.found_count}-${validation?.cam2?.found_count}-${validation?.valid}-${validation?.cam1?.error}-${validation?.cam2?.error}`}
              stereoParams={{ cam1, cam2 }}
              pointSelectMode={
                (fiducialSelectMode && activeFiducialCamera === activeCam) ||
                (labelTarget !== null && labelTarget.camera === activeCam)
              }
              onPointSelect={(px, py, cam, frame) => {
                if (labelTarget && labelTarget.camera === activeCam) {
                  handleLabelClick(px, py);
                } else {
                  handlePointSelect(px, py, cam, frame);
                }
              }}
              onFrameChange={handleFrameChange}
              selectedMarkers={markerPoints}
              externalOverlayPoints={overlayPoints}
              externalOverlayLines={overlayLines}
            />
          </div>
          )}

          {/* ============================================= */}
          {/* Section 5: Generate Model                     */}
          {/* ============================================= */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold">Generate Model</h3>

            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={generateModel}
                disabled={
                  !allFiducialsSet
                  || generating
                  || sequenceStatus !== 'ready'
                  || sequencePoses.some(p =>
                    !p.is_datum && p.cam1?.ok && p.cam2?.ok &&
                    (!isVerified(cam1, p.frame_idx) || !isVerified(cam2, p.frame_idx))
                  )
                }
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate Model"
                )}
              </Button>

              <Button
                onClick={loadModel}
                disabled={modelLoading}
                variant="outline"
              >
                {modelLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load Saved'
                )}
              </Button>

              {!allFiducialsSet && !hasModel && (
                <span className="text-xs text-muted-foreground">
                  Set all 6 fiducials (Origin, +X, +Y on each camera) to enable generation
                </span>
              )}

              {/* Self-Calibration Warning (Step 4) */}
              <SelfCalibrationWarning hasModel={hasModel} hasSelfCal={selfCal.hasSelfCal} />

              {/* Set as Active Method (Step 2) */}
              <Button
                onClick={setAsActiveMethod}
                disabled={isActive}
                className={isActive ? "bg-green-600 hover:bg-green-600 text-white" : ""}
                variant={isActive ? "default" : "outline"}
              >
                {isActive ? (<><CheckCircle2 className="h-4 w-4 mr-1" />Active</>) : 'Set as Active'}
              </Button>

              {/* Reconstruct 3D Vectors with type selector (Step 3) */}
              <div className="flex gap-2 items-center">
                <Select value={reconstructTypeName} onValueChange={handleReconstructTypeChange}>
                  <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instantaneous">Instantaneous</SelectItem>
                    <SelectItem value="ensemble">Ensemble</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => reconstructVectors(reconstructTypeName)}
                  disabled={!hasModel || isReconstructing}
                  variant="outline"
                  className="border-green-500 text-green-700 hover:bg-green-50"
                  title={!hasModel ? "Generate a model first" : "Reconstruct 3D velocity vectors"}
                >
                  {isReconstructing ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Reconstructing...</>) : 'Reconstruct 3D Vectors'}
                </Button>
              </div>
            </div>

            {generating && (
              <Progress value={generationProgress} className="w-full" />
            )}

            {modelLoadError && (
              <div className="text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {modelLoadError}
              </div>
            )}

            {/* Reconstruction job status (Step 3) */}
            {reconstructJobStatus && (reconstructJobStatus.status === 'running' || reconstructJobStatus.status === 'starting') && (
              <div className="p-3 border rounded bg-blue-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <strong>3D Reconstruction:</strong>
                  <span className="capitalize">{reconstructJobStatus.status}</span>
                </div>
                <Progress value={reconstructJobStatus.progress} className="w-full" />
                <div className="text-xs text-muted-foreground mt-1">
                  Frames: {reconstructJobStatus.processed_frames}/{reconstructJobStatus.total_frames}
                  {reconstructJobStatus.successful_frames > 0 && (
                    <span> | Successful: {reconstructJobStatus.successful_frames}</span>
                  )}
                </div>
              </div>
            )}
            {reconstructJobStatus?.status === 'completed' && (
              <div className="p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                3D reconstruction completed! ({reconstructJobStatus.successful_frames}/{reconstructJobStatus.total_frames} frames)
              </div>
            )}
            {reconstructJobStatus?.status === 'failed' && (
              <div className="p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Reconstruction failed: {reconstructJobStatus.error || 'Unknown error'}
              </div>
            )}

            {/* Model generation error */}
            {modelResults?.status === 'failed' && (
              <div className="p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Model generation failed: {(modelResults as any).error || 'Unknown error'}
              </div>
            )}

            {/* Results card */}
            {modelResults && modelResults.status !== 'failed' && (
              <Card className="border-green-200 bg-green-50/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Pinhole Model Results
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Per-camera results */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="p-3 border rounded bg-white">
                      <h4 className="text-sm font-semibold mb-2">Camera {cam1}</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">RMS Error:</span>
                          <span className="ml-2 font-medium">
                            {(modelResults as any).cam1_rms?.toFixed(4)} px
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Focal Length:</span>
                          <span className="ml-2 font-medium">
                            {(modelResults as any).cam1_details?.focal_length?.[0]?.toFixed(1)} / {(modelResults as any).cam1_details?.focal_length?.[1]?.toFixed(1)} px
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Principal Point:</span>
                          <span className="ml-2 font-medium">
                            ({(modelResults as any).cam1_details?.principal_point?.[0]?.toFixed(1)}, {(modelResults as any).cam1_details?.principal_point?.[1]?.toFixed(1)})
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 border rounded bg-white">
                      <h4 className="text-sm font-semibold mb-2">Camera {cam2}</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">RMS Error:</span>
                          <span className="ml-2 font-medium">
                            {(modelResults as any).cam2_rms?.toFixed(4)} px
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Focal Length:</span>
                          <span className="ml-2 font-medium">
                            {(modelResults as any).cam2_details?.focal_length?.[0]?.toFixed(1)} / {(modelResults as any).cam2_details?.focal_length?.[1]?.toFixed(1)} px
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Principal Point:</span>
                          <span className="ml-2 font-medium">
                            ({(modelResults as any).cam2_details?.principal_point?.[0]?.toFixed(1)}, {(modelResults as any).cam2_details?.principal_point?.[1]?.toFixed(1)})
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Stereo geometry results */}
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="p-3 bg-muted rounded">
                      <div className="text-xs text-muted-foreground">Stereo RMS Error</div>
                      <div className="text-lg font-semibold">
                        {(modelResults as any).stereo_rms != null
                          ? `${(modelResults as any).stereo_rms.toFixed(4)} px`
                          : 'N/A (derived)'}
                      </div>
                    </div>
                    <div className="p-3 bg-muted rounded">
                      <div className="text-xs text-muted-foreground">Baseline Distance</div>
                      <div className="text-lg font-semibold">
                        {(modelResults as any).baseline_mm?.toFixed(2)} mm
                      </div>
                    </div>
                    <div className="p-3 bg-muted rounded">
                      <div className="text-xs text-muted-foreground">Relative Angle</div>
                      <div className="text-lg font-semibold">
                        {(modelResults as any).relative_angle_deg?.toFixed(2)}&deg;
                      </div>
                    </div>
                  </div>

                  {/* Auto-detected stereo geometry */}
                  {(modelResults as any).stereo_config_resolved && (
                    <div className="p-3 bg-muted rounded">
                      <div className="text-xs text-muted-foreground">Detected Stereo Geometry</div>
                      <div className="text-lg font-semibold capitalize">
                        {String((modelResults as any).stereo_config_resolved).replace('_', ' ')}
                      </div>
                      {(modelResults as any).stereo_config_rms_same_side != null
                        && (modelResults as any).stereo_config_rms_transmission != null && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Auto-picked by RMS: same-side = {(modelResults as any).stereo_config_rms_same_side.toFixed(3)} px,
                          {' '}transmission = {(modelResults as any).stereo_config_rms_transmission.toFixed(3)} px
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ============================================= */}
      {/* Section 6: Self-Calibration                   */}
      {/* ============================================= */}
      <SelfCalibrationSection
        cam1={cam1}
        cam2={cam2}
        method="stepped_board"
        hasModel={hasModel}
      />
    </div>
  );
};
