/**
 * Calibration method registry — the single declarative source of truth for the
 * unified calibration GUI. Tabs are generated from this list, and the shared
 * Workbench composes its panels from each method's `capabilities`. No panel ever
 * branches on a method name.
 *
 * This de-duplicates the four methods onto one Workbench; a deferred method
 * (stepped board, self-calibration, a polynomial model) slots in as ONE new entry
 * here plus its detector — no Workbench edits.
 *
 * Global coordinates is a PLANAR multi-camera feature (pick overlapping points
 * between planar cameras to stitch them into one frame) — it appears inline in the
 * planar tabs, never as its own tab, and never for stereo.
 */

export type Board = "dotboard" | "charuco";
export type Geometry = "mono" | "stereo";

export interface MethodCapabilities {
  boardParams: boolean;
  worldFrameClicks: boolean;
  datumFrame: boolean;
  measure: boolean;
  generate: boolean;
  apply: boolean;
  multiCamera: boolean;   // camera selector (planar multi-cam; stereo handled separately)
  globalCoords: boolean;  // inline planar N-camera stitching
}

export interface CalibMethod {
  id: string;
  label: string;
  board: Board;
  geometry: Geometry;
  capabilities: MethodCapabilities;
}

const PLANAR: MethodCapabilities = {
  boardParams: true, worldFrameClicks: true, datumFrame: true, measure: true,
  generate: true, apply: true, multiCamera: true, globalCoords: true,
};

const STEREO: MethodCapabilities = {
  boardParams: true, worldFrameClicks: true, datumFrame: true, measure: true,
  generate: true, apply: true, multiCamera: false, globalCoords: false,
};

export const CALIBRATION_METHODS: CalibMethod[] = [
  { id: "planar_dotboard", label: "Planar Dotboard", board: "dotboard", geometry: "mono", capabilities: PLANAR },
  { id: "planar_charuco", label: "Planar ChArUco", board: "charuco", geometry: "mono", capabilities: PLANAR },
  { id: "stereo_dotboard", label: "Stereo Dotboard", board: "dotboard", geometry: "stereo", capabilities: STEREO },
  { id: "stereo_charuco", label: "Stereo ChArUco", board: "charuco", geometry: "stereo", capabilities: STEREO },
];
