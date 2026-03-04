import { useState, useEffect, useRef, useCallback } from 'react';

interface UseNumericInputOptions {
  /** The current config value (number or undefined). */
  configValue: number | undefined;
  /** Default value when config is undefined. */
  defaultValue: number;
  /** Callback to commit the final parsed value on blur. */
  onCommit: (value: number) => void;
  /** Parsing mode: 'int' uses parseInt, 'float' uses parseFloat. Default: 'int'. */
  mode?: 'int' | 'float';
  /** Optional minimum clamp applied on blur. */
  min?: number;
  /** Optional maximum clamp applied on blur. */
  max?: number;
}

interface UseNumericInputReturn {
  /** Current string value for the input's value prop. */
  value: string;
  /** onChange handler — updates local string state only. */
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** onFocus handler — marks editing active. */
  onFocus: () => void;
  /** onBlur handler — parses, clamps, and commits the value. */
  onBlur: () => void;
}

/**
 * Hook for numeric input fields that avoids "sticky" value reversion.
 *
 * Uses a local string buffer for immediate keystroke responsiveness.
 * Config value syncs into the buffer only when the user is NOT focused
 * on the input. On blur, the value is parsed, clamped, and committed.
 */
export function useNumericInput({
  configValue,
  defaultValue,
  onCommit,
  mode = 'int',
  min,
  max,
}: UseNumericInputOptions): UseNumericInputReturn {
  const [localValue, setLocalValue] = useState<string>(
    String(configValue ?? defaultValue)
  );
  const isEditingRef = useRef(false);

  // Sync from config when not editing
  useEffect(() => {
    if (isEditingRef.current) return;
    setLocalValue(String(configValue ?? defaultValue));
  }, [configValue, defaultValue]);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalValue(e.target.value);
    },
    []
  );

  const onFocus = useCallback(() => {
    isEditingRef.current = true;
  }, []);

  const onBlur = useCallback(() => {
    isEditingRef.current = false;
    const parse = mode === 'float' ? parseFloat : parseInt;
    let num = parse(localValue);
    if (isNaN(num)) {
      num = defaultValue;
    }
    if (min !== undefined && num < min) num = min;
    if (max !== undefined && num > max) num = max;
    setLocalValue(String(num));
    onCommit(num);
  }, [localValue, defaultValue, onCommit, mode, min, max]);

  return { value: localValue, onChange, onFocus, onBlur };
}
