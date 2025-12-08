import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface ValidationAlertProps {
  validation: {
    valid: boolean;
    checked: boolean;
    error?: string | null;
    suggested_pattern?: string | null;
  };
  /** Custom success message to display instead of default */
  customSuccessMessage?: string;
  /** Optional count of found items to display */
  foundCount?: number | string;
  /** Callback when user clicks to apply suggested pattern */
  onApplySuggestedPattern?: (pattern: string) => void;
}

export function ValidationAlert({ validation, customSuccessMessage, foundCount, onApplySuggestedPattern }: ValidationAlertProps) {
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
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Validation Failed</AlertTitle>
        <AlertDescription className="text-sm">
          {validation.error}
          {validation.suggested_pattern && onApplySuggestedPattern && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-muted-foreground">Did you mean:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onApplySuggestedPattern(validation.suggested_pattern!)}
                className="text-blue-600 border-blue-300 hover:bg-blue-50 font-mono"
              >
                {validation.suggested_pattern}
              </Button>
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
