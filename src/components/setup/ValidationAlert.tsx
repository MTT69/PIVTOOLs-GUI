import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";

/**
 * Base validation state that ValidationAlert accepts.
 * This is compatible with ValidationState from useConfigUpdate and the
 * per-board validation shapes returned by the calibration hooks.
 */
interface BaseValidationState {
  valid: boolean;
  checked: boolean;
  error?: string | null;
  /** Nothing to validate yet: `error` (if any) is shown as a muted note. */
  idle?: boolean;
  abCountWarning?: string | null;
  /** Files found in each failing camera's folder, headed by the camera's label. */
  sampleFiles?: { label: string; files: string[] }[];
}

interface ValidationAlertProps {
  validation: BaseValidationState;
  /** Custom success message to display instead of default */
  customSuccessMessage?: string;
  /**
   * Opt-in label for the pending (re-validating) state. When set and the validation is
   * not yet `checked` with no current error, a neutral spinner with this label is shown
   * instead of nothing. Calibration tabs pass "Validating…" so a previous source/format
   * error is replaced by a spinner the instant an input changes (stale errors never linger).
   * Callers that omit it keep the original behaviour (nothing shown until an error/result).
   */
  pendingLabel?: string;
  /** Optional count of found items to display */
  foundCount?: number | string;
}

export function ValidationAlert({ validation, customSuccessMessage, foundCount, pendingLabel }: ValidationAlertProps) {
  // Idle: nothing to validate yet. No spinner, no alert colour.
  if (validation.idle) {
    return validation.error ? (
      <p className="text-sm text-muted-foreground">{validation.error}</p>
    ) : null;
  }

  // Checking / re-validating state: show the in-flight error if one is present, else the
  // opt-in pending label. Callers that pass `pendingLabel` get a neutral spinner while a
  // fresh check runs; callers that don't keep the original "nothing until error" behaviour.
  if (!validation.checked && (validation.error || pendingLabel)) {
    return (
      <Alert className="border-blue-500 bg-blue-50">
        <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
        <AlertDescription className="text-sm text-blue-800">
          {validation.error || pendingLabel}
        </AlertDescription>
      </Alert>
    );
  }

  // Success state
  if (validation.checked && validation.valid) {
    const message = customSuccessMessage
      ? customSuccessMessage
      : foundCount !== undefined
        ? `Found ${foundCount} image${foundCount !== 1 ? 's' : ''} and validated successfully!`
        : "Image files found and validated successfully!";

    // A valid set can still carry notes (grayscale conversion, subset, a 0/1 start-index
    // hint); they are shown under the success line.
    const notes = validation.error && <div className="mt-1 text-xs">{validation.error}</div>;

    // A/B count mismatch is a warning, not a failure
    if (validation.abCountWarning) {
      return (
        <Alert className="border-yellow-500 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-sm text-yellow-800">
            {message}
            {validation.abCountWarning && (
              <div className="mt-1 text-yellow-700">
                <strong>Warning:</strong> {validation.abCountWarning}
              </div>
            )}
            {notes}
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <Alert className="border-green-500 bg-green-50">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-sm text-green-800">
          {message}
          {notes}
        </AlertDescription>
      </Alert>
    );
  }

  // Error state
  if (validation.checked && !validation.valid && validation.error) {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Validation Failed</AlertTitle>
        <AlertDescription className="text-sm">
          {validation.error}
          {/* Show files found in each failing camera's folder for context */}
          {validation.sampleFiles?.map(({ label, files }) => (
            <div key={label} className="mt-2 p-2 bg-muted/30 rounded text-xs font-mono">
              <p className="font-medium text-muted-foreground">{label}</p>
              <p className="font-medium text-muted-foreground mb-1">Files found in folder:</p>
              {files.map((f, i) => (
                <div key={i} className="text-muted-foreground">{f}</div>
              ))}
            </div>
          ))}
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
