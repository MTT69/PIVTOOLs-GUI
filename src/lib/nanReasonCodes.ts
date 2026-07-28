// Human-readable meanings for the per-window `nan_reason` invalidation codes.
// Mirror of the two Python taxonomies — keep in sync:
//   instantaneous  pivtools_cli/piv/piv_backend/nan_reason_codes.py (NAN_REASON_LABELS)
//   ensemble       pivtools_cli/piv/piv_backend/single_pass_accumulator.py (module docstring)
//                  pivtools_cli/piv/piv_backend/kspace_lm_fitting.py (STATUS_* constants)
//
// The two pipelines do NOT share one taxonomy. They agree on -1 / 0 / 10 and
// diverge elsewhere: codes 2/3/5/11 are ensemble-only, 9/12/13 are
// instantaneous-only, and 1 and 6 carry different meanings on each side. Always
// decode against the pipeline the data actually came from.
//
// Do not transcribe from PIVTOOLs-web's manual page — it is stale (merges the two
// taxonomies, omits 9/12/13, misattributes code 2).

import { normalizeVarName } from "@/lib/plotUnits";

export type NanReasonPipeline = "instantaneous" | "ensemble";

export interface NanReasonEntry {
  stage: string;
  meaning: string;
}

/** Instantaneous PIV — nan_reason_codes.py:18-36, stages per wiki instantaneous-invalid-vectors-and-debug.md. */
export const NAN_REASON_INST: Record<number, NanReasonEntry> = {
  [-1]: { stage: "mask", meaning: "masked window" },
  0: { stage: "init / rescue reset", meaning: "valid" },
  1: { stage: "post-C-call", meaning: "peak-fit failure (no peak / LM did not converge)" },
  6: { stage: "post-C-call", meaning: "large-displacement rejection" },
  9: { stage: "end of pass", meaning: "unclassified (in nan_mask, no stage claimed it)" },
  10: { stage: "outlier stage", meaning: "outlier detection (primary peak)" },
  12: { stage: "secondary loop", meaning: "outlier detection (substituted secondary peak)" },
  13: { stage: "secondary loop / final", meaning: "chosen peak magnitude NaN (peaks exhausted)" },
};

/** Ensemble PIV — single_pass_accumulator.py:7-23 plus the k-space LM fitter status codes. */
export const NAN_REASON_ENS: Record<number, NanReasonEntry> = {
  [-1]: { stage: "pre-fitting", meaning: "masked vector (outside ROI)" },
  0: { stage: "success", meaning: "fit succeeded, all checks passed" },
  1: { stage: "fitting", meaning: "LM did not converge (ENOPROG / reject / <10 valid k-bins)" },
  2: { stage: "post-fit validation", meaning: "SNR too low (empty centre amplitudes)" },
  3: { stage: "post-fit validation", meaning: "displacement > 3/4 window (in fitter)" },
  // Reachable only from the dormant kspace_linear module; decoded for old files,
  // excluded from the rendered legend by LEGEND_EXCLUDED_ENS below.
  4: { stage: "post-fit validation", meaning: "singular phase solve (kspace_linear only)" },
  5: { stage: "post-fit validation", meaning: "negative variance" },
  6: { stage: "displacement check", meaning: "displacement > 3/4 window (in accumulator)" },
  10: { stage: "outlier detection", meaning: "velocity outlier (median test)" },
  11: {
    stage: "outlier detection",
    meaning: "stress outlier (median test / realizability violation)",
  },
};

/** Codes present in the map for decoding old files, but not worth listing in the legend. */
const LEGEND_EXCLUDED_ENS = new Set([4]);

function tableFor(pipeline: NanReasonPipeline): Record<number, NanReasonEntry> {
  return pipeline === "ensemble" ? NAN_REASON_ENS : NAN_REASON_INST;
}

/** True when the selected variable is the nan_reason channel (accepts `inst:`/`ens:` prefixes). */
export function isNanReasonVar(varName: string): boolean {
  return normalizeVarName(varName) === "nan_reason";
}

/** Legend rows for a pipeline, ascending by code. */
export function nanReasonEntries(
  pipeline: NanReasonPipeline
): Array<{ code: number; stage: string; meaning: string }> {
  const table = tableFor(pipeline);
  const excluded = pipeline === "ensemble" ? LEGEND_EXCLUDED_ENS : new Set<number>();
  return Object.keys(table)
    .map(Number)
    .filter((code) => !excluded.has(code))
    .sort((a, b) => a - b)
    .map((code) => ({ code, ...table[code] }));
}

/**
 * Decode a single code to "10 — outlier detection (primary peak)".
 *
 * Never falls back silently to a bare number: a code missing from the table above
 * means this file has drifted from the Python taxonomy, and says so in the UI.
 */
export function nanReasonLabel(code: number, pipeline: NanReasonPipeline): string {
  if (!Number.isFinite(code) || !Number.isInteger(code)) {
    return `${code} — not a valid code`;
  }
  const entry = tableFor(pipeline)[code];
  if (!entry) {
    return `${code} — UNKNOWN CODE (not in GUI table)`;
  }
  return `${code} — ${entry.meaning}`;
}
