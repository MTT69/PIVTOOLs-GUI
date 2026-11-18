/**
 * Pre-select a labelled recording's double-frame cameras as the PIV cameras. Pure module.
 *
 * A LaVision `.set` recording whose cameras carry labels says which cameras are double
 * frame (an A and a B stream). The backend offers that selection as its `set_streams`
 * suggestion; the pair reader can only pair those cameras. Setup applies it on its own,
 * once per set of source paths, unless the camera numbers there are the user's: the
 * selection the page loaded with, or one changed while those sources were set.
 */

import type { CameraIdentities } from './cameraIdentity';
import type { Diagnosis, SuggestionApply } from './sourceDiagnosis';

/** The backend rule id of the camera-selection suggestion (`source_diagnosis.py`). */
export const SET_STREAMS_RULE_ID = 'set_streams';

/** The apply keys a camera selection may carry, and nothing else. */
const CAMERA_APPLY_KEYS: readonly string[] = ['camera_count', 'camera_numbers'];

/** The double-frame selection to apply, and the cameras it selects. */
export interface DoubleFrameSelection {
  apply: SuggestionApply;
  cameras: number[];
}

/** The double-frame cameras of a labelled recording, ascending. */
export function doubleFrameCameras(identities: CameraIdentities): number[] {
  return [...identities].filter(([, id]) => id.double_frame).map(([n]) => n).sort((a, b) => a - b);
}

const sameNumbers = (a: readonly number[] | undefined, b: readonly number[]): boolean =>
  a !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The double-frame selection every validated camera's diagnosis offers, or null.
 *
 * `entries` is every (source, camera) diagnosis and `identities` the labels all sources
 * agree on. A selection is returned only when there are double-frame cameras and every
 * entry offers the same `set_streams` apply selecting exactly them; any entry without it
 * (a camera whose check failed early, a source that disagrees) leaves it a suggestion.
 */
export function doubleFrameSelection(
  entries: readonly Diagnosis[],
  identities: CameraIdentities,
): DoubleFrameSelection | null {
  const cameras = doubleFrameCameras(identities);
  if (cameras.length === 0 || entries.length === 0) return null;
  let apply: SuggestionApply | null = null;
  for (const entry of entries) {
    const offered = entry.suggestions.find((s) =>
      s.id === SET_STREAMS_RULE_ID &&
      Object.keys(s.apply).every((k) => CAMERA_APPLY_KEYS.includes(k)) &&
      sameNumbers(s.apply.camera_numbers, cameras));
    if (!offered) return null;
    if (apply !== null && apply.camera_count !== offered.apply.camera_count) return null;
    apply = offered.apply;
  }
  return apply === null ? null : { apply, cameras };
}

/** `1`, `1 and 2`, `1, 2 and 3`. */
function andJoin(numbers: readonly number[]): string {
  const t = numbers.map(String);
  return t.length === 1 ? t[0] : `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`;
}

/** The line Setup shows after selecting the double-frame cameras itself. */
export function selectionNotice(cameras: readonly number[]): string {
  const noun = cameras.length === 1 ? 'camera' : 'cameras';
  return `Selected the double-frame ${noun} ${andJoin(cameras)} from the recording's labels; `
    + 'change them in the camera selection of the PIV or Ensemble tab.';
}

/**
 * What the auto-selection knows about the current source paths: `settled` holds every
 * source key (see {@link sourceKey}) whose camera numbers must not be replaced, and
 * `last` the source key and camera numbers seen last.
 */
export interface SelectionTracker {
  settled: ReadonlySet<string>;
  last: { key: string; cameras: string } | null;
}

export const NEW_TRACKER: SelectionTracker = { settled: new Set(), last: null };

/** The key of a set of source paths. */
export const sourceKey = (sourcePaths: readonly string[]): string => JSON.stringify(sourcePaths);

/**
 * Record a config's source paths and camera numbers. The first config seen is the
 * loaded one: its selection may be the user's from an earlier session, so it is settled.
 * A camera change while the source paths stay the same is a choice (the PIV and Ensemble
 * camera selectors, a clicked suggestion, a camera-count change), so it settles them too.
 */
export function observeSelection(
  tracker: SelectionTracker,
  sourcePaths: readonly string[],
  cameraNumbers: readonly number[],
): SelectionTracker {
  const key = sourceKey(sourcePaths);
  const cameras = JSON.stringify(cameraNumbers);
  const { last } = tracker;
  const settles = last === null || (last.key === key && last.cameras !== cameras);
  if (last !== null && last.key === key && last.cameras === cameras) return tracker;
  return {
    settled: settles ? new Set([...tracker.settled, key]) : tracker.settled,
    last: { key, cameras },
  };
}

/** Settle a source key once the auto-selection has been applied to it (or tried). */
export function settle(tracker: SelectionTracker, key: string): SelectionTracker {
  return tracker.settled.has(key) ? tracker : { ...tracker, settled: new Set([...tracker.settled, key]) };
}
