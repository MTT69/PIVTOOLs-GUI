"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Camera } from "lucide-react";

interface CameraSelectorProps {
  cameraCount: number;
  selectedCameras: number[];
  onSelectionChange: (cameras: number[]) => void;
}

const CameraSelector = memo(function CameraSelector({
  cameraCount,
  selectedCameras,
  onSelectionChange
}: CameraSelectorProps) {
  const toggleCamera = (cameraNum: number) => {
    let newSelectedCameras: number[];
    if (selectedCameras.includes(cameraNum)) {
      // Don't allow deselecting all cameras
      if (selectedCameras.length === 1) return;
      newSelectedCameras = selectedCameras.filter((c: number) => c !== cameraNum);
    } else {
      newSelectedCameras = [...selectedCameras, cameraNum].sort((a, b) => a - b);
    }
    onSelectionChange(newSelectedCameras);
  };

  if (cameraCount <= 1) {
    return null;
  }

  return (
    <div className="mb-6 p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center gap-2 mb-3">
        <Camera className="h-5 w-5 text-soton-blue" />
        <Label className="text-sm font-semibold">Select Cameras to Process</Label>
      </div>
      <div className="flex flex-wrap gap-2">
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
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Selected cameras: {selectedCameras.join(', ')} (at least one required)
      </p>
    </div>
  );
});

export default CameraSelector;
