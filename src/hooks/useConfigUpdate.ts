import { useCallback, useState, useEffect, useRef } from 'react';
import { postJson, errorMessage, ApiError } from '@/lib/api';
import {
  Diagnosis,
  DiagnosisEntry,
  MergedSuggestion,
  SetupConfigView,
  Suggestion,
  SuggestionApply,
  buildSetupPayload,
  mergeSuggestions,
  parseDiagnosis,
} from '@/lib/sourceDiagnosis';
import {
  CameraIdentities,
  NO_IDENTITIES,
  agreedIdentities,
  identitiesFromStreams,
} from '@/lib/cameraIdentity';
import { assertNoServerOnlyKeys, mergeImagesUpdate } from '@/lib/pairCount';

/** Validation result for a single pattern (A or B) of one camera */
export interface PatternValidation {
  index: number;
  label: string;  // "A", "B", or "pattern"
  pattern: string;
  valid: boolean;
  found_count?: number | 'container';
  error: string | null;
  suggestions: Suggestion[];
  sample_files?: string[];
}

/**
 * A `.pivraw` run's trigger alignment (backend `PivrawAlignment.report`). Camera keys
 * of `skipped_by_camera` are strings (JSON object keys).
 */
export interface PivrawAlignmentReport {
  pairs: number;
  skipped_incomplete: number;
  skipped_by_camera: Record<string, number>;
  triggers_requested: number;
  triggers_unaccounted: number;
  summary: string;
  notes: string[];
}

/** One camera's `/validate_files` detail, with the source diagnosis. */
export interface SetupCameraResult extends Diagnosis {
  camera: number;
  status: 'ok' | 'error';
  error: string | null;
  sample_files: string[];
  pattern_validations: PatternValidation[];
  color_detected: boolean;
  indexing_warning: string | null;
  ab_count_warning: string | null;
  /** [width, height] of this camera's images; cameras may differ. Null when unread. */
  image_size: [number, number] | null;
  /** Plain-words facts about how the images are read (e.g. no dark was subtracted). */
  notes: string[];
  /** `.pivraw` only: how the run was paired by trigger. */
  pivraw_alignment: PivrawAlignmentReport | null;
}

/** The validation of one configured source path. */
export interface SourceValidation {
  sourceIdx: number;
  /** The source path this result was computed for (stale once the config changes). */
  sourcePath: string;
  valid: boolean;
  /** The request's own failure (e.g. the 400 for a bad source index); `cameras` is then []. */
  requestError: string | null;
  detectedCount: number | null;
  cameras: SetupCameraResult[];
}

/** One pattern index summarised over every (source, camera). */
export interface PatternSummary {
  index: number;
  valid: boolean;
  failures: { label: string; error: string }[];
  suggestions: MergedSuggestion[];
}

export interface ValidationState {
  /** Nothing to validate yet (config not fetched, or no source path). */
  idle: boolean;
  valid: boolean;
  checked: boolean;
  error?: string | null;
  sources: SourceValidation[];
  patterns: PatternSummary[];
  /** Auto-detected frame/file count of source 0 (feeds the num_images auto-fill) */
  detectedCount: number | null;
  /** Warning if A/B file counts differ significantly */
  abCountWarning: string | null;
  /** Files found in the folder of each failing camera (shown on validation error for context) */
  sampleFiles: { label: string; files: string[] }[];
  /** Cameras named by the recordings' own labels, where every source agrees. */
  cameraIdentities: CameraIdentities;
}

/** `Camera N` with one source, `Source S, camera N` otherwise. */
export function entryLabel(sourceCount: number, sourceIdx: number, camera: number): string {
  return sourceCount === 1 ? `Camera ${camera}` : `Source ${sourceIdx + 1}, camera ${camera}`;
}

/**
 * Keys of a camera detail on the backend's short branches (blank source, per-camera
 * exception): the list fields and flags of the full detail are absent there.
 */
const SHORT_DETAIL_KEYS = ['status', 'error', 'found', 'suggestions', 'streams'];

const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** `[W, H]` or null. */
export function parseImageSize(raw: unknown, where: string): [number, number] | null {
  if (raw === null) return null;
  if (Array.isArray(raw) && raw.length === 2 && raw.every((v) => isCount(v) && v > 0)) {
    return [raw[0], raw[1]];
  }
  throw new Error(`${where}: "image_size" must be [width, height] or null`);
}

