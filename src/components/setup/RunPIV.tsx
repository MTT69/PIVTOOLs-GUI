// src/components/RunPIV.tsx

"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ColormapSelect from "@/components/shared/ColormapSelect";
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
import { usePivJobContext } from '@/contexts/PivJobContext';

// Helper to display a user-friendly path name
const basename = (p: string) => p?.replace(/\\/g, "/").split("/").filter(Boolean).pop() || p;

interface RunPIVProps {
  config?: any;
  showProgressBar?: boolean;
  showFrameViewer?: boolean;
  showSimpleStatus?: boolean;
  title?: string;
  mode?: "instantaneous" | "ensemble";
}

const RunPIV: React.FC<RunPIVProps> = ({
  config,
  showProgressBar = true,
  showFrameViewer = true,
  showSimpleStatus = false,
  title = "Run PIV",
  mode = "instantaneous"
}) => {
  // Get job state from context
  const {
    instantaneousJob,
    ensembleJob,
    startJob,
    cancelJob,
    resetJob,
    updateSettings,
    instantaneousSettings,
    ensembleSettings,
  } = usePivJobContext();

  // Select the appropriate job and settings based on mode
  const job = mode === 'ensemble' ? ensembleJob : instantaneousJob;
  const settings = mode === 'ensemble' ? ensembleSettings : instantaneousSettings;
  const { isLoading, isPolling, progress, statusImage, logs } = job;

  // --- UI State (local to component) ---
  const [varType, setVarType] = useState<string>(settings.varType);
  const [cmap, setCmap] = useState<string>(settings.cmap);
  const [lowerLimit, setLowerLimit] = useState<string>(settings.lowerLimit);
  const [upperLimit, setUpperLimit] = useState<string>(settings.upperLimit);
  const [showStatusImage, setShowStatusImage] = useState(true);
  const [showLogs, setShowLogs] = useState(true);
  const [frameVars, setFrameVars] = useState<string[]>(['ux', 'uy', 'nan_mask', 'peak_mag']);
  const [frameVarsLoading, setFrameVarsLoading] = useState(false);
  const [showOverwriteDialog, setShowOverwriteDialog] = useState(false);
  const [isCheckingOutput, setIsCheckingOutput] = useState(false);

  // Ref for log container to enable auto-scroll
  const logContainerRef = useRef<HTMLDivElement>(null);

  // --- Derived State (memoized for performance) ---
  const sourcePaths = useMemo(() => config?.paths?.source_paths || [], [config]);
  const basePaths = useMemo(() => config?.paths?.base_paths || [], [config]);
  const activePaths = settings.activePaths;
  const sourcePathIdx = settings.sourcePathIdx;

  // Sync UI state changes to context settings
  const handleUpdateSettings = useCallback((updates: Partial<typeof settings>) => {
    updateSettings(mode, updates);
  }, [mode, updateSettings]);

  // Update context when local UI state changes
  useEffect(() => {
    handleUpdateSettings({ varType, cmap, lowerLimit, upperLimit, showStatusImage });
  }, [varType, cmap, lowerLimit, upperLimit, showStatusImage, handleUpdateSettings]);

  // Initialize activePaths when sourcePaths change (only if empty)
  useEffect(() => {
    if (sourcePaths.length > 0 && activePaths.length === 0) {
      handleUpdateSettings({ activePaths: sourcePaths.map((_: string, i: number) => i) });
    }
  }, [sourcePaths, activePaths.length, handleUpdateSettings]);

  // Toggle a specific path's active state
  const togglePath = useCallback((idx: number) => {
    const newPaths = activePaths.includes(idx)
      ? activePaths.filter((i: number) => i !== idx)
      : [...activePaths, idx].sort((a, b) => a - b);
    handleUpdateSettings({ activePaths: newPaths });
  }, [activePaths, handleUpdateSettings]);

  // Check if output data already exists before starting a run
  const handleRunClick = async () => {
    if (activePaths.length === 0) return;

    setIsCheckingOutput(true);
    try {
      const url = `/backend/check_output_exists?active_paths=${activePaths.join(',')}&mode=${mode}`;
      console.log('[RunPIV] Checking for existing output:', url);
      const checkRes = await fetch(url);
      console.log('[RunPIV] Check response status:', checkRes.status);

      if (checkRes.ok) {
        const data = await checkRes.json();
        console.log('[RunPIV] Check response data:', data);

        if (data.exists) {
          // Data exists - show confirmation dialog
          console.log('[RunPIV] Data exists, showing dialog');
          setShowOverwriteDialog(true);
          setIsCheckingOutput(false);
          return; // Don't run yet - wait for user confirmation
        } else {
          // No existing data - run directly
          console.log('[RunPIV] No existing data, running directly');
          await startJob(mode, settings);
        }
      } else {
        // If check fails, just run anyway
        console.log('[RunPIV] Check failed, running anyway');
        await startJob(mode, settings);
      }
    } catch (error) {
      console.error("[RunPIV] Error checking for existing output:", error);
      // On error, just run anyway
      await startJob(mode, settings);
    } finally {
      setIsCheckingOutput(false);
    }
  };

  // Handle user confirming they want to overwrite existing data
  const handleConfirmOverwrite = async () => {
    setShowOverwriteDialog(false);
    setIsCheckingOutput(true);

    try {
      // Clear existing output data for selected paths and cameras
      console.log('[RunPIV] Clearing output for paths:', activePaths, 'cameras:', config?.paths?.camera_numbers);
      const clearRes = await fetch('/backend/clear_output', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_paths: activePaths,
          camera_numbers: config?.paths?.camera_numbers || [],
          mode: mode
        })
      });

      if (clearRes.ok) {
        const result = await clearRes.json();
        console.log('[RunPIV] Clear result:', result);
      } else {
        console.error("[RunPIV] Failed to clear output data:", clearRes.status);
      }
    } catch (error) {
      console.error("[RunPIV] Error clearing output:", error);
    } finally {
      setIsCheckingOutput(false);
    }

    // Start the PIV run
    console.log('[RunPIV] Starting PIV run after clear');
    await startJob(mode, settings);
  };

  // Handle cancel
  const handleCancel = async () => {
    try {
      await cancelJob(mode);
    } catch (error) {
      console.error("[RunPIV] Error cancelling run:", error);
    }
  };

  // --- Effects for UI Sync ---
  // Auto-scroll logs to bottom when they update
  useEffect(() => {
    if (logContainerRef.current && logs) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Only fetch available variables when PIV is running and progress > 0
  useEffect(() => {
    if (!isPolling || progress === 0) return;

    const fetchFrameVars = async () => {
      setFrameVarsLoading(true);
      try {
        const params = new URLSearchParams({
          basepath_idx: String(sourcePathIdx),
          frame: '1',
          is_uncalibrated: '1',
        });
        const res = await fetch(`/backend/plot/check_vars?${params.toString()}`);

        // Only process if the response is OK
        if (res.ok) {
          const json = await res.json();
          const allowed = ["ux", "uy", "nan_mask", "peak_mag"];
          const filtered = (json.vars || []).filter((v: string) => allowed.includes(v));
          if (filtered.length > 0) {
            setFrameVars(filtered);
            // Only update varType if current one is not in the list
            setVarType(prevVarType => filtered.includes(prevVarType) ? prevVarType : filtered[0]);
          } else {
            setFrameVars(allowed);
          }
        } else {
          // If frame doesn't exist yet, just keep the default vars
          console.log("Frame not ready yet, using default variables");
        }
      } catch (error) {
        console.log("Waiting for frames to be available...", error);
        // Don't throw error, just keep the default variables
      } finally {
        setFrameVarsLoading(false);
      }
    };

    // Add a small delay to allow first frame to be created
    const timeoutId = setTimeout(fetchFrameVars, 1000);
    return () => clearTimeout(timeoutId);
  }, [isPolling, progress, sourcePathIdx]);

  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-6">

        {/* Setup Summary */}
        {config && (() => {
          const images = config.images || {};
          const paths = config.paths || {};
          const processing = config.processing || {};
          const pivConfig = mode === "ensemble" ? (config.ensemble_piv || {}) : (config.instantaneous_piv || {});
          const masking = config.masking || {};
          const filters = config.filters || [];

          const sourceName = basename(paths.source_paths?.[0] || "");
          const numLoops = images.num_loops || 1;
          const numImages = images.num_images || 0;
          const numPairs = images.num_frame_pairs || 0;
          const preset = images.pairing_preset || "";
          const format = Array.isArray(images.image_format) ? images.image_format[0] : images.image_format || "";

          // Window sizes: [[128,128],[64,64],...] → "128→64→32→16"
          const windowSizes = pivConfig.window_size || [];
          const windowStr = windowSizes.map((ws: number[]) =>
            Array.isArray(ws) ? (ws[0] === ws[1] ? `${ws[0]}` : `${ws[0]}x${ws[1]}`) : ws
          ).join(" > ");
          const overlaps = pivConfig.overlap || [];
          const overlapStr = overlaps.length > 0
            ? (overlaps.every((o: number) => o === overlaps[0]) ? `${overlaps[0]}%` : overlaps.join("/") + "%")
            : "";
          const numPasses = windowSizes.length;

          const batchSize = config.batches?.size || 1;
          const workers = processing.dask_workers_per_node || 1;
          const memLimit = processing.dask_memory_limit || "4GB";

          // Filter names
          const filterNames = filters.map((f: any) => f.type || "unknown").join(", ");

          return (
            <div className="p-3 bg-muted/50 rounded-md border text-xs space-y-1">
              <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1">
                <span className="text-muted-foreground font-medium">Source</span>
                <span>{sourceName}{numLoops > 1 ? ` + ${numLoops - 1} more loop${numLoops > 2 ? "s" : ""}` : ""}</span>

                <span className="text-muted-foreground font-medium">Images</span>
                <span>
                  {numImages > 0 ? `${numImages} ${images.image_type === "cine" ? "frames" : "files"}` : "not set"}
                  {numLoops > 1 ? ` x ${numLoops} loops = ${numPairs} pairs` : numPairs > 0 ? ` = ${numPairs} pairs` : ""}
                  {preset ? ` (${preset.replace(/_/g, " ")})` : ""}
                </span>

                <span className="text-muted-foreground font-medium">Format</span>
                <span className="font-mono">{format}</span>

                {numPasses > 0 && (<>
                  <span className="text-muted-foreground font-medium">PIV</span>
                  <span>
                    {mode === "ensemble" ? "Ensemble" : "Instantaneous"} - {numPasses} pass{numPasses !== 1 ? "es" : ""} - {windowStr} - {overlapStr} overlap
                  </span>
                </>)}

                <span className="text-muted-foreground font-medium">Workers</span>
                <span>{workers} worker{workers !== 1 ? "s" : ""} - {batchSize} pairs/batch - {memLimit} per worker</span>

                {(masking.enabled || filters.length > 0) && (<>
                  <span className="text-muted-foreground font-medium">Pre-proc</span>
                  <span>
                    {masking.enabled ? `Mask (${masking.mode || "file"})` : ""}
                    {masking.enabled && filters.length > 0 ? " + " : ""}
                    {filters.length > 0 ? filterNames : ""}
                  </span>
                </>)}
              </div>
            </div>
          );
        })()}

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-2">Source/Base Path Pairs to Process</label>
            {sourcePaths.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-3 bg-gray-50">
                {sourcePaths.map((sourcePath: string, i: number) => (
                  <label key={i} className="flex items-start gap-3 cursor-pointer hover:bg-gray-100 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={activePaths.includes(i)}
                      onChange={() => togglePath(i)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {basename(sourcePath)}
                      </div>
                      {basePaths[i] && (
                        <div className="text-xs text-gray-500 truncate">
                          → {basename(basePaths[i])}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">No paths configured</p>
            )}
            <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
              <span>{activePaths.length} of {sourcePaths.length} path(s) selected</span>
              {sourcePaths.length > 1 && (
                <>
                  <span>•</span>
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => handleUpdateSettings({ activePaths: sourcePaths.map((_: string, i: number) => i) })}
                  >
                    Select All
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => handleUpdateSettings({ activePaths: [] })}
                  >
                    Clear All
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        {showFrameViewer && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div>
              <label className="text-sm font-medium">Variable</label>
              <Select value={varType} onValueChange={setVarType} disabled={frameVarsLoading}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {frameVarsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                   frameVars.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Colormap</label>
              <ColormapSelect
                value={cmap}
                onValueChange={setCmap}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Lower Limit</label>
              <Input type="text" inputMode="numeric" value={lowerLimit} onChange={e => setLowerLimit(e.target.value)} placeholder="auto" />
            </div>
            <div>
              <label className="text-sm font-medium">Upper Limit</label>
              <Input type="text" inputMode="numeric" value={upperLimit} onChange={e => setUpperLimit(e.target.value)} placeholder="auto" />
            </div>
          </div>
        )}

        {showProgressBar && (
          <div className="space-y-2">
            <Progress value={progress} />
            <p className="text-sm text-center font-medium text-gray-500">
              {isPolling ? `Processing... ${progress}%` : (progress === 100 ? "Completed!" : "Idle")}
            </p>
          </div>
        )}

        {showSimpleStatus && (
          <div className="p-4 bg-gray-50 rounded-lg text-center">
            <p className="text-sm font-medium text-gray-600">
              {isPolling ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></span>
                  Processing...
                </span>
              ) : (
                progress === 100 ? "Complete!" : "Ready to run"
              )}
            </p>
          </div>
        )}

        {showFrameViewer && (
          <div>
            <Button variant="outline" size="sm" onClick={() => setShowStatusImage(!showStatusImage)}>
              {showStatusImage ? "Hide" : "Show"} Status Image
            </Button>
            {showStatusImage && (
              <div className="mt-2 border rounded-lg p-2 bg-gray-50 min-h-[200px] flex items-center justify-center">
                {statusImage.error && <p className="text-red-600 font-semibold">{statusImage.error}</p>}
                {statusImage.src && !statusImage.error && (
                  <img src={`data:image/png;base64,${statusImage.src}`} alt="PIV Status" className="rounded max-w-full"/>
                )}
                {!statusImage.src && !statusImage.error && isPolling && (
                  <div className="flex flex-col items-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-2"></div>
                    <p className="text-gray-500">
                      {progress === 0 ? "Waiting for run to commence..." : "Processing first frame..."}
                    </p>
                  </div>
                )}
                {!statusImage.src && !statusImage.error && !isPolling && (
                  <p className="text-gray-500">No image available</p>
                )}
              </div>
            )}
          </div>
        )}
        <div>
          <Button variant="outline" size="sm" onClick={() => setShowLogs(!showLogs)}>
            {showLogs ? "Hide" : "Show"} Console Logs
          </Button>
          {showLogs && (
            <div className="mt-2 border rounded-lg bg-gray-900 text-green-400 font-mono text-xs overflow-hidden">
              <div className="bg-gray-800 px-3 py-2 border-b border-gray-700 flex items-center justify-between">
                <span className="text-gray-300 font-semibold">PIV Console Output</span>
                {isPolling && (
                  <span className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    Live
                  </span>
                )}
              </div>
              <div
                ref={logContainerRef}
                className="p-3 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-800"
              >
                {logs ? (
                  <>
                    <pre className="whitespace-pre-wrap break-words">{logs}</pre>
                  </>
                ) : (
                  <p className="text-gray-500 italic">
                    {isPolling ? "Waiting for output..." : "No logs available. Start a PIV run to see output."}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 pt-2">
          <Button
            className="bg-green-600 hover:bg-green-700"
            onClick={handleRunClick}
            disabled={isLoading || isPolling || isCheckingOutput || activePaths.length === 0}
          >
            {isPolling ? "Running..." : isCheckingOutput ? "Checking..." : activePaths.length === 0 ? "Select Paths" : "Run PIV"}
          </Button>
          <Button className="bg-red-600 hover:bg-red-700" onClick={handleCancel} disabled={!isPolling && !isLoading}>
            Cancel Run
          </Button>
          <Button
            variant="outline"
            onClick={() => resetJob(mode)}
            disabled={isPolling || isLoading || (!logs && !statusImage.src && progress === 0)}
          >
            Clear Output
          </Button>
        </div>

        {/* Overwrite Confirmation Dialog */}
        <AlertDialog open={showOverwriteDialog} onOpenChange={setShowOverwriteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Output Data Already Exists</AlertDialogTitle>
              <AlertDialogDescription>
                Existing {mode} data was found for the selected paths. Would you like to clear it and recompute?
                This will delete all existing {mode} PIV results for the selected cameras and cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmOverwrite}
                className="bg-red-600 hover:bg-red-700"
              >
                Clear and Recompute
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};

export default RunPIV;
