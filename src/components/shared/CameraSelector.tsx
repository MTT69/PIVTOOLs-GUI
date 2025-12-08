"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Camera, FolderTree, Merge } from "lucide-react";

interface PathInfo {
  source: string;
  base: string;
}

interface CameraSelectorProps {
  // Camera selection (existing)
  cameraCount: number;
  selectedCameras: number[];
  onSelectionChange: (cameras: number[]) => void;

  // Path selection (new)
  paths?: PathInfo[];
  selectedPaths?: number[];
  onPathsChange?: (paths: number[]) => void;
  showPaths?: boolean;

  // Merged option (new)
  includeMerged?: boolean;
  onMergedChange?: (include: boolean) => void;
  showMerged?: boolean;

  // Control visibility of cameras section
  showCameras?: boolean;
}

/**
 * Extract basename from a path string.
 */
function basename(path: string | undefined): string {
  if (!path) return "";
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
}

const CameraSelector = memo(function CameraSelector({
  cameraCount,
  selectedCameras,
  onSelectionChange,
  paths = [],
  selectedPaths = [0],
  onPathsChange,
  showPaths = false,
  includeMerged = false,
  onMergedChange,
  showMerged = false,
  showCameras = true,
}: CameraSelectorProps) {

  // Toggle camera selection
  const toggleCamera = (cameraNum: number) => {
    let newSelectedCameras: number[];
    if (selectedCameras.includes(cameraNum)) {
      // Allow deselecting if merged is enabled or other cameras remain
      if (selectedCameras.length === 1 && !includeMerged) return;
      newSelectedCameras = selectedCameras.filter((c: number) => c !== cameraNum);
    } else {
      newSelectedCameras = [...selectedCameras, cameraNum].sort((a, b) => a - b);
    }
    onSelectionChange(newSelectedCameras);
  };

  // Toggle path selection
  const togglePath = (pathIdx: number) => {
    if (!onPathsChange) return;

    if (selectedPaths.includes(pathIdx)) {
      // Don't allow deselecting all paths
      if (selectedPaths.length === 1) return;
      onPathsChange(selectedPaths.filter(i => i !== pathIdx));
    } else {
      onPathsChange([...selectedPaths, pathIdx].sort((a, b) => a - b));
    }
  };

  // Select/deselect all paths
  const selectAllPaths = () => {
    if (!onPathsChange) return;
    onPathsChange(paths.map((_, i) => i));
  };

  const clearPaths = () => {
    if (!onPathsChange || paths.length === 0) return;
    onPathsChange([0]); // Keep at least one
  };

  // Toggle merged option
  const toggleMerged = () => {
    if (!onMergedChange) return;

    const newMerged = !includeMerged;
    onMergedChange(newMerged);

    // If turning off merged and no cameras selected, select first camera
    if (!newMerged && selectedCameras.length === 0) {
      onSelectionChange([1]);
    }
  };

  // Build summary text
  const buildSummary = () => {
    const parts: string[] = [];

    if (selectedCameras.length > 0) {
      parts.push(`Cameras: ${selectedCameras.join(", ")}`);
    }

    if (includeMerged) {
      parts.push("Merged");
    }

    if (parts.length === 0) {
      return "Select at least one source";
    }

    return parts.join(" + ");
  };

  // Determine if we should show the paths section
  const shouldShowPaths = showPaths && paths.length > 1;

  // Determine if we should show the cameras section
  const shouldShowCameras = showCameras && cameraCount > 0;

  // If nothing to show, return null
  if (!shouldShowPaths && (!shouldShowCameras || cameraCount <= 1)) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Path Selection */}
      {shouldShowPaths && (
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FolderTree className="h-5 w-5 text-soton-blue" />
              <Label className="text-sm font-semibold">Select Paths to Process</Label>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAllPaths}
                className="text-xs h-7"
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearPaths}
                className="text-xs h-7"
              >
                Clear
              </Button>
            </div>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {paths.map((path, i) => (
              <label
                key={i}
                className="flex items-start gap-3 cursor-pointer hover:bg-gray-100 p-2 rounded"
              >
                <input
                  type="checkbox"
                  checked={selectedPaths.includes(i)}
                  onChange={() => togglePath(i)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {basename(path.source)}
                  </div>
                  {path.base && path.base !== path.source && (
                    <div className="text-xs text-gray-500 truncate">
                      &rarr; {basename(path.base)}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {selectedPaths.length} of {paths.length} path(s) selected
          </p>
        </div>
      )}

      {/* Camera + Merged Selection */}
      {shouldShowCameras && cameraCount > 0 && (
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <Camera className="h-5 w-5 text-soton-blue" />
            <Label className="text-sm font-semibold">
              {showMerged ? "Select Cameras & Data Sources" : "Select Cameras to Process"}
            </Label>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Individual Camera Buttons */}
            {Array.from({ length: cameraCount }, (_, i) => i + 1).map(camNum => (
              <Button
                key={camNum}
                variant={selectedCameras.includes(camNum) ? "default" : "outline"}
                size="sm"
                onClick={() => toggleCamera(camNum)}
                className="min-w-[80px]"
              >
                Camera {camNum}
              </Button>
            ))}

            {/* Merged Button (only show if showMerged and multiple cameras) */}
            {showMerged && cameraCount > 1 && (
              <Button
                variant={includeMerged ? "default" : "outline"}
                size="sm"
                onClick={toggleMerged}
                className="min-w-[80px] gap-1"
              >
                <Merge className="h-4 w-4" />
                Merged
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {buildSummary()}
          </p>
        </div>
      )}
    </div>
  );
});

export default CameraSelector;
