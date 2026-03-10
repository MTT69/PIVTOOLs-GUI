import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { PatternValidation } from "@/hooks/useConfigUpdate";

/**
 * Base validation state that ValidationAlert accepts.
 * This is compatible with both ValidationState from useConfigUpdate
 * and PinholeValidationResult from useCalibrationValidation.
 */
interface BaseValidationState {
  valid: boolean;
  checked: boolean;
  error?: string | null;
  suggested_pattern?: string | null;
  suggested_pattern_b?: string | null;
  suggested_mode?: 'ab_format' | 'skip_frames' | null;
  suggested_subfolder?: string | null;
  patternValidations?: PatternValidation[];
  abCountWarning?: string | null;
}

interface ValidationAlertProps {
  validation: BaseValidationState;
  /** Custom success message to display instead of default */
  customSuccessMessage?: string;
  /** Optional count of found items to display */
  foundCount?: number | string;
  /** Current pairing mode from config (used to preserve mode when applying suggestions) */
  currentMode?: 'ab_format' | 'skip_frames';
  /** Callback when user clicks to apply suggested pattern(s) */
  onApplySuggestedPattern?: (pattern: string, patternB?: string | null, mode?: string | null) => void;
  /** Callback when user clicks to apply a suggested camera subfolder */
  onApplySuggestedSubfolder?: (subfolder: string) => void;
}

export function ValidationAlert({ validation, customSuccessMessage, foundCount, currentMode, onApplySuggestedPattern, onApplySuggestedSubfolder }: ValidationAlertProps) {
  // Checking state
  if (!validation.checked && validation.error) {
    return (
      <Alert className="border-blue-500 bg-blue-50">
        <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
        <AlertDescription className="text-sm text-blue-800">
          {validation.error}
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

    // Check for A/B count warning (validation passed but counts differ)
    if (validation.abCountWarning) {
      return (
        <Alert className="border-yellow-500 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-sm text-yellow-800">
            {message}
            <div className="mt-1 text-yellow-700">
              <strong>Warning:</strong> {validation.abCountWarning}
            </div>
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <Alert className="border-green-500 bg-green-50">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-sm text-green-800">
          {message}
        </AlertDescription>
      </Alert>
    );
  }

  // Error state
  if (validation.checked && !validation.valid && validation.error) {
    // Check if we have per-pattern validations with individual suggestions
    // In this case, show a simpler overall message since suggestions are shown inline
    const hasPerPatternSuggestions = validation.patternValidations?.some(
      pv => !pv.valid && pv.suggested_pattern
    );

    // Count invalid patterns
    const invalidPatterns = validation.patternValidations?.filter(pv => !pv.valid) || [];
    const invalidCount = invalidPatterns.length;
    const totalPatterns = validation.patternValidations?.length || 0;

    // Build a cleaner error summary when per-pattern details are shown inline
    let errorSummary = validation.error;
    if (hasPerPatternSuggestions && totalPatterns > 0) {
      if (invalidCount === totalPatterns) {
        errorSummary = totalPatterns === 1
          ? "Pattern validation failed"
          : "All patterns failed validation";
      } else {
        const failedLabels = invalidPatterns.map(p => `Pattern ${p.label}`).join(', ');
        errorSummary = `${failedLabels} failed validation`;
      }
    }

    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Validation Failed</AlertTitle>
        <AlertDescription className="text-sm">
          {errorSummary}
          {/* Only show legacy global suggestion if no per-pattern suggestions */}
          {!hasPerPatternSuggestions && validation.suggested_pattern && onApplySuggestedPattern && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-muted-foreground">Did you mean:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onApplySuggestedPattern(
                  validation.suggested_pattern!,
                  validation.suggested_pattern_b,
                  validation.suggested_mode
                )}
                className="text-blue-600 border-blue-300 hover:bg-blue-50 font-mono"
              >
                {validation.suggested_pattern}
                {validation.suggested_pattern_b && ` + ${validation.suggested_pattern_b}`}
              </Button>
            </div>
          )}
          {validation.suggested_subfolder && onApplySuggestedSubfolder && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-muted-foreground">Did you mean folder:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onApplySuggestedSubfolder(validation.suggested_subfolder!)}
                className="text-blue-600 border-blue-300 hover:bg-blue-50 font-mono"
              >
                {validation.suggested_subfolder}
              </Button>
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
