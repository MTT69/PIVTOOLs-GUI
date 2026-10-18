import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CameraSubfolderInputsProps {
  /** Cameras to show a box for. */
  cameras: number[];
  /** Subfolders indexed by camera number - 1 (the backend reads `subfolders[camera - 1]`). */
  cameraSubfolders: string[];
  setSubfolderFor: (camera: number, value: string) => void;
  /** Calibration source path, for the example line. */
  sourcePath: string;
}

/**
 * One subfolder box per camera, addressed by CAMERA NUMBER — never by position in a list —
 * so a pair like (2, 3) edits slots 1 and 2, matching `calibration_camera_folder`.
 */
export const CameraSubfolderInputs: React.FC<CameraSubfolderInputsProps> = ({
  cameras, cameraSubfolders, setSubfolderFor, sourcePath,
}) => {
  const first = cameras[0];
  return (
    <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
      <h4 className="text-sm font-medium">Camera Subfolder Configuration</h4>
      <p className="text-xs text-muted-foreground">
        Camera subfolders are relative to the calibration source path.
        Example: {sourcePath || "/path/to/calibration"}/{cameraSubfolders[first - 1] || `Cam${first}`}/
      </p>
      <div className="space-y-2">
        <label className="text-sm font-medium">Camera Subfolder Names (optional)</label>
        <p className="text-xs text-muted-foreground mb-2">
          Custom folder name for each camera. Leave empty to use the default (Cam&lt;N&gt;).
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {cameras.map(cam => (
            <div key={cam}>
              <label className="text-xs text-muted-foreground">Camera {cam}</label>
              <Input
                placeholder={`Cam${cam}`}
                value={cameraSubfolders[cam - 1] || ""}
                onChange={e => setSubfolderFor(cam, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface SubfolderSuggestionProps {
  /** Suggested subfolder per camera number; cameras without one are left as they are. */
  suggestions: Record<number, string>;
  onApply: (suggestions: Record<number, string>) => void;
}

/** "Use <subfolder>" button for validation's did-you-mean, labelled per camera. */
export const SubfolderSuggestion: React.FC<SubfolderSuggestionProps> = ({ suggestions, onApply }) => {
  const entries = Object.entries(suggestions).map(([cam, sub]) => [Number(cam), sub] as const);
  if (entries.length === 0) return null;
  const label = entries.map(([cam, sub]) => `Cam ${cam}: "${sub}"`).join(", ");
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-600">Subfolder suggestion:</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onApply(suggestions)}
        className="text-blue-600 border-blue-300 hover:bg-blue-50"
      >
        Use {label}
      </Button>
    </div>
  );
};

/** Each validated camera's own subfolder suggestion. */
export function subfolderSuggestions(
  byCamera: Record<number, { suggested_subfolder?: string } | null | undefined>,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [cam, r] of Object.entries(byCamera)) {
    if (r?.suggested_subfolder) out[Number(cam)] = r.suggested_subfolder;
  }
  return out;
}
