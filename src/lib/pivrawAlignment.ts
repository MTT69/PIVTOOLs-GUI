/**
 * A `.pivraw` run's trigger alignment as `/backend/validate_files` reports it per
 * camera (backend `PivrawAlignment.report`). Pure module.
 *
 * A run with a dropped frame is refused: it arrives as the validation error and as
 * `images.pairing_error`, with no report. So a report has no skipped pairs.
 */

import { isCount } from './pairCount';

export interface PivrawAlignmentReport {
  pairs: number;
  triggers_requested: number;
  /** One sentence: the pairs aligned. */
  summary: string;
  /** Plain sentences: phases that could not be proven. */
  notes: string[];
}

/** The keys of a report, exactly. */
const REPORT_KEYS: readonly string[] = ['pairs', 'triggers_requested', 'summary', 'notes'];

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Validate a `pivraw_alignment` report, or null. Requires exactly the report's keys:
 * a missing or extra key means the backend is out of step with this GUI.
 */
export function parsePivrawAlignment(raw: unknown, where: string): PivrawAlignmentReport | null {
  if (raw === null) return null;
  const fail = (what: string): never => {
    throw new Error(`${where}: pivraw_alignment ${what}`);
  };
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('must be an object or null');
  const r = raw as Record<string, unknown>;
  const extra = Object.keys(r).filter((k) => !REPORT_KEYS.includes(k));
  if (extra.length > 0) {
    fail(`has unknown keys ${extra.map((k) => `"${k}"`).join(', ')}; the backend is out of step with this GUI`);
  }
  for (const k of ['pairs', 'triggers_requested'] as const) {
    if (!isCount(r[k])) fail(`needs a whole-number "${k}"`);
  }
  if (typeof r.summary !== 'string') fail('needs a string "summary"');
  if (!isStringList(r.notes)) fail('needs a list of strings "notes"');
  return {
    pairs: r.pairs as number,
    triggers_requested: r.triggers_requested as number,
    summary: r.summary as string,
    notes: r.notes as string[],
  };
}
