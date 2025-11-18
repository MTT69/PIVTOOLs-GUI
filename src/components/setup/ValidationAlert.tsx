import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface ValidationAlertProps {
  validation: {
    valid: boolean;
    checked: boolean;
    error?: string;
  };
}

export function ValidationAlert({ validation }: ValidationAlertProps) {
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
    return (
      <Alert className="border-green-500 bg-green-50">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-sm text-green-800">
          Image files found and validated successfully!
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
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
