import React from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Warns that the form no longer matches the loaded model: `fields` are the settings that
 * differ from the geometry stamped into the model record. Renders nothing when they match.
 */
export const ChangedSinceGenerate: React.FC<{ fields: string[] }> = ({ fields }) => {
  if (fields.length === 0) return null;
  return (
    <div className="p-3 border rounded bg-amber-50 text-amber-800 text-sm">
      <AlertTriangle className="h-4 w-4 inline mr-2" />
      Settings changed since this model was generated ({fields.join(", ")}). Regenerate the model
      before calibrating vectors — Apply still uses the saved model.
    </div>
  );
};
