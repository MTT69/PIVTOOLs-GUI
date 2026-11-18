import { AlertTriangle } from "lucide-react";

/**
 * Warnings that did not stop anything but must be seen: amber, with an icon, one box per
 * line. The one style for source-diagnosis warnings (DaVis's SetIsSuspicious flag) and
 * calibration warnings (frames applied without a comparison).
 */
export function WarningLines({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {lines.map((w, i) => (
        <p
          key={i}
          role="alert"
          className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 whitespace-pre-wrap"
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
          <span>{w}</span>
        </p>
      ))}
    </div>
  );
}
