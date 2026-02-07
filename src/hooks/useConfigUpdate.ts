import { useCallback, useState, useEffect, useRef } from 'react';

/** Validation result for a single pattern (A or B) */
export interface PatternValidation {
  index: number;
  label: string;  // "A", "B", or "pattern"
  pattern: string;
  valid: boolean;
  found_count?: number | 'container';
  error?: string | null;
  suggested_pattern?: string | null;
  sample_files?: string[];
}

export interface ValidationState {
  valid: boolean;
  error?: string | null;
  checked: boolean;
  /** Per-pattern validation results (new) */
  patternValidations?: PatternValidation[];
  /** Warning if A/B file counts differ significantly */
  abCountWarning?: string | null;
  // Legacy fields for backward compatibility
  suggested_pattern?: string | null;
  suggested_pattern_b?: string | null;  // For A/B pair detection
  suggested_mode?: 'ab_format' | 'skip_frames' | null;  // Detected pairing mode
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
    // Include ALL fields that affect file loading
    const validationKey = JSON.stringify({
      sourcePaths: config?.paths?.source_paths,
      imageFormat: config?.images?.image_format,
      cameraNumbers: config?.paths?.camera_numbers,
      cameraSubfolders: config?.paths?.camera_subfolders,
      cameraCount: config?.paths?.camera_count,
      numImages: config?.images?.num_images,
      startIndex: config?.images?.start_index,
      pairingPreset: config?.images?.pairing_preset,
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
      const sourcePaths = config.paths?.source_paths || [];
      const cameraNumbers = config.paths?.camera_numbers || [1];
      const cameraToTest = cameraNumbers[0] || 1;

      try {
        // Use new smart validation endpoint
        const res = await fetch('/backend/validate_files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_path_idx: 0 }),
        });

        if (res.ok) {
          const json = await res.json();
          const details = json.details || {};

          // Extract per-pattern validations and A/B count warning from first camera
          const firstCamera = Object.values(details)[0] as any;
          const patternValidations: PatternValidation[] = firstCamera?.pattern_validations || [];
          const abCountWarning = firstCamera?.ab_count_warning || null;

          if (json.valid) {
            // Check for color images or subset processing
            const messages: string[] = [];

            Object.values(details).forEach((detail: any) => {
              if (detail.color_detected) {
                messages.push('Color images will be converted to grayscale');
              }
              if (detail.error && detail.error.startsWith('Processing subset:')) {
                messages.push(detail.error);
              }
              if (detail.indexing_warning) {
                messages.push(detail.indexing_warning);
              }
              if (detail.ab_count_warning) {
                messages.push(detail.ab_count_warning);
              }
            });

            const message = messages.length > 0 ? messages.join('. ') + '.' : undefined;

            setValidation({
              valid: true,
              checked: true,
              error: message,
              patternValidations,
              abCountWarning,
            });

            // Note: Preloading is handled by ImagePairViewer which knows the user's format preference
            // We don't preload here to avoid loading the wrong format (jpeg vs png)
          } else {
            // Build detailed error message from validation results
            const errors: string[] = [];
            const warnings: string[] = [];
            let suggestedPattern: string | null = null;
            let suggestedPatternB: string | null = null;
            let suggestedMode: 'ab_format' | 'skip_frames' | null = null;

            Object.entries(details).forEach(([key, value]: [string, any]) => {
              if (value.status === 'error') {
                // Use the detailed error message if available
                const errorDetail = value.error ||
                  (value.expected_count && value.actual_count !== value.expected_count
                    ? `Found ${value.actual_count}/${value.expected_count} files`
                    : 'Cannot read files');
                errors.push(`${key}: ${errorDetail}`);
                // Capture first suggested pattern from any camera (legacy)
                if (value.suggested_pattern && !suggestedPattern) {
                  suggestedPattern = value.suggested_pattern;
                }
                // Capture A/B pair suggestion if available (legacy)
                if (value.suggested_pattern_b && !suggestedPatternB) {
                  suggestedPatternB = value.suggested_pattern_b;
                }
                if (value.suggested_mode && !suggestedMode) {
                  suggestedMode = value.suggested_mode;
                }
              } else if (value.status === 'warning') {
                const expected = value.expected_count || 0;
                const actual = value.actual_count || 0;
                warnings.push(`${key}: Found ${actual}/${expected} files`);
              }
            });

            const errorMsg = [
              ...errors,
              ...warnings,
            ].join('; ') || 'Image files not found';

            setValidation({
              valid: false,
              checked: true,
              error: errorMsg,
              patternValidations,
              abCountWarning,
              // Legacy fields
              suggested_pattern: suggestedPattern,
              suggested_pattern_b: suggestedPatternB,
              suggested_mode: suggestedMode,
            });
          }
        } else {
          const json = await res.json();
          const errorMsg = json.error || 'Validation failed';
          setValidation({ valid: false, checked: true, error: errorMsg });
        }
      } catch (e: any) {
        setValidation({ valid: false, checked: true, error: `Validation failed: ${e.message}` });
      }
    }, 500);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [
    config?.paths?.source_paths,
    config?.images?.image_format,
    config?.paths?.camera_numbers,
    config?.paths?.camera_subfolders,
    config?.paths?.camera_count,
    config?.images?.num_images,
    config?.images?.start_index,
    config?.images?.pairing_preset,
  ]);

  return validation;
}
