import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import {
  NEW_TRACKER,
  SelectionTracker,
  doubleFrameSelection,
  observeSelection,
  selectionNotice,
  settle,
  sourceKey,
} from '@/lib/doubleFrameSelection';
import { ValidationState, applySetupSuggestion } from './useConfigUpdate';

/** What Setup says about the camera selection it made itself. */
export interface DoubleFrameAutoSelect {
  /** The selection line while the applied cameras are still the selection, else null. */
  notice: string | null;
  /** Why the selection could not be written, for the current source paths, else null. */
  error: string | null;
}

/**
 * Select a labelled recording's double-frame cameras as the PIV cameras once its
 * validation offers them, unless the camera numbers are the user's (see
 * `observeSelection`). Runs at most once per set of source paths; afterwards the
 * selection stays a suggestion the user clicks.
 */
export function useDoubleFrameAutoSelect(
  config: any,
  validation: ValidationState,
  updateConfig: (path: string[], value: unknown) => void,
): DoubleFrameAutoSelect {
  const trackerRef = useRef<SelectionTracker>(NEW_TRACKER);
  const configRef = useRef(config);
  configRef.current = config;
  const [applied, setApplied] = useState<{ key: string; cameras: number[] } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const sourcePaths: string[] | undefined = config?.paths?.source_paths;
  // The page maps an unset camera_numbers to []; undefined only before the config loads.
  const cameraNumbers: number[] | undefined = config?.paths?.camera_numbers;

  // Declared before the apply effect, so it records a camera change first.
  useEffect(() => {
    if (sourcePaths === undefined) return;
    trackerRef.current = observeSelection(trackerRef.current, sourcePaths, cameraNumbers ?? []);
  }, [sourcePaths, cameraNumbers]);

  useEffect(() => {
    if (sourcePaths === undefined || validation.idle || !validation.checked) return;
    const fresh = validation.sources.length === sourcePaths.length &&
      validation.sources.every((s, i) => s.sourcePath === sourcePaths[i]);
    if (!fresh) return;
    const key = sourceKey(sourcePaths);
    if (trackerRef.current.settled.has(key)) return;
    const selection = doubleFrameSelection(
      validation.sources.flatMap((s) => s.cameras),
      validation.cameraIdentities,
    );
    if (selection === null) return;
    trackerRef.current = settle(trackerRef.current, key);
    applySetupSuggestion(selection.apply, { config: configRef.current, sourcePathIdx: 0, updateConfig })
      .then(() => setApplied({ key, cameras: selection.cameras }))
      .catch((e) => setFailure({
        key,
        message: `Could not select the double-frame cameras from the recording's labels: ${errorMessage(e)}`,
      }));
  }, [validation, sourcePaths, updateConfig]);

  const key = sourcePaths === undefined ? null : sourceKey(sourcePaths);
  const stillApplied = applied !== null && applied.key === key &&
    JSON.stringify(applied.cameras) === JSON.stringify(cameraNumbers ?? []);
  return {
    notice: stillApplied ? selectionNotice(applied.cameras) : null,
    error: failure !== null && failure.key === key ? failure.message : null,
  };
}
