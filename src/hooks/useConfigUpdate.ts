import { useCallback, useState, useEffect, useRef } from 'react';

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

/**
 * Simple, automatic path validation hook
 * Validates when config changes, no manual triggering needed
 */
export function useAutoValidation(config: any) {
  const [validation, setValidation] = useState<ValidationState>({
    valid: false,
    checked: false,
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastValidatedRef = useRef<string>('');

  useEffect(() => {
    // Create a validation key from critical config
    const validationKey = JSON.stringify({
      sourcePaths: config?.paths?.source_paths,
      imageFormat: config?.images?.image_format,
      cameraNumbers: config?.paths?.camera_numbers,
    });

    // Skip if nothing changed
    if (validationKey === lastValidatedRef.current) {
      return;
    }

    // Skip if no meaningful config
    const hasConfig = config?.paths?.source_paths?.length > 0;
    if (!hasConfig) {
      setValidation({ valid: false, checked: false, error: 'No configuration loaded' });
      return;
    }

    lastValidatedRef.current = validationKey;

    // Clear any pending validation
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set pending state
    setValidation({ valid: false, checked: false, error: 'Validating...' });

    // Validate after short delay
    timerRef.current = setTimeout(async () => {
      console.log('🔍 Auto-validation: Starting...');

      const sourcePaths = config.paths?.source_paths || [];
      const cameraNumbers = config.paths?.camera_numbers || [1];
      const cameraToTest = cameraNumbers[0] || 1;

      try {
        const url = `/backend/get_frame_pair?camera=${cameraToTest}&idx=1&source_path_idx=0`;
        console.log('🔍 Auto-validation: Fetching', url);

        const res = await fetch(url);

        if (res.ok) {
          console.log('✅ Auto-validation: Success');
          setValidation({ valid: true, checked: true });

          // Preload images
          fetch('/backend/preload_images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ camera: cameraToTest, start_idx: 1, count: 10, source_path_idx: 0 }),
          }).catch(e => console.warn('Failed to preload:', e));
        } else {
          const json = await res.json();
          const errorMsg = json.detail || json.error || 'Image files not found';
          console.log('❌ Auto-validation: Failed -', errorMsg);
          setValidation({ valid: false, checked: true, error: errorMsg });
        }
      } catch (e: any) {
        console.log('❌ Auto-validation: Error -', e.message);
        setValidation({ valid: false, checked: true, error: `Validation failed: ${e.message}` });
      }
    }, 500);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [config?.paths?.source_paths, config?.images?.image_format, config?.paths?.camera_numbers]);

  return validation;
}
