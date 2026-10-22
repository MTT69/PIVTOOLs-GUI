import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/** Container formats address entries, not numbered files, so first-frame numbering does not apply. */
const CONTAINER_IMAGE_TYPES = new Set(["lavision_set", "cine"]);

interface FirstFrameNumberProps {
  /** Sidecar `image.image_type`; the control is hidden for container formats. */
  imageType: string;
  /** Sidecar `image.zero_based_indexing`: true when the first file is numbered 0. */
  zeroBased: boolean;
  onChange: (zeroBased: boolean) => void;
}

/**
 * First-frame numbering (0 or 1) for a calibration image set, laid out like the PIV image
 * setup's "First Frame Number" control.
 *
 * Frame numbers shown in the calibration UI stay 1-based either way: with 0-based files,
 * frame 1 reads the file numbered 0.
 */
export const FirstFrameNumber: React.FC<FirstFrameNumberProps> = ({ imageType, zeroBased, onChange }) => (
  CONTAINER_IMAGE_TYPES.has(imageType) ? null : <div className="flex items-center gap-3 flex-wrap">
    <Label className="text-sm">First Frame Number:</Label>
    <div className="flex gap-1">
      {[0, 1].map(n => (
        <Button
          key={n}
          variant={zeroBased === (n === 0) ? "default" : "outline"}
          size="sm"
          className="w-10"
          onClick={() => onChange(n === 0)}
        >
          {n}
        </Button>
      ))}
    </div>
  </div>
);
