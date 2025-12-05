import { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCalibrationImageViewer } from '@/hooks/useCalibrationImageViewer';
import ZoomableCanvas from './zoomableCanvas';
import * as Slider from '@radix-ui/react-slider';

// Loading spinner component
const LoadingSpinner = ({ className = "" }: { className?: string }) => (
  <div className={`flex items-center justify-center ${className}`}>
    <div className="relative">
      <div className="w-8 h-8 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin"></div>
    </div>
  </div>
);

/**
 * Detection data for a single frame from saved calibration model
 */
export interface FrameDetectionData {
  grid_points: [number, number][];
  reprojection_error?: number;
}

export interface CalibrationImageViewerProps {
  backendUrl?: string;
  sourcePathIdx: number;
  camera: number;
  numImages: number;
  calibrationType: 'pinhole' | 'charuco' | 'stereo' | 'stereo-charuco';
  calibrationParams?: Record<string, any>;
  onFrameChange?: (idx: number) => void;
  compact?: boolean;
  // Saved detection overlay (from calibration model)
  savedDetections?: Record<number, FrameDetectionData>;
  showSavedOverlay?: boolean;
  onSavedOverlayChange?: (show: boolean) => void;
  // Stereo-specific props
  stereoParams?: { cam1: number; cam2: number };
}

