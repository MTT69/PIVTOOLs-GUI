"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2 } from "lucide-react";
import { useCalibration2, V2Fiducials, Pt } from "@/hooks/useCalibration2";
import { useConfigUpdate } from "@/hooks/useConfigUpdate";
import { CalibrationSourcePanel } from "./calibration/CalibrationSourcePanel";
import { CalibrationParamsPanel } from "./calibration/CalibrationParamsPanel";
import { Calibration2Viewer, ViewerMode } from "./calibration/Calibration2Viewer";
import { WorldFramePanel, WorldStep, WORLD_STEPS, STEP_COLOR, STEP_LABEL } from "./calibration/WorldFramePanel";
import { ModelSummaryPanel } from "./calibration/ModelSummaryPanel";
import { GlobalCoordinatesPanel, GlobalPick } from "./calibration/GlobalCoordinatesPanel";
import { ApplyVectorsPanel } from "./calibration/ApplyVectorsPanel";
import type { Board, Geometry, MethodCapabilities } from "./calibration/methods";

interface Props {
  board: Board;
  geometry: Geometry;
  capabilities: MethodCapabilities;
  config: any;
  updateConfig: (path: string[], value: any) => void;
  cameraOptions?: number[];
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-lg border p-4 space-y-3">
    <div className="text-sm font-semibold">{title}</div>
    {children}
  </div>
);

