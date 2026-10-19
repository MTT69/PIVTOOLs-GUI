import React from "react";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ApplyJobStatus, formatDtUsed, formatDuration, isApplyJobActive } from "@/lib/applyJob";

interface CalibrationJobProgressProps {
  /** Poll result for the apply job; null before one starts. */
  job: ApplyJobStatus | null | undefined;
  /** Heading, e.g. "Vector Calibration" or "3D Reconstruction". */
  title: string;
  /** Requests a cancel; the button is hidden when omitted. */
  onCancel?: () => void;
  /** A cancel request is waiting for the backend to settle the job. */
  cancelling?: boolean;
  /** Why the last cancel request failed. */
  cancelError?: string | null;
}

/**
 * In-progress and cancelled display for the calibration apply job, shared by every tab.
 *
 * Renders nothing for completed/failed jobs — each tab keeps its own completed and failed
 * blocks, which carry tab-specific detail (global alignment, camera counts).
 *
 * Every detail segment is omitted when the backend has not reported it, so nothing on screen
 * is invented: no zero frame counts before the first tick, no ETA before progress leaves 0
 * (the backend only sends `estimated_remaining` once it is meaningful).
 */
export const CalibrationJobProgress: React.FC<CalibrationJobProgressProps> = ({
  job,
  title,
  onCancel,
  cancelling = false,
  cancelError = null,
}) => {
  if (!job) return null;
  const dtUsed = formatDtUsed(job);

  if (job.status === "cancelled") {
    const frames = job.frame_total ? ` at frame ${job.frame_done ?? 0}/${job.frame_total}` : "";
    return (
      <div className="mt-4 p-3 border rounded bg-amber-50 text-sm text-amber-800">
        <XCircle className="h-4 w-4 inline mr-2" />
        {title} cancelled{job.unit_label ? ` during ${job.unit_label}` : ""}{frames}.
        {/* The backend's account of what was written and where. */}
        {job.error && <div className="text-xs mt-1">{job.error}</div>}
        {dtUsed && <div className="text-xs mt-1">{dtUsed}</div>}
        <ApplyJobWarnings job={job} />
      </div>
    );
  }

  if (!isApplyJobActive(job)) return null;

  const totalUnits = job.total_units;
  // Unknown total once running: show the running unit against "?" rather than an invented
  // count. While still starting nothing has been reported, so nothing is shown.
  const showDatasets = totalUnits === null ? job.status === "running" : totalUnits > 1;
  // processed_units counts units FINISHED, so the running one is the next index along. It can
  // momentarily equal total_units between the last unit finishing and the job completing.
  const currentUnit = totalUnits === null ? job.processed_units + 1 : Math.min(job.processed_units + 1, totalUnits);
  const showFrames = !!job.frame_total && job.frame_total > 0;

  const detail: string[] = [];
  if (job.unit_label) detail.push(job.unit_label);
  if (showDatasets) detail.push(`dataset ${currentUnit}/${totalUnits ?? "?"}`);
  if (showFrames) detail.push(`frames ${job.frame_done ?? 0}/${job.frame_total}`);
  if (job.estimated_remaining !== undefined) {
    detail.push(`~${formatDuration(job.estimated_remaining)} remaining`);
  }
  if (dtUsed) detail.push(dtUsed);

  return (
    <div className="mt-4 p-3 border rounded bg-green-50">
      <div className="flex items-center gap-2 text-sm mb-2">
        <Loader2 className="h-4 w-4 animate-spin text-green-600" />
        <strong>{title}:</strong>
        <span className="capitalize">{cancelling ? "cancelling" : job.status}</span>
        {onCancel && (
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={onCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>
      <Progress value={job.progress} />
      {detail.length > 0 && (
        <div className="text-xs text-muted-foreground mt-1">{detail.join(" | ")}</div>
      )}
      {cancelError && <div className="text-xs text-red-600 mt-1">{cancelError}</div>}
      <ApplyJobWarnings job={job} />
    </div>
  );
};

/** The job's non-fatal warnings, one per line; nothing when the backend sent none. */
export const ApplyJobWarnings: React.FC<{ job: ApplyJobStatus }> = ({ job }) => {
  if (!job.warnings || job.warnings.length === 0) return null;
  return (
    <ul className="text-xs text-amber-700 mt-1 list-disc pl-5">
      {job.warnings.map((w, i) => <li key={i}>{w}</li>)}
    </ul>
  );
};
