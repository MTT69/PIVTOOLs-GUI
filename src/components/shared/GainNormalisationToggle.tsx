"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface GainNormalisationToggleProps {
  config: any;
  updateConfigValue: (path: string[], value: any) => void;
}

const GainNormalisationToggle = memo(function GainNormalisationToggle({
  config,
  updateConfigValue,
}: GainNormalisationToggleProps) {
  const enabled = config?.preprocessing?.gain_normalisation ?? false;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Gain Normalisation</Label>
        <Button
          variant={enabled ? "default" : "outline"}
          size="sm"
          onClick={() => updateConfigValue(['preprocessing', 'gain_normalisation'], !enabled)}
        >
          {enabled ? "Enabled" : "Disabled"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Divide each frame by its least-squares gain against the ensemble mean image
        (unmasked pixels), removing laser energy drift and A/B pulse imbalance before
        all filters. Adds two extra passes over the data before processing. The image
        preview does not show this normalisation.
      </p>
    </div>
  );
});

export default GainNormalisationToggle;
