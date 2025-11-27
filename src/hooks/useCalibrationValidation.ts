import { useCallback, useState, useEffect, useRef } from 'react';

/**
 * Validation state for a single camera
 */
interface CameraValidation {
  camera: number;
  valid: boolean;
  found_count: number | 'container';
  camera_path: string | null;
  sample_files: string[];
  first_image_preview: string | null;
  image_size: [number, number] | null;
  format_detected: string | null;
  error: string | null;
  suggested_pattern?: string | null;
}

/**
 * Validation result for pinhole (single camera) calibration
 */
export interface PinholeValidationResult {
  valid: boolean;
  checked: boolean;
  found_count: number | 'container';
  file_pattern: string;
  camera_path: string;
  sample_files: string[];
  first_image_preview: string | null;
  image_size: [number, number] | null;
  format_detected: string | null;
  container_format: boolean;
  error: string | null;
  suggested_pattern?: string | null;
}

/**
 * Validation result for stereo (camera pair) calibration
 */
export interface StereoValidationResult {
  valid: boolean;
  checked: boolean;
  camera_pair: [number, number];
  file_pattern: string;
  container_format: boolean;
  cameras: {
    [key: string]: CameraValidation;
  };
  matching_pairs: number | 'container';
  error: string | null;
}

/**
 * Hook for validating pinhole calibration images
 *
 * @param sourcePathIdx - Index of the source path in config
 * @param camera - Camera number (1-based)
 * @param filePattern - File pattern for calibration images
 * @param enabled - Whether to enable validation (default: true)
 */
export function usePinholeValidation(
  sourcePathIdx: number,
  camera: number,
  filePattern: string,
  enabled: boolean = true
): PinholeValidationResult {
  const [validation, setValidation] = useState<PinholeValidationResult>({
    valid: false,
    checked: false,
    found_count: 0,
    file_pattern: filePattern,
    camera_path: '',
    sample_files: [],
    first_image_preview: null,
    image_size: null,
    format_detected: null,
    container_format: false,
    error: null,
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastValidatedRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Create validation key from critical config
    const validationKey = JSON.stringify({
      sourcePathIdx,
      camera,
      filePattern,
    });

    // Skip if nothing changed
    if (validationKey === lastValidatedRef.current) {
      return;
    }

    // Skip if no meaningful config
    if (!filePattern || filePattern.trim() === '') {
      setValidation(prev => ({
        ...prev,
        valid: false,
        checked: false,
        error: 'No file pattern specified',
      }));
      return;
    }

    lastValidatedRef.current = validationKey;

    // Clear any pending validation
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set pending state
    setValidation(prev => ({
      ...prev,
      valid: false,
      checked: false,
      error: 'Validating...',
    }));

    // Validate after short delay (debounce)
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/backend/calibration/planar/validate_images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_path_idx: sourcePathIdx,
            camera,
            file_pattern: filePattern,
          }),
        });

        const json = await res.json();

        if (res.ok) {
          setValidation({
            valid: json.valid,
            checked: true,
            found_count: json.found_count,
            file_pattern: json.file_pattern,
            camera_path: json.camera_path,
            sample_files: json.sample_files || [],
            first_image_preview: json.first_image_preview,
            image_size: json.image_size,
            format_detected: json.format_detected,
            container_format: json.container_format || false,
            error: json.error,
            suggested_pattern: json.suggested_pattern || null,
          });
        } else {
          setValidation(prev => ({
            ...prev,
            valid: false,
            checked: true,
            error: json.error || 'Validation failed',
          }));
        }
      } catch (e: any) {
        setValidation(prev => ({
          ...prev,
          valid: false,
          checked: true,
          error: `Validation failed: ${e.message}`,
        }));
      }
    }, 500);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [sourcePathIdx, camera, filePattern, enabled]);

  return validation;
}

/**
 * Hook for validating stereo calibration images
 *
 * @param sourcePathIdx - Index of the source path in config
 * @param cam1 - First camera number (1-based)
 * @param cam2 - Second camera number (1-based)
 * @param filePattern - File pattern for calibration images
 * @param enabled - Whether to enable validation (default: true)
 */
export function useStereoValidation(
  sourcePathIdx: number,
  cam1: number,
  cam2: number,
  filePattern: string,
  enabled: boolean = true
): StereoValidationResult {
  const [validation, setValidation] = useState<StereoValidationResult>({
    valid: false,
    checked: false,
    camera_pair: [cam1, cam2],
    file_pattern: filePattern,
    container_format: false,
    cameras: {},
    matching_pairs: 0,
    error: null,
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastValidatedRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Create validation key from critical config
    const validationKey = JSON.stringify({
      sourcePathIdx,
      cam1,
      cam2,
      filePattern,
    });

    // Skip if nothing changed
    if (validationKey === lastValidatedRef.current) {
      return;
    }

    // Skip if no meaningful config
    if (!filePattern || filePattern.trim() === '') {
      setValidation(prev => ({
        ...prev,
        valid: false,
        checked: false,
        error: 'No file pattern specified',
      }));
      return;
    }

    lastValidatedRef.current = validationKey;

    // Clear any pending validation
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set pending state
    setValidation(prev => ({
      ...prev,
      valid: false,
      checked: false,
      error: 'Validating...',
    }));

    // Validate after short delay (debounce)
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/backend/stereo/calibration/validate_images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_path_idx: sourcePathIdx,
            cam1,
            cam2,
            file_pattern: filePattern,
          }),
        });

        const json = await res.json();

        if (res.ok) {
          setValidation({
            valid: json.valid,
            checked: true,
            camera_pair: json.camera_pair || [cam1, cam2],
            file_pattern: json.file_pattern,
            container_format: json.container_format || false,
            cameras: json.cameras || {},
            matching_pairs: json.matching_pairs,
            error: json.error,
          });
        } else {
          setValidation(prev => ({
            ...prev,
            valid: false,
            checked: true,
            error: json.error || 'Validation failed',
          }));
        }
      } catch (e: any) {
        setValidation(prev => ({
          ...prev,
          valid: false,
          checked: true,
          error: `Validation failed: ${e.message}`,
        }));
      }
    }, 500);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [sourcePathIdx, cam1, cam2, filePattern, enabled]);

  return validation;
}

/**
 * Helper function to check if running on macOS
 */
export function useIsMacOS(): boolean {
  const [isMacOS, setIsMacOS] = useState(false);

  useEffect(() => {
    setIsMacOS(navigator.platform.toLowerCase().includes('mac'));
  }, []);

  return isMacOS;
}

/**
 * Helper function to check if file pattern is a container format
 */
export function isContainerFormat(filePattern: string): boolean {
  const lower = filePattern.toLowerCase();
  return lower.includes('.set') || lower.includes('.im7');
}
