"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";

const inputCls = "border rounded px-2 py-1 bg-background w-full";

interface Props {
  stereo: boolean;
  cfg: any;
  set: (key: string, value: any) => void;
  board: string;
  sourceIdx: number;
  camera: number;
  pair: number[];
  startApply: (body: any) => Promise<any>;
  applyStatus: (jobId: string) => Promise<any>;
}

export const ApplyVectorsPanel: React.FC<Props> = ({
  stereo, cfg, set, board, sourceIdx, camera, pair, startApply, applyStatus,
}) => {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId) return;
    timer.current = setInterval(async () => {
      const s = await applyStatus(jobId);
      setStatus(s);
      if (s?.status === "completed" || s?.status === "failed") {
        if (timer.current) clearInterval(timer.current);
      }
    }, 700);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [jobId, applyStatus]);

  const onApply = async () => {
    if (starting) return;
    setStarting(true);
    setStatus(null);
    const body: any = {
      board, source_path_idx: sourceIdx, dt: cfg.dt ?? 1, stereo,
      calibrated_dir: cfg.calibrated_dir,
      vector_glob: cfg.vector_glob || "B*.mat",
      z_world: cfg.z_world ?? 0, tilt_x: cfg.tilt_x ?? 0, tilt_y: cfg.tilt_y ?? 0,
    };
    if (stereo) {
      body.camera_pair = pair;
      body.uncalibrated_dir_cam1 = cfg.uncalibrated_dir_cam1;
      body.uncalibrated_dir_cam2 = cfg.uncalibrated_dir_cam2;
    } else {
      body.camera = camera;
      body.uncalibrated_dir = cfg.uncalibrated_dir;
    }
    const res = await startApply(body);
    if (res?.job_id) setJobId(res.job_id);
    setStarting(false);
  };

  const running = starting || status?.status === "running" || status?.status === "starting";
  const progress = status?.progress ?? 0;

  return (
    <div className="space-y-2 text-sm border-t pt-3">
      <div className="font-medium">Apply to PIV output</div>
      {stereo ? (
        <>
          <label className="flex flex-col gap-1">Uncalibrated cam {pair[0]}
            <input className={inputCls} value={cfg.uncalibrated_dir_cam1 || ""}
              onChange={(e) => set("uncalibrated_dir_cam1", e.target.value)} placeholder="…/Cam1/instantaneous" />
          </label>
          <label className="flex flex-col gap-1">Uncalibrated cam {pair[1]}
            <input className={inputCls} value={cfg.uncalibrated_dir_cam2 || ""}
              onChange={(e) => set("uncalibrated_dir_cam2", e.target.value)} placeholder="…/Cam2/instantaneous" />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1">Uncalibrated dir
          <input className={inputCls} value={cfg.uncalibrated_dir || ""}
            onChange={(e) => set("uncalibrated_dir", e.target.value)} placeholder="…/uncalibrated_piv/…/instantaneous" />
        </label>
      )}
      <label className="flex flex-col gap-1">Calibrated output dir
        <input className={inputCls} value={cfg.calibrated_dir || ""}
          onChange={(e) => set("calibrated_dir", e.target.value)} placeholder="…/calibrated_piv/…/instantaneous" />
      </label>
      <label className="flex flex-col gap-1">Vector file pattern
        <input className={inputCls} value={cfg.vector_glob || "B*.mat"}
          onChange={(e) => set("vector_glob", e.target.value)} placeholder="B*.mat" />
      </label>

      <Button onClick={onApply} disabled={running} variant="secondary">
        {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {stereo ? "Reconstruct 3C" : "Apply"} to vectors
      </Button>

      {status && (
        <div className="space-y-1">
          {running && (
            <div className="h-2 w-full rounded bg-muted overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
          {running && <span className="text-xs text-muted-foreground">{progress}% — {status.processed ?? 0}/{status.total ?? "?"} frames</span>}
          {status.status === "completed" && (
            <span className="flex items-center gap-1 text-green-700">
              <CheckCircle2 className="h-4 w-4" /> {status.n_frames} frame(s) → {status.out_dir}
            </span>
          )}
          {status.status === "failed" && <span className="text-red-600 text-xs">{status.error}</span>}
        </div>
      )}
    </div>
  );
};
