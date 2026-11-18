/**
 * `POST /backend/import_run`: write the GUI's config.yaml for a run recorded by the
 * PIVTOOLs acquisition app (backend `pivtools_cli.run_import.import_run`).
 *
 * The GUI always has a config, so the first attempt answers 409 naming every
 * conflict (the config itself, and a calibration `rig.dt` that differs from the
 * run's); the user confirms, and the same request goes again with `force`.
 */

import { ApiError, postJson } from './api';
import { sanitizePath } from './sourcePath';

/** HTTP status of "the import would replace something; post again with force". */
const CONFLICT_STATUS = 409;

export interface RunImportRequest {
  run_dir: string;
  /** Where PIV results go; null for the backend default `<project>/results/<run name>`. */
  base_path: string | null;
  force: boolean;
}

export type RunImportOutcome =
  /** Written; `summary` is the backend's plain-lines report. */
  | { kind: 'imported'; summary: string }
  /** Nothing written; `message` lists what force would replace. */
  | { kind: 'conflict'; message: string };

/** The request body from the form fields. Throws when the run folder is blank. */
export function runImportRequest(runDir: string, basePath: string, force: boolean): RunImportRequest {
  const run = sanitizePath(runDir);
  if (run === '') throw new Error('Enter the run folder: the folder that holds Camera1.pivraw and run.yaml');
  const base = sanitizePath(basePath);
  return { run_dir: run, base_path: base === '' ? null : base, force };
}

/**
 * Post one import. A 409 is an outcome (the caller asks before forcing); every other
 * failure, a refused run (400) included, is thrown with the backend's message.
 */
export async function importRun(request: RunImportRequest): Promise<RunImportOutcome> {
  try {
    const json = await postJson('/backend/import_run', request);
    if (json?.success !== true || typeof json.summary !== 'string') {
      throw new Error('import_run answered without "success" and "summary"');
    }
    return { kind: 'imported', summary: json.summary };
  } catch (e) {
    if (e instanceof ApiError && e.status === CONFLICT_STATUS && !request.force) {
      return { kind: 'conflict', message: e.message };
    }
    throw e;
  }
}
