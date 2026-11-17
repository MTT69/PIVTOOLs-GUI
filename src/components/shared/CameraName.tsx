"use client";

import { SelectItem } from "@/components/ui/select";
import { useCameraIdentities } from "@/contexts/CameraIdentityContext";
import { cameraDetail, cameraShortName, cameraTitle } from "@/lib/cameraIdentity";

/**
 * A camera option for a select. The trigger shows the short name; the open list adds
 * DaVis's model, camera id (serial) and frame kind when the recording labels its cameras.
 */
export function CameraSelectItem({
  camera,
  value,
  disabled,
}: {
  camera: number;
  value?: string;
  disabled?: boolean;
}) {
  const ids = useCameraIdentities();
  const detail = cameraDetail(camera, ids);
  return (
    <SelectItem
      value={value ?? String(camera)}
      disabled={disabled}
      detail={detail ?? undefined}
      title={cameraTitle(camera, ids)}
    >
      {cameraShortName(camera, ids)}
    </SelectItem>
  );
}

/**
 * A camera's name inline, with the full identity (label, model, serial) on hover.
 * `compact` keeps the narrow "Cam N" of steppers and checkbox rows; a labelled
 * camera gets the help cursor, so the hover is discoverable.
 */
export function CameraName({ camera, compact = false }: { camera: number; compact?: boolean }) {
  const ids = useCameraIdentities();
  return (
    <span title={cameraTitle(camera, ids)} className={ids.has(camera) ? "cursor-help" : undefined}>
      {compact ? `Cam ${camera}` : cameraShortName(camera, ids)}
    </span>
  );
}