export const CalibrationWorkbench: React.FC<Props> = ({
  board, geometry, capabilities, config, updateConfig, cameraOptions = [],
}) => {
  // Image-source config lives in config.calibration (read by the all-format reader);
  // calibration-math config lives in config.calibration2.
  const cal = config?.calibration || {};
  const cfg = config?.calibration2 || {};
  const { updateConfig: persist } = useConfigUpdate();
  const {
    busy, error, setError,
    detect, loadFrameImage, snap, generate, loadModel, measure, listFigures, figureUrl,
    validateSource, globalCompute, startApply, applyStatus,
  } = useCalibration2();

  const setBoardParam = useCallback((b: string, k: string, v: any) => {
    updateConfig(["calibration2", b, k], v);
    persist({ calibration2: { [b]: { [k]: v } } });
  }, [updateConfig, persist]);
  const setGC = useCallback((k: string, v: any) => {
    updateConfig(["calibration2", "global_coordinates", k], v);
    persist({ calibration2: { global_coordinates: { [k]: v } } });
  }, [updateConfig, persist]);

  const stereo = geometry === "stereo";
  const showGlobal = capabilities.globalCoords;          // planar multi-camera stitching
  const pair = useMemo<number[]>(() => cfg.camera_pair || [1, 2], [cfg.camera_pair]);
  const gc = useMemo(() => cfg.global_coordinates || {}, [cfg.global_coordinates]);
  const allCams = useMemo<number[]>(
    () => (cameraOptions.length ? cameraOptions : [1, 2, 3, 4]), [cameraOptions]);
  const multiCam = !!capabilities.multiCamera || stereo;

  const sourceIdx: number = cal.source_path_idx ?? 0;
  const imageFormat: string = cal.image_format || "calib%05d.tif";
  const imageType: string = cal.image_type || "standard";
  const frameTotal: number = cal.num_images ?? 10;
  const datumFrame: number = cfg.datum_frame ?? 1;
  const haveSource: boolean = !!(cal.calibration_sources || [])[sourceIdx];

  const [viewCam, setViewCam] = useState<number>(stereo ? pair[0] : (cfg.camera ?? allCams[0]));
  const [frame, setFrame] = useState<number>(datumFrame);
  const [src, setSrc] = useState<string | null>(null);
  const [showDots, setShowDots] = useState(true);
  const [mode, setMode] = useState<ViewerMode>("none");
  const [worldStep, setWorldStep] = useState<WorldStep | null>(null);

  const [detectionByCam, setDetectionByCam] = useState<Record<number, any>>({});
  const [datumReadyByCam, setDatumReadyByCam] = useState<Record<number, boolean>>({});
  const [fiducialsByCam, setFiducialsByCam] = useState<Record<number, V2Fiducials>>({});
  const [frameCount, setFrameCount] = useState(0);

  const [measureP, setMeasureP] = useState<{ p1?: Pt; p2?: Pt }>({});
  const [measureReadout, setMeasureReadout] = useState<string | null>(null);

  const [result, setResult] = useState<any>(null);
  const [model, setModel] = useState<any>(null);
  const [figures, setFigures] = useState<string[]>([]);

  const [globalPick, setGlobalPick] = useState<GlobalPick | null>(null);
  const [globalShifts, setGlobalShifts] = useState<Record<string, [number, number]> | null>(null);

  const imgQuery = useCallback((cam: number, f: number) => ({
    source_path_idx: sourceIdx, camera: cam, frame: f,
    image_format: imageFormat, image_type: imageType,
  }), [sourceIdx, imageFormat, imageType]);

  const modelQuery = useMemo(() => (
    stereo
      ? { board, source_path_idx: sourceIdx, stereo: 1, camera_pair: pair.join(",") }
      : { board, source_path_idx: sourceIdx, camera: viewCam }
  ), [stereo, board, sourceIdx, pair, viewCam]);

  // Load the current frame image whenever the view target changes.
  useEffect(() => {
    let alive = true;
    if (!haveSource) { setSrc(null); return; }
    (async () => {
      const s = await loadFrameImage(imgQuery(viewCam, frame));
      if (alive) setSrc(s);
    })();
    return () => { alive = false; };
  }, [loadFrameImage, haveSource, imgQuery, viewCam, frame]);

  // Load any existing model + its figures when the target changes.
  useEffect(() => {
    let alive = true;
    if (!haveSource) return;
    (async () => {
      const m = await loadModel(modelQuery);
      if (!alive) return;
      setModel(m);
      setFigures(m?.exists ? await listFigures(modelQuery) : []);
    })();
    return () => { alive = false; };
  }, [loadModel, listFigures, haveSource, modelQuery]);

  const onDetect = useCallback(async () => {
    if (!board) return;
    const isDatum = frame === datumFrame;
    const det = await detect({
      ...imgQuery(viewCam, frame), board, datum_frame: frame, board_params: cfg[board] || {},
    }, { datum: isDatum });
    if (!det) return;
    setDetectionByCam((p) => ({ ...p, [viewCam]: det }));
    setFrameCount(det.frameCount || 0);
    setShowDots(true);
    if (isDatum) setDatumReadyByCam((p) => ({ ...p, [viewCam]: true }));
  }, [detect, board, imgQuery, viewCam, frame, datumFrame, cfg]);

  const onImageClick = useCallback(async (x: number, y: number) => {
    if (mode === "global" && globalPick) {
      if (globalPick.kind === "datum") {
        setGC("datum_pixel", [x, y]); setGC("datum_camera", viewCam);
      } else {
        const pairs = [...(gc.overlap_pairs || [])];
        const cur = { ...(pairs[globalPick.idx] || {}) };
        if (globalPick.side === "a") cur.pixel_on_a = [x, y]; else cur.pixel_on_b = [x, y];
        pairs[globalPick.idx] = cur;
        setGC("overlap_pairs", pairs);
      }
      setGlobalPick(null); setMode("none");
      return;
    }
    if (mode === "world" && worldStep) {
      const snapped = await snap(viewCam, x, y);
      if (!snapped) return;
      setFiducialsByCam((p) => ({ ...p, [viewCam]: { ...(p[viewCam] || {}), [worldStep]: snapped } }));
      const done = WORLD_STEPS.indexOf(worldStep) === WORLD_STEPS.length - 1;
      setWorldStep(done ? null : WORLD_STEPS[WORLD_STEPS.indexOf(worldStep) + 1]);
      if (done) setMode("none");
    } else if (mode === "measure") {
      if (!measureP.p1 || measureP.p2) {
        setMeasureP({ p1: [x, y] }); setMeasureReadout("click the second point");
      } else {
        const p1 = measureP.p1; const p2: Pt = [x, y];
        setMeasureP({ p1, p2 });
        const m = await measure({ ...modelQuery, p1, p2 });
        setMeasureReadout(m
          ? `${m.distance_px.toFixed(1)} px · ${m.distance_mm.toFixed(2)} mm`
          : `${Math.hypot(p2[0] - p1[0], p2[1] - p1[1]).toFixed(1)} px (model needed for mm)`);
      }
    }
  }, [mode, globalPick, gc, setGC, snap, measure, worldStep, viewCam, measureP, modelQuery]);

  const onComputeGlobal = useCallback(async () => {
    const res = await globalCompute({
      board, source_path_idx: sourceIdx,
      datum_camera: gc.datum_camera ?? allCams[0],
      datum_pixel: gc.datum_pixel, datum_physical: gc.datum_physical || [0, 0],
      overlap_pairs: gc.overlap_pairs || [],
    });
    if (res?.camera_shifts) setGlobalShifts(res.camera_shifts);
  }, [globalCompute, board, sourceIdx, gc, allCams]);

  const onGenerate = useCallback(async () => {
    if (!board) return;
    const f1 = fiducialsByCam[stereo ? pair[0] : viewCam];
    const clicks = f1?.origin && f1?.x_axis && f1?.y_axis
      ? { origin: f1.origin, x_axis: f1.x_axis, y_axis: f1.y_axis } : null;
    if (!clicks) { setError("Pick the world frame (origin, +X, +Y) on the datum frame first."); return; }
    const body: any = {
      board, source_path_idx: sourceIdx, image_format: imageFormat, image_type: imageType,
      frame_total: frameTotal, datum_frame: datumFrame, board_params: cfg[board] || {}, stereo, clicks,
    };
    if (stereo) {
      const f2 = fiducialsByCam[pair[1]];
      body.camera_pair = pair;
      body.clicks2 = f2?.origin && f2?.x_axis && f2?.y_axis
        ? { origin: f2.origin, x_axis: f2.x_axis, y_axis: f2.y_axis } : null;
      if (!body.clicks2) { setError("Stereo needs the world frame picked on BOTH cameras."); return; }
    } else {
      body.camera = viewCam;
    }
    const data = await generate(body);
    if (data) {
      setResult(data);
      setModel({ ...data, exists: true });
      setFigures(data.figures || []);
    }
  }, [generate, setError, board, sourceIdx, imageFormat, imageType, frameTotal, datumFrame,
      cfg, stereo, pair, viewCam, fiducialsByCam]);

  const detection = detectionByCam[viewCam];
  const overlayPoints = detection?.points?.map((p: number[]) => ({ x: p[0], y: p[1] }));
  const fid = fiducialsByCam[viewCam] || {};
  const worldMarkers = WORLD_STEPS.filter((s) => fid[s]).map((s) => ({
    x: fid[s]![0], y: fid[s]![1], color: STEP_COLOR[s], label: STEP_LABEL[s][0],
  }));
  const overlayLines = (["x_axis", "y_axis"] as WorldStep[])
    .filter((s) => fid.origin && fid[s])
    .map((s) => ({ x1: fid.origin![0], y1: fid.origin![1], x2: fid[s]![0], y2: fid[s]![1], color: STEP_COLOR[s] }));
  const worldEnabled = frame === datumFrame && !!datumReadyByCam[viewCam];

  // Global-coordinate markers for the current camera (datum + this camera's pair clicks).
  const globalMarkers: { x: number; y: number; color: string; label: string }[] = [];
  if (showGlobal) {
    if (gc.datum_camera === viewCam && gc.datum_pixel)
      globalMarkers.push({ x: gc.datum_pixel[0], y: gc.datum_pixel[1], color: "#22c55e", label: "O" });
    (gc.overlap_pairs || []).forEach((p: any, i: number) => {
      if (p.camera_a === viewCam && p.pixel_on_a)
        globalMarkers.push({ x: p.pixel_on_a[0], y: p.pixel_on_a[1], color: "#3b82f6", label: `A${i + 1}` });
      if (p.camera_b === viewCam && p.pixel_on_b)
        globalMarkers.push({ x: p.pixel_on_b[0], y: p.pixel_on_b[1], color: "#a855f7", label: `B${i + 1}` });
    });
  }
  const markerPoints = mode === "global" || globalPick ? [...worldMarkers, ...globalMarkers] : worldMarkers;
  const switcherCams = multiCam ? (stereo ? pair : allCams) : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
      <div className="space-y-2">
        {switcherCams.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {switcherCams.map((c) => (
              <Button key={c} size="sm" variant={viewCam === c ? "default" : "outline"}
                onClick={() => { setViewCam(c); setMode("none"); setWorldStep(null); setGlobalPick(null); }}>
                Cam {c}
              </Button>
            ))}
          </div>
        )}
        <Calibration2Viewer
          title={`${board} — cam ${viewCam}`}
          src={src}
          frame={frame} frameCount={frameCount} startIndex={1} datumFrame={datumFrame}
          enableDatumFrame={capabilities.datumFrame}
          onFrame={setFrame}
          onDetect={onDetect} busy={busy} detectLabel={`Detect board (cam ${viewCam})`}
          showDots={showDots} onToggleDots={() => setShowDots((s) => !s)}
          overlayPoints={overlayPoints} overlayLines={overlayLines} markerPoints={markerPoints}
          mode={mode} onSetMode={(m) => { setMode(m); setMeasureP({}); setMeasureReadout(null); }}
          onImageClick={onImageClick}
          measureLine={measureP.p1 ? { p1: { x: measureP.p1[0], y: measureP.p1[1] },
            p2: measureP.p2 ? { x: measureP.p2[0], y: measureP.p2[1] } : undefined } : null}
          measureReadout={measureReadout}
          enableMeasure={capabilities.measure}
          stepHint={mode === "world" && worldStep ? `picking ${STEP_LABEL[worldStep]}`
            : globalPick ? "click the point on the image" : null}
        />
      </div>

      <div className="space-y-4">
        <Section title="Calibration images">
          <CalibrationSourcePanel
            config={config} updateConfig={updateConfig}
            geometry={geometry} cameraOptions={allCams} validateSource={validateSource}
          />
        </Section>

        {capabilities.boardParams && (
          <Section title="Board">
            <CalibrationParamsPanel board={board} cfg={cfg} setBoardParam={setBoardParam} />
          </Section>
        )}

        {capabilities.worldFrameClicks && (
          <Section title="World frame">
            <WorldFramePanel
              fiducials={fid}
              activeStep={mode === "world" ? worldStep : null}
              enabled={worldEnabled}
              cameraLabel={multiCam ? `cam ${viewCam}` : undefined}
              onPick={(s) => { setMode("world"); setWorldStep(s); }}
              onClear={() => setFiducialsByCam((p) => ({ ...p, [viewCam]: {} }))}
            />
            {!worldEnabled && frame !== datumFrame && (
              <p className="text-xs text-muted-foreground">Navigate to the datum frame ({datumFrame}) and detect to pick.</p>
            )}
          </Section>
        )}

        {capabilities.generate && (
          <Section title="Model">
            <div className="flex items-center gap-2">
              <Button onClick={onGenerate} disabled={busy} variant="secondary">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate model{multiCam && !stereo ? ` (cam ${viewCam})` : ""}
              </Button>
            </div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            {result && (
              <Alert className="border-green-200 text-green-800">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription>Model saved to the calibration source.</AlertDescription>
              </Alert>
            )}
            <ModelSummaryPanel model={model} figures={figures} figureUrl={(name) => figureUrl(modelQuery, name)} />
          </Section>
        )}

        {showGlobal && (
          <Section title="Global coordinates (stitch planar cameras)">
            <GlobalCoordinatesPanel
              gc={gc} cameras={allCams} pick={globalPick} busy={busy} shifts={globalShifts}
              onSetDatumCamera={(c) => setGC("datum_camera", c)}
              onPickDatum={() => { setViewCam(gc.datum_camera ?? allCams[0]); setGlobalPick({ kind: "datum" }); setMode("global"); }}
              onSetPhysical={(xy) => setGC("datum_physical", xy)}
              onAddPair={() => setGC("overlap_pairs", [...(gc.overlap_pairs || []),
                { camera_a: allCams[0], camera_b: allCams[1] ?? allCams[0] }])}
              onRemovePair={(i) => setGC("overlap_pairs", (gc.overlap_pairs || []).filter((_: any, j: number) => j !== i))}
              onSetPairCam={(i, side, c) => {
                const pairs = [...(gc.overlap_pairs || [])];
                pairs[i] = { ...pairs[i], [side === "a" ? "camera_a" : "camera_b"]: c };
                setGC("overlap_pairs", pairs);
              }}
              onPickPair={(i, side) => {
                const p = (gc.overlap_pairs || [])[i];
                setViewCam(side === "a" ? p.camera_a : p.camera_b);
                setGlobalPick({ kind: "pair", idx: i, side }); setMode("global");
              }}
              onCompute={onComputeGlobal}
            />
          </Section>
        )}

        {capabilities.apply && (
          <Section title="Apply to PIV output">
            <ApplyVectorsPanel
              stereo={stereo} cfg={cfg} set={(k, v) => { updateConfig(["calibration2", k], v); persist({ calibration2: { [k]: v } }); }}
              board={board} sourceIdx={sourceIdx}
              camera={viewCam} pair={pair}
              startApply={startApply} applyStatus={applyStatus}
            />
          </Section>
        )}
      </div>
    </div>
  );
};
