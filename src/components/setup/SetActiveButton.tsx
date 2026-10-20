import React, { useCallback, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage, postJson } from "@/lib/api";

interface SetActiveButtonProps {
  /** `calibration.active` value this tab sets, e.g. "dotboard" or "stereo_stepped". */
  method: string;
  /** The full config; `calibration.active` says whether this method is already active. */
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

/**
 * "Set as Active" for one calibration method: writes `calibration.active` and mirrors the
 * backend's echo into the local config. A failed write is shown beside the button, never only
 * logged, so the user is not left believing the method is active.
 */
export const SetActiveButton: React.FC<SetActiveButtonProps> = ({ method, config, updateConfig }) => {
  const [error, setError] = useState<string | null>(null);
  const isActive = config?.calibration?.active === method;

  const setActive = useCallback(async () => {
    try {
      const json = await postJson("/backend/update_config", { calibration: { active: method } });
      if (json.updated?.calibration) {
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
      setError(null);
    } catch (err) {
      setError(`Could not set as active: ${errorMessage(err)}`);
    }
  }, [method, config, updateConfig]);

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <Button
        onClick={setActive}
        disabled={isActive}
        variant={isActive ? "default" : "outline"}
        className={isActive ? "bg-green-600 hover:bg-green-600 text-white" : ""}
      >
        {isActive ? <><CheckCircle2 className="h-4 w-4 mr-1" />Active</> : "Set as Active"}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
};
