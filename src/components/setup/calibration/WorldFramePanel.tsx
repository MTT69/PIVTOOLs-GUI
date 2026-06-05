"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import type { V2Fiducials } from "@/hooks/useCalibration2";

export type WorldStep = "origin" | "x_axis" | "y_axis";

export const STEP_LABEL: Record<WorldStep, string> = { origin: "Origin", x_axis: "+X", y_axis: "+Y" };
export const STEP_COLOR: Record<WorldStep, string> = { origin: "#22c55e", x_axis: "#ef4444", y_axis: "#3b82f6" };
export const WORLD_STEPS: WorldStep[] = ["origin", "x_axis", "y_axis"];

interface Props {
  fiducials: V2Fiducials;
  activeStep: WorldStep | null;       // step currently being picked (null = not picking)
  enabled: boolean;                   // datum frame detected for this camera
  cameraLabel?: string;
  onPick: (step: WorldStep) => void;  // start picking this step
  onClear: () => void;
}

export const WorldFramePanel: React.FC<Props> = ({
  fiducials, activeStep, enabled, cameraLabel, onPick, onClear,
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">World frame{cameraLabel ? ` — ${cameraLabel}` : ""}</span>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
    </div>
    {!enabled && (
      <p className="text-xs text-muted-foreground">
        Detect the board on the datum frame to pick the world frame.
      </p>
    )}
    <div className="grid grid-cols-3 gap-2">
      {WORLD_STEPS.map((s) => {
        const pt = fiducials[s];
        return (
          <Button
            key={s}
            size="sm"
            disabled={!enabled}
            variant={activeStep === s ? "default" : pt ? "secondary" : "outline"}
            onClick={() => onPick(s)}
            style={activeStep === s ? { backgroundColor: STEP_COLOR[s] } : undefined}
          >
            <span style={{ color: pt && activeStep !== s ? STEP_COLOR[s] : undefined }}>
              {STEP_LABEL[s]}{pt ? " ✓" : ""}
            </span>
          </Button>
        );
      })}
    </div>
    {activeStep && (
      <p className="text-xs" style={{ color: STEP_COLOR[activeStep] }}>
        Click the {STEP_LABEL[activeStep]} dot on the image (snaps to nearest detected dot).
      </p>
    )}
  </div>
);
