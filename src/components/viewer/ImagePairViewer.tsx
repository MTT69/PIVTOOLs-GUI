import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";
import { useImagePair } from '@/hooks/useImagePair';
import { useImageFilters } from '@/hooks/useImageFilters';
import { FilterSelector, FilterEditor } from '@/components/FilterComponents';
import ZoomableCanvas from './zoomableCanvas';
import * as Slider from '@radix-ui/react-slider';
import { basename } from "@/lib/utils";

interface ImagePairViewerProps {
  backendUrl?: string;
  config?: any;
  onFiltersChange?: (filters: any[]) => Promise<void>;
}

// Loading spinner component
const LoadingSpinner = ({ className = "" }: { className?: string }) => (
  <div className={`flex items-center justify-center ${className}`}>
    <div className="relative">
      <div className="w-8 h-8 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin"></div>
      <div className="absolute inset-0 w-8 h-8 border-4 border-transparent border-t-blue-300 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
    </div>
  </div>
);

export default function ImagePairViewer({ backendUrl = "/backend", config, onFiltersChange }: ImagePairViewerProps) {
  // --- UI State ---
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState(1);
  const [index, setIndex] = useState(1);
  const [colormap, setColormap] = useState<"gray" | "viridis">("gray");
  
  const [useGrid, setUseGrid] = useState(false);
  const [gridSize, setGridSize] = useState(16);
  const [customGridSize, setCustomGridSize] = useState<string>('16');
  const [rawToggle, setRawToggle] = useState<"A" | "B">("A");
  const [procToggle, setProcToggle] = useState<"A" | "B">("A");

  const [rawVmin, setRawVmin] = useState(0);
  const [rawVmax, setRawVmax] = useState(255);
  const [procVmin, setProcVmin] = useState(0);
  const [procVmax, setProcVmax] = useState(255);

  // Auto-scale toggles (enabled by default)
  const [rawAutoScale, setRawAutoScale] = useState(true);
  const [procAutoScale, setProcAutoScale] = useState(true);

  // Track if user has manually adjusted sliders for current image
  const [rawManuallyAdjusted, setRawManuallyAdjusted] = useState(false);
  const [procManuallyAdjusted, setProcManuallyAdjusted] = useState(false);

  // Image format: jpeg for speed (default), png for precise viewing
  const [imageFormat, setImageFormat] = useState<'jpeg' | 'png'>('jpeg');

  // Add shared zoom state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Play/Frame navigation state
  const [playing, setPlaying] = useState(false);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const maxFrames = useMemo(() => config?.images?.num_images || 100, [config]);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // FPS: 1, 2, 5, 10
  const [frameInputValue, setFrameInputValue] = useState<string>(String(index));
  const [batchSize, setBatchSize] = useState<string>('30');

  // --- Hooks for Logic ---
  const { loading, error, imgARaw, imgBRaw, imgA, imgB, vmin: autoVmin, vmax: autoVmax, metadata, prefetchSurrounding } =
    useImagePair(backendUrl, sourcePathIdx, `Cam${camera}`, index, imageFormat, rawAutoScale);
  const { filters, setFilters, addFilter, removeFilter, runProcessing, autoProcessFrame, procLoading, procImgA, procImgB, procStats, fetchProcessed, updateFilter, moveFilter, downloadImage } =
    useImageFilters(backendUrl);

  // Memoize camera options and initialize camera
  const cameraOptions = useMemo(() => {
    return config?.paths?.camera_numbers || [];
  }, [config?.paths?.camera_numbers]);

  // Initialize camera from first available option when config loads
  useEffect(() => {
    if (cameraOptions.length > 0) {
      setCamera(cameraOptions[0]);
    }
  }, [cameraOptions]);

  // Initialize filters from config
  useEffect(() => {
    if (config?.filters) {
      const configFilters = config.filters.map((f: any) => {
        const filter: any = { type: f.type };

        // Copy all parameters from config
        if (f.size !== undefined) filter.size = f.size;
        if (f.sigma !== undefined) filter.sigma = f.sigma;
        if (f.threshold !== undefined) filter.threshold = f.threshold;
        if (f.n !== undefined) filter.n = f.n;
        if (f.offset !== undefined) filter.offset = f.offset;
        if (f.white !== undefined) filter.white = f.white;
        if (f.max_gain !== undefined) filter.max_gain = f.max_gain;
        if (f.bg !== undefined) filter.bg = f.bg;

        return filter;
      });
      setFilters(configFilters);
    }
  }, [config?.filters, setFilters]);

  // Preload first batch of images on mount or when camera/source/format changes
  // Use a ref to prevent multiple simultaneous preload requests
  const preloadRef = useRef<{ camera: number; sourcePathIdx: number; imageFormat: string; autoLimits: boolean } | null>(null);

  useEffect(() => {
    const preloadImages = async () => {
      if (!config || !camera) return;

      // Prevent duplicate preload requests for the same camera/source/format combo
      if (preloadRef.current?.camera === camera &&
          preloadRef.current?.sourcePathIdx === sourcePathIdx &&
          preloadRef.current?.imageFormat === imageFormat &&
          preloadRef.current?.autoLimits === rawAutoScale) {
        return;
      }

      preloadRef.current = { camera, sourcePathIdx, imageFormat, autoLimits: rawAutoScale };
      const batchSize = config?.batches?.size || 30;

      try {
        console.log(`Preloading ${batchSize} ${imageFormat} images for camera ${camera}, source ${sourcePathIdx}`);
        await fetch(`${backendUrl}/preload_images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            camera,
            start_idx: 1,
            count: batchSize,
            source_path_idx: sourcePathIdx,
            format: imageFormat,
            auto_limits: rawAutoScale,
          }),
        });
        console.log('Preload request sent');
      } catch (e) {
        console.warn('Failed to preload images:', e);
      }
    };

    preloadImages();
  }, [backendUrl, camera, sourcePathIdx, config, imageFormat, rawAutoScale]);

  // Auto-fetch processed images when frame/camera/source changes
  useEffect(() => {
    const fetchProcessedForCurrentFrame = async () => {
      if (filters.length > 0) {
        await autoProcessFrame(`Cam${camera}`, index, sourcePathIdx, procAutoScale);
      } else {
        // Clear processed images if no filters are applied
        // This is handled in useImageFilters by setting procImgA and procImgB to null
      }
    };

    fetchProcessedForCurrentFrame();
  }, [camera, index, sourcePathIdx, autoProcessFrame, filters.length, procAutoScale]);

  // Reset manual adjustment flags when auto-scale is re-enabled
  useEffect(() => {
    if (rawAutoScale) {
      setRawManuallyAdjusted(false);
    }
  }, [rawAutoScale]);

  useEffect(() => {
    if (procAutoScale) {
      setProcManuallyAdjusted(false);
    }
  }, [procAutoScale]);

  // Reset manual adjustment flags when image changes
  useEffect(() => {
    setRawManuallyAdjusted(false);
    setProcManuallyAdjusted(false);
  }, [sourcePathIdx, camera, index]);

  // Sync frame input value with index
  useEffect(() => {
    setFrameInputValue(String(index));
  }, [index]);

  // Initialize batch size from config
  useEffect(() => {
    if (config?.batches?.size !== undefined) {
      setBatchSize(String(config.batches.size));
    }
  }, [config?.batches?.size]);

  // Check if any temporal filters are present
  const hasTemporalFilters = useMemo(() => {
    return filters.some(f => f.type === 'time' || f.type === 'pod');
  }, [filters]);

  // Save batch size to backend
  const saveBatchSize = async (newBatchSize: string) => {
    const num = parseInt(newBatchSize, 10);
    if (isNaN(num) || num < 1) return;

    try {
      await fetch(`${backendUrl}/update_config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batches: { size: num }
        }),
      });
      console.log('Batch size updated to', num);
    } catch (e) {
      console.error('Failed to save batch size', e);
    }
  };

  // Update slider values when server-provided auto-contrast values change
  useEffect(() => {
    if (rawAutoScale && !rawManuallyAdjusted) {
      setRawVmin(autoVmin);
      setRawVmax(autoVmax);
    }
  }, [autoVmin, autoVmax, rawAutoScale, rawManuallyAdjusted]);

  // Auto-contrast for processed images
  useEffect(() => {
    if (procAutoScale && !procManuallyAdjusted) {
      if (procStats) {
        // Use server stats if available
        if (procToggle === 'A' && procStats.A) {
          setProcVmin(procStats.A.vmin);
          setProcVmax(procStats.A.vmax);
        } else if (procToggle === 'B' && procStats.B) {
          setProcVmin(procStats.B.vmin);
          setProcVmax(procStats.B.vmax);
        }
      } else if (procImgA || procImgB) {
        // Fallback to 0-255 if no stats (existing logic)
        setProcVmin(0);
        setProcVmax(255);
      }
    }
  }, [procStats, procImgA, procImgB, procAutoScale, procManuallyAdjusted, procToggle]);

  // Save filters to config when they change (debounced to avoid excessive updates)
  useEffect(() => {
    // Debounce filter saves to reduce backend calls
    const timeoutId = setTimeout(async () => {
      // Prepare filters with all parameters for saving
      const filtersToSave = filters.map(f => {
        const filterData: any = { type: f.type };

        // Include all parameters based on filter type
        if (f.size !== undefined) filterData.size = f.size;
        if (f.sigma !== undefined) filterData.sigma = f.sigma;
        if (f.threshold !== undefined) filterData.threshold = f.threshold;
        if (f.n !== undefined) filterData.n = f.n;
        if (f.offset !== undefined) filterData.offset = f.offset;
        if (f.white !== undefined) filterData.white = f.white;
        if (f.max_gain !== undefined) filterData.max_gain = f.max_gain;
        if (f.bg !== undefined) filterData.bg = f.bg;

        return filterData;
      });

      try {
        await fetch(`${backendUrl}/update_config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: filtersToSave }),
        });
      } catch (e) {
        console.error('Failed to save filters to backend', e);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [filters, backendUrl]);

  const sourcePaths = useMemo(() => config?.paths?.source_paths || [], [config]);
  const maxVal = metadata?.bitDepth ? 2 ** metadata.bitDepth - 1 : 255;

  // Track when images start/finish loading (but not during playback)
  useEffect(() => {
    if (!playing) {
      setIsImageLoading(true);
    }
  }, [index, camera, sourcePathIdx, playing]);

  useEffect(() => {
    if (!loading && !playing) {
      setIsImageLoading(false);
    }
  }, [loading, playing]);

  // Play/Pause functionality with smart prefetching
  useEffect(() => {
    if (playing) {
      // Prefetch ahead based on playback speed
      const prefetchCount = Math.max(5, Math.ceil(playbackSpeed * 3));
      prefetchSurrounding(index, prefetchCount);

      const advanceFrame = () => {
        setIndex(prev => {
          const next = prev >= maxFrames ? 1 : prev + 1;
          // Prefetch frames ahead while playing
          prefetchSurrounding(next, prefetchCount);
          return next;
        });
      };

      // Calculate interval based on playback speed (FPS)
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Image Pre-Processing & Viewer</CardTitle>
        <CardDescription>
          Load raw images, define a filter stack, and process them for inspection. All controls are in this panel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* --- FILTER STACK UI (TOP) --- */}
        <div className="space-y-3 p-4 border rounded-lg">
            <h3 className="text-lg font-semibold">Filter Stack</h3>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <FilterSelector onAddFilter={addFilter} />
              </div>
              {hasTemporalFilters && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="batch-size" className="text-xs whitespace-nowrap">Batch Size:</Label>
                  <Input
                    id="batch-size"
                    type="number"
                    min="1"
                    value={batchSize}
                    onChange={(e) => setBatchSize(e.target.value)}
                    onBlur={() => saveBatchSize(batchSize)}
                    className="w-20 h-9"
                    title="Number of images per batch for temporal filters (Time, POD)"
                  />
                </div>
              )}
            </div>
            <div className="space-y-2 p-2 border rounded-md min-h-[100px] bg-muted/50">
              {filters.length === 0 && <p className="text-sm text-muted-foreground">No filters applied</p>}
              {filters.map((filter, idx) => (
                <FilterEditor
                  key={idx}
                  filter={filter}
                  index={idx}
                  onUpdate={updateFilter}
                  onRemove={removeFilter}
                  onMoveUp={() => moveFilter(idx, 'up')}
                  onMoveDown={() => moveFilter(idx, 'down')}
                  isFirst={idx === 0}
                  isLast={idx === filters.length - 1}
                />
              ))}
            </div>
            <Button className="w-full" onClick={() => runProcessing(`Cam${camera}`, index, sourcePathIdx, procAutoScale)} disabled={procLoading || filters.length === 0}>
              {procLoading ? "Processing..." : "Test Filters"}
            </Button>
        </div>

        {/* --- TOP-LEVEL CONTROLS --- */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <Label>Source Path</Label>
            <Select value={String(sourcePathIdx)} onValueChange={v => setSourcePathIdx(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{sourcePaths.map((p: string, i: number) => <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Camera</Label>
            <Select value={String(camera)} onValueChange={v => setCamera(Number(v))} disabled={cameraOptions.length === 0}>
              <SelectTrigger><SelectValue placeholder={cameraOptions.length === 0 ? "No cameras" : undefined} /></SelectTrigger>
              <SelectContent>
                {cameraOptions.length === 0 ? (
                  <SelectItem value="none" disabled>No cameras available</SelectItem>
                ) : (
                  cameraOptions.map((cam: number) => <SelectItem key={cam} value={String(cam)}>{cam}</SelectItem>)
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Colormap</Label>
            <Select value={colormap} onValueChange={v => setColormap(v as any)}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gray">Grayscale</SelectItem>
                <SelectItem value="viridis">Viridis</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Image Format Toggle */}
        <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-md">
          <Label className="text-sm font-medium">Image Format:</Label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={imageFormat === 'jpeg' ? 'default' : 'outline'}
              onClick={() => setImageFormat('jpeg')}
              title="JPEG: Faster loading, smaller file size (recommended for playback)"
            >
              JPEG (Fast)
            </Button>
            <Button
              size="sm"
              variant={imageFormat === 'png' ? 'default' : 'outline'}
              onClick={() => setImageFormat('png')}
              title="PNG: Lossless quality for precise viewing"
            >
              PNG (Precise)
            </Button>
          </div>
          <span className="text-xs text-gray-500">
            {imageFormat === 'jpeg' ? 'Optimized for speed' : 'Lossless quality'}
          </span>
        </div>

        {/* --- FRAME NAVIGATION CONTROLS --- */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-4 mt-4">
          <label htmlFor="frame-slider" className="text-sm font-medium">Frame:</label>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIndex(Math.max(1, index - 1))}
              disabled={index <= 1}
              className="rounded-full p-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4L6 10l6 6" />
              </svg>
            </Button>
            <input
              id="frame-slider"
              type="range"
              min={1}
              max={maxFrames}
              value={index}
              onChange={e => setIndex(Number(e.target.value))}
              className="w-64"
            />
            <Input
              id="frame-input"
              type="number"
              min={1}
              max={maxFrames}
              value={frameInputValue}
              onChange={e => {
                const val = e.target.value;
                setFrameInputValue(val);
                // Only update index if value is a valid number
                if (val && !isNaN(Number(val))) {
                  const num = Math.max(1, Math.min(maxFrames, Number(val)));
                  setIndex(num);
                }
              }}
              onBlur={e => {
                // On blur, ensure we have a valid value
                const val = e.target.value;
                if (!val || isNaN(Number(val))) {
                  setFrameInputValue(String(index));
                } else {
                  const num = Math.max(1, Math.min(maxFrames, Number(val)));
                  setIndex(num);
                  setFrameInputValue(String(num));
                }
              }}
              className="w-24"
            />
            <span className="text-xs text-gray-500 whitespace-nowrap">{index} / {maxFrames}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIndex(Math.min(maxFrames, index + 1))}
              disabled={index >= maxFrames}
              className="rounded-full p-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 4l6 6-6 6" />
              </svg>
            </Button>
          </div>
          <Button
            size="sm"
            variant={playing ? "default" : "outline"}
            onClick={() => setPlaying(!playing)}
            className="flex items-center gap-1"
          >
            {playing ? <span>&#10073;&#10073; Pause</span> : <span>&#9654; Play</span>}
          </Button>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Playback Speed:</Label>
            <Select
              value={String(playbackSpeed)}
              onValueChange={(v) => setPlaybackSpeed(Number(v))}
              disabled={playing}
            >
              <SelectTrigger className="w-24 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0.5">0.5 FPS</SelectItem>
                <SelectItem value="1">1 FPS</SelectItem>
                <SelectItem value="2">2 FPS</SelectItem>
                <SelectItem value="5">5 FPS</SelectItem>
                <SelectItem value="10">10 FPS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* --- IMAGE VIEWERS --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* RAW IMAGE PANEL */}
          <div className="space-y-4">
            <div className="h-[480px] relative">
              <ZoomableCanvas
                raw={rawToggle === 'A' ? imgARaw : rawToggle === 'B' ? imgBRaw : undefined}
                src={rawToggle === 'A' ? (imgARaw ? undefined : imgA) : rawToggle === 'B' ? (imgBRaw ? undefined : imgB) : undefined}
                error={error}
                vmin={rawVmin} vmax={rawVmax} colormap={colormap} title={`Raw Image ${rawToggle}`}
                useGrid={useGrid} gridSize={gridSize}
                zoomLevel={zoomLevel} panX={panX} panY={panY} onZoomChange={(zl, px, py) => { setZoomLevel(zl); setPanX(px); setPanY(py); }}
              />
              {loading && !playing && (
                <div className="absolute inset-0 bg-black bg-opacity-20 flex items-center justify-center rounded-lg">
                  <LoadingSpinner />
                </div>
              )}
            </div>
            <div className="space-y-3 p-3 border rounded-md">
              <div className="flex items-center gap-2">
                <Label>View</Label>
                <Button size="sm" variant={rawToggle === "A" ? "default" : "outline"} onClick={() => setRawToggle("A")}>A</Button>
                <Button size="sm" variant={rawToggle === "B" ? "default" : "outline"} onClick={() => setRawToggle("B")}>B</Button>
                <div className="flex items-center gap-2 ml-auto">
                  <Switch id="raw-auto-scale" checked={rawAutoScale} onCheckedChange={setRawAutoScale} />
                  <Label htmlFor="raw-auto-scale" className="text-sm">Auto Scale</Label>
                  <Switch id="use-grid" checked={useGrid} onCheckedChange={setUseGrid} />
                  <Label htmlFor="use-grid">Grid</Label>
                  {useGrid && (
                    <>
                      <Select value={String(gridSize)} onValueChange={v => {
                        const num = Number(v);
                        setGridSize(num);
                        if (num !== 0) setCustomGridSize(String(num));
                      }}>
                        <SelectTrigger className="w-24 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="8">8x8</SelectItem>
                          <SelectItem value="16">16x16</SelectItem>
                          <SelectItem value="32">32x32</SelectItem>
                          <SelectItem value="64">64x64</SelectItem>
                          <SelectItem value="0">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                      {gridSize === 0 && (
                        <Input
                          type="number"
                          min={1}
                          max={512}
                          value={customGridSize}
                          onChange={e => {
                            const val = e.target.value;
                            setCustomGridSize(val);
                            if (val && !isNaN(Number(val))) {
                              setGridSize(Number(val));
                            }
                          }}
                          onBlur={e => {
                            const val = e.target.value;
                            if (!val || isNaN(Number(val)) || Number(val) < 1) {
                              setCustomGridSize('16');
                              setGridSize(16);
                            }
                          }}
                          className="w-16 h-8"
                          placeholder="Size"
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input type="number" value={rawVmin} min={0} max={rawVmax} onChange={e => {
                  setRawManuallyAdjusted(true);
                  setRawAutoScale(false);
                  const val = Math.min(Number(e.target.value), rawVmax);
                  setRawVmin(val);
                  if (val > rawVmax) setRawVmax(val);
                }} className="w-20 h-8" />
                <div className="w-full min-w-0">
                  <Slider.Root
                    className="relative flex items-center select-none touch-none w-full h-5"
                    min={0}
                    max={maxVal}
                    step={1}
                    value={[rawVmin, rawVmax]}
                    onValueChange={([min, max]) => {
                      setRawManuallyAdjusted(true);
                      setRawAutoScale(false);
                      setRawVmin(min);
                      setRawVmax(max);
                    }}
                  >
                    <Slider.Track className="bg-gray-200 relative grow rounded-full h-[3px]">
                      <Slider.Range className="absolute bg-blue-500 rounded-full h-full" />
                    </Slider.Track>
                    <Slider.Thumb className="block w-5 h-5 bg-white rounded-[10px] border border-gray-300 hover:bg-gray-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50" />
                    <Slider.Thumb className="block w-5 h-5 bg-white rounded-[10px] border border-gray-300 hover:bg-gray-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50" />
                  </Slider.Root>
                </div>
                <Input type="number" value={rawVmax} min={rawVmin} max={maxVal} onChange={e => {
                  setRawManuallyAdjusted(true);
                  setRawAutoScale(false);
                  const val = Math.max(Number(e.target.value), rawVmin);
                  setRawVmax(val);
                  if (val < rawVmin) setRawVmin(val);
                }} className="w-20 h-8" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => downloadImage('raw', 'A', imgA || '', index, camera)} disabled={!imgA && !imgARaw}>
                Download Raw A
              </Button>
              <Button size="sm" onClick={() => downloadImage('raw', 'B', imgB || '', index, camera)} disabled={!imgB && !imgBRaw}>
                Download Raw B
              </Button>
            </div>
          </div>
          {/* PROCESSED IMAGE PANEL */}
          <div className="space-y-4">
            <div className="h-[480px] relative">
              <ZoomableCanvas
                raw={undefined}
                src={procToggle === 'A' ? procImgA : procImgB}
                vmin={procVmin}
                vmax={procVmax}
                colormap={colormap}
                title={`Processed Image ${procToggle}`}
                zoomLevel={zoomLevel} panX={panX} panY={panY} onZoomChange={(zl, px, py) => { setZoomLevel(zl); setPanX(px); setPanY(py); }}
              />
              {procLoading && !playing && (
                <div className="absolute inset-0 bg-black bg-opacity-20 flex items-center justify-center rounded-lg">
                  <LoadingSpinner />
                </div>
              )}
            </div>
            <div className="space-y-3 p-3 border rounded-md">
                <div className="flex items-center gap-2">
                  <Label>View</Label>
                  <Button size="sm" variant={procToggle === "A" ? "default" : "outline"} onClick={() => setProcToggle("A")}>A</Button>
                  <Button size="sm" variant={procToggle === "B" ? "default" : "outline"} onClick={() => setProcToggle("B")}>B</Button>
                  <div className="flex items-center gap-2 ml-auto">
                    <Switch id="proc-auto-scale" checked={procAutoScale} onCheckedChange={setProcAutoScale} />
                    <Label htmlFor="proc-auto-scale" className="text-sm">Auto Scale</Label>
                  </div>
                </div>
              <div className="flex items-center gap-2">
                <Input type="number" value={procVmin} min={0} max={procVmax} onChange={e => {
                  setProcManuallyAdjusted(true);
                  setProcAutoScale(false);
                  const val = Math.min(Number(e.target.value), procVmax);
                  setProcVmin(val);
                  if (val > procVmax) setProcVmax(val);
                }} className="w-20 h-8" />
                <div className="w-full min-w-0">
                  <Slider.Root
                    className="relative flex items-center select-none touch-none w-full h-5"
                    min={0}
                    max={maxVal}
                    step={1}
                    value={[procVmin, procVmax]}
                    onValueChange={([min, max]) => {
                      setProcManuallyAdjusted(true);
                      setProcAutoScale(false);
                      setProcVmin(min);
                      setProcVmax(max);
                    }}
                  >
                    <Slider.Track className="bg-gray-200 relative grow rounded-full h-[3px]">
                      <Slider.Range className="absolute bg-blue-500 rounded-full h-full" />
                    </Slider.Track>
                    <Slider.Thumb className="block w-5 h-5 bg-white rounded-[10px] border border-gray-300 hover:bg-gray-50 focus:shadow-[0_0_0_5px] focus:shadow-blackA8 data-[disabled]:pointer-events-none data-[disabled]:opacity-50" />
                    <Slider.Thumb className="block w-5 h-5 bg-white rounded-[10px] border border-gray-300 hover:bg-gray-50 focus:shadow-[0_0_0_5px] focus:shadow-blackA8 data-[disabled]:pointer-events-none data-[disabled]:opacity-50" />
                  </Slider.Root>
                </div>
                <Input type="number" value={procVmax} min={procVmin} max={maxVal} onChange={e => {
                  setProcManuallyAdjusted(true);
                  setProcAutoScale(false);
                  const val = Math.max(Number(e.target.value), procVmin);
                  setProcVmax(val);
                  if (val < procVmin) setProcVmin(val);
                }} className="w-20 h-8" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => downloadImage('processed', 'A', procImgA || '', index, camera)} disabled={!procImgA}>
                Download Processed A
              </Button>
              <Button size="sm" onClick={() => downloadImage('processed', 'B', procImgB || '', index, camera)} disabled={!procImgB}>
                Download Processed B
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}