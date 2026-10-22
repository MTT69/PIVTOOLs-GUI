import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

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

interface Im7SubfolderToggleProps {
  id: string;
  imageType: string;
  /** Rig size from Setup (`paths.camera_count`). */
  cameraCount: number | undefined;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}

/**
 * The IM7 "one camera per file" switch. IM7 is the only format the flag applies to
 * (`camera_subfolder_name`), and it is meaningful at any camera count.
 */
export const Im7SubfolderToggle: React.FC<Im7SubfolderToggleProps> = ({
  id, imageType, cameraCount, checked, onCheckedChange,
}) => {
  if (imageType !== "lavision_im7") return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
        <Label htmlFor={id} className="text-sm">
          IM7 files in camera subfolders (one camera per file)
        </Label>
      </div>
      <p className="text-xs text-muted-foreground ml-10">
        {checked
          ? "Each .im7 file contains ONE camera only. Files expected in Cam1/, Cam2/ subfolders."
          : "Each .im7 file contains ALL cameras. Files in source directory, camera extracted by index."}
      </p>
      {cameraCount === 1 && (
        <p className="text-xs text-muted-foreground ml-10">Camera count is 1 (set in Setup)</p>
      )}
    </div>
  );
};

/** Mirror of the backend `camera_subfolder_name`: true when a camera's images sit in a subfolder. */
export function usesCameraFolders(
  imageType: string,
  cameraCount: number | undefined,
  useCameraSubfolders: boolean,
): boolean {
  return (
    cameraCount !== undefined &&
    cameraCount > 1 &&
    (imageType === "standard" || (imageType === "lavision_im7" && useCameraSubfolders))
  );
}
