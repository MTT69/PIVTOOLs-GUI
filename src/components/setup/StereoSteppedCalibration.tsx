"use client";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InterpolatorSelect } from "./InterpolatorSelect";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { SetActiveButton } from "@/components/setup/SetActiveButton";
import { ApplyDatasetButtons, ApplyJobsStatus, defaultDatasetIdx } from "@/components/setup/ApplyToDatasets";
import { FirstFrameNumber } from "@/components/setup/FirstFrameNumber";
import { CameraSubfolderInputs, SubfolderSuggestion, subfolderSuggestions } from "@/components/setup/CameraSubfolderInputs";
import { ChangedSinceGenerate } from "@/components/setup/ChangedSinceGenerate";
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
import { SelfCalibrationSection } from "@/components/setup/SelfCalibrationSection";
import CalibrationImageViewer from "@/components/viewer/CalibrationImageViewer";
import { MarkerPoint } from "@/components/viewer/zoomableCanvas";

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
    sourceEpoch,

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
    datumFrame,
    setDatumFrame,

    // Stereo geometry classification
    stereoConfig,
    setStereoConfig,
    modelType,
    setModelType,
    fixK2,
    setFixK2,
    showFixK2,

    // Validation
    validation,
    viewerRefreshKey,
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
    hasSidecar,

    // Reconstruct
    applyJobs,
    isReconstructing,
    cancelApply,
    changedSinceGenerate,
    clicksSaveError,

    // Actions
    detect,
    snapFiducial,
    generateModel,
    reconstructVectors,
    interpolator,
    setInterpolator,
    fetchPoseDetection,
    identifyPoseLevel,

    // Overlay helpers
    getDetectionOverlayPoints,
    getDetectionOverlayLines,
  } = calibration;

  // ---- Local state ----
  const [fiducialSelectMode, setFiducialSelectMode] = useState(false);
  const [fiducialStepIdx, setFiducialStepIdx] = useState(0);
  // Why the last fiducial click was refused (viewer not on the datum frame).
  const [pickRefused, setPickRefused] = useState<string | null>(null);

  // Local debounced inputs
  const [dotSpacingInput, setDotSpacingInput] = useState(String(dotSpacingMm));
  const [stepHeightInput, setStepHeightInput] = useState(String(stepHeightMm));
  const [boardThicknessInput, setBoardThicknessInput] = useState(String(boardThicknessMm));
  const [dtInput, setDtInput] = useState(String(dt));
  const [datumFrameInput, setDatumFrameInput] = useState(String(datumFrame));
  const [labelTarget, setLabelTarget] = useState<{ frameIdx: number; camera: number } | null>(null);
  const [displayedFrame, setDisplayedFrame] = useState<number>(datumFrame);

  // Pick / label modes belong to the source + pair they were started on: a source, pair or
  // path change resets them along with the hook's per-source state.
  React.useEffect(() => {
    setFiducialSelectMode(false);
    setFiducialStepIdx(0);
    setLabelTarget(null);
    setPickRefused(null);
  }, [sourceEpoch]);

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

  // Auto-switch the viewer to the camera of the current fiducial step.
  React.useEffect(() => {
    if (!fiducialSelectMode || fiducialStepIdx >= FIDUCIAL_STEPS.length) return;
    const stepCam = FIDUCIAL_STEPS[fiducialStepIdx].slot === 1 ? cam1 : cam2;
    if (activeCam !== stepCam) setActiveCam(stepCam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiducialSelectMode, fiducialStepIdx, cam1, cam2]);

  // PIV result type for the apply step — rig.piv_type in the per-source settings
  // sidecar, hydrated and persisted (debounced) by the calibration hook.
  const vectorTypeName = calibration.pivType;
  // PIV datasets the saved model can be applied to (Settings → Directories).
  const basePaths: string[] = config?.paths?.base_paths ?? [];
  const handleVectorTypeChange = (value: 'instantaneous' | 'ensemble') =>
    calibration.setPivType(value);

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
    if (isGenerating) return false;
    const liveReady =
      sequenceStatus === 'ready' &&
      sequenceId !== null &&
      hasAllFiducials(cam1) && hasAllFiducials(cam2) &&
      hasLevel(cam1) && hasLevel(cam2) &&
      allVerifiedForCam(cam1) && allVerifiedForCam(cam2);
    // Normally restoreSequence rehydrates a live sequence (sequenceId set) so the liveReady
    // branch governs. This fallback covers the rare state of a flagged sidecar with no live
    // sequence (restore not yet run / cache expired) — regenerate straight from inputs.mat.
    return liveReady || (sequenceId === null && hasSidecar);
  }, [sequenceStatus, sequenceId, hasAllFiducials, hasLevel, cam1, cam2,
      allVerifiedForCam, isGenerating, hasSidecar]);

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
    if (!fiducialSelectMode || !currentStep || currentStepCam === null) return;
    // Fiducials are snapped against the datum frame's detection: a click on any other frame
    // would land on a different board pose. `displayedFrame` (the viewer's onFrameChange) is
    // what is on screen; the viewer's reported frame is the REQUESTED one (`externalFrame`),
    // which stays the datum even after the user browses away.
    if (displayedFrame !== datumFrame) {
      setPickRefused(`Fiducials are picked on the datum frame (${datumFrame}); the viewer shows frame `
        + `${displayedFrame}. Go back to frame ${datumFrame} and click again.`);
      return;
    }
    setPickRefused(null);
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
  }, [fiducialSelectMode, currentStep, currentStepCam, snapFiducial, fiducialStepIdx, datumFrame,
      displayedFrame]);

  // Re-clicking overwrites a fiducial, so a "reset" only needs to restart the step
  // sequence; the existing clicks remain until the next click replaces them.
  const resetFiducials = useCallback(() => {
    setFiducialSelectMode(false);
    setFiducialStepIdx(0);
    setPickRefused(null);
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



  const viewerCamera = activeCam;

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
                <p className="text-xs text-muted-foreground mt-1">Picks which calibration source this tab edits, one per PIV source path (Settings → Directories). Models are saved in the calibration source folder.</p>
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
                  placeholder="auto"
                  onChange={e => setNumImages(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Leave blank to count the images found.</p>
                {autoViewCountText && <p className="text-xs text-muted-foreground">{autoViewCountText}</p>}
              </div>
            </div>

            <FirstFrameNumber imageType={imageType} zeroBased={zeroBasedIndexing} onChange={setZeroBasedIndexing}
              suggestedZeroBased={suggestedZeroBased} />

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

            {useCameraSubfolders && (
              <CameraSubfolderInputs
                cameras={[cam1, cam2]}
                cameraSubfolders={cameraSubfolders}
                setSubfolderFor={setSubfolderFor}
                sourcePath={calibrationSources[sourcePathIdx] || ""}
              />
            )}

            {validation && (
              <ValidationAlert
                validation={{
                  valid: validation.valid,
                  checked: !validating,
                  error: validation.error || validation.cam1?.error || validation.cam2?.error || null,
                }}
                pendingLabel="Validating…"
                customSuccessMessage={
                  validation.valid
                    ? `Both cameras validated (Cam ${cam1}, Cam ${cam2})`
                    : undefined
                }
              />
            )}

            {/* Suggested file pattern (Did you mean) */}
            {validation && !validating && !validation.valid && (validation.cam1?.suggested_pattern || validation.cam2?.suggested_pattern) && (
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

            {/* Suggested camera subfolder (Did you mean): each camera's own suggestion */}
            {validation && !validating && !validation.valid && (
              <SubfolderSuggestion
                suggestions={subfolderSuggestions({ [cam1]: validation.cam1, [cam2]: validation.cam2 })}
                onApply={applySubfolderSuggestions}
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
                  onBlur={() => setDotSpacingMm(dotSpacingInput)}
                />
                <p className="text-xs text-muted-foreground mt-1">Physical spacing between dots</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Step Height (mm)</Label>
                <Input
                  type="text" inputMode="numeric"
                  value={stepHeightInput}
                  onChange={e => setStepHeightInput(e.target.value)}
                  onBlur={() => setStepHeightMm(stepHeightInput)}
                />
                <p className="text-xs text-muted-foreground mt-1">Height between peak and trough levels</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Board Thickness (mm)</Label>
                <Input
                  type="text" inputMode="numeric"
                  value={boardThicknessInput}
                  onChange={e => setBoardThicknessInput(e.target.value)}
                  onBlur={() => setBoardThicknessMm(boardThicknessInput)}
                />
                <p className="text-xs text-muted-foreground mt-1">Total thickness of the board</p>
              </div>
              <div>
                <Label className="text-sm font-medium">&Delta;t (s)</Label>
                <Input
                  type="text" inputMode="numeric"
                  value={dtInput}
                  onChange={e => setDtInput(e.target.value)}
                  onBlur={() => setDt(dtInput)}
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
                {/* Stereo polynomial3d is temporarily disabled (builds no stereo pose) —
                    pinhole only for stereo. Mono stepped still offers polynomial3d. */}
                <Select value={modelType} onValueChange={(v) => setModelType(v as 'pinhole' | 'polynomial3d')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pinhole">Pinhole (multi-view)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  OpenCV pinhole, composed stereo pose
                </p>
              </div>
            </div>

            {/* Fix radial k2 = 0 — pinhole with <3 frames, where k2 is unconstrained */}
            {showFixK2 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="stereo-stepped-fix-k2"
                    checked={fixK2}
                    onCheckedChange={setFixK2}
                  />
                  <Label htmlFor="stereo-stepped-fix-k2" className="text-sm font-medium">
                    Fix radial k2 = 0 (few views)
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground ml-10">
                  {fixK2
                    ? "k2 fixed at 0 — recommended below 3 frames, where one stepped view cannot constrain the r⁴ radial term and a free k2 corrupts focal length and stereo angle."
                    : "k2 fit freely — only do this if you trust a single stepped view to pin the r⁴ radial term."}
                </p>
              </div>
            )}
          </div>

          {/* ============================================= */}
          {/* Section 3: Detection + Fiducials              */}
          {/* ============================================= */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold">Detection + Fiducials</h3>

            <p className="text-xs text-muted-foreground">
              Detects dots on {frameCount ?? "the found"} frames for BOTH cameras and runs a joint
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

            {clicksSaveError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{clicksSaveError}</AlertDescription>
              </Alert>
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
                      {currentStep.slot === 2 && (
                        <div className="text-sm text-muted-foreground font-normal mt-1">
                          Click the same physical dot you picked on Cam {cam1} — the origin, +X and +Y dots must be the same three dots in both cameras.
                        </div>
                      )}
                      {pickRefused && <div className="text-sm text-red-600 font-normal mt-1">{pickRefused}</div>}
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
                numImages={frameCount}
                refreshKey={viewerRefreshKey}
                stereoParams={{ cam1, cam2 }}
                calibrationParams={{}}
                pointSelectMode={fiducialSelectMode || labelTarget !== null}
                onPointSelect={(px, py, cam, frame) => {
                  if (labelTarget) {
                    handleLabelClick(px, py);
                  } else {
                    handlePointSelect(px, py, cam, frame);
                  }
                }}
                onFrameChange={handleFrameChange}
                selectedMarkers={markerPoints}
                externalFrame={
                  fiducialSelectMode || labelTarget ? (labelTarget?.frameIdx ?? datumFrame) : undefined
                }
                externalOverlayPoints={overlayPoints}
                externalOverlayLines={overlayLines}
                detectionLoading={modelLoading}
              />
            </div>
          )}

          {/* ============================================= */}
          {/* Section 5: Generate Model                     */}
          {/* ============================================= */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold">Generate Stereo Model</h3>

            {sequenceId === null && hasSidecar && (
              <p className="text-xs text-muted-foreground">
                Using saved detections — <strong>Generate</strong> rebuilds the model from the sidecar
                without re-detecting or re-clicking. Use <strong>Re-detect</strong> to refresh from the images.
              </p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => generateModel()}
                disabled={!canGenerate}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                title={
                  canGenerate
                    ? 'Fit the stereo pinhole model for both cameras'
                    : 'Need sequence + all 6 fiducials + a clicked level + every pose verified '
                      + '(peak/trough) for each camera'
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
                onClick={() => detect()}
                disabled={isGenerating || sequenceStatus === 'detecting'}
                variant="outline"
                title="Re-run detection from the images (refreshes the saved detections)"
              >
                {sequenceStatus === 'detecting' ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Detecting…
                  </>
                ) : (
                  'Re-detect'
                )}
              </Button>

              <SetActiveButton method="stereo_stepped" config={config} updateConfig={updateConfig} />

              {/* Reconstruct 3C Vectors: cam2 interpolator, PIV type, target datasets */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">Reconstruct 3D vectors:</span>
                <InterpolatorSelect value={interpolator} onValueChange={setInterpolator} disabled={isReconstructing} />
                <Select value={vectorTypeName} onValueChange={handleVectorTypeChange} disabled={isReconstructing}>
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
                  onApply={datasets => reconstructVectors(vectorTypeName, datasets)}
                  disabled={!hasModel}
                  title={!hasModel ? "Generate or load a stereo model first" : "Reconstruct 3C vectors for the pair"}
                  buttonClassName="bg-green-600 hover:bg-green-700 text-white"
                />
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

            <ChangedSinceGenerate fields={changedSinceGenerate} />

            {modelLoadError && (
              <div className="text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {modelLoadError}
              </div>
            )}

            {/* 3C reconstruction progress / results, one per target dataset selection */}
            <ApplyJobsStatus jobs={applyJobs} basePaths={basePaths} title="3C reconstruction"
              onCancel={cancelApply} />
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
                ? `Stereo 3D polynomial model (single datum view) for Cameras ${stereoModel.cam1} & ${stereoModel.cam2} (solve order)`
                : `Stereo pinhole model for Cameras ${stereoModel.cam1} & ${stereoModel.cam2} (solve order)`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Stereo geometry roll-up */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mb-4">
              <div>
                <span className="text-muted-foreground">RMS Cam {stereoModel.cam1}:</span>
                <span className="ml-2 font-medium">{stereoModel.rms_cam1?.toFixed(4) ?? '—'} px</span>
              </div>
              <div>
                <span className="text-muted-foreground">RMS Cam {stereoModel.cam2}:</span>
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
              {stereoModel.world_z_toward_camera != null && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">World +Z:</span>
                  <span className="ml-2 font-medium">
                    {stereoModel.world_z_toward_camera > 0
                      ? `toward Cam ${stereoModel.cam1} (from the clicked +X/+Y handedness)`
                      : `into the board, away from Cam ${stereoModel.cam1} (from the clicked +X/+Y handedness)`}
                  </span>
                </div>
              )}
            </div>
            {/* Reprojection gate: dots removed from the fit, per camera. Amber only when non-zero. */}
            {stereoModel.model_type !== 'polynomial3d' &&
              ((stereoModel.n_gated_points1 ?? 0) > 0 || (stereoModel.n_gated_points2 ?? 0) > 0) && (
                <p className="text-sm text-amber-600 mb-4">
                  Reprojection gate removed{' '}
                  {[
                    [stereoModel.cam1, stereoModel.n_gated_points1, stereoModel.gate_limit_px1],
                    [stereoModel.cam2, stereoModel.n_gated_points2, stereoModel.gate_limit_px2],
                  ]
                    .filter(([, n]) => (n ?? 0) > 0)
                    .map(([cam, n, lim]) => `${n} dot(s) from Cam ${cam} (above ${(lim as number)?.toFixed(2)} px)`)
                    .join(', ')}
                  . They are listed in the solve log; a dot that fails the gate on every solve is not a reliable mark.
                </p>
              )}

            {stereoModel.method && (
              <p className="text-xs text-muted-foreground mb-4">
                Cross-camera pose:{' '}
                {stereoModel.method === 'compose'
                  ? 'composed per-camera PnP (each camera fit independently into the shared plate frame)'
                  : stereoModel.method === 'polynomial'
                    ? 'per-camera 3D polynomial (no rig pose)'
                    : stereoModel.method}
                . There is no joint reprojection RMS for a composed pair — cross-camera
                agreement is reported by self-calibration (residual disparity) below.
              </p>
            )}

            {/* Per-camera: intrinsics (pinhole) or per-plane RMS (polynomial) */}
            <div className="grid md:grid-cols-2 gap-6">
              {[
                { cam: stereoModel.cam1, intr: stereoModel.intrinsics1, planeRms: stereoModel.plane_rms_cam1 },
                { cam: stereoModel.cam2, intr: stereoModel.intrinsics2, planeRms: stereoModel.plane_rms_cam2 },
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

            {/* Self-calibration (Wieneke disparity): pinhole only — it nudges the
                extrinsics, which a polynomial pair does not have. */}
            {stereoModel.model_type !== 'polynomial3d' && (
              <div className="mt-6">
                <SelfCalibrationSection
                  cam1={cam1} cam2={cam2} board="stepped"
                  hasModel={hasModel} sourcePathIdx={sourcePathIdx} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
