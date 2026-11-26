import { useState, useEffect, useCallback, useRef } from 'react';
import { postJson, errorMessage } from '@/lib/api';

export interface MaskingConfig {
  enabled: boolean;
  mode: 'file' | 'rectangular';
  mask_file_pattern?: string;
  rectangular?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  predictor_fill?: PredictorFill;
}

export type PredictorFill = 'harmonic' | 'nearest' | 'none';

export function useMaskingConfig(
  initialConfig: MaskingConfig | undefined,
  updateConfig: (path: string[], value: any) => void
) {
  const [enabled, setEnabled] = useState(initialConfig?.enabled ?? false);
  const [mode, setMode] = useState<'polygon' | 'pixel_border'>(() => {
    const configMode = initialConfig?.mode;
    return configMode === 'rectangular' ? 'pixel_border' : 'polygon';
  });
  const [rectangularTop, setRectangularTop] = useState(initialConfig?.rectangular?.top ?? 0);
  const [rectangularBottom, setRectangularBottom] = useState(initialConfig?.rectangular?.bottom ?? 0);
  const [rectangularLeft, setRectangularLeft] = useState(initialConfig?.rectangular?.left ?? 0);
  const [rectangularRight, setRectangularRight] = useState(initialConfig?.rectangular?.right ?? 0);
  const [predictorFill, setPredictorFill] = useState<PredictorFill>(initialConfig?.predictor_fill ?? 'harmonic');
  // /backend/update_config echoes only the subset it was sent, and that echo
  // replaces the local masking object. Every save therefore resends the current
  // predictor_fill (read from a ref so memoised updaters never send a stale one).
  const predictorFillRef = useRef<PredictorFill>(predictorFill);

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
      setRectangularTop(initialConfig.rectangular.top ?? 0);
      setRectangularBottom(initialConfig.rectangular.bottom ?? 0);
      setRectangularLeft(initialConfig.rectangular.left ?? 0);
      setRectangularRight(initialConfig.rectangular.right ?? 0);
    }
  }, [initialConfig?.rectangular]);

  useEffect(() => {
    if (initialConfig?.predictor_fill) {
      setPredictorFill(initialConfig.predictor_fill);
      predictorFillRef.current = initialConfig.predictor_fill;
    }
  }, [initialConfig?.predictor_fill]);

  const saveMaskingConfig = useCallback(async (config: Partial<MaskingConfig>) => {
    try {
      const payload = {
        masking: { predictor_fill: predictorFillRef.current, ...config }
      };

      const json = await postJson('/backend/update_config', payload);

      // Update local state with the response
      if (json.updated?.masking) {
        updateConfig(['masking'], json.updated.masking);
      }

      return true;
    } catch (error) {
      console.error('Error updating masking config:', errorMessage(error));
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

  const updatePredictorFill = useCallback(async (value: PredictorFill) => {
    setPredictorFill(value);
    predictorFillRef.current = value;
    await saveMaskingConfig({
      enabled,
      mode: mode === 'polygon' ? 'file' : 'rectangular',
      predictor_fill: value,
      ...(mode === 'pixel_border' && {
        rectangular: {
          top: rectangularTop,
          bottom: rectangularBottom,
          left: rectangularLeft,
          right: rectangularRight
        }
      })
    });
  }, [enabled, mode, rectangularTop, rectangularBottom, rectangularLeft, rectangularRight, saveMaskingConfig]);

  return {
    enabled,
    mode,
    rectangularTop,
    rectangularBottom,
    rectangularLeft,
    rectangularRight,
    predictorFill,
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
    updateRectangular,
    updatePredictorFill
  };
}
