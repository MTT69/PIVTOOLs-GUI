// Display units for plottable PIV variables.
// Mirror of the backend map in pivtools_gui/plotting/app/shared_utils.py
// (units_for_var / normalize_var_name / wall_scale_divisor) — keep in sync.
// The backend bakes units into the rendered PNG; this module labels the
// hover-tooltip readout so both always agree.

const CAL_UNITS: Record<string, string> = {
  // Velocities
  ux: "m/s", uy: "m/s", uz: "m/s",
  mean_ux: "m/s", mean_uy: "m/s", mean_uz: "m/s",
  // Fluctuations
  u_prime: "m/s", v_prime: "m/s", w_prime: "m/s",
  // Reynolds stresses + TKE
  uu: "m²/s²", vv: "m²/s²", ww: "m²/s²",
  uv: "m²/s²", uw: "m²/s²", vw: "m²/s²",
  tke: "m²/s²",
  // Vorticity & divergence
  vorticity: "1/s", divergence: "1/s",
  // Dimensionless
  gamma1: "", gamma2: "",
  peak_mag: "", peakheight: "", mean_peak_height: "",
  nan_reason: "", b_mask: "",
  c_a: "", c_b: "", c_ab: "",
  // Pixel-space diagnostics
  window_size: "px",
  sig_ab_x: "px", sig_ab_y: "px", sig_ab_xy: "px",
  sig_a_x: "px", sig_a_y: "px", sig_a_xy: "px",
  win_ctrs_x: "px", win_ctrs_y: "px",
  pred_x: "px", pred_y: "px",
};

// Ensemble/statistics names carry these suffixes on top of the base names
// (e.g. UU_stress_uncorrected -> uu); stripped repeatedly until stable.
const SUFFIXES = [
  "_uncorrected", "_window_correction", "_particle_correction",
  "_correction", "_stress", "_inst",
];

export function normalizeVarName(varName: string): string {
  const idx = varName.indexOf(":");
  let v = (idx >= 0 ? varName.slice(idx + 1) : varName).trim().toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of SUFFIXES) {
      if (v.endsWith(suf) && v.length > suf.length) {
        v = v.slice(0, -suf.length);
        changed = true;
      }
    }
  }
  return v;
}

// Uncalibrated data is pixel displacement per frame pair.
const UNCAL_UNITS: Record<string, string> = {
  "m/s": "px",
  "m²/s²": "px²",
  "1/s": "1/frame",
};

export function unitsForVar(varName: string, uncalibrated: boolean): string {
  const cal = CAL_UNITS[normalizeVarName(varName)] ?? "";
  return uncalibrated ? (UNCAL_UNITS[cal] ?? cal) : cal;
}

// Wall-units (viscous scaling) view: only velocity and stress variables scale.
const WALL_VELOCITY = new Set([
  "ux", "uy", "uz", "mean_ux", "mean_uy", "mean_uz",
  "u_prime", "v_prime", "w_prime",
]);
const WALL_STRESS = new Set(["uu", "vv", "ww", "uv", "uw", "vw", "tke"]);

/** Divisor converting a variable to wall units, or null if it doesn't scale. */
export function wallScaleDivisor(varName: string, uTau: number): number | null {
  const base = normalizeVarName(varName);
  if (WALL_VELOCITY.has(base)) return uTau;
  if (WALL_STRESS.has(base)) return uTau * uTau;
  return null;
}