/** Validate a `pivraw_alignment` report, or null. */
export function parsePivrawAlignment(raw: unknown, where: string): PivrawAlignmentReport | null {
  if (raw === null) return null;
  const fail = (what: string): never => {
    throw new Error(`${where}: pivraw_alignment ${what}`);
  };
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('must be an object or null');
  const r = raw as Record<string, unknown>;
  for (const k of ['pairs', 'skipped_incomplete', 'triggers_requested', 'triggers_unaccounted'] as const) {
    if (!isCount(r[k])) fail(`needs a whole-number "${k}"`);
  }
  if (typeof r.summary !== 'string') fail('needs a string "summary"');
  if (!isStringList(r.notes)) fail('needs a list of strings "notes"');
  const skipped = r.skipped_by_camera;
  if (typeof skipped !== 'object' || skipped === null || Array.isArray(skipped) ||
      !Object.entries(skipped).every(([cam, n]) => /^\d+$/.test(cam) && isCount(n))) {
    fail('needs "skipped_by_camera" mapping camera numbers to whole numbers');
  }
  return {
    pairs: r.pairs as number,
    skipped_incomplete: r.skipped_incomplete as number,
    skipped_by_camera: skipped as Record<string, number>,
    triggers_requested: r.triggers_requested as number,
    triggers_unaccounted: r.triggers_unaccounted as number,
    summary: r.summary as string,
    notes: r.notes as string[],
  };
}

function parsePatternValidation(raw: unknown): PatternValidation {
  if (typeof raw !== 'object' || raw === null) throw new Error('Pattern validation must be an object');
  const pv = raw as Record<string, unknown>;
  if (
    typeof pv.index !== 'number' || typeof pv.label !== 'string' || typeof pv.pattern !== 'string' ||
    typeof pv.valid !== 'boolean' || !isStringOrNull(pv.error) || !isStringList(pv.sample_files)
  ) {
    throw new Error('Pattern validation needs "index", "label", "pattern", "valid", "error" and "sample_files"');
  }
  if (!pv.valid && typeof pv.error !== 'string') {
    throw new Error(`Pattern ${pv.label} is invalid but carries no error`);
  }
  return {
    index: pv.index,
    label: pv.label,
    pattern: pv.pattern,
    valid: pv.valid,
    found_count: pv.found_count as PatternValidation['found_count'],
    error: pv.error,
    // Pattern suggestions share the diagnosis suggestion shape; validate them with its guard.
    suggestions: parseDiagnosis({ found: null, suggestions: pv.suggestions, streams: null }).suggestions,
    sample_files: pv.sample_files,
  };
}

/** Validate one `details["camera_N"]` entry. Throws on any shape violation. */
function parseCameraResult(camera: number, raw: unknown): SetupCameraResult {
  const diagnosis = parseDiagnosis(raw);
  const d = raw as Record<string, unknown>;
  if (d.status !== 'ok' && d.status !== 'error') throw new Error(`camera_${camera}: unknown status ${String(d.status)}`);
  if (!isStringOrNull(d.error)) throw new Error(`camera_${camera}: "error" must be a string or null`);
  if (d.status === 'error' && typeof d.error !== 'string') throw new Error(`camera_${camera}: status "error" carries no error`);
  const keys = Object.keys(d);
  if (keys.length === SHORT_DETAIL_KEYS.length && keys.every((k) => SHORT_DETAIL_KEYS.includes(k))) {
    return {
      ...diagnosis, camera, status: d.status, error: d.error,
      sample_files: [], pattern_validations: [], color_detected: false, indexing_warning: null, ab_count_warning: null,
      image_size: null, notes: [], pivraw_alignment: null,
    };
  }
  if (
    !isStringList(d.sample_files) || !Array.isArray(d.pattern_validations) || typeof d.color_detected !== 'boolean' ||
    !isStringOrNull(d.indexing_warning) || !isStringOrNull(d.ab_count_warning) || !isStringList(d.notes) ||
    !('image_size' in d) || !('pivraw_alignment' in d)
  ) {
    throw new Error(
      `camera_${camera}: needs "sample_files", "pattern_validations", "color_detected", "indexing_warning", ` +
      '"ab_count_warning", "notes", "image_size" and "pivraw_alignment"; the backend may be older than this GUI',
    );
  }
  return {
    image_size: parseImageSize(d.image_size, `camera_${camera}`),
    notes: d.notes,
    pivraw_alignment: parsePivrawAlignment(d.pivraw_alignment, `camera_${camera}`),
    ...diagnosis,
    camera,
    status: d.status,
    error: d.error,
    sample_files: d.sample_files,
    pattern_validations: d.pattern_validations.map(parsePatternValidation),
    color_detected: d.color_detected,
    indexing_warning: d.indexing_warning,
    ab_count_warning: d.ab_count_warning,
  };
}

