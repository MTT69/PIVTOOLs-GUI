import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useImagePair, countsToPct, DisplayBounds, DisplayStats } from '@/hooks/useImagePair';
import { useImageFilters, ImageFilter } from '@/hooks/useImageFilters';
import { FilterSelector, FilterEditor } from '@/components/FilterComponents';
import ZoomableCanvas from './zoomableCanvas';
import * as Slider from '@radix-ui/react-slider';
import { basename, cn } from "@/lib/utils";
import { postJson, errorMessage } from "@/lib/api";
import { useNumericInput } from '@/hooks/useNumericInput';

interface ImagePairViewerProps {
  backendUrl?: string;
  config?: any;
  onFiltersChange?: (filters: any[]) => Promise<void>;
  updateConfig?: (path: string[], value: any) => void;
}

// Shown in the processed panel when the user's filter list is empty. Request-only: never enters
// the `filters` state, so it is never saved to config.
const DEFAULT_PREVIEW_FILTERS: ImageFilter[] = [{ type: 'ssmin', size: [7, 7] }];

// The display-range slider track spans exactly the committed window (it re-zooms on release), so a
// drag can only narrow it; widening is via the Full button, Auto Scale or the number boxes.
// Windows at least SLIDER_WHOLE_COUNTS wide step in whole counts; narrower ones (e.g. processed
// frames) in SLIDER_STEPS steps across the track.
const SLIDER_WHOLE_COUNTS = 100;
const SLIDER_STEPS = 1000;
const sliderStep = (lo: number, hi: number) => (hi - lo >= SLIDER_WHOLE_COUNTS ? 1 : (hi - lo) / SLIDER_STEPS);
// Round a bound to the slider's resolution for a window this wide (1/SLIDER_STEPS of it): whole
// counts for wide raw windows, enough decimals for narrow float windows (e.g. normalised outputs)
// that a fixed precision would collapse. Also strips float noise such as 399.99900000000002.
const MAX_DISPLAY_DECIMALS = 12;
const roundToWindow = (x: number, width: number) => {
  if (!(width > 0) || !Number.isFinite(width)) return x;
  const decimals = Math.min(MAX_DISPLAY_DECIMALS, Math.max(0, Math.ceil(-Math.log10(width / SLIDER_STEPS))));
  return Number(x.toFixed(decimals));
};
const formatCounts = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

// Loading spinner component
const LoadingSpinner = ({ className = "" }: { className?: string }) => (
  <div className={`flex items-center justify-center ${className}`}>
    <div className="relative">
      <div className="w-8 h-8 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin"></div>
      <div className="absolute inset-0 w-8 h-8 border-4 border-transparent border-t-blue-300 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
    </div>
  </div>
);

