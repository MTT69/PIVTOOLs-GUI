"use client";
import React, { useCallback, useMemo, useRef, useState } from "react";
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
  useStereoSteppedCalibration,
  FiducialSet,
} from "@/hooks/useStereoSteppedCalibration";
import { ValidationAlert } from "@/components/setup/ValidationAlert";
import { CalibrationFigureGallery } from "@/components/setup/CalibrationFigureGallery";
import CalibrationImageViewer from "@/components/viewer/CalibrationImageViewer";
import { MarkerPoint } from "@/components/viewer/zoomableCanvas";
import {
  GCInlineControls,
  GlobalFrameSummary,
  useGlobalCoordinates,
  getGlobalCoordMarkers,
  getGlobalCoordViewerTarget,
  handleGlobalCoordPointSelect,
} from "@/components/setup/GlobalCoordinateSetup";

interface StereoSteppedCalibrationProps {
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

// Positional step list: `slot` 1 = first camera of the pair, 2 = second. Mapped
// to the actual cam1/cam2 values at click time so the viewer auto-switches.
const FIDUCIAL_STEPS: { slot: 1 | 2; point: FiducialName }[] = [
  { slot: 1, point: "origin" },
  { slot: 1, point: "x_axis" },
  { slot: 1, point: "y_axis" },
  { slot: 2, point: "origin" },
  { slot: 2, point: "x_axis" },
  { slot: 2, point: "y_axis" },
];

export const StereoSteppedCalibration: React.FC<StereoSteppedCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
}) => {
  const calibration = useStereoSteppedCalibration(cameraOptions, sourcePaths);

  const {
    // Source + pair selection
    sourcePathIdx,
    setSourcePathIdx,
    cam1,
    setCam1,
    cam2,
    setCam2,
    activeCam,
    setActiveCam,

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

    // Stereo geometry classification
    stereoConfig,
    setStereoConfig,
    modelType,
    setModelType,

    // Validation
    validation,
    validating,

    // Sequence state
    sequenceId,
    sequenceStatus,
    sequencePoses,
    sequenceError,
    detectionProgress,

    // Per-camera fiducials + levels
    fiducials,
    clickedLevel,
    setClickedLevel,
    poseLevels,
    setPoseLevel,

    // Stereo fit + model
    fitJobStatus,
    stereoModel,
    modelLoading,
    modelLoadError,
    isGenerating,

    // Reconstruct
    reconstructJobStatus,
    isReconstructing,

    // Actions
    detect,
    snapFiducial,
    generateModel,
    loadModel,
    reconstructVectors,
    fetchPoseDetection,
    identifyPoseLevel,

    // Overlay helpers
    getDetectionOverlayPoints,
    getDetectionOverlayLines,
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
  const [labelTarget, setLabelTarget] = useState<{ frameIdx: number; camera: number } | null>(null);
  const [displayedFrame, setDisplayedFrame] = useState<number>(datumFrame);

  // Off by default: generate is gated on every usable pose being verified. Turning this
  // on deliberately labels unverified poses with the datum face (the old behaviour).
  const [assumeDatumForUnverified, setAssumeDatumForUnverified] = useState(false);

  // In-flight latches for the async click handlers (snap / pose identify): a ref blocks a
  // re-entrant click that would otherwise act on this render's stale step/target.
  const snapInFlight = useRef(false);
  const labelInFlight = useRef(false);

  // A pose is verified for a camera once its peak/trough label is set.
  const isVerified = useCallback((cam: number, frameIdx: number) =>
    (poseLevels?.[cam] || {})[frameIdx] !== undefined,
  [poseLevels]);

  // Every usable (ok, non-datum) pose has a label. Failed detections need none (the
  // calibrator skips them); mirrors the verify UI's count.
  const allVerifiedForCam = useCallback((cam: number) => {
    const poses = sequencePoses[cam] ?? [];
    return poses.filter(p => !p.is_datum && p.ok).every(p => isVerified(cam, p.frame_idx));
  }, [sequencePoses, isVerified]);

  React.useEffect(() => { setDotSpacingInput(String(dotSpacingMm)); }, [dotSpacingMm]);
  React.useEffect(() => { setStepHeightInput(String(stepHeightMm)); }, [stepHeightMm]);
  React.useEffect(() => { setBoardThicknessInput(String(boardThicknessMm)); }, [boardThicknessMm]);
  React.useEffect(() => { setDtInput(String(dt)); }, [dt]);
  React.useEffect(() => { setDatumFrameInput(String(datumFrame)); }, [datumFrame]);
  React.useEffect(() => { setNumFramesInput(String(numCalibrationFrames)); }, [numCalibrationFrames]);

  // Auto-switch the viewer to the camera of the current fiducial step.
  React.useEffect(() => {
    if (!fiducialSelectMode || fiducialStepIdx >= FIDUCIAL_STEPS.length) return;
    const stepCam = FIDUCIAL_STEPS[fiducialStepIdx].slot === 1 ? cam1 : cam2;
    if (activeCam !== stepCam) setActiveCam(stepCam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiducialSelectMode, fiducialStepIdx, cam1, cam2]);

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

  // ---- Active-camera slices ----
  const activeFiducials: FiducialSet = fiducials[activeCam] ?? { origin: null, x_axis: null, y_axis: null };
  const activePoses = sequencePoses[activeCam] ?? null;

  const hasAllFiducials = useCallback((cam: number) => {
    const f = fiducials[cam];
    return Boolean(f?.origin && f?.x_axis && f?.y_axis);
  }, [fiducials]);

  const hasLevel = useCallback((cam: number) => {
    const l = clickedLevel[cam];
    return l === 'peak' || l === 'trough';
  }, [clickedLevel]);

  const canGenerate = useMemo(() => {
    return (
      sequenceStatus === 'ready' &&
      sequenceId !== null &&
      hasAllFiducials(cam1) && hasAllFiducials(cam2) &&
      hasLevel(cam1) && hasLevel(cam2) &&
      (assumeDatumForUnverified || (allVerifiedForCam(cam1) && allVerifiedForCam(cam2))) &&
      !isGenerating
    );
  }, [sequenceStatus, sequenceId, hasAllFiducials, hasLevel, cam1, cam2,
      assumeDatumForUnverified, allVerifiedForCam, isGenerating]);

  const hasModel = stereoModel !== null;

  // ---- Fiducial click handling ----
  const currentStep = fiducialStepIdx < FIDUCIAL_STEPS.length ? FIDUCIAL_STEPS[fiducialStepIdx] : null;
  const currentStepCam = currentStep ? (currentStep.slot === 1 ? cam1 : cam2) : null;

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
    if (!fiducialSelectMode || !currentStep || currentStepCam === null) return;
    // Refuse a re-entrant click while a snap is pending. Worse than mono: a stale click at
    // the slot-1->slot-2 boundary could snap cam2's pixels against cam1's board, cross-
    // contaminating the world frame. Pin the target cam/point BEFORE the await so a camera
    // switch mid-snap can't redirect this result.
    if (snapInFlight.current) return;
    snapInFlight.current = true;
    const targetCam = currentStepCam;
    const targetWhich = currentStep.point;
    try {
      const snapped = await snapFiducial(targetCam, targetWhich, pixelX, pixelY);
      if (!snapped) return;  // snap failed (error surfaced by the hook): keep this step, retry
      const nextIdx = fiducialStepIdx + 1;
      if (nextIdx < FIDUCIAL_STEPS.length) {
        setFiducialStepIdx(nextIdx);
      } else {
        setFiducialSelectMode(false);
        setFiducialStepIdx(0);
      }
    } finally {
      snapInFlight.current = false;
    }
  }, [gcIsSelecting, gc, fiducialSelectMode, currentStep, currentStepCam, snapFiducial, fiducialStepIdx]);

  // Re-clicking overwrites a fiducial, so a "reset" only needs to restart the step
  // sequence; the existing clicks remain until the next click replaces them.
  const resetFiducials = useCallback(() => {
    setFiducialSelectMode(false);
    setFiducialStepIdx(0);
  }, []);

  // ---- Fiducial markers for overlay (active camera, datum frame only) ----
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
        gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : activeCam,
        1,
      );
      return [...markerPoints, ...(gcMarkers ?? [])];
    }
    return markerPoints;
  }, [gcIsSelecting, gc, gcViewerTarget, activeCam, markerPoints]);

  // ---- Detection overlay for the active camera (pose-level-aware) ----
  const overlayPoints = useMemo(() => {
    const raw = getDetectionOverlayPoints(activeCam);
    if (raw.length === 0) return raw;
    const poseLevel = (poseLevels?.[activeCam] || {})[displayedFrame];
    if (!poseLevel || poseLevel === 'peak') return raw;
    return raw.map(pt => ({
      ...pt,
      color: pt.color === 'blue' ? 'red' : pt.color === 'red' ? 'blue' : pt.color,
    }));
  }, [getDetectionOverlayPoints, activeCam, poseLevels, displayedFrame]);

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

  // Handle frame change — fetch detection overlay for that frame on the active cam.
  const handleFrameChange = useCallback((frameIdx: number) => {
    setDisplayedFrame(frameIdx);
    if (sequenceId && sequenceStatus === 'ready') {
      fetchPoseDetection(activeCam, frameIdx);
    }
  }, [activeCam, sequenceId, sequenceStatus, fetchPoseDetection]);

  // ---- Stereo auto-advance: find the next unverified (frame, camera) slot ----
  const findNextUnverified = useCallback((): { frameIdx: number; camera: number } | null => {
    const spine = sequencePoses[cam1] ?? [];
    const cam2ByFrame = new Map<number, { ok?: boolean; is_datum: boolean }>();
    for (const p of sequencePoses[cam2] ?? []) cam2ByFrame.set(p.frame_idx, p);
    for (const p of spine) {
      if (p.is_datum) continue;
      if (p.ok && !isVerified(cam1, p.frame_idx)) return { frameIdx: p.frame_idx, camera: cam1 };
      const o = cam2ByFrame.get(p.frame_idx);
      if (o?.ok && !isVerified(cam2, p.frame_idx)) return { frameIdx: p.frame_idx, camera: cam2 };
    }
    return null;
  }, [sequencePoses, cam1, cam2, isVerified]);

  // Handle click-to-label: identify level, set pose_level, then auto-advance to the
  // other camera on the same frame, else the next unverified pose.
  const handleLabelClick = useCallback(async (pixelX: number, pixelY: number) => {
    if (!labelTarget) return;
    // Re-entrancy guard: a double-click would identify the same frame twice and double-
    // advance the cursor (skipping a pose, or desyncing activeCam/labelTarget mid-switch).
    if (labelInFlight.current) return;
    labelInFlight.current = true;
    const { frameIdx, camera } = labelTarget;
    try {
      const level = await identifyPoseLevel(camera, frameIdx, pixelX, pixelY);
      if (!level) { setLabelTarget(null); return; }

      setPoseLevel(camera, frameIdx, level);

      // Other camera, same frame, if it detected and is still unverified.
      const otherCam = camera === cam1 ? cam2 : cam1;
      const otherPose = (sequencePoses[otherCam] ?? []).find(p => p.frame_idx === frameIdx);
      if (otherPose?.ok && !otherPose.is_datum && !isVerified(otherCam, frameIdx)) {
        setActiveCam(otherCam);
        setLabelTarget({ frameIdx, camera: otherCam });
        fetchPoseDetection(otherCam, frameIdx);
        return;
      }

      const next = findNextUnverified();
      if (next && !(next.frameIdx === frameIdx && next.camera === camera)) {
        setActiveCam(next.camera);
        setLabelTarget(next);
        fetchPoseDetection(next.camera, next.frameIdx);
        return;
      }

      setLabelTarget(null);
    } finally {
      labelInFlight.current = false;
    }
  }, [labelTarget, cam1, cam2, identifyPoseLevel, setPoseLevel, sequencePoses, isVerified, fetchPoseDetection, findNextUnverified, setActiveCam]);

  // ---- Verification roll-up across both cameras ----
  const verification = useMemo(() => {
    let total = 0;
    let verified = 0;
    for (const cam of [cam1, cam2]) {
      for (const p of sequencePoses[cam] ?? []) {
        if (p.is_datum || !p.ok) continue;
        total += 1;
        if (isVerified(cam, p.frame_idx)) verified += 1;
      }
    }
    return { total, verified, allDone: total > 0 && verified === total };
  }, [sequencePoses, cam1, cam2, isVerified]);

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
        body: JSON.stringify({ calibration: { active: "stereo_stepped" } }),
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

  const isActive = config.calibration?.active === "stereo_stepped";

  const viewerCamera = gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : activeCam;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Stereo Stepped Board (Pinhole)</CardTitle>
          <CardDescription>
            Two-camera stepped calibration. One detected sequence feeds both cameras; the
            per-camera fiducial clicks + level set each camera&apos;s world frame and the
            same-side / transmission geometry.
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
                <Label className="text-sm font-medium">Camera 1 (world reference)</Label>
                <Select value={String(cam1)} onValueChange={v => setCam1(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cameraOptions.map(c => (
                      <SelectItem key={c} value={String(c)}>Camera {c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Anchors the shared world frame.</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Camera 2</Label>
                <Select value={String(cam2)} onValueChange={v => setCam2(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cameraOptions.filter(c => c !== cam1).map(c => (
                      <SelectItem key={c} value={String(c)}>Camera {c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Resolved relative to Camera 1.</p>
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

            {(imageType === "standard" || imageType === "lavision_im7") && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="stereo-stepped-use-camera-subfolders"
                    checked={useCameraSubfolders}
                    onCheckedChange={setUseCameraSubfolders}
                  />
                  <Label htmlFor="stereo-stepped-use-camera-subfolders" className="text-sm">
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
                  error: validation.cam1?.error || validation.cam2?.error || null,
                }}
                customSuccessMessage={
                  validation.valid
                    ? `Both cameras validated (Cam ${cam1}, Cam ${cam2})`
                    : undefined
                }
              />
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
                  onBlur={() => setDotSpacingMm(parseFloat(dotSpacingInput) || 15.0)}
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
                <p className="text-xs text-muted-foreground mt-1">World origin image (1-based, both cameras)</p>
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
              <div>
                <Label className="text-sm font-medium">Stereo Geometry</Label>
                <Select value={stereoConfig} onValueChange={v => setStereoConfig(v as 'auto' | 'same_side' | 'transmission')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (from clicks)</SelectItem>
                    <SelectItem value="same_side">Same side</SelectItem>
                    <SelectItem value="transmission">Transmission</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Auto derives it from the two clicked frames</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Model Type</Label>
                <Select value={modelType} onValueChange={(v) => setModelType(v as 'pinhole' | 'polynomial3d')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pinhole">Pinhole (multi-view)</SelectItem>
                    <SelectItem value="polynomial3d">Polynomial 3D (single datum view)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {modelType === 'polynomial3d'
                    ? 'DaVis poly: per-camera, no baseline/angle'
                    : 'OpenCV pinhole, composed stereo pose'}
                </p>
              </div>
            </div>
          </div>

          {/* ============================================= */}
          {/* Section 3: Detection + Fiducials              */}
          {/* ============================================= */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold">Detection + Fiducials</h3>

            <p className="text-xs text-muted-foreground">
              Detects dots on {numCalibrationFrames} frames for BOTH cameras and runs a joint
              stereo pinhole fit using both Z levels. Each camera&apos;s datum fiducial clicks
              anchor its world frame.
            </p>

            {/* Detect button */}
            <div className="flex items-center gap-3">
              <Button
                onClick={() => detect()}
                disabled={sequenceStatus === 'detecting' || !validation?.valid}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {sequenceStatus === 'detecting' ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Detecting sequence...
                  </>
                ) : (
                  `Detect sequence (Cam ${cam1} + Cam ${cam2})`
                )}
              </Button>
              {sequenceStatus === 'ready' && sequenceId && activePoses && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Sequence ready ({activePoses.length} poses / camera)
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

            {/* Per-pose peak/trough verification (both cameras) */}
            {sequenceStatus === 'ready' && (sequencePoses[cam1]?.length ?? 0) > 0 && (() => {
              const spine = sequencePoses[cam1] ?? [];
              const cam2ByFrame = new Map<number, { ok?: boolean; is_datum: boolean }>();
              for (const p of sequencePoses[cam2] ?? []) cam2ByFrame.set(p.frame_idx, p);
              const firstUnverified = findNextUnverified();
              return (
              <div className="p-3 border rounded space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">
                    Peak/trough verification (Cam {cam1} + Cam {cam2})
                  </h4>
                  {verification.allDone ? (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> All verified
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {verification.verified}/{verification.total} verified
                    </span>
                  )}
                </div>

                {!verification.allDone && !labelTarget && firstUnverified && (
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => {
                      setActiveCam(firstUnverified.camera);
                      setLabelTarget(firstUnverified);
                      fetchPoseDetection(firstUnverified.camera, firstUnverified.frameIdx);
                    }}
                  >
                    {verification.verified === 0
                      ? 'Verify all poses (click the clicked-face dots)'
                      : `Continue verification (${verification.total - verification.verified} remaining)`
                    }
                  </Button>
                )}
                {labelTarget && (
                  <div className="flex items-center gap-3">
                    <Alert className="flex-1">
                      <Crosshair className="h-4 w-4" />
                      <AlertDescription className="font-medium">
                        Cam {labelTarget.camera}, frame {labelTarget.frameIdx}: click a
                        <span className="font-bold text-blue-600 mx-1">{clickedLevel[labelTarget.camera] || 'peak'}</span>
                        dot &mdash; blue = peak, red = trough
                      </AlertDescription>
                    </Alert>
                    <Button variant="outline" size="sm" onClick={() => setLabelTarget(null)}>
                      Stop
                    </Button>
                  </div>
                )}

                {/* Per-pose grid — one row per frame, a clickable cell for each camera */}
                <div className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 items-center max-w-md">
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">Frame</div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">Cam {cam1}</div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">Cam {cam2}</div>
                  {spine.map((pose) => {
                    const frameIdx = pose.frame_idx;
                    const isDatum = pose.is_datum;
                    const cells: { cam: number; pose?: { ok?: boolean; is_datum: boolean } }[] = [
                      { cam: cam1, pose },
                      { cam: cam2, pose: cam2ByFrame.get(frameIdx) },
                    ];
                    return (
                      <React.Fragment key={`v_${frameIdx}`}>
                        <div className={`text-xs tabular-nums ${isDatum ? 'font-bold text-blue-600' : ''}`}>
                          {frameIdx}{isDatum ? ' (datum)' : ''}
                        </div>
                        {cells.map(({ cam, pose: cp }) => {
                          const ok = cp?.ok === true;
                          const v = isDatum || isVerified(cam, frameIdx);
                          const isLabeling = labelTarget?.frameIdx === frameIdx && labelTarget?.camera === cam;
                          const label = (poseLevels?.[cam] || {})[frameIdx];
                          return (
                            <div
                              key={`v_${frameIdx}_${cam}`}
                              className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${
                                !ok ? '' :
                                isLabeling ? 'bg-blue-50 ring-1 ring-blue-400' :
                                isDatum ? '' :
                                v ? 'hover:bg-muted cursor-pointer' :
                                'hover:bg-amber-50 cursor-pointer'
                              }`}
                              onClick={() => {
                                if (ok && !isDatum) {
                                  setActiveCam(cam);
                                  setLabelTarget({ frameIdx, camera: cam });
                                  fetchPoseDetection(cam, frameIdx);
                                }
                              }}
                            >
                              <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                                !ok ? 'bg-gray-300' :
                                isLabeling ? 'bg-blue-500 animate-pulse' :
                                v ? 'bg-green-500' : 'bg-amber-400'
                              }`} />
                              <span className={`text-[11px] ${!ok ? 'text-muted-foreground italic' : v ? 'text-foreground' : 'text-muted-foreground'}`}>
                                {!ok ? 'no detection' :
                                 isDatum ? (clickedLevel[cam] || 'peak') :
                                 label ?? 'click to set'}
                              </span>
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {/* Fiducial panel */}
            {sequenceStatus === 'ready' && (
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
                      Select Fiducials (6 clicks)
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
                    onClick={resetFiducials}
                    className="flex items-center gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset Step
                  </Button>

                  {/* Per-camera clicked-face selectors */}
                  <div className="flex items-center gap-2 ml-auto">
                    <Label className="text-xs text-muted-foreground">Cam {cam1} face:</Label>
                    <Select
                      value={clickedLevel[cam1] ?? ''}
                      onValueChange={v => setClickedLevel(cam1, v as 'peak' | 'trough')}
                    >
                      <SelectTrigger className="w-[110px] h-8 text-xs">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="peak">Peak</SelectItem>
                        <SelectItem value="trough">Trough</SelectItem>
                      </SelectContent>
                    </Select>
                    <Label className="text-xs text-muted-foreground">Cam {cam2} face:</Label>
                    <Select
                      value={clickedLevel[cam2] ?? ''}
                      onValueChange={v => setClickedLevel(cam2, v as 'peak' | 'trough')}
                    >
                      <SelectTrigger className="w-[110px] h-8 text-xs">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="peak">Peak</SelectItem>
                        <SelectItem value="trough">Trough</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  {[cam1, cam2].map((cam) => {
                    const f = fiducials[cam] ?? { origin: null, x_axis: null, y_axis: null };
                    return (
                      <div key={`fid_${cam}`} className="p-3 border rounded space-y-2">
                        <h4 className="text-sm font-medium">Cam {cam} Fiducials</h4>
                        <div className="space-y-1 text-sm">
                          {(["origin", "x_axis", "y_axis"] as FiducialName[]).map((name) => (
                            <div key={name} className="flex items-center gap-2">
                              <span
                                className="inline-block w-3 h-3 rounded-full"
                                style={{ backgroundColor: FIDUCIAL_COLORS[name] }}
                              />
                              <span className="text-muted-foreground">{FIDUCIAL_LABELS[name]}:</span>
                              <span className={f[name] ? 'font-medium' : 'text-muted-foreground italic'}>
                                {fmtCoord(f[name])}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {fiducialSelectMode && currentStep && currentStepCam !== null && (
                  <Alert>
                    <Crosshair className="h-4 w-4" />
                    <AlertDescription className="font-medium">
                      Click {FIDUCIAL_LABELS[currentStep.point].toUpperCase()} on Cam {currentStepCam}
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
            <div className="border-t pt-4 space-y-2">
              {/* Active-camera toggle */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Viewing:</Label>
                {[cam1, cam2].map((cam) => (
                  <Button
                    key={`view_${cam}`}
                    size="sm"
                    variant={viewerCamera === cam ? 'default' : 'outline'}
                    onClick={() => setActiveCam(cam)}
                    className={viewerCamera === cam ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                  >
                    Camera {cam}
                  </Button>
                ))}
              </div>
              <CalibrationImageViewer
                key={`stereo-stepped-${viewerCamera}-${sourcePathIdx}`}
                backendUrl="/backend"
                sourcePathIdx={sourcePathIdx}
                camera={viewerCamera}
                numImages={parseInt(numImages) || 10}
                calibrationType="stereo_dotboard"
                refreshKey={`${validation?.cam1?.camera_path}-${validation?.cam2?.camera_path}-${validation?.valid}`}
                stereoParams={{ cam1, cam2 }}
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
                    : (fiducialSelectMode || labelTarget ? (labelTarget?.frameIdx ?? datumFrame) : undefined)
                }
                externalOverlayPoints={overlayPoints}
                externalOverlayLines={overlayLines}
                detectionLoading={modelLoading}
                settingsBarExtras={
                  <GCInlineControls
                    gc={gc}
                    currentCamera={viewerCamera}
                    cameraOptions={cameraOptions}
                    onCameraChange={setActiveCam}
                  />
                }
              />
            </div>
          )}

          {/* ============================================= */}
          {/* Section 5: Generate Model                     */}
          {/* ============================================= */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold">Generate Stereo Model</h3>

            <div className="flex items-center gap-2">
              <Switch
                id="stereo-stepped-assume-datum-unverified"
                checked={assumeDatumForUnverified}
                onCheckedChange={setAssumeDatumForUnverified}
              />
              <Label htmlFor="stereo-stepped-assume-datum-unverified" className="text-sm">
                Assume datum face for unverified poses
              </Label>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => generateModel(assumeDatumForUnverified)}
                disabled={!canGenerate}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                title={
                  canGenerate
                    ? 'Fit the stereo pinhole model for both cameras'
                    : 'Need sequence + all 6 fiducials + a clicked level + every pose verified '
                      + 'for each camera (or enable "Assume datum face for unverified poses")'
                }
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating…
                  </>
                ) : (
                  'Generate Stereo Model'
                )}
              </Button>

              <Button
                onClick={() => loadModel()}
                disabled={modelLoading}
                variant="outline"
              >
                {modelLoading ? (
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

              {/* Reconstruct 3C Vectors */}
              <div className="flex items-center gap-1">
                <Button
                  onClick={() => reconstructVectors(vectorTypeName)}
                  disabled={!hasModel || isReconstructing}
                  className="bg-green-600 hover:bg-green-700 text-white rounded-r-none"
                  title={!hasModel ? "Generate or load a stereo model first" : "Reconstruct 3C vectors for the pair"}
                >
                  {isReconstructing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Reconstructing…
                    </>
                  ) : (
                    'Reconstruct 3D Vectors'
                  )}
                </Button>
                <Select value={vectorTypeName} onValueChange={handleVectorTypeChange} disabled={isReconstructing}>
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

            {isGenerating && (
              <Progress value={fitJobStatus?.progress ?? 0} className="w-full" />
            )}

            {fitJobStatus?.status === 'failed' && (
              <div className="p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Stereo fit failed: {fitJobStatus?.error || 'Unknown error'}
              </div>
            )}

            {modelLoadError && (
              <div className="text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {modelLoadError}
              </div>
            )}

            {/* Reconstruct progress + results */}
            {reconstructJobStatus && (reconstructJobStatus.status === 'running' || reconstructJobStatus.status === 'starting') && (
              <div className="p-3 border rounded bg-green-50">
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                  <strong>3C Reconstruction:</strong>
                  <span className="capitalize">{reconstructJobStatus.status}</span>
                </div>
                {reconstructJobStatus.total_frames != null && (
                  <div className="text-xs text-muted-foreground">
                    Frames: {reconstructJobStatus.processed_frames ?? 0}/{reconstructJobStatus.total_frames}
                  </div>
                )}
                <Progress value={reconstructJobStatus.progress ?? 0} className="w-full mt-2" />
              </div>
            )}

            {reconstructJobStatus?.status === 'completed' && (
              <div className="p-3 border rounded bg-green-50 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                3C reconstruction completed
                {reconstructJobStatus.processed_frames != null && ` (${reconstructJobStatus.processed_frames} frames)`}.
              </div>
            )}

            {reconstructJobStatus?.status === 'failed' && (
              <div className="p-3 border rounded bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Reconstruction error: {reconstructJobStatus.error || 'Unknown error'}
              </div>
            )}

            <GlobalFrameSummary
              gc={gc} cameraOptions={cameraOptions} board="stepped" sourcePathIdx={sourcePathIdx} />
          </div>
        </CardContent>
      </Card>

      {/* ============================================= */}
      {/* Section 6: Stereo Model Result                */}
      {/* ============================================= */}
      {hasModel && stereoModel && (
        <Card>
          <CardHeader>
            <CardTitle>Stereo Model Results</CardTitle>
            <CardDescription>
              {stereoModel.model_type === 'polynomial3d'
                ? `Stereo 3D polynomial model (single datum view) for Cameras ${cam1} & ${cam2}`
                : `Stereo pinhole model for Cameras ${cam1} & ${cam2}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Stereo geometry roll-up */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mb-4">
              <div>
                <span className="text-muted-foreground">RMS Cam {cam1}:</span>
                <span className="ml-2 font-medium">{stereoModel.rms_cam1?.toFixed(4) ?? '—'} px</span>
              </div>
              <div>
                <span className="text-muted-foreground">RMS Cam {cam2}:</span>
                <span className="ml-2 font-medium">{stereoModel.rms_cam2?.toFixed(4) ?? '—'} px</span>
              </div>
              <div>
                <span className="text-muted-foreground">Baseline:</span>
                <span className="ml-2 font-medium">
                  {stereoModel.model_type === 'polynomial3d'
                    ? 'n/a (polynomial)'
                    : `${stereoModel.baseline_mm?.toFixed(2) ?? '—'} mm`}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Relative Angle:</span>
                <span className="ml-2 font-medium">
                  {stereoModel.model_type === 'polynomial3d'
                    ? 'n/a (polynomial)'
                    : `${stereoModel.relative_angle_deg?.toFixed(2) ?? '—'}°`}
                </span>
              </div>
              {stereoModel.num_pairs_used != null && (
                <div>
                  <span className="text-muted-foreground">Pairs Used:</span>
                  <span className="ml-2 font-medium">{stereoModel.num_pairs_used}</span>
                </div>
              )}
              {stereoModel.stereo_config && (
                <div>
                  <span className="text-muted-foreground">Geometry:</span>
                  <span className="ml-2 font-medium capitalize">{stereoModel.stereo_config.replace('_', ' ')}</span>
                </div>
              )}
              {stereoModel.world_frame_mode && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">World Frame:</span>
                  <span className="ml-2 font-medium">{stereoModel.world_frame_mode}</span>
                </div>
              )}
            </div>

            {/* Per-camera: intrinsics (pinhole) or per-plane RMS (polynomial) */}
            <div className="grid md:grid-cols-2 gap-6">
              {[
                { cam: cam1, intr: stereoModel.intrinsics1, planeRms: stereoModel.plane_rms_cam1 },
                { cam: cam2, intr: stereoModel.intrinsics2, planeRms: stereoModel.plane_rms_cam2 },
              ].map(({ cam, intr, planeRms }) => (
                <div key={`intr_${cam}`} className="space-y-2">
                  <h4 className="text-sm font-semibold mb-2">Camera {cam}</h4>
                  {stereoModel.model_type === 'polynomial3d' ? (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {(planeRms ?? []).map((v, i) => (
                        <div key={i}>
                          <span className="text-muted-foreground">Plane {i}:</span>
                          <span className="ml-2 font-medium">{v.toFixed(4)} px</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">fx:</span>
                          <span className="ml-2 font-medium">{intr?.fx?.toFixed(1) ?? '—'} px</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">fy:</span>
                          <span className="ml-2 font-medium">{intr?.fy?.toFixed(1) ?? '—'} px</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">cx:</span>
                          <span className="ml-2 font-medium">{intr?.cx?.toFixed(1) ?? '—'} px</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">cy:</span>
                          <span className="ml-2 font-medium">{intr?.cy?.toFixed(1) ?? '—'} px</span>
                        </div>
                      </div>
                      {intr?.dist_coeffs && (
                        <div className="font-mono text-xs bg-muted p-2 rounded">
                          dist: [{intr.dist_coeffs.map((d: number) => d?.toFixed(5) ?? 'null').join(', ')}]
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}

              {stereoModel.model_path && (
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground">Saved to:</span>
                  <span className="ml-2 font-mono text-xs">{stereoModel.model_path}</span>
                </div>
              )}
            </div>

            <CalibrationFigureGallery
              query={{ stereo: 1, board: "stepped", camera_pair: `${cam1},${cam2}`, source_path_idx: sourcePathIdx }}
              trigger={stereoModel}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
};