/** Parse `details` into per-camera results. Every key must be `camera_N`. */
function parseCameraDetails(details: unknown): SetupCameraResult[] {
  if (typeof details !== 'object' || details === null) throw new Error('validate response has no "details"');
  return Object.entries(details).map(([key, value]) => {
    const match = /^camera_(\d+)$/.exec(key);
    if (!match) throw new Error(`Unexpected validation detail key "${key}"`);
    return parseCameraResult(Number(match[1]), value);
  });
}

/** Validate one source. Only the request's own failure (`ApiError`) is kept per source. */
async function validateSource(sourceIdx: number, sourcePath: string): Promise<SourceValidation> {
  try {
    const json = await postJson('/backend/validate_files', { source_path_idx: sourceIdx });
    if (typeof json?.valid !== 'boolean') throw new Error('validate response has no "valid"');
    return {
      sourceIdx,
      sourcePath,
      valid: json.valid,
      requestError: null,
      detectedCount: typeof json.detected_count === 'number' ? json.detected_count : null,
      cameras: parseCameraDetails(json.details),
    };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    return { sourceIdx, sourcePath, valid: false, requestError: e.message, detectedCount: null, cameras: [] };
  }
}

const IDLE_FIELDS = {
  sources: [], patterns: [], detectedCount: null, abCountWarning: null, sampleFiles: [],
  cameraIdentities: NO_IDENTITIES,
} satisfies Partial<ValidationState>;

/**
 * The camera identities every source agrees on. Each source is one recording, so its
 * cameras share one stream table; a source with no table (not a labelled `.set`)
 * names no camera, and then no camera number is named for Setup as a whole.
 */
export function sourceIdentities(sources: SourceValidation[]): CameraIdentities {
  return agreedIdentities(sources.map((s) => {
    const streams = s.cameras.find((c) => c.streams !== null)?.streams;
    return streams ? identitiesFromStreams(streams) : NO_IDENTITIES;
  }));
}

/** Gather pattern index `i` over every (source, camera). */
function summarisePatterns(sources: SourceValidation[]): PatternSummary[] {
  const count = Math.max(0, ...sources.flatMap((s) => s.cameras.map((c) => c.pattern_validations.length)));
  return Array.from({ length: count }, (_, i) => {
    const entries = sources.flatMap((s) => s.cameras.flatMap((c) => {
      const pv = c.pattern_validations[i];
      return pv ? [{ label: entryLabel(sources.length, s.sourceIdx, c.camera), pv }] : [];
    }));
    const failed = entries.filter((e) => !e.pv.valid);
    const failedEntries: DiagnosisEntry[] = failed.map((e) => ({
      label: e.label, found: null, suggestions: e.pv.suggestions, streams: null,
    }));
    return {
      index: i,
      valid: failed.length === 0,
      failures: failed.map((e) => ({ label: e.label, error: e.pv.error as string })),
      suggestions: mergeSuggestions(failedEntries),
    };
  });
}

