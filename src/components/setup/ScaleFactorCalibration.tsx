"use client";
import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
import { clearCalibrationFrameCache, warmCalibrationFrameCache, calibrationViewerRefreshKey } from "@/hooks/useCalibrationImageViewer";
import { CalibrationFigureGallery } from "@/components/setup/CalibrationFigureGallery";
import { ValidationAlert } from "@/components/setup/ValidationAlert";
import { ApplyDatasetButtons, ApplyJobsStatus, defaultDatasetIdx } from "@/components/setup/ApplyToDatasets";
import { FirstFrameNumber } from "@/components/setup/FirstFrameNumber";
import { isApplyJobActive } from "@/lib/applyJob";
import { CalibrationJobFamily, useCalibrationJobs } from "@/contexts/CalibrationJobContext";
import { fetchJson, postJson, errorMessage } from "@/lib/api";
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
  // The source LIST is the config pointer, fetched from the backend on mount (the
  // `config` prop is not kept in sync by the other calibration tabs); everything
  // else hydrates from the per-source settings sidecar (GET /calibration/settings).
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState(cameraOptions[0] || 1);
  const [imageFormat, setImageFormat] = useState<string>('');
  const [imageType, setImageType] = useState<string>('standard');
  // Sidecar image.zero_based_indexing: the first FILE is numbered 0 (frames stay 1-based).
  const [zeroBasedIndexing, setZeroBasedIndexing] = useState(false);
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);
  // Opens once the source list has loaded. Gates hydration and every write: an
  // unknown list must never be persisted back over the real one.
  const [configLoaded, setConfigLoaded] = useState(false);
  // A failed source-list load leaves the gate closed for good, so it gets its own
  // alert: `validation` is cleared by other effects and only renders with images on.
  const [sourcesLoadError, setSourcesLoadError] = useState<string | null>(null);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState<boolean>(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);
  const [frameIdx, setFrameIdx] = useState(1);
  // Image-less mode: the uniform pixel->mm map needs no image, so a model can be
  // typed in, generated and re-edited with no calibration images on disk (explicit
  // use_image flag; the proof figure is skipped). Persisted per source as the sidecar's
  // methods.scale_factor.use_images; the initial value is a placeholder until hydration.
  const [useImages, setUseImages] = useState(true);

  // --- Scale-factor params (persist to the sidecar; NO frontend defaults) --------
  const [pxPerMm, setPxPerMm] = useState<string>('');
  const [dt, setDt] = useState<string>('');
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

  // --- Vector calibration type (rig.piv_type in the settings sidecar) ------------
  const [vectorTypeName, setVectorTypeName] = useState<"instantaneous" | "ensemble">("instantaneous");
  const handleVectorTypeChange = useCallback(async (value: "instantaneous" | "ensemble") => {
    setVectorTypeName(value);
    try {
      await postJson("/backend/calibration/settings", {
        source_path_idx: sourcePathIdx,
        settings: { rig: { piv_type: value } },
      });
    } catch (e) {
      console.error("Failed to save piv_type:", errorMessage(e));
    }
  }, [sourcePathIdx]);

  // --- Source path validation (folder/pattern "Did you mean" suggestions) -------
  interface SFValidation {
    valid: boolean;
    error?: string;
    found_count?: number;
    camera_path?: string;
    image_size?: [number, number];
    suggested_pattern?: string;
    suggested_subfolder?: string;
    suggested_zero_based?: boolean | null;
  }
  const [validation, setValidation] = useState<SFValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [viewerRefreshKey, setViewerRefreshKey] = useState('');

  // --- Multi-camera global coordinates (shared chain, per-source sidecar) -------
  const gc = useGlobalCoordinates(cameraOptions, sourcePathIdx);
  const gcViewerTarget = getGlobalCoordViewerTarget(gc);
  const gcIsSelecting = gc.selectionMode !== "none";

  // The viewer follows the GC target camera/frame while a GC pick is active.
  const viewCamera = gcIsSelecting && gcViewerTarget ? gcViewerTarget.camera : camera;
  const viewFrame = gcIsSelecting && gcViewerTarget ? gcViewerTarget.frame : frameIdx;

  const locator = useCallback(
    () => ({ board: "scale_factor", camera, source_path_idx: sourcePathIdx }),
    [camera, sourcePathIdx]);

  // --- Hydrate from the per-source settings sidecar ------------------------------
  // CalibrationImageViewer fetches frames WITHOUT image_format/image_type params —
  // the backend reads them from the SIDECAR, so edits must land there before the
  // viewer or validation can see them. Hydration is per-source; `settingsEpoch`
  // bumps after each load so the persist effect below re-fires once (echo save
  // persists a fresh seed), and `settingsReadyRef` blocks writes mid-hydration.
  const settingsReadyRef = useRef(false);
  const settingsSeqRef = useRef(0);
  const [settingsEpoch, setSettingsEpoch] = useState(0);
  // Index of the source whose sidecar the form now holds. The viewer renders only for that
  // source: on the render that switches source, the previous source's valid validation is
  // still set, and the viewer's own fetch effect runs before any parent effect could clear it.
  const [hydratedIdx, setHydratedIdx] = useState<number | null>(null);
  // The source directory the displayed form/model belongs to — lets the persist
  // effect detect an in-place path edit (same index, new string) and rehydrate
  // instead of writing the old source's settings into the new directory.
  const loadedSourcePathRef = useRef<string>('');
  // Bumped to force a rehydrate + model reload after an in-place path edit
  // (sourcePathIdx alone doesn't change in that case).
  const [sourceReloadTick, setSourceReloadTick] = useState(0);

  // Load the source list (config pointer) on mount.
  useEffect(() => {
    (async () => {
      try {
        const cal = (await fetchJson('/backend/config')).calibration || {};
        const sources: string[] = Array.isArray(cal.calibration_sources) ? cal.calibration_sources : [];
        setCalibrationSources(sources);
        // The persist effect can fire before the first hydrate returns; without
        // this it would read the still-empty ref as an in-place path edit.
        loadedSourcePathRef.current = sources[0] ?? '';
        setConfigLoaded(true);
      } catch (e) {
        setSourcesLoadError(errorMessage(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    settingsReadyRef.current = false;
    const seq = ++settingsSeqRef.current;
    // No source path yet: there is no sidecar to read. The persist effect below
    // saves the path once typed and bumps `sourceReloadTick` to rehydrate.
    if (!(calibrationSources[sourcePathIdx] ?? '').trim()) return;
    (async () => {
      try {
        const data = await fetchJson(`/backend/calibration/settings?source_path_idx=${sourcePathIdx}`);
        if (seq !== settingsSeqRef.current) return;  // superseded by a newer load
        if (!data.settings) {
          // Guard stays CLOSED: the form still holds another source's values
          // and an open guard would let the debounced save write them into
          // THIS source's sidecar. Surface the failure in the validation panel.
          setValidation({ valid: false, error: `Failed to load calibration settings: ${data.error ?? "no settings in response"}` });
          return;
        }
        const img = data.settings.image || {};
        setImageFormat(img.image_format ?? '');
        if (img.image_type) setImageType(img.image_type);
        setZeroBasedIndexing(Boolean(img.zero_based_indexing));
        setUseCameraSubfolders(Boolean(img.use_camera_subfolders));
        if (Array.isArray(img.camera_subfolders)) setCameraSubfolders(img.camera_subfolders);
        const rig = data.settings.rig || {};
        setDt(rig.dt == null ? '' : String(rig.dt));
        if (rig.piv_type === 'instantaneous' || rig.piv_type === 'ensemble') setVectorTypeName(rig.piv_type);
        const sf = data.settings.methods?.scale_factor || {};
        setPxPerMm(sf.px_per_mm == null ? '' : String(sf.px_per_mm));
        setUseImages(Boolean(sf.use_images));
        loadedSourcePathRef.current = calibrationSources[sourcePathIdx] ?? '';
        settingsReadyRef.current = true;
        setHydratedIdx(sourcePathIdx);
        setSettingsEpoch(n => n + 1);
      } catch (e) {
        if (seq !== settingsSeqRef.current) return;
        setValidation({ valid: false, error: `Failed to load calibration settings: ${errorMessage(e)}` });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, sourcePathIdx, sourceReloadTick]);

  // --- Persist (debounced): source list to config.yaml, the rest to the sidecar ---
  // The source list saves as soon as it has loaded — NOT only after a sidecar
  // hydrate, which needs a saved source path to succeed. The sidecar write keeps
  // its own `settingsReadyRef` guard below.
  useEffect(() => {
    if (!configLoaded) return;
    const t = setTimeout(async () => {
      try {
        await postJson("/backend/update_config", {
          calibration: { calibration_sources: calibrationSources },
        });
      } catch (e) {
        console.error("persist calibration sources failed", errorMessage(e));
      }
      // Sidecars are per-source: never write the form into a source it wasn't
      // hydrated from — an in-place path edit repoints the index at a NEW
      // directory while the form still shows the old one's values.
      const currentPath = calibrationSources[sourcePathIdx] ?? '';
      const pathEdited = currentPath !== loadedSourcePathRef.current;
      if (!pathEdited && settingsReadyRef.current) {
        try {
          const res = await postJson("/backend/calibration/settings", {
            source_path_idx: sourcePathIdx,
            settings: {
              image: {
                image_format: imageFormat,
                image_type: imageType,
                zero_based_indexing: zeroBasedIndexing,
                use_camera_subfolders: useCameraSubfolders,
                camera_subfolders: cameraSubfolders,
              },
              rig: { dt: (() => { const v = parseFloat(dt); return Number.isFinite(v) ? v : null; })() },
              methods: {
                scale_factor: {
                  px_per_mm: (() => { const v = parseFloat(pxPerMm); return Number.isFinite(v) ? v : null; })(),
                  use_images: useImages,
                },
              },
            },
          });
          // The backend prunes camera_subfolders to the camera count and echoes the stored
          // list; adopt it (unless edited meanwhile) so stale entries are not re-sent.
          const stored = res.settings?.image?.camera_subfolders;
          if (!Array.isArray(stored)) {
            throw new Error("settings save response carries no image.camera_subfolders");
          }
          const sentSubfolders = JSON.stringify(cameraSubfolders);
          if (JSON.stringify(stored) !== sentSubfolders) {
            setCameraSubfolders(prev => (JSON.stringify(prev) === sentSubfolders ? stored : prev));
          }
        } catch (e) {
          console.error("persist calibration settings failed", errorMessage(e));
        }
      }
      if (pathEdited) {
        // The persisted sources list now points elsewhere: drop the stale
        // model/overlay and rehydrate settings + model from the new directory.
        loadedSourcePathRef.current = currentPath;
        setResult(null);
        restoredFor.current = "";
        setSourceReloadTick(n => n + 1);
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageFormat, imageType, zeroBasedIndexing, calibrationSources, useCameraSubfolders, cameraSubfolders,
      pxPerMm, useImages, dt, settingsEpoch, sourcePathIdx, configLoaded]);

  // --- Validate the camera's source path/pattern (same route the other tabs use) ----
  const validate = useCallback(async () => {
    setValidating(true);
    try {
      const result = await postJson(`${BASE}/validate`, {
        camera, source_path_idx: sourcePathIdx,
        image_format: imageFormat, image_type: imageType, frame_total: 1,
      });
      setValidation(result);
      // This tab used to clear the frame cache but never warm it, even though its
      // viewer mounts as soon as the source validates -- so every frame it showed
      // was a cold decode. Built here, once, and handed to both the warmup and the
      // viewer so the two share one key namespace.
      const refreshKey = calibrationViewerRefreshKey({
        sourcePath: calibrationSources[sourcePathIdx] ?? '',
        imageFormat, imageType, zeroBasedIndexing,
        useCameraSubfolders, cameraSubfolders,
        valid: Boolean(result?.valid),
      });
      setViewerRefreshKey(refreshKey);
      if (result?.valid) {
        warmCalibrationFrameCache({
          backendUrl: "/backend",
          cameras: cameraOptions,
          primaryCamera: camera,
          sourcePathIdx,
          refreshKey,
        });
      }
    } catch (e) {
      setValidation({ valid: false, error: errorMessage(e) });
    } finally {
      setValidating(false);
    }
  }, [camera, sourcePathIdx, imageFormat, imageType, zeroBasedIndexing, cameraOptions,
      calibrationSources, useCameraSubfolders, cameraSubfolders]);

  // Debounced past the 500 ms config persist above: source dir + subfolders are resolved
  // from config on the backend, so validation must run after the persist lands.
  // With images off, or before a source path is set, there is nothing to validate —
  // clearing the result also drops the alert.
  useEffect(() => {
    if (!configLoaded) return;
    if (!useImages || !(calibrationSources[sourcePathIdx] ?? '').trim()) {
      setValidation(null);
      setValidating(false);
      return;
    }
    const t = setTimeout(validate, 800);
    return () => clearTimeout(t);
  }, [validate, useImages, calibrationSources, sourcePathIdx, useCameraSubfolders, cameraSubfolders,
      configLoaded]);

  // Clear a stale validation error the instant an input changes and enter a pending state; the
  // debounced re-validate above then refreshes it. Validation is resolved by the backend from
  // the PERSISTED config (by index, not the request), so without this the error from a PREVIOUS
  // source / format / subfolder lingers on screen through the persist + re-validate window.
  useEffect(() => {
    if (!settingsReadyRef.current || !useImages) return;
    setValidating(true);
    clearCalibrationFrameCache();
    setValidation(v => (v ? { ...v, valid: false, error: undefined } : v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePathIdx, imageFormat, imageType, zeroBasedIndexing, calibrationSources, useCameraSubfolders,
      cameraSubfolders]);

  // Image-driven interactions cannot survive the viewer unmounting.
  useEffect(() => {
    if (!useImages) {
      setPickMode("none");
      setMeasureP1(null);
      setMeasureP2(null);
      gc.setSelectionMode("none");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useImages]);

  // Image dimensions for overlay geometry: validation reports [W, H].
  const dims: { w: number; h: number } | null =
    validation?.valid && Array.isArray(validation.image_size)
      ? { w: Number(validation.image_size[0]), h: Number(validation.image_size[1]) }
      : null;


  // --- Restore saved model on camera/source change (or in-place path edit) ------
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
        // guard: a malformed record must not render the literal "undefined"
        setPxPerMm(m.px_per_mm == null ? "" : String(m.px_per_mm));
        // A model stamped without dt must not blank the field: the settings save would then
        // write rig.dt = null over the user's value. The card still says dt is missing.
        if (m.dt != null) setDt(String(m.dt));
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
  }, [sourcePathIdx, camera, sourceReloadTick]);

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
  const sourcePathSet = Boolean((calibrationSources[sourcePathIdx] ?? '').trim());
  const generate = useCallback(async () => {
    if (!sourcePathSet) {
      c2.setError(useImages
        ? "Set the calibration images location first."
        : "Set the calibration folder first — the model is saved there.");
      return;
    }
    if (!originPx) {
      c2.setError(useImages
        ? "Pick the origin on the image first."
        : "Enter the origin pixel coordinates first.");
      return;
    }
    // px/mm and dt have no defaults — an unset field is an error, never a 1.0.
    const px = parseFloat(pxPerMm);
    const dtVal = parseFloat(dt);
    if (!Number.isFinite(px) || px <= 0) {
      c2.setError("Set the scale (px/mm) first.");
      return;
    }
    if (!Number.isFinite(dtVal) || dtVal <= 0) {
      c2.setError("Set Δt (seconds) first — it is stamped into the model.");
      return;
    }
    const data = await c2.generateScaleFactor({
      ...locator(),
      px_per_mm: px,
      dt: dtVal,
      origin_px: originPx,
      origin_mm: [parseFloat(originMmX) || 0, parseFloat(originMmY) || 0],
      x_dir: xDir, y_dir: yDir, swap_axes: swapAxes,
      frame_idx: frameIdx, image_format: imageFormat, image_type: imageType,
      use_image: useImages,
    });
    if (data) {
      setResult(data);
    }
  }, [sourcePathSet, originPx, originMmX, originMmY, pxPerMm, dt, xDir, yDir, swapAxes, frameIdx,
      imageFormat, imageType, useImages, locator]);

  // --- Apply (model-agnostic mono apply job) ------------------------------------
  // Jobs live in CalibrationJobContext so they keep polling across tab switches; one slot per
  // target dataset selection, so different datasets can run side by side.
  const jobs = useCalibrationJobs();
  const basePaths: string[] = config?.paths?.base_paths ?? [];
  const applyFamily: CalibrationJobFamily = useMemo(
    () => ({ board: "scale_factor", sourcePathIdx }), [sourcePathIdx]);
  const applyJobs = jobs.jobsFor(applyFamily);
  const applyRunning = applyJobs.some(j => isApplyJobActive(j.status));
  const runApply = useCallback(async (datasets: number[]) => {
    const dtVal = parseFloat(dt);
    const sorted = [...datasets].sort((a, b) => a - b);
    await jobs.startApply({ ...applyFamily, datasets: sorted }, {
      board: "scale_factor", stereo: false, source_path_idx: sourcePathIdx,
      type_name: vectorTypeName,
      // Empty dt is omitted: apply falls back to the model-stamped dt.
      ...(Number.isFinite(dtVal) ? { dt: dtVal } : {}),
      // Always explicit, so the request states which datasets it applies to.
      active_paths: sorted,
    });
  }, [jobs, applyFamily, dt, vectorTypeName, sourcePathIdx]);

  // --- Set as active ------------------------------------------------------------
  const isActive = config?.calibration?.active === "scale_factor";
  const setAsActive = useCallback(async () => {
    try {
      const json = await postJson("/backend/update_config", { calibration: { active: "scale_factor" } });
      if (json.updated?.calibration) {
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (e) { console.error("set active failed", errorMessage(e)); }
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
          {/* Use-images toggle: off = image-less mode, model is edited numerically */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Switch id="sf-use-images" checked={useImages} onCheckedChange={setUseImages} />
              <Label htmlFor="sf-use-images" className="text-sm">Use calibration images</Label>
            </div>
            <p className="text-xs text-muted-foreground ml-10">
              {useImages
                ? "Pick the origin and measure scale on calibration images."
                : "No images required. Type the origin, scale and Δt."}
            </p>
          </div>

          {sourcesLoadError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Calibration sources did not load</AlertTitle>
              <AlertDescription>
                {sourcesLoadError} — nothing on this tab can load or save. Reload the page once the backend is reachable.
              </AlertDescription>
            </Alert>
          )}

          {/* Section 1: Calibration Source Path (primary input). Shown in both modes:
              the model is saved under this folder, images or not. */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {useImages ? "Calibration Images Location" : "Calibration Folder"}
            </Label>
            <Input
              value={calibrationSources[sourcePathIdx] || ""}
              onChange={e => {
                const newSources = [...calibrationSources];
                while (newSources.length <= sourcePathIdx) newSources.push("");
                newSources[sourcePathIdx] = e.target.value;
                setCalibrationSources(newSources);
              }}
              placeholder={useImages ? "/path/to/calibration/images" : "/path/to/calibration/folder"}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {useImages
                ? "Full path to directory containing calibration images. Camera subfolders (if enabled) are relative to this path. The model is saved in this folder."
                : "The model is saved in this folder. No images are required."}
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
              <p className="text-xs text-muted-foreground mt-1">Picks which calibration source this tab edits, one per PIV source path (Settings → Directories). Models are saved in the calibration source folder.</p>
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
          {useImages && (<>
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

          <FirstFrameNumber imageType={imageType} zeroBased={zeroBasedIndexing} onChange={setZeroBasedIndexing}
            suggestedZeroBased={validating ? null : validation?.suggested_zero_based} />

          {/* Camera subfolders toggle — for standard and IM7 formats; hidden for a one-camera rig, which
              always resolves at the source root (rig size, not the selected cameras) */}
          {(imageType === "standard" || imageType === "lavision_im7") && config?.paths?.camera_count !== 1 && (
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
              pendingLabel="Validating…"
              customSuccessMessage={
                validation.valid
                  ? `Found ${validation.found_count} calibration images`
                  : undefined
              }
            />
          )}

          {validation && !validating && !validation.valid && validation.suggested_pattern && (
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

          {validation && !validating && !validation.valid && validation.suggested_subfolder && (() => {
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

          {/* Image viewer with origin/measure picking (shared component — same as other tabs).
              Gated on a valid source (Dotboard pattern) whose settings have loaded, so a 404 never
              reaches the canvas overlay. */}
          {validation?.valid && hydratedIdx === sourcePathIdx && (
          <CalibrationImageViewer
            backendUrl="/backend"
            sourcePathIdx={sourcePathIdx}
            camera={viewCamera}
            numImages={typeof validation?.found_count === "number" ? validation.found_count : 1}
            refreshKey={viewerRefreshKey}
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
          )}

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
          </>)}

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
            <Button onClick={generate} disabled={c2.busy || !originPx || !sourcePathSet}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    title={!sourcePathSet
                      ? (useImages ? "Set the calibration images location first" : "Set the calibration folder first")
                      : !originPx
                        ? (useImages ? "Pick the origin first" : "Enter the origin pixel coordinates first")
                        : undefined}>
              {c2.busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</> : "Generate Model"}
            </Button>

            {/* Calibrate Vectors: PIV type + target datasets (same control as the other tabs) */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Calibrate vectors:</span>
              <Select value={vectorTypeName} onValueChange={handleVectorTypeChange}
                      disabled={applyRunning}>
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
                onApply={runApply}
                disabled={!result}
                title={!result ? "Generate the model first" : "Calibrate vectors"}
                buttonClassName="bg-green-600 hover:bg-green-700 text-white"
              />
            </div>

            <Button onClick={setAsActive} disabled={isActive}
                    variant={isActive ? "default" : "outline"}
                    className={isActive ? "bg-green-600 hover:bg-green-600" : ""}>
              {isActive ? <><CheckCircle2 className="h-4 w-4 mr-1" />Active</> : "Set as Active"}
            </Button>
          </div>

          {/* Apply progress / results (shared with every other calibration tab) */}
          <ApplyJobsStatus jobs={applyJobs} basePaths={basePaths} title="Vector calibration"
            onCancel={datasets => jobs.cancelApply({ ...applyFamily, datasets })} />

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
                {result.dt == null
                  ? <span className="ml-2 font-medium text-amber-600">dt missing — regenerate</span>
                  : <span className="ml-2 font-medium">{result.dt} s</span>}</div>
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