export default function ImagePairViewer({ backendUrl = "/backend", config, onFiltersChange, updateConfig }: ImagePairViewerProps) {
  // --- UI State ---
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState(1);
  const [index, setIndex] = useState(1);
  const [colormap, setColormap] = useState<"gray" | "viridis">("gray");
  
  const [useGrid, setUseGrid] = useState(false);
  const [gridSize, setGridSize] = useState(16);
  const [customGridSize, setCustomGridSize] = useState<string>('16');
  const [gridThickness, setGridThickness] = useState(1);
  const [rawToggle, setRawToggle] = useState<"A" | "B">("A");
  const [procToggle, setProcToggle] = useState<"A" | "B">("A");

  // Display window in the frame's intensity units (counts): the slider thumbs. While a thumb is
  // dragged the canvas remaps the current image; on release the window is committed to
  // rawBounds/procBounds and the server re-encodes exactly that window.
  const [rawVmin, setRawVmin] = useState(0);
  const [rawVmax, setRawVmax] = useState(0);
  const [procVmin, setProcVmin] = useState(0);
  const [procVmax, setProcVmax] = useState(0);

  // Auto-scale toggles (enabled by default)
  const [rawAutoScale, setRawAutoScale] = useState(true);
  const [procAutoScale, setProcAutoScale] = useState(true);

  // Committed manual windows; persist across frames while auto scale is off
  const [rawBounds, setRawBounds] = useState<DisplayBounds | null>(null);
  const [procBounds, setProcBounds] = useState<DisplayBounds | null>(null);
  // Slider track [lo, hi]: the committed window, held separately so it stays put during a drag
  const [rawTrack, setRawTrack] = useState<[number, number]>([0, 1]);
  const [procTrack, setProcTrack] = useState<[number, number]>([0, 1]);
  const rawDisplayBounds = useMemo(() => (rawAutoScale ? null : rawBounds), [rawAutoScale, rawBounds]);
  const procDisplayBounds = useMemo(() => (procAutoScale ? null : procBounds), [procAutoScale, procBounds]);

  // Image format: jpeg for speed (default), png for precise viewing
  const [imageFormat, setImageFormat] = useState<'jpeg' | 'png'>('jpeg');

  // Add shared zoom state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Play/Frame navigation state
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false); // Ref to avoid stale closure in playback loop
  const indexRef = useRef(index); // Ref to track current index without re-creating interval

  // Playback source: determines which image pipeline gates frame advancement
  const [playbackSource, setPlaybackSource] = useState<"raw" | "processed">("raw");

  // Number of frame pairs (computed by backend from stride config)
  const maxFrames = useMemo(() => {
    return config?.images?.num_images || 100;
  }, [config?.images?.num_images]);

  const [isImageLoading, setIsImageLoading] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // FPS: 0.5, 1, 2, 5, 10

  // Keep refs in sync with state for use in playback loop
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  const [frameInputValue, setFrameInputValue] = useState<string>(String(index));

  // --- Hooks for Logic ---
  // Disable raw fetching during processed playback to avoid bandwidth competition
  const rawFetchEnabled = !(playing && playbackSource === "processed");
  // autoLimits is passed as a constant: no image-pair route reads auto_limits, and keying the fetch on
  // the auto toggle would refetch the same image when a drag switches auto off. The window is carried
  // by rawDisplayBounds.
  const { loading, error, imgARaw, imgBRaw, imgA, imgB, stats: rawStatsAB, metadata, prefetchSurrounding, isFrameCached } =
    useImagePair(backendUrl, sourcePathIdx, `Cam${camera}`, index, imageFormat, true, rawFetchEnabled, rawDisplayBounds);
  const {
    filters, setFilters, addFilter, removeFilter, runProcessing, autoProcessFrame,
    procLoading, procImgA, procImgB, procStats, fetchProcessed, updateFilter, moveFilter, downloadImage,
    needsProcessing, lastError, processingBlocked, cancelProcessing, clearProcessingBlocked
  } = useImageFilters(backendUrl);

  // With an empty filter list the processed panel previews SSMin; otherwise it shows the user's filters
  const previewActive = filters.length === 0;
  const previewOverride = previewActive ? DEFAULT_PREVIEW_FILTERS : undefined;
  // Check if any temporal filters are present
  const hasTemporalFilters = useMemo(() => {
    return filters.some(f => f.type === 'time' || f.type === 'pod');
  }, [filters]);
  // Time/POD results come from the /filter store, encoded at the auto window only, so a manual window
  // is a client remap there and must not be sent (or trigger a refetch)
  const procRequestBounds = hasTemporalFilters ? null : procDisplayBounds;

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

  // Track if filters have been initialized to prevent overwriting
  const filtersInitializedRef = useRef(false);

  // Initialize filters from config only once
  useEffect(() => {
    // Only initialize if not already done AND config has filters
    if (!filtersInitializedRef.current && config?.filters) {
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
      filtersInitializedRef.current = true;
    }
  }, [config?.filters, setFilters]);

  // NOTE: Removed automatic preloading on mount - useImagePair handles prefetching
  // The frontend prefetch buffer in useImagePair loads frames as user navigates

  // Auto-fetch processed images when frame/camera/source changes
  // Skip during playback when synced to "raw" to avoid unnecessary processing and flashing
  useEffect(() => {
    const fetchProcessedForCurrentFrame = async () => {
      // Skip processing calls during playback synced to "raw" (processed panel should just show
      // last available frame). An empty filter list still renders, via the SSMin preview override.
      if (playing && playbackSource === "raw") {
        return;
      }

      await autoProcessFrame(`Cam${camera}`, index, sourcePathIdx, true, previewOverride, procRequestBounds);
    };

    fetchProcessedForCurrentFrame();
  }, [camera, index, sourcePathIdx, autoProcessFrame, previewOverride, procRequestBounds, playing, playbackSource]);

  // Sync frame input value with index
  useEffect(() => {
    setFrameInputValue(String(index));
  }, [index]);

  // Show toast when there's an error from filter processing
  useEffect(() => {
    if (lastError) {
      toast({
        title: "Filter Processing Failed",
        description: lastError,
        variant: "destructive",
      });
    }
  }, [lastError]);

  // Stats of the frame each panel shows (A or B)
  const rawStats: DisplayStats | null = rawStatsAB?.[rawToggle] ?? null;
  const procFrameStats: DisplayStats | null = procStats?.[procToggle] ?? null;

  // Auto scale: the thumbs follow the server's auto window for the shown frame
  useEffect(() => {
    if (rawAutoScale && rawStats) {
      const width = rawStats.white - rawStats.black;
      const lo = roundToWindow(rawStats.black, width);
      const hi = roundToWindow(rawStats.white, width);
      setRawVmin(lo);
      setRawVmax(hi);
      setRawTrack([lo, hi]);
    }
  }, [rawAutoScale, rawStats]);

  useEffect(() => {
    if (procAutoScale && procFrameStats) {
      const width = procFrameStats.white - procFrameStats.black;
      const lo = roundToWindow(procFrameStats.black, width);
      const hi = roundToWindow(procFrameStats.white, width);
      setProcVmin(lo);
      setProcVmax(hi);
      setProcTrack([lo, hi]);
    }
  }, [procAutoScale, procFrameStats]);

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
        await postJson(`${backendUrl}/update_config`, { filters: filtersToSave });

        // Update parent config to keep it in sync
        if (updateConfig) {
          updateConfig(['filters'], filtersToSave);
        }
      } catch (e) {
        console.error('Failed to save filters to backend', e);
        toast({
          title: "Failed to save filters",
          description: errorMessage(e),
          variant: "destructive",
        });
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [filters, backendUrl, updateConfig]);

  const sourcePaths = useMemo(() => config?.paths?.source_paths || [], [config]);
  const rawTrackWidth = rawTrack[1] - rawTrack[0];
  const procTrackWidth = procTrack[1] - procTrack[0];
  const rawStep = sliderStep(rawTrack[0], rawTrack[1]);
  const procStep = sliderStep(procTrack[0], procTrack[1]);
  // Full range of the shown frame, from 0 for camera counts (data_min if a filter went negative)
  const rawFull: [number, number] | null = rawStats ? [Math.min(0, rawStats.data_min), rawStats.data_max] : null;
  const procFull: [number, number] | null = procFrameStats ? [Math.min(0, procFrameStats.data_min), procFrameStats.data_max] : null;

  // Canvas contrast is % of the encoded image, which spans enc_lo..enc_hi counts
  const rawPct = (c: number) => (rawStats ? countsToPct(rawStats, c) : c);
  const procPct = (c: number) => (procFrameStats ? countsToPct(procFrameStats, c) : c);

  // Commit a manual window (the server re-encodes it, the track zooms to it); auto scale goes off
  const commitRaw = (vmin: number, vmax: number) => {
    setRawAutoScale(false);
    setRawVmin(vmin);
    setRawVmax(vmax);
    setRawBounds({ vmin, vmax });
    setRawTrack([vmin, vmax]);
  };
  const commitProc = (vmin: number, vmax: number) => {
    setProcAutoScale(false);
    setProcVmin(vmin);
    setProcVmax(vmax);
    setProcBounds({ vmin, vmax });
    setProcTrack([vmin, vmax]);
  };

  // Turning auto off keeps the current (auto) window as the manual one; turning it on drops it
  const toggleRawAuto = (on: boolean) => {
    setRawAutoScale(on);
    setRawBounds(on || rawVmax <= rawVmin ? null : { vmin: rawVmin, vmax: rawVmax });
  };
  const toggleProcAuto = (on: boolean) => {
    setProcAutoScale(on);
    setProcBounds(on || procVmax <= procVmin ? null : { vmin: procVmin, vmax: procVmax });
  };

  // Bound inputs: string-buffered so decimals can be typed; committed on blur/Enter when changed.
  const rawVminInput = useNumericInput({
    configValue: rawVmin, defaultValue: rawVmin, mode: 'float', min: rawFull?.[0], max: rawVmax - rawStep,
    onCommit: (val) => { const v = roundToWindow(val, rawTrackWidth); if (v !== rawVmin) commitRaw(v, rawVmax); },
  });
  const rawVmaxInput = useNumericInput({
    configValue: rawVmax, defaultValue: rawVmax, mode: 'float', min: rawVmin + rawStep,
    onCommit: (val) => { const v = roundToWindow(val, rawTrackWidth); if (v !== rawVmax) commitRaw(rawVmin, v); },
  });
  const procVminInput = useNumericInput({
    configValue: procVmin, defaultValue: procVmin, mode: 'float', min: procFull?.[0], max: procVmax - procStep,
    onCommit: (val) => { const v = roundToWindow(val, procTrackWidth); if (v !== procVmin) commitProc(v, procVmax); },
  });
  const procVmaxInput = useNumericInput({
    configValue: procVmax, defaultValue: procVmax, mode: 'float', min: procVmin + procStep,
    onCommit: (val) => { const v = roundToWindow(val, procTrackWidth); if (v !== procVmax) commitProc(procVmin, v); },
  });
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

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

  // Play/Pause functionality with adaptive frame timing and strict data-ready gating
  // Uses refs to avoid recreating interval on every frame change
  // IMPORTANT: Frame counter ONLY advances when data for the NEXT frame is actually ready
  useEffect(() => {
    if (playing) {
      // Prefetch more frames ahead based on playback speed
      const prefetchCount = Math.max(8, Math.ceil(playbackSpeed * 5));
      prefetchSurrounding(indexRef.current, prefetchCount);

      let lastFrameTime = performance.now();
      let animationFrameId: number | null = null;
      let consecutiveSkips = 0;  // Track stalls for re-triggering prefetch

      const advanceFrame = (currentTime: number) => {
        if (!playingRef.current) return;

        const targetInterval = 1000 / playbackSpeed;
        const elapsed = currentTime - lastFrameTime;

        if (elapsed >= targetInterval) {
          const currentIdx = indexRef.current;
          const nextIdx = currentIdx >= maxFrames ? 1 : currentIdx + 1;

          // Check if next frame data is ready based on playback source
          let frameReady = false;
          if (playbackSource === "raw") {
            // Raw mode: STRICT - only advance if next frame is actually cached
            // Do NOT use loading state as fallback (causes frame/display mismatch)
            frameReady = isFrameCached(nextIdx);
          } else {
            // Processed mode: check if processed images are ready
            // Only advance when processing is complete (empty filter list renders the SSMin preview)
            frameReady = !procLoading && procImgA !== null;
          }

          // Only advance if next frame data is ready
          if (frameReady) {
            // Update frame
            setIndex(nextIdx);

            // Prefetch frames ahead while playing
            prefetchSurrounding(nextIdx, prefetchCount);

            lastFrameTime = currentTime;
            consecutiveSkips = 0;
          } else {
            // Frame not ready - trigger more prefetching if we're stalling
            consecutiveSkips++;
            if (consecutiveSkips >= 2 && playbackSource === "raw") {
              prefetchSurrounding(currentIdx, prefetchCount);
            }
          }
        }

        // Continue the animation loop
        animationFrameId = requestAnimationFrame(advanceFrame);
      };

      // Start the animation loop
      animationFrameId = requestAnimationFrame(advanceFrame);

      // Cleanup
      return () => {
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
        }
      };
    }
  }, [playing, maxFrames, playbackSpeed, prefetchSurrounding, playbackSource, isFrameCached, procLoading, procImgA]);

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
            <Button className="w-full" onClick={() => runProcessing(`Cam${camera}`, index, sourcePathIdx, true, undefined, procRequestBounds)} disabled={procLoading || filters.length === 0}>
              {procLoading ? "Processing..." : "Test Filters"}
            </Button>
        </div>

        {/* --- TOP-LEVEL CONTROLS --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div>
            <Label>Source Path</Label>
            <Select value={String(sourcePathIdx)} onValueChange={v => setSourcePathIdx(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{sourcePaths.map((p: string, i: number) => <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>)}</SelectContent>
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
        <div className="flex flex-col md:flex-row flex-wrap items-center justify-center gap-4 mt-4">
          <div className="flex items-center gap-1">
            <Label className="text-xs whitespace-nowrap">Camera:</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="px-2"
              disabled={cameraOptions.length <= 1}
              onClick={() => {
                const i = cameraOptions.indexOf(camera);
                const n = cameraOptions.length;
                setCamera(cameraOptions[(i - 1 + n) % n]);
              }}
            >
              ◀
            </Button>
            <span className="text-xs font-medium px-2 py-1 bg-gray-100 rounded min-w-[3.5rem] text-center">
              {cameraOptions.length === 0 ? "No cameras" : `Cam ${camera}`}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="px-2"
              disabled={cameraOptions.length <= 1}
              onClick={() => {
                const i = cameraOptions.indexOf(camera);
                const n = cameraOptions.length;
                setCamera(cameraOptions[(i + 1) % n]);
              }}
            >
              ▶
            </Button>
          </div>
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
              className="w-40"
            />
            <Input
              id="frame-input"
              type="text" inputMode="numeric"
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
            <Label className="text-xs whitespace-nowrap">Speed:</Label>
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
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Sync To:</Label>
            <Select
              value={playbackSource}
              onValueChange={(v) => setPlaybackSource(v as "raw" | "processed")}
              disabled={playing}
            >
              <SelectTrigger className="w-28 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="raw">Raw</SelectItem>
                <SelectItem value="processed">
                  Processed
                </SelectItem>
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
                vmin={rawPct(rawVmin)} vmax={rawPct(rawVmax)} colormap={colormap} title={`Raw Image ${rawToggle}`}
                useGrid={useGrid} gridSize={gridSize} gridThickness={gridThickness}
                zoomLevel={zoomLevel} panX={panX} panY={panY} onZoomChange={(zl, px, py) => { setZoomLevel(zl); setPanX(px); setPanY(py); }}
              />
              {loading && !playing && (
                <div className="absolute inset-0 bg-black bg-opacity-20 flex items-center justify-center rounded-lg">
                  <LoadingSpinner />
                </div>
              )}
            </div>
            <div className="space-y-3 p-3 border rounded-md">
              <div className="flex items-center gap-2 justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("text-sm font-medium", rawToggle === "A" ? "text-primary" : "text-muted-foreground")}>A</span>
                  <Switch
                    id="raw-toggle"
                    checked={rawToggle === "B"}
                    onCheckedChange={(checked) => setRawToggle(checked ? "B" : "A")}
                  />
                  <span className={cn("text-sm font-medium", rawToggle === "B" ? "text-primary" : "text-muted-foreground")}>B</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="raw-auto-scale" checked={rawAutoScale} onCheckedChange={toggleRawAuto} />
                  <Label htmlFor="raw-auto-scale" className="text-sm">Auto Scale</Label>
                </div>
              </div>

              {/* Grid Controls - Separate Row */}
              <div className="flex items-center gap-2 pt-2 border-t">
                <Switch id="use-grid" checked={useGrid} onCheckedChange={setUseGrid} />
                <Label htmlFor="use-grid" className="text-sm">Grid</Label>
                {useGrid && (
                  <>
                    <Label className="text-xs text-muted-foreground ml-2">Size:</Label>
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
                        type="text" inputMode="numeric"
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
                    <Label className="text-xs text-muted-foreground ml-2">Thickness:</Label>
                    <Select value={String(gridThickness)} onValueChange={v => setGridThickness(Number(v))}>
                      <SelectTrigger className="w-20 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1px</SelectItem>
                        <SelectItem value="2">2px</SelectItem>
                        <SelectItem value="4">4px</SelectItem>
                        <SelectItem value="6">6px</SelectItem>
                        <SelectItem value="8">8px</SelectItem>
                        <SelectItem value="10">10px</SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input type="text" inputMode="decimal" {...rawVminInput} onKeyDown={blurOnEnter} disabled={!rawStats} className="w-20 h-8" />
                <div className="w-full min-w-0">
                  <Slider.Root
                    className="relative flex items-center select-none touch-none w-full h-5"
                    min={rawTrack[0]}
                    max={rawTrack[1]}
                    step={rawStep}
                    minStepsBetweenThumbs={1}
                    value={[rawVmin, rawVmax]}
                    disabled={!rawStats || rawTrackWidth <= 0}
                    onValueChange={([lo, hi]) => {
                      setRawAutoScale(false);
                      setRawVmin(roundToWindow(lo, rawTrackWidth));
                      setRawVmax(roundToWindow(hi, rawTrackWidth));
                    }}
                    onValueCommit={([lo, hi]) => commitRaw(roundToWindow(lo, rawTrackWidth), roundToWindow(hi, rawTrackWidth))}
                  >
                    <Slider.Track className="bg-gray-200 relative grow rounded-full h-[3px]">
                      <Slider.Range className="absolute bg-blue-500 rounded-full h-full" />
                    </Slider.Track>
                    <Slider.Thumb className="block w-5 h-5 bg-white rounded-[10px] border border-gray-300 hover:bg-gray-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50" />
                    <Slider.Thumb className="block w-5 h-5 bg-white rounded-[10px] border border-gray-300 hover:bg-gray-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50" />
                  </Slider.Root>
                </div>
                <Input type="text" inputMode="decimal" {...rawVmaxInput} onKeyDown={blurOnEnter} disabled={!rawStats} className="w-20 h-8" />
              </div>
              {rawStats && rawFull && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Display range in counts · frame range {formatCounts(rawStats.data_min)}–{formatCounts(rawStats.data_max)}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={rawVmin === rawFull[0] && rawVmax === rawFull[1]}
                    onClick={() => commitRaw(rawFull[0], rawFull[1])}
                  >
                    Full
                  </Button>
                </div>
              )}
              {rawAutoScale && rawStats?.method === 'percentile_fallback' && (
                <p className="text-xs text-muted-foreground">Auto: no particles found — percentile window</p>
              )}
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
                vmin={procPct(procVmin)}
                vmax={procPct(procVmax)}
                colormap={colormap}
                title={`Processed Image ${procToggle}`}
                useGrid={useGrid} gridSize={gridSize} gridThickness={gridThickness}
                zoomLevel={zoomLevel} panX={panX} panY={panY} onZoomChange={(zl, px, py) => { setZoomLevel(zl); setPanX(px); setPanY(py); }}
              />
              {procLoading && !playing && (
                <div className="absolute inset-0 bg-black bg-opacity-50 flex flex-col items-center justify-center rounded-lg">
                  <LoadingSpinner />
                  <p className="text-white mt-2 text-sm">Processing filters...</p>
                </div>
              )}
              {!procLoading && needsProcessing && hasTemporalFilters && !playing && (
                <div className="absolute inset-0 bg-gray-100/90 flex flex-col items-center justify-center rounded-lg border border-gray-300">
                  <p className="text-gray-600 text-sm mb-3">Frame not yet processed</p>
                  <Button
                    size="sm"
                    onClick={() => runProcessing(`Cam${camera}`, index, sourcePathIdx, true, undefined, procRequestBounds)}
                  >
                    Test Filters
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-3 p-3 border rounded-md">
                {previewActive && (
                  <p className="text-xs text-muted-foreground">Default preview: SSMin 7×7 — not in your filter list</p>
                )}
                <div className="flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-sm font-medium", procToggle === "A" ? "text-primary" : "text-muted-foreground")}>A</span>
                    <Switch
                      id="proc-toggle"
                      checked={procToggle === "B"}
                      onCheckedChange={(checked) => setProcToggle(checked ? "B" : "A")}
                    />
                    <span className={cn("text-sm font-medium", procToggle === "B" ? "text-primary" : "text-muted-foreground")}>B</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="proc-auto-scale" checked={procAutoScale} onCheckedChange={toggleProcAuto} />
                    <Label htmlFor="proc-auto-scale" className="text-sm">Auto Scale</Label>
                  </div>
                </div>
              <div className="flex items-center gap-2">
                <Input type="text" inputMode="decimal" {...procVminInput} onKeyDown={blurOnEnter} disabled={!procFrameStats} className="w-20 h-8" />
                <div className="w-full min-w-0">
                  <Slider.Root
                    className="relative flex items-center select-none touch-none w-full h-5"
                    min={procTrack[0]}
                    max={procTrack[1]}
                    step={procStep}
                    minStepsBetweenThumbs={1}
                    value={[procVmin, procVmax]}
                    disabled={!procFrameStats || procTrackWidth <= 0}
                    onValueChange={([lo, hi]) => {
                      setProcAutoScale(false);
                      setProcVmin(roundToWindow(lo, procTrackWidth));
                      setProcVmax(roundToWindow(hi, procTrackWidth));
                    }}
                    onValueCommit={([lo, hi]) => commitProc(roundToWindow(lo, procTrackWidth), roundToWindow(hi, procTrackWidth))}
                  >
                    <Slider.Track className="bg-gray-200 relative grow rounded-full h-[3px]">
                      <Slider.Range className="absolute bg-blue-500 rounded-full h-full" />
                    </Slider.Track>
                    <Slider.Thumb className="block w-5 h-5 bg-white rounded-[10px] border border-gray-300 hover:bg-gray-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50" />
                    <Slider.Thumb className="block w-5 h-5 bg-white rounded-[10px] border border-gray-300 hover:bg-gray-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50" />
                  </Slider.Root>
                </div>
                <Input type="text" inputMode="decimal" {...procVmaxInput} onKeyDown={blurOnEnter} disabled={!procFrameStats} className="w-20 h-8" />
              </div>
              {procFrameStats && procFull && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Display range in processed intensity · frame range {formatCounts(procFrameStats.data_min)}–{formatCounts(procFrameStats.data_max)}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={procVmin === procFull[0] && procVmax === procFull[1]}
                    onClick={() => commitProc(procFull[0], procFull[1])}
                  >
                    Full
                  </Button>
                </div>
              )}
              {procAutoScale && procFrameStats?.method === 'percentile_fallback' && (
                <p className="text-xs text-muted-foreground">Auto: no particles found — percentile window</p>
              )}
              {!procAutoScale && hasTemporalFilters && procFrameStats && (
                <p className="text-xs text-muted-foreground">
                  Time/POD filters: the window is applied to the auto-encoded image, which only holds{' '}
                  {formatCounts(procFrameStats.enc_lo)}–{formatCounts(procFrameStats.enc_hi)}; values outside it clip.
                </p>
              )}
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

      {/* Dialog shown when user tries to modify filters during processing */}
      <AlertDialog open={processingBlocked} onOpenChange={(open) => !open && clearProcessingBlocked()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Processing in Progress</AlertDialogTitle>
            <AlertDialogDescription>
              Filters cannot be modified while batch processing is running.
              Would you like to cancel the current processing?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={clearProcessingBlocked}>Wait for Completion</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              cancelProcessing();
              clearProcessingBlocked();
            }}>
              Cancel Processing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}