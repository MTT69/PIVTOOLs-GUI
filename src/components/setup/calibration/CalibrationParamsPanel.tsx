"use client";

import React from "react";
import type { Board } from "./methods";

interface FieldSpec {
  key: string;
  label: string;
  type: "number" | "text";
  step?: string;
}

/**
 * Board-parameter fields, one entry per board type. Adding a board (e.g. stepped)
 * is one new entry here — the panel renders whatever the active board declares.
 * (Image source, frames, camera and the model live in the source card; there is no
 * distortion choice — the model is the DaVis pinhole, k1,k2,p1,p2.)
 */
const BOARD_FIELDS: Record<string, FieldSpec[]> = {
  dotboard: [
    { key: "dot_spacing_mm", label: "Dot spacing (mm)", type: "number", step: "any" },
    { key: "k_neighbors", label: "k neighbours", type: "number" },
  ],
  charuco: [
    { key: "squares_h", label: "Squares (H)", type: "number" },
    { key: "squares_v", label: "Squares (V)", type: "number" },
    { key: "square_size", label: "Square size (m)", type: "number", step: "any" },
    { key: "marker_ratio", label: "Marker ratio", type: "number", step: "any" },
    { key: "aruco_dict", label: "ArUco dict", type: "text" },
    { key: "min_corners", label: "Min corners", type: "number" },
  ],
};

const BOARD_DEFAULTS: Record<string, Record<string, any>> = {
  dotboard: { dot_spacing_mm: 15.0, k_neighbors: 9 },
  charuco: {
    squares_h: 10, squares_v: 7, square_size: 0.03,
    marker_ratio: 0.5, aruco_dict: "DICT_4X4_1000", min_corners: 6,
  },
};

const inputCls = "border rounded px-2 py-1 bg-background";

interface Props {
  board: Board;
  cfg: any; // config.calibration2
  setBoardParam: (board: string, key: string, value: any) => void;
}

export const CalibrationParamsPanel: React.FC<Props> = ({ board, cfg, setBoardParam }) => {
  if (!board) return null;
  const boardCfg = cfg[board] || {};
  return (
    <div className="space-y-2 text-sm">
      <div className="text-xs font-medium uppercase text-muted-foreground">{board} parameters</div>
      <div className="grid grid-cols-2 gap-3">
        {BOARD_FIELDS[board].map((f) => {
          const val = boardCfg[f.key] ?? BOARD_DEFAULTS[board][f.key];
          return (
            <label key={f.key} className="flex flex-col gap-1">
              {f.label}
              <input
                className={inputCls}
                type={f.type}
                step={f.step}
                value={val ?? ""}
                onChange={(e) =>
                  setBoardParam(
                    board, f.key,
                    f.type === "number" ? parseFloat(e.target.value || "0") : e.target.value,
                  )
                }
              />
            </label>
          );
        })}
      </div>
    </div>
  );
};
