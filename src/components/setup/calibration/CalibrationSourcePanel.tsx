"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useConfigUpdate } from "@/hooks/useConfigUpdate";
import type { Geometry } from "./methods";

const inputCls = "border rounded px-2 py-1 bg-background w-full";

interface Props {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  geometry: Geometry;
  cameraOptions: number[];
  validateSource: (body: any) => Promise<any>;
}

/**
 * Calibration image-source configuration, mirroring the v1 CalibrationImageConfig UX
 * on the calibration2 backend: a base-path dropdown (from config.calibration.calibration_sources),
 * image type/format, camera subfolders, and a Validate step that reports found-count, a preview,
 * and a "did you mean" suggested pattern — auto-filling the frame total. Image-source settings live
 * in config.calibration (what the all-format reader reads); datum/dt/camera live in config.calibration2.
 */
export const CalibrationSourcePanel: React.FC<Props> = ({
  config, updateConfig, geometry, cameraOptions, validateSource,
}) => {
  const { updateConfig: persist } = useConfigUpdate();
  const cal = config?.calibration || {};
  const c2cfg = config?.calibration2 || {};
  const cams = cameraOptions.length ? cameraOptions : [1, 2, 3, 4];

  const sources: string[] = cal.calibration_sources || [];
  const sourceIdx: number = cal.source_path_idx ?? 0;
  const useSub: boolean = cal.use_camera_subfolders ?? true;
  const subs: string[] = cal.camera_subfolders || [];
  const stereo = geometry === "stereo";
  const pair: number[] = c2cfg.camera_pair || [1, 2];

  const [val, setVal] = useState<any>(null);
  const [validating, setValidating] = useState(false);

  const setCal = (k: string, v: any) => { updateConfig(["calibration", k], v); persist({ calibration: { [k]: v } }); };
  const setC2 = (k: string, v: any) => { updateConfig(["calibration2", k], v); persist({ calibration2: { [k]: v } }); };

  const setSourcePath = (path: string) => {
    const arr = [...sources];
    arr[sourceIdx] = path;
    setCal("calibration_sources", arr);
  };
  const addSource = () => {
    const arr = [...sources, ""];
    updateConfig(["calibration", "calibration_sources"], arr);
    setCal("source_path_idx", arr.length - 1);
  };
  const setSub = (cam: number, name: string) => {
    const arr = [...subs];
    while (arr.length < cam) arr.push("");
    arr[cam - 1] = name;
    setCal("camera_subfolders", arr);
  };

  const camera = stereo ? pair[0] : (c2cfg.camera ?? 1);

  const onValidate = async () => {
    setValidating(true);
    // Persist the full image-source block so the backend reader sees it, defaulting
    // camera subfolders to Cam{n} when subfolders are enabled but unset.
    const camera_subfolders = useSub
      ? cams.map((c, i) => subs[i] || `Cam${c}`)
      : [];
    await persist({
      calibration: {
        calibration_sources: sources, source_path_idx: sourceIdx,
        image_format: cal.image_format, image_type: cal.image_type,
        num_images: cal.num_images, use_camera_subfolders: useSub,
        camera_subfolders, zero_based_indexing: cal.zero_based_indexing || false,
      },
    });
    const r = await validateSource({
      camera, source_path_idx: sourceIdx,
      image_format: cal.image_format, image_type: cal.image_type,
    });
    setVal(r);
    if (r?.valid && typeof r.found_count === "number" && r.found_count > 0) {
      setCal("num_images", r.found_count);
    }
    setValidating(false);
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <label className="text-xs font-medium uppercase text-muted-foreground">Calibration source (model saved here)</label>
        {sources.length > 1 && (
          <select className={inputCls} value={sourceIdx}
            onChange={(e) => setCal("source_path_idx", parseInt(e.target.value, 10))}>
            {sources.map((s, i) => <option key={i} value={i}>{s || `(source ${i + 1})`}</option>)}
          </select>
        )}
        <div className="flex gap-2">
          <input className={inputCls} value={sources[sourceIdx] || ""}
            onChange={(e) => setSourcePath(e.target.value)} placeholder="/path/to/calibration/images" />
          <Button size="sm" variant="outline" onClick={addSource}>+ Add</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          Image type
          <select className={inputCls} value={cal.image_type || "standard"}
            onChange={(e) => setCal("image_type", e.target.value)}>
            <option value="standard">Standard (TIFF/PNG/JPG)</option>
            <option value="lavision_im7">LaVision .im7</option>
            <option value="lavision_set">LaVision .set</option>
            <option value="cine">Phantom .cine</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Image format
          <input className={inputCls} value={cal.image_format || "calib%05d.tif"}
            onChange={(e) => setCal("image_format", e.target.value)} placeholder="calib%05d.tif" />
        </label>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={useSub} onChange={(e) => setCal("use_camera_subfolders", e.target.checked)} />
        Images in camera subfolders
      </label>
      {useSub && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {cams.map((c) => (
            <label key={c} className="flex flex-col gap-1 text-xs">
              Cam {c}
              <input className={inputCls} value={subs[c - 1] ?? `Cam${c}`}
                onChange={(e) => setSub(c, e.target.value)} />
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onValidate} disabled={validating}>
          {validating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Validate
        </Button>
        {val?.valid && (
          <span className="flex items-center gap-1 text-green-700 text-xs">
            <CheckCircle2 className="h-4 w-4" /> Found {String(val.found_count)}
            {val.image_size ? ` · ${val.image_size[0]}×${val.image_size[1]}` : ""}
          </span>
        )}
        {val && !val.valid && (
          <span className="flex items-center gap-1 text-red-600 text-xs"><XCircle className="h-4 w-4" /> {val.error || "not found"}</span>
        )}
      </div>

      {val && !val.valid && val.suggested_pattern && (
        <Alert>
          <AlertDescription className="flex items-center justify-between gap-2 text-xs">
            <span>Did you mean <code className="font-mono">{val.suggested_pattern}</code>?</span>
            <Button size="sm" variant="outline" onClick={() => setCal("image_format", val.suggested_pattern)}>Apply</Button>
          </AlertDescription>
        </Alert>
      )}
      {val?.valid && val.first_image_preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`data:image/png;base64,${val.first_image_preview}`} alt="preview"
          className="max-h-32 rounded border" />
      )}

      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          Frame total
          <input className={inputCls} type="number" value={cal.num_images ?? 10}
            onChange={(e) => setCal("num_images", parseInt(e.target.value || "1", 10))} />
        </label>
        <label className="flex flex-col gap-1">
          Datum frame
          <input className={inputCls} type="number" value={c2cfg.datum_frame ?? 1}
            onChange={(e) => setC2("datum_frame", parseInt(e.target.value || "1", 10))} />
        </label>
        <label className="flex flex-col gap-1">
          dt (s)
          <input className={inputCls} type="number" step="any" value={c2cfg.dt ?? 1}
            onChange={(e) => setC2("dt", parseFloat(e.target.value || "1"))} />
        </label>
      </div>

      {stereo ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">Camera 1
            <select className={inputCls} value={pair[0]}
              onChange={(e) => setC2("camera_pair", [parseInt(e.target.value, 10), pair[1]])}>
              {cams.map((c) => <option key={c} value={c}>Cam {c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">Camera 2
            <select className={inputCls} value={pair[1]}
              onChange={(e) => setC2("camera_pair", [pair[0], parseInt(e.target.value, 10)])}>
              {cams.map((c) => <option key={c} value={c}>Cam {c}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <label className="flex flex-col gap-1 w-1/2">Camera
          <select className={inputCls} value={c2cfg.camera ?? 1}
            onChange={(e) => setC2("camera", parseInt(e.target.value, 10))}>
            {cams.map((c) => <option key={c} value={c}>Cam {c}</option>)}
          </select>
        </label>
      )}
    </div>
  );
};
