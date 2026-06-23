import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Dropdown for a PIV window axis length, limited to the sizes the codelet FFT
 * engine was built for (served by the backend via {@link useFftSizes}). The FFT
 * only supports these sizes, so typing arbitrary numbers is no longer allowed.
 *
 * If the currently-stored value is not one of the built sizes (e.g. a legacy or
 * hand-edited config.yaml), it is shown as a flagged "(unsupported)" item so the
 * bad value is visible and the user can correct it — it is never silently dropped.
 */
interface WindowSizeSelectProps {
  value: number | string;
  onChange: (value: string) => void;
  sizes: number[];
  className?: string;
  disabled?: boolean;
}

export function WindowSizeSelect({ value, onChange, sizes, className, disabled }: WindowSizeSelectProps) {
  const current = value === "" || value === undefined || value === null ? "" : String(value);
  const isUnsupported = current !== "" && !sizes.map(String).includes(current);

  return (
    <Select value={current} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Size" />
      </SelectTrigger>
      <SelectContent>
        {sizes.map((s) => (
          <SelectItem key={s} value={String(s)}>{s}</SelectItem>
        ))}
        {isUnsupported && (
          <SelectItem key={current} value={current} className="text-red-600">
            {current} (unsupported)
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
