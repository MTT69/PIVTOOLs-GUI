import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type Interpolator = "cubic" | "lanczos";

/**
 * Stereo 3C reconstruction resample kernel.
 *
 * Selects how cam2's displacement field is resampled onto cam1's grid. "lanczos"
 * (default) and "cubic" use cv2.remap and remove the grid-locked variance ringing the
 * legacy bilinear resample imprints on stereo RMS / Reynolds-stress fields.
 */
export function InterpolatorSelect({
  value,
  onValueChange,
  disabled,
}: {
  value: Interpolator;
  onValueChange: (v: Interpolator) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground whitespace-nowrap" title="Cam2 resample kernel for 3C reconstruction">
        Interpolation
      </span>
      <Select value={value} onValueChange={(v) => onValueChange(v as Interpolator)} disabled={disabled}>
        <SelectTrigger className="w-[120px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="lanczos">Lanczos</SelectItem>
          <SelectItem value="cubic">Cubic</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
