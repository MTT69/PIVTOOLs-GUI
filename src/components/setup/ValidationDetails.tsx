import { Info } from "lucide-react";
import { ValidationState, entryLabel } from "@/hooks/useConfigUpdate";
import { useCameraIdentities } from "@/contexts/CameraIdentityContext";
import { cameraTitle } from "@/lib/cameraIdentity";

/**
 * What validation learned about each camera beyond pass or fail: its image size
 * (cameras may differ), facts about how its images are read (e.g. no dark was
 * subtracted), and for a `.pivraw` run how the cameras were paired by trigger.
 * Shown under the validation alert; nothing when there is nothing to say.
 */
export function ValidationDetails({ validation }: { validation: ValidationState }) {
  const identities = useCameraIdentities();
  if (!validation.checked) return null;
  const rows = validation.sources.flatMap((s) => s.cameras
    .filter((c) => c.image_size !== null || c.notes.length > 0 || c.pivraw_alignment !== null)
    .map((c) => ({
      key: `${s.sourceIdx}-${c.camera}`,
      label: validation.sources.length === 1
        ? cameraTitle(c.camera, identities)
        : entryLabel(validation.sources.length, s.sourceIdx, c.camera),
      camera: c,
    })));
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2 rounded-md border p-3 text-xs">
      {rows.map(({ key, label, camera }) => {
        const a = camera.pivraw_alignment;
        return (
          <div key={key} className="space-y-0.5">
            <p className="font-medium">
              {label}
              {camera.image_size && (
                <span className="ml-2 font-normal text-muted-foreground">
                  {camera.image_size[0]}×{camera.image_size[1]} px
                </span>
              )}
            </p>
            {camera.notes.map((n, i) => (
              <p key={i} className="flex items-start gap-1 text-amber-800">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />{n}
              </p>
            ))}
            {a && (
              <div className="text-muted-foreground">
                <p>Pairs: {a.pairs}</p>
                <p>{a.summary}</p>
                {a.notes.map((n, i) => (
                  <p key={i} className="flex items-start gap-1 text-amber-800">
                    <Info className="h-3 w-3 mt-0.5 shrink-0" />{n}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
