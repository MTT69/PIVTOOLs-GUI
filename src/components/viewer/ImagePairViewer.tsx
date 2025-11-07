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

  // Add shared zoom state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Play/Frame navigation state
  const [playing, setPlaying] = useState(false);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const maxFrames = useMemo(() => config?.images?.num_images || 100, [config]);
  const [isImageLoading, setIsImageLoading] = useState(false);

  // --- Hooks for Logic ---
  const { loading, error, imgARaw, imgBRaw, imgA, imgB, vmin: autoVmin, vmax: autoVmax, metadata } = 
    useImagePair(backendUrl, sourcePathIdx, `Cam${camera}`, index);
  const { filters, setFilters, addFilter, removeFilter, runProcessing, autoProcessFrame, procLoading, procImgA, procImgB, fetchProcessed, updateFilter, moveFilter, downloadImage } = 
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

  // Preload first batch of images on mount or when camera/source changes
  useEffect(() => {
    const preloadImages = async () => {
      if (!config || !camera) return;
      
      const batchSize = config?.batches?.size || 30;
      
      try {
        console.log(`Preloading ${batchSize} images for camera ${camera}, source ${sourcePathIdx}`);
        await fetch(`${backendUrl}/preload_images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            camera,
            start_idx: 1,
            count: batchSize,
            source_path_idx: sourcePathIdx,
          }),
        });
        console.log('Preload request sent');
      } catch (e) {
        console.warn('Failed to preload images:', e);
      }
    };

    preloadImages();
  }, [backendUrl, camera, sourcePathIdx, config]);

  // Auto-fetch processed images when frame/camera/source changes
  useEffect(() => {
    const fetchProcessedForCurrentFrame = async () => {
      if (filters.length > 0) {
        await autoProcessFrame(`Cam${camera}`, index, sourcePathIdx);
      } else {
        // Clear processed images if no filters are applied
        // This is handled in useImageFilters by setting procImgA and procImgB to null
      }
    };

    fetchProcessedForCurrentFrame();
  }, [camera, index, sourcePathIdx, autoProcessFrame, filters.length]);

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

  // Update slider values when auto-contrast values change and autoscale is enabled
  useEffect(() => {
    if (rawAutoScale && !rawManuallyAdjusted && (autoVmin !== 0 || autoVmax !== 255)) {
      setRawVmin(autoVmin);
      setRawVmax(autoVmax);
    }
  }, [autoVmin, autoVmax, rawAutoScale, rawManuallyAdjusted]);

  // Auto-contrast for processed images when they load
  useEffect(() => {
    const applyProcAutoContrast = async () => {
      if (procAutoScale && !procManuallyAdjusted && (procImgA || procImgB)) {
        try {
          const activeImg = procToggle === 'A' ? procImgA : procImgB;
          if (activeImg) {
            const pngDataUrl = `data:image/png;base64,${activeImg}`;
            
            const img = new Image();
            img.onload = () => {
              try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                
                const imageData = ctx.getImageData(0, 0, img.width, img.height);
                const pixels = imageData.data;
                const grayscaleValues = [];
                
                for (let i = 0; i < pixels.length; i += 4) {
                  const r = pixels[i];
                  const g = pixels[i + 1];
                  const b = pixels[i + 2];
                  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                  grayscaleValues.push(gray);
                }
                
                grayscaleValues.sort((a, b) => a - b);
                
                const p1Index = Math.floor(grayscaleValues.length * 0.01);
                const p99Index = Math.floor(grayscaleValues.length * 0.99);
                
                const vmin = grayscaleValues[p1Index];
                const vmax = grayscaleValues[p99Index];
                
                setProcVmin(vmin);
                setProcVmax(vmax);
              } catch (err) {
                console.warn('[ImagePairViewer] Processed image auto-contrast failed:', err);
              }
            };
            img.src = pngDataUrl;
          } else {
            // No active image - reset to defaults
            setProcVmin(0);
            setProcVmax(255);
          }
        } catch (err) {
          console.warn('[ImagePairViewer] Processed image auto-contrast failed:', err);
          setProcVmin(0);
          setProcVmax(255);
        }
      }
    };

    applyProcAutoContrast();
  }, [procImgA, procImgB, procToggle, procAutoScale, procManuallyAdjusted]);

  // Save filters to config when they change
  useEffect(() => {
    const saveFilters = async () => {
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
    };

    // Only save if filters array has been modified (not on initial load)
    if (filters.length > 0 || config?.filters?.length > 0) {
      saveFilters();
    }
  }, [filters, backendUrl]);

  const sourcePaths = useMemo(() => config?.paths?.source_paths || [], [config]);
  const maxVal = metadata?.bitDepth ? 2 ** metadata.bitDepth - 1 : 255;

  // Track when images start/finish loading
  useEffect(() => {
    setIsImageLoading(true);
  }, [index, camera, sourcePathIdx]);

  useEffect(() => {
    if (!loading) {
      setIsImageLoading(false);
    }
  }, [loading]);

  // Play/Pause functionality with smart loading handling
  useEffect(() => {
    if (playing) {
      const advanceFrame = () => {
        // Only advance if not currently loading
        if (!isImageLoading) {
          setIndex(prev => (prev >= maxFrames ? 1 : prev + 1));
        }
      };

      // Start with 1 FPS (1000ms), but the actual rate will be limited by image load time
      playIntervalRef.current = setInterval(advanceFrame, 1000);
    } else if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [playing, maxFrames, isImageLoading]);

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
            <FilterSelector onAddFilter={addFilter} />
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
            <Button className="w-full" onClick={() => runProcessing(`Cam${camera}`, index, sourcePathIdx)} disabled={procLoading || filters.length === 0}>
              {procLoading ? "Processing..." : "Apply Filters to Frame"}
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
              value={index}
              onChange={e => setIndex(Math.max(1, Math.min(maxFrames, Number(e.target.value || 1))))}
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
              {loading && (
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
              {procLoading && (
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