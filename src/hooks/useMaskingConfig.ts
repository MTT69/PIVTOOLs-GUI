import { useState, useEffect, useCallback } from 'react';

export interface MaskingConfig {
  enabled: boolean;
  mode: 'file' | 'rectangular';
  mask_file_pattern?: string;
  mask_threshold?: number;
  rectangular?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

export function useMaskingConfig(
  initialConfig: MaskingConfig | undefined,
  updateConfig: (path: string[], value: any) => void
) {
  const [enabled, setEnabled] = useState(initialConfig?.enabled ?? false);
  const [mode, setMode] = useState<'polygon' | 'pixel_border'>(() => {
    const configMode = initialConfig?.mode;
    return configMode === 'rectangular' ? 'pixel_border' : 'polygon';
  });
  const [rectangularTop, setRectangularTop] = useState(initialConfig?.rectangular?.top ?? 64);
  const [rectangularBottom, setRectangularBottom] = useState(initialConfig?.rectangular?.bottom ?? 64);
  const [rectangularLeft, setRectangularLeft] = useState(initialConfig?.rectangular?.left ?? 0);
  const [rectangularRight, setRectangularRight] = useState(initialConfig?.rectangular?.right ?? 0);

  // Sync with config changes
  useEffect(() => {
    if (initialConfig?.enabled !== undefined) {
      setEnabled(initialConfig.enabled);
    }
  }, [initialConfig?.enabled]);

  useEffect(() => {
    if (initialConfig?.mode) {
      setMode(initialConfig.mode === 'rectangular' ? 'pixel_border' : 'polygon');
    }
  }, [initialConfig?.mode]);

  useEffect(() => {
    if (initialConfig?.rectangular) {
      setRectangularTop(initialConfig.rectangular.top ?? 64);
      setRectangularBottom(initialConfig.rectangular.bottom ?? 64);
      setRectangularLeft(initialConfig.rectangular.left ?? 0);
      setRectangularRight(initialConfig.rectangular.right ?? 0);
    }
  }, [initialConfig?.rectangular]);

  const saveMaskingConfig = useCallback(async (config: Partial<MaskingConfig>) => {
    try {
      const payload = {
        masking: config
      };

      const response = await fetch('/backend/update_config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Failed to update masking config');

      // Update local state with the response
      if (json.updated?.masking) {
        updateConfig(['masking'], json.updated.masking);
      }

      return true;
    } catch (error) {
      console.error('Error updating masking config:', error);
      return false;
    }
  }, [updateConfig]);

  const updateEnabled = useCallback(async (newEnabled: boolean) => {
    setEnabled(newEnabled);
    await saveMaskingConfig({
      enabled: newEnabled,
      mode: mode === 'polygon' ? 'file' : 'rectangular',
      ...(mode === 'pixel_border' && {
        rectangular: {
          top: rectangularTop,
          bottom: rectangularBottom,
          left: rectangularLeft,
          right: rectangularRight
        }
      })
    });
  }, [mode, rectangularTop, rectangularBottom, rectangularLeft, rectangularRight, saveMaskingConfig]);

  const updateMode = useCallback(async (newMode: 'polygon' | 'pixel_border') => {
    setMode(newMode);
    await saveMaskingConfig({
      enabled,
      mode: newMode === 'polygon' ? 'file' : 'rectangular',
      ...(newMode === 'pixel_border' && {
        rectangular: {
          top: rectangularTop,
          bottom: rectangularBottom,
          left: rectangularLeft,
          right: rectangularRight
        }
      })
    });
  }, [enabled, rectangularTop, rectangularBottom, rectangularLeft, rectangularRight, saveMaskingConfig]);

  const updateRectangular = useCallback(async (rectangular: { top: number; bottom: number; left: number; right: number }) => {
    setRectangularTop(rectangular.top);
    setRectangularBottom(rectangular.bottom);
    setRectangularLeft(rectangular.left);
    setRectangularRight(rectangular.right);

    if (mode === 'pixel_border') {
      await saveMaskingConfig({
        enabled,
        mode: 'rectangular',
        rectangular
      });
    }
  }, [enabled, mode, saveMaskingConfig]);

  // Individual update functions that save to backend
  const updateRectangularTop = useCallback(async (value: number) => {
    setRectangularTop(value);
    if (mode === 'pixel_border') {
      await saveMaskingConfig({
        enabled,
        mode: 'rectangular',
        rectangular: {
          top: value,
          bottom: rectangularBottom,
          left: rectangularLeft,
          right: rectangularRight
        }
      });
    }
  }, [enabled, mode, rectangularBottom, rectangularLeft, rectangularRight, saveMaskingConfig]);

  const updateRectangularBottom = useCallback(async (value: number) => {
    setRectangularBottom(value);
    if (mode === 'pixel_border') {
      await saveMaskingConfig({
        enabled,
        mode: 'rectangular',
        rectangular: {
          top: rectangularTop,
          bottom: value,
          left: rectangularLeft,
          right: rectangularRight
        }
      });
    }
  }, [enabled, mode, rectangularTop, rectangularLeft, rectangularRight, saveMaskingConfig]);

  const updateRectangularLeft = useCallback(async (value: number) => {
    setRectangularLeft(value);
    if (mode === 'pixel_border') {
      await saveMaskingConfig({
        enabled,
        mode: 'rectangular',
        rectangular: {
          top: rectangularTop,
          bottom: rectangularBottom,
          left: value,
          right: rectangularRight
        }
      });
    }
  }, [enabled, mode, rectangularTop, rectangularBottom, rectangularRight, saveMaskingConfig]);

  const updateRectangularRight = useCallback(async (value: number) => {
    setRectangularRight(value);
    if (mode === 'pixel_border') {
      await saveMaskingConfig({
        enabled,
        mode: 'rectangular',
        rectangular: {
          top: rectangularTop,
          bottom: rectangularBottom,
          left: rectangularLeft,
          right: value
        }
      });
    }
  }, [enabled, mode, rectangularTop, rectangularBottom, rectangularLeft, saveMaskingConfig]);

  return {
    enabled,
    mode,
    rectangularTop,
    rectangularBottom,
    rectangularLeft,
    rectangularRight,
    setRectangularTop,
    setRectangularBottom,
    setRectangularLeft,
    setRectangularRight,
    updateRectangularTop,
    updateRectangularBottom,
    updateRectangularLeft,
    updateRectangularRight,
    updateEnabled,
    updateMode,
    updateRectangular
  };
}