/** Aggregate per-source results into the Setup validation state. */
function aggregate(sources: SourceValidation[]): ValidationState {
  const valid = sources.every((s) => s.valid);
  const cameras = sources.flatMap((s) => s.cameras);
  let error: string | undefined;

  if (valid) {
    // Check for color images or subset processing
    const messages: string[] = [];
    cameras.forEach((detail) => {
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
    error = messages.length > 0 ? messages.join('. ') + '.' : undefined;
  } else {
    const lines: string[] = [];
    sources.forEach((s) => {
      if (s.requestError !== null) lines.push(`Source ${s.sourceIdx + 1}: ${s.requestError}`);
      s.cameras.forEach((c) => {
        if (c.status === 'error') lines.push(`${entryLabel(sources.length, s.sourceIdx, c.camera)}: ${c.error}`);
      });
    });
    error = lines.join('; ');
  }

  const sampleFiles = sources.flatMap((s) => s.cameras
    .filter((c) => c.status === 'error' && c.sample_files.length > 0)
    .map((c) => ({ label: entryLabel(sources.length, s.sourceIdx, c.camera), files: c.sample_files })));

  return {
    idle: false,
    valid,
    checked: true,
    error,
    sources,
    patterns: summarisePatterns(sources),
    detectedCount: sources[0].detectedCount,
    abCountWarning: cameras.find((c) => c.ab_count_warning !== null)?.ab_count_warning ?? null,
    sampleFiles,
    cameraIdentities: sourceIdentities(sources),
  };
}

type UpdateConfig = (path: string[], value: unknown) => void;

/**
 * Merge an update_config response's `updated` sections into the local config. Images
 * go through `mergeImagesUpdate`, so a stale `pairing_error` never outlives a fresh
 * pair count. Every Setup save that posts `paths` or `images` merges through here.
 */
export function mergeUpdatedSections(
  updated: { images?: Record<string, unknown>; paths?: Record<string, unknown> },
  config: { images?: Record<string, unknown>; paths?: Record<string, unknown> },
  updateConfig: UpdateConfig,
): void {
  if (updated.images) updateConfig(['images'], mergeImagesUpdate(config.images ?? {}, updated.images));
  if (updated.paths) updateConfig(['paths'], { ...config.paths, ...updated.paths });
}

/**
 * Apply a source-diagnosis suggestion to the Setup config: post the mapped patch to
 * `/backend/update_config` and merge the server's `updated` sections into the local
 * config. Throws on failure (the caller shows the error).
 */
export async function applySetupSuggestion(
  apply: SuggestionApply,
  target: {
    config: SetupConfigView & Record<string, any>;
    sourcePathIdx: number;
    updateConfig: (path: string[], value: unknown) => void;
  },
): Promise<void> {
  const { config, sourcePathIdx, updateConfig } = target;
  const payload = buildSetupPayload(apply, config, sourcePathIdx);
  assertNoServerOnlyKeys(payload as Record<string, unknown>);
  const json = await postJson('/backend/update_config', payload);
  const updated = json?.updated;
  if (typeof updated !== 'object' || updated === null) {
    throw new Error('update_config response has no "updated"');
  }
  mergeUpdatedSections(updated, config, updateConfig);
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
      assertNoServerOnlyKeys(payload);
      const json = await postJson('/backend/update_config', payload);
      return { success: true, data: json };
    } catch (e) {
      const errorMsg = `Failed to update config: ${errorMessage(e)}`;
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
    idle: true,
    valid: false,
    checked: false,
    error: null,
    ...IDLE_FIELDS,
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastValidatedRef = useRef<string>('');
  // Monotonic sequence for validation requests: only the latest request may
  // write results. The debounce timer stops queued requests, but a fetch
  // already in flight can resolve AFTER a newer one and overwrite fresh
  // results with stale ones without this guard.
  const requestSeqRef = useRef(0);

  useEffect(() => {
    // Create a validation key from critical config
    // Include ALL fields that affect file loading
    const validationKey = JSON.stringify({
      sourcePaths: config?.paths?.source_paths,
      imageFormat: config?.images?.image_format,
      imageType: config?.images?.image_type,
      useCameraSubfolders: config?.images?.use_camera_subfolders,
      numLoops: config?.images?.num_loops,
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

    // Nothing to validate: config not fetched yet (undefined) or no source path ([]).
    const sourcePaths: string[] | undefined = config?.paths?.source_paths;
    if (sourcePaths === undefined || sourcePaths.length === 0) {
      requestSeqRef.current++; // invalidate any in-flight validation
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      lastValidatedRef.current = '';
      setValidation({
        idle: true,
        valid: false,
        checked: false,
        error: sourcePaths === undefined ? null : 'No source path yet.',
        ...IDLE_FIELDS,
      });
      return;
    }

    lastValidatedRef.current = validationKey;
    const seq = ++requestSeqRef.current;

    // Clear any pending validation
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set pending state
    setValidation({ idle: false, valid: false, checked: false, error: 'Validating...', ...IDLE_FIELDS });

    // Validate after short delay
    timerRef.current = setTimeout(async () => {
      timerRef.current = null; // fired: the cleanup must no longer treat it as pending
      try {
        const sources = await Promise.all(sourcePaths.map((path, idx) => validateSource(idx, path)));
        if (seq !== requestSeqRef.current) return; // stale response — a newer validation superseded this one
        setValidation(aggregate(sources));
        // Note: Preloading is handled by ImagePairViewer which knows the user's format preference
        // We don't preload here to avoid loading the wrong format (jpeg vs png)
      } catch (e) {
        if (seq !== requestSeqRef.current) return; // stale response
        setValidation({
          idle: false,
          valid: false,
          checked: true,
          error: `Validation failed: ${errorMessage(e)}`,
          ...IDLE_FIELDS,
        });
      }
    }, 500);

    return () => {
      // A validation cancelled before it fired never ran: forget its key, so the next run
      // re-schedules even when the key is unchanged or back to an earlier value (else the
      // "Validating..." state set above would stick).
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        lastValidatedRef.current = '';
      }
    };
  }, [
    config?.paths?.source_paths,
    config?.images?.image_format,
    config?.images?.image_type,
    config?.images?.use_camera_subfolders,
    config?.images?.num_loops,
    config?.paths?.camera_numbers,
    config?.paths?.camera_subfolders,
    config?.paths?.camera_count,
    config?.images?.num_images,
    config?.images?.start_index,
    config?.images?.pairing_preset,
  ]);

  return validation;
}
