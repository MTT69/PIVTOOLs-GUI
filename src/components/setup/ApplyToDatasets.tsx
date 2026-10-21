import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApplyJobWarnings, CalibrationJobProgress } from "@/components/setup/CalibrationJobProgress";
import { CalibrationFamilyJob } from "@/contexts/CalibrationJobContext";
import { formatDtUsed, isApplyJobActive } from "@/lib/applyJob";

/**
 * The calibration apply targets: which PIV datasets (`paths.base_paths`) a saved model is
 * applied to. Every tab's apply/reconstruct action uses these two pieces:
 *
 *   - {@link ApplyDatasetButtons}: a dataset picker with "Apply to this dataset" and "Apply to
 *     all N datasets" (a single "Apply" when one dataset is configured). Both send an explicit
 *     `active_paths`, never an omitted one. A mono (planar) apply calibrates EVERY configured
 *     camera, so on a multi-camera rig the labels say so ("(all N cameras)").
 *   - {@link ApplyJobsStatus}: progress / result of every job of the tab's family, each named
 *     by its target datasets, so a run on dataset b beside one on dataset a stays visible and
 *     cancellable.
 */

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** "#<index> <folder>" for a base-path index; the index alone when it is no longer configured. */
export function datasetName(basePaths: string[], idx: number): string {
  return idx < basePaths.length ? `#${idx} ${basename(basePaths[idx])}` : `#${idx}`;
}

/** Human list of a job's targets: "all N datasets" when it covers every configured one. */
function targetsText(basePaths: string[], datasets: number[]): string {
  if (basePaths.length > 1 && datasets.length === basePaths.length
      && datasets.every((d, i) => d === i)) {
    return `all ${basePaths.length} datasets`;
  }
  return datasets.map(d => datasetName(basePaths, d)).join(", ");
}

const sameTargets = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The dataset the picker starts on: the first configured `paths.active_paths` index that is in
 * range, else 0.
 */
export function defaultDatasetIdx(config: any): number {
  const n: number = config?.paths?.base_paths?.length ?? 0;
  const active: unknown = config?.paths?.active_paths;
  const first = Array.isArray(active) ? active.find(i => Number.isInteger(i) && i >= 0 && i < n) : undefined;
  return typeof first === "number" ? first : 0;
}

interface ApplyDatasetButtonsProps {
  basePaths: string[];
  /** Initial picker selection (see {@link defaultDatasetIdx}). */
  defaultIdx: number;
  /**
   * The family's jobs: a button is busy while a job with exactly its targets runs, and disabled
   * while any job on one of its targets runs.
   */
  jobs: CalibrationFamilyJob[];
  /** Start an apply on these base-path indices (sorted ascending). */
  onApply: (datasets: number[]) => void;
  /** E.g. no model yet. */
  disabled?: boolean;
  /** Tooltip, e.g. why the buttons are disabled. */
  title?: string;
  /** Tab-specific button colours. */
  buttonClassName?: string;
  /**
   * Cameras one apply calibrates (mono tabs: every configured camera). Above 1 the labels name
   * the count; omit for stereo tabs, whose apply is the selected pair.
   */
  cameraCount?: number;
}

export const ApplyDatasetButtons: React.FC<ApplyDatasetButtonsProps> = ({
  basePaths, defaultIdx, jobs, onApply, disabled = false, title, buttonClassName, cameraCount,
}) => {
  const [picked, setPicked] = useState(defaultIdx);
  const n = basePaths.length;
  const idx = picked < n ? picked : 0;
  const all = Array.from({ length: n }, (_, i) => i);
  const active = jobs.filter(j => isApplyJobActive(j.status));

  const button = (label: string, targets: number[]) => {
    const busy = active.some(j => sameTargets(j.datasets, targets));
    // A running job on any of these datasets writes the same output folders, so the backend's
    // overlap guard would refuse this apply; disable it here instead of showing a failed row.
    const blocked = !busy && active.some(j => j.datasets.some(d => targets.includes(d)));
    return (
      <Button
        onClick={() => onApply(targets)}
        disabled={disabled || busy || blocked || n === 0}
        className={buttonClassName}
        title={n === 0 ? "Configure base paths (Settings → Directories) first"
          : blocked ? "An apply is already running on one of these datasets" : title}
      >
        {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {label}
      </Button>
    );
  };

  const multiCam = cameraCount !== undefined && cameraCount > 1;
  const cams = multiCam ? ` (all ${cameraCount} cameras)` : "";
  if (n <= 1) return button(multiCam ? `Apply to all ${cameraCount} cameras` : "Apply", all);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={String(idx)} onValueChange={v => setPicked(Number(v))}>
        <SelectTrigger className="w-[180px]" title="Dataset (base path) to apply to">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {basePaths.map((p, i) => (
            <SelectItem key={i} value={String(i)} title={p}>{datasetName(basePaths, i)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {button(`Apply to this dataset${cams}`, [idx])}
      {button(`Apply to all ${n} datasets${cams}`, all)}
    </div>
  );
};

interface ApplyJobsStatusProps {
  jobs: CalibrationFamilyJob[];
  basePaths: string[];
  /** Heading, e.g. "Vector calibration" or "3D reconstruction". */
  title: string;
  onCancel: (datasets: number[]) => void;
}

/** Progress, cancel and result of each job in the family, named by its target datasets. */
export const ApplyJobsStatus: React.FC<ApplyJobsStatusProps> = ({ jobs, basePaths, title, onCancel }) => (
  <>
    {jobs.map(job => {
      const targets = targetsText(basePaths, job.datasets);
      const key = job.datasets.join(",");
      if (job.status.status === "completed") {
        const dtUsed = formatDtUsed(job.status);
        const outDirs = job.status.out_dirs ?? [];
        return (
          <div key={key} className="mt-4 p-3 border rounded bg-green-50 text-green-700 text-sm">
            <CheckCircle2 className="h-4 w-4 inline mr-2" />
            {title} completed for {targets}.
            {dtUsed && <div className="text-xs mt-1">{dtUsed}</div>}
            {!!job.status.n_frames_skipped && (
              <div className="text-xs mt-1 text-amber-700">
                {job.status.n_frames_skipped} frame(s) skipped (pass absent)
              </div>
            )}
            {outDirs.length > 0 && (
              <div className="text-xs mt-1">
                Written to:
                <ul className="list-disc pl-5 font-mono break-all">
                  {outDirs.map(d => <li key={d}>{d}</li>)}
                </ul>
              </div>
            )}
            <ApplyJobWarnings job={job.status} />
          </div>
        );
      }
      if (job.status.status === "failed") {
        return (
          <div key={key} className="mt-4 p-3 border rounded bg-red-50 text-red-700 text-sm">
            <AlertTriangle className="h-4 w-4 inline mr-2" />
            {title} failed for {targets}: {job.status.error || "unknown error"}
          </div>
        );
      }
      return (
        <CalibrationJobProgress key={key} job={job.status} title={`${title} (${targets})`}
          onCancel={() => onCancel(job.datasets)} cancelling={job.cancelRequested}
          cancelError={job.cancelError} />
      );
    })}
  </>
);