export default function CalibrationImageViewer({
  backendUrl = "/backend",
  sourcePathIdx,
  camera,
  numImages,
  calibrationType,
  calibrationParams = {},
  onFrameChange,
  compact = false,
  savedDetections,
  showSavedOverlay = false,
  onSavedOverlayChange,
  stereoParams,
}: CalibrationImageViewerProps) {
  // Frame navigation state
  const [index, setIndex] = useState(1);
  const [frameInputValue, setFrameInputValue] = useState('1');

  // Image display settings
  const [colormap, setColormap] = useState<"gray" | "viridis">("gray");
  const [imageFormat, setImageFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [autoScale, setAutoScale] = useState(true);
  const [manuallyAdjusted, setManuallyAdjusted] = useState(false);

  // Zoom/pan state (shared across view modes)
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Play state
  const [playing, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);


  // Hook for image loading
  const {
    loading,
    error,
    image,
    width,
    height,
    frameCount,
    stats,
    vmin,
    setVmin,
    vmax,
    setVmax,
    prefetchSurrounding,
  } = useCalibrationImageViewer(
    backendUrl,
    sourcePathIdx,
    camera,
    index,
    imageFormat,
    autoScale,
    calibrationType
  );

  // Actual frame count (from server or prop)
  const maxFrames = useMemo(() => {
    return frameCount > 0 ? frameCount : numImages;
  }, [frameCount, numImages]);

  // Sync frame input with index
  useEffect(() => {
    setFrameInputValue(String(index));
  }, [index]);

  // Notify parent of frame changes
  useEffect(() => {
    onFrameChange?.(index);
  }, [index, onFrameChange]);

  // Reset manual adjustment when auto-scale is enabled
  useEffect(() => {
    if (autoScale) {
      setManuallyAdjusted(false);
    }
  }, [autoScale]);

  // Reset manual adjustment when frame changes
  useEffect(() => {
    setManuallyAdjusted(false);
  }, [index, camera, sourcePathIdx]);

  // Update contrast from server stats when not manually adjusted
  useEffect(() => {
    if (autoScale && !manuallyAdjusted && stats) {
      setVmin(stats.vmin_pct);
      setVmax(stats.vmax_pct);
    }
  }, [stats, autoScale, manuallyAdjusted, setVmin, setVmax]);

  // Play/pause functionality
  useEffect(() => {
    if (playing) {
      const prefetchCount = Math.max(3, Math.ceil(playbackSpeed * 2));
      prefetchSurrounding(index, prefetchCount);

      const advanceFrame = () => {
        setIndex(prev => {
          const next = prev >= maxFrames ? 1 : prev + 1;
          prefetchSurrounding(next, prefetchCount);
          return next;
        });
      };

      const intervalMs = 1000 / playbackSpeed;
      playIntervalRef.current = setInterval(advanceFrame, intervalMs);
    } else if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }

    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [playing, maxFrames, playbackSpeed, index, prefetchSurrounding]);


  // Compute overlay points from saved detections for current frame
  const savedOverlayPoints = useMemo(() => {
    if (!showSavedOverlay || !savedDetections) return undefined;
    const frameData = savedDetections[index];
    if (!frameData?.grid_points) return undefined;
    // Convert [number, number][] to {x, y}[]
    return frameData.grid_points.map(([x, y]) => ({ x, y }));
  }, [showSavedOverlay, savedDetections, index]);

  // Count of detected points for current frame
  const savedPointCount = useMemo(() => {
    if (!savedDetections) return 0;
    const frameData = savedDetections[index];
    return frameData?.grid_points?.length || 0;
  }, [savedDetections, index]);

  // Total frames with detections
  const framesWithDetections = useMemo(() => {
    if (!savedDetections) return 0;
    return Object.keys(savedDetections).length;
  }, [savedDetections]);

  // Handle frame input
  const handleFrameInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFrameInputValue(val);
    if (val && !isNaN(Number(val))) {
      const num = Math.max(1, Math.min(maxFrames, Number(val)));
      setIndex(num);
    }
  };

  const handleFrameInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val || isNaN(Number(val))) {
      setFrameInputValue(String(index));
    } else {
      const num = Math.max(1, Math.min(maxFrames, Number(val)));
      setIndex(num);
      setFrameInputValue(String(num));
    }
  };

  // Handle zoom changes
  const handleZoomChange = (zl: number, px: number, py: number) => {
    setZoomLevel(zl);
    setPanX(px);
    setPanY(py);
  };

  // Compact mode renders just the viewer
  if (compact) {
    return (
      <div className="space-y-3">
        {/* Compact Frame Navigation */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIndex(Math.max(1, index - 1))}
            disabled={index <= 1}
            className="px-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4L6 10l6 6" />
            </svg>
          </Button>
          <input
            type="range"
            min={1}
            max={maxFrames}
            value={index}
            onChange={e => setIndex(Number(e.target.value))}
            className="flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIndex(Math.min(maxFrames, index + 1))}
            disabled={index >= maxFrames}
            className="px-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 4l6 6-6 6" />
            </svg>
          </Button>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{index} / {maxFrames}</span>
        </div>

        {/* Image Viewer */}
        <div className="h-[300px] relative">
          <ZoomableCanvas
            src={image}
            error={error}
            vmin={vmin}
            vmax={vmax}
            colormap={colormap}
            title={`Frame ${index}`}
            zoomLevel={zoomLevel}
            panX={panX}
            panY={panY}
            onZoomChange={handleZoomChange}
            overlayPoints={savedOverlayPoints}
          />
          {loading && !playing && (
            <div className="absolute inset-0 bg-black bg-opacity-20 flex items-center justify-center rounded-lg">
              <LoadingSpinner />
            </div>
          )}
        </div>

        {/* Overlay Toggle (only show if detections exist) */}
        {savedDetections && Object.keys(savedDetections).length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Switch
              id="show-overlay-compact"
              checked={showSavedOverlay}
              onCheckedChange={onSavedOverlayChange}
            />
            <Label htmlFor="show-overlay-compact" className="text-sm">Show Overlay</Label>
            {showSavedOverlay && savedPointCount > 0 && (
              <span className="text-xs text-green-600">{savedPointCount} pts</span>
            )}
          </div>
        )}
      </div>
    );
  }

  // Full mode with card wrapper
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Calibration Image Viewer</CardTitle>
        <CardDescription>
          Browse calibration target images for Camera {camera}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Frame Navigation */}
        <div className="flex flex-col md:flex-row items-center gap-4">
          <Label className="text-sm font-medium whitespace-nowrap">Frame:</Label>
          <div className="flex items-center gap-2 flex-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIndex(Math.max(1, index - 1))}
              disabled={index <= 1}
              className="rounded-full p-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 4L6 10l6 6" />
              </svg>
            </Button>
            <input
              type="range"
              min={1}
              max={maxFrames}
              value={index}
              onChange={e => setIndex(Number(e.target.value))}
              className="flex-1 max-w-[300px]"
            />
            <Input
              type="number"
              min={1}
              max={maxFrames}
              value={frameInputValue}
              onChange={handleFrameInputChange}
              onBlur={handleFrameInputBlur}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">/ {maxFrames}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIndex(Math.min(maxFrames, index + 1))}
              disabled={index >= maxFrames}
              className="rounded-full p-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 4l6 6-6 6" />
              </svg>
            </Button>
          </div>

          {/* Play Controls */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={playing ? "default" : "outline"}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? (
                <span className="flex items-center gap-1">&#10073;&#10073; Pause</span>
              ) : (
                <span className="flex items-center gap-1">&#9654; Play</span>
              )}
            </Button>
            <Select
              value={String(playbackSpeed)}
              onValueChange={v => setPlaybackSpeed(Number(v))}
              disabled={playing}
            >
              <SelectTrigger className="w-20 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0.5">0.5 FPS</SelectItem>
                <SelectItem value="1">1 FPS</SelectItem>
                <SelectItem value="2">2 FPS</SelectItem>
                <SelectItem value="5">5 FPS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Image Display */}
        <div className="h-[400px] relative">
          <ZoomableCanvas
            src={image}
            error={error}
            vmin={vmin}
            vmax={vmax}
            colormap={colormap}
            title={`Calibration Frame ${index}`}
            zoomLevel={zoomLevel}
            panX={panX}
            panY={panY}
            onZoomChange={handleZoomChange}
            overlayPoints={savedOverlayPoints}
          />
          {loading && !playing && (
            <div className="absolute inset-0 bg-black bg-opacity-20 flex items-center justify-center rounded-lg">
              <LoadingSpinner />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4 p-3 bg-muted/50 rounded-md">
          {/* Overlay Toggle (only show if detections exist) */}
          {savedDetections && Object.keys(savedDetections).length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <Switch
                  id="show-overlay"
                  checked={showSavedOverlay}
                  onCheckedChange={onSavedOverlayChange}
                />
                <Label htmlFor="show-overlay" className="text-sm">Show Overlay</Label>
              </div>
              {showSavedOverlay && (
                <span className="text-xs text-green-600">
                  {savedPointCount > 0 ? `${savedPointCount} pts` : 'No detection'} | {framesWithDetections} frames
                </span>
              )}
              <div className="border-l h-6 mx-2" />
            </>
          )}

          {/* Auto Scale Toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="auto-scale"
              checked={autoScale}
              onCheckedChange={setAutoScale}
            />
            <Label htmlFor="auto-scale" className="text-sm">Auto Scale</Label>
          </div>

          {/* Colormap */}
          <div className="flex items-center gap-2">
            <Label className="text-sm">Colormap:</Label>
            <Select value={colormap} onValueChange={v => setColormap(v as any)}>
              <SelectTrigger className="w-24 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gray">Grayscale</SelectItem>
                <SelectItem value="viridis">Viridis</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Image Format */}
          <div className="flex items-center gap-2">
            <Label className="text-sm">Format:</Label>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={imageFormat === 'jpeg' ? 'default' : 'outline'}
                onClick={() => setImageFormat('jpeg')}
                className="h-7 px-2"
              >
                JPEG
              </Button>
              <Button
                size="sm"
                variant={imageFormat === 'png' ? 'default' : 'outline'}
                onClick={() => setImageFormat('png')}
                className="h-7 px-2"
              >
                PNG
              </Button>
            </div>
          </div>
        </div>

        {/* Contrast Slider */}
        <div className="space-y-2 p-3 border rounded-md">
          <Label className="text-sm font-medium">Contrast</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={Math.round(vmin)}
              min={0}
              max={vmax}
              onChange={e => {
                setManuallyAdjusted(true);
                setAutoScale(false);
                const val = Math.min(Number(e.target.value), vmax);
                setVmin(val);
              }}
              className="w-16 h-8"
            />
            <div className="flex-1">
              <Slider.Root
                className="relative flex items-center select-none touch-none w-full h-5"
                min={0}
                max={100}
                step={1}
                value={[vmin, vmax]}
                onValueChange={([min, max]) => {
                  setManuallyAdjusted(true);
                  setAutoScale(false);
                  setVmin(min);
                  setVmax(max);
                }}
              >
                <Slider.Track className="bg-gray-200 relative grow rounded-full h-[3px]">
                  <Slider.Range className="absolute bg-blue-500 rounded-full h-full" />
                </Slider.Track>
                <Slider.Thumb className="block w-5 h-5 bg-white rounded-full border border-gray-300 hover:bg-gray-50" />
                <Slider.Thumb className="block w-5 h-5 bg-white rounded-full border border-gray-300 hover:bg-gray-50" />
              </Slider.Root>
            </div>
            <Input
              type="number"
              value={Math.round(vmax)}
              min={vmin}
              max={100}
              onChange={e => {
                setManuallyAdjusted(true);
                setAutoScale(false);
                const val = Math.max(Number(e.target.value), vmin);
                setVmax(val);
              }}
              className="w-16 h-8"
            />
          </div>
        </div>

        {/* Image Info */}
        {width > 0 && height > 0 && (
          <div className="text-xs text-muted-foreground">
            Image size: {width} x {height} px
          </div>
        )}
      </CardContent>
    </Card>
  );
}
