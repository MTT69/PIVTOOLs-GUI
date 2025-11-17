import { useCallback, useState } from 'react';

interface ValidationState {
  valid: boolean;
  error?: string;
  checked: boolean;
}

export function useConfigUpdate() {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  /**
   * Update configuration on the backend
   */
  const updateConfig = useCallback(async (payload: any): Promise<{ success: boolean; data?: any; error?: string }> => {
    setIsUpdating(true);
    setUpdateError(null);

    try {
      const res = await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok) {
        const errorMsg = json.error || 'Failed to update configuration';
        setUpdateError(errorMsg);
        return { success: false, error: errorMsg };
      }

      return { success: true, data: json };
    } catch (e: any) {
      const errorMsg = `Failed to update config: ${e.message}`;
      setUpdateError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsUpdating(false);
    }
  }, []);

  return {
    updateConfig,
    isUpdating,
    updateError,
  };
}

export function usePathValidation() {
  const [validationStatus, setValidationStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [validationError, setValidationError] = useState<string | undefined>(undefined);

  /**
   * Validate that image files exist at the configured paths
   */
  const validatePaths = useCallback(async (
    sourcePaths: string[],
    cameraNumbers: number[]
  ): Promise<ValidationState> => {
    if (sourcePaths.length === 0) {
      const error = 'No source paths configured. Please add at least one source directory.';
      setValidationStatus('invalid');
      setValidationError(error);
      return { valid: false, error, checked: true };
    }

    setValidationStatus('checking');
    setValidationError(undefined);

    try {
      // Use the first camera from camera_numbers (which are the selected cameras for processing)
      const cameraToTest = cameraNumbers[0] || 1;
      const res = await fetch(`/backend/get_frame_pair?camera=${cameraToTest}&idx=1&source_path_idx=0`);

      if (res.ok) {
        setValidationStatus('valid');
        setValidationError(undefined);
        return { valid: true, checked: true };
      } else {
        const json = await res.json();
        const errorMsg = json.detail || json.error || 'Image files could not be found with the current configuration.';
        setValidationStatus('invalid');
        setValidationError(errorMsg);
        return { valid: false, error: errorMsg, checked: true };
      }
    } catch (e: any) {
      const errorMsg = `Failed to validate paths: ${e.message}`;
      setValidationStatus('invalid');
      setValidationError(errorMsg);
      return { valid: false, error: errorMsg, checked: true };
    }
  }, []);

  /**
   * Reset validation state
   */
  const resetValidation = useCallback(() => {
    setValidationStatus('idle');
    setValidationError(undefined);
  }, []);

  return {
    validationStatus,
    validationError,
    validatePaths,
    resetValidation,
  };
}
