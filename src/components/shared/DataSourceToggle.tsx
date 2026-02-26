"use client";

import { memo } from "react";
import { Label } from "@/components/ui/label";
import { Camera, Merge, Layers } from "lucide-react";

interface DataSourceToggleProps {
  /**
   * Number of cameras available. Used to show camera count in labels.
   */
  cameraCount: number;

  /**
   * Whether merged data exists/is available.
   */
  hasMergedData: boolean;

  /**
   * Current selection: 'all_cameras', 'merged', or 'both'
   */
  value: "all_cameras" | "merged" | "both";

  /**
   * Callback when selection changes.
   */
  onChange: (value: "all_cameras" | "merged" | "both") => void;

  /**
   * Whether the control is disabled.
   */
  disabled?: boolean;

  /**
   * Whether this is a stereo setup. When true, shows "Stereo" indicator instead of toggle.
   */
  isStereo?: boolean;

  /**
   * Optional className for the container.
   */
  className?: string;
}

/**
 * DataSourceToggle - Simple radio button toggle for selecting between
 * processing all cameras or merged data (mutually exclusive).
 *
 * Used by statistics, video, and transform batch operations.
 */
const DataSourceToggle = memo(function DataSourceToggle({
  cameraCount,
  hasMergedData,
  value,
  onChange,
  disabled = false,
  isStereo = false,
  className = "",
}: DataSourceToggleProps) {
  // For stereo setups, show simple indicator (no toggle needed - single combined result)
  if (isStereo) {
    return (
      <div className={`p-4 bg-gray-50 rounded-lg ${className}`}>
        <Label className="text-sm font-semibold mb-3 block">Data Source</Label>
        <div className="flex items-center gap-2 text-sm">
          <Camera className="h-4 w-4 text-blue-600" />
          <span className="font-medium">Stereo (3D)</span>
          <span className="text-xs text-muted-foreground">(combined 2-camera result)</span>
        </div>
      </div>
    );
  }

  // If only one camera and no merged data, no need to show toggle
  if (cameraCount <= 1 && !hasMergedData) {
    return null;
  }

  return (
    <div className={`p-4 bg-gray-50 rounded-lg ${className}`}>
      <Label className="text-sm font-semibold mb-3 block">Data Source</Label>
      <div className="flex flex-col gap-3">
        {/* All Cameras Option */}
        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="radio"
            name="data-source"
            value="all_cameras"
            checked={value === "all_cameras"}
            onChange={() => onChange("all_cameras")}
            disabled={disabled}
            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
          />
          <span className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-blue-600" />
            <span>All Cameras</span>
            <span className="text-xs text-muted-foreground">
              ({cameraCount} camera{cameraCount !== 1 ? "s" : ""})
            </span>
          </span>
        </label>

        {/* Merged Data Option */}
        <label
          className={`flex items-center space-x-3 ${
            hasMergedData ? "cursor-pointer" : "cursor-not-allowed opacity-50"
          }`}
        >
          <input
            type="radio"
            name="data-source"
            value="merged"
            checked={value === "merged"}
            onChange={() => onChange("merged")}
            disabled={disabled || !hasMergedData}
            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
          />
          <span className="flex items-center gap-2">
            <Merge className="h-4 w-4 text-blue-600" />
            <span>Merged Data</span>
            {!hasMergedData && (
              <span className="text-xs text-muted-foreground">(not available)</span>
            )}
          </span>
        </label>

        {/* All Cameras + Merged Option */}
        {hasMergedData && (
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="radio"
              name="data-source"
              value="both"
              checked={value === "both"}
              onChange={() => onChange("both")}
              disabled={disabled}
              className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <span className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-600" />
              <span>All Cameras + Merged</span>
            </span>
          </label>
        )}
      </div>
    </div>
  );
});

export default DataSourceToggle;
