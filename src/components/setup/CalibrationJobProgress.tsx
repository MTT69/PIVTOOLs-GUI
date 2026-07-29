import React from "react";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ApplyJobStatus, formatDuration } from "@/lib/applyJob";

interface CalibrationJobProgressProps {
  /** Poll result for the apply job; null before one starts. */
  job: ApplyJobStatus | null | undefined;
  /** Heading, e.g. "Vector Calibration" or "3D Reconstruction". */
  title: string;
}

/**
 * In-progress display for the calibration apply job, shared by every calibration tab.
 *
 * Renders nothing unless the job is starting/running — each tab keeps its own completed and
 * failed blocks, which carry tab-specific detail (global alignment, camera counts).
 *
 * Every detail segment is omitted when the backend has not reported it, so nothing on screen
 * is invented: no zero frame counts before the first tick, no ETA before progress leaves 0
 * (the backend only sends `estimated_remaining` once it is meaningful).
 */
export const CalibrationJobProgress: React.FC<CalibrationJobProgressProps> = ({
  job,
  title,
}) => {
  if (!job || (job.status !== "running" && job.status !== "starting")) return null;

  const showDatasets = job.total_units > 1;
  // processed_units counts units FINISHED, so the running one is the next index along. It can
  // momentarily equal total_units between the last unit finishing and the job completing.
  const currentUnit = Math.min(job.processed_units + 1, job.total_units);
  const showFrames = !!job.frame_total && job.frame_total > 0;

  const detail: string[] = [];
  if (job.unit_label) detail.push(job.unit_label);
  if (showDatasets) detail.push(`dataset ${currentUnit}/${job.total_units}`);
  if (showFrames) detail.push(`frames ${job.frame_done ?? 0}/${job.frame_total}`);
  if (job.estimated_remaining !== undefined) {
    detail.push(`~${formatDuration(job.estimated_remaining)} remaining`);
  }

  return (
    <div className="mt-4 p-3 border rounded bg-green-50">
      <div className="flex items-center gap-2 text-sm mb-2">
        <Loader2 className="h-4 w-4 animate-spin text-green-600" />
        <strong>{title}:</strong>
        <span className="capitalize">{job.status}</span>
      </div>
      <Progress value={job.progress} />
      {detail.length > 0 && (
        <div className="text-xs text-muted-foreground mt-1">{detail.join(" | ")}</div>
      )}
    </div>
  );
};
