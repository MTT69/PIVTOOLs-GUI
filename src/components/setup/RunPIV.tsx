// src/components/RunPIV.tsx

"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePivRunner } from '@/hooks/usePivRunner'; 

// Helper to display a user-friendly path name
const basename = (p: string) => p?.replace(/\\/g, "/").split("/").filter(Boolean).pop() || p;

interface RunPIVProps {
  config?: any;
  showProgressBar?: boolean;
  showFrameViewer?: boolean;
  showSimpleStatus?: boolean;
  title?: string;
}

const RunPIV: React.FC<RunPIVProps> = ({
  config,
  showProgressBar = true,
  showFrameViewer = true,
  showSimpleStatus = false,
  title = "Run PIV"
}) => {
  // --- UI State ---
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(0);
  const [varType, setVarType] = useState<string>("ux");
  const [cmap, setCmap] = useState<string>("default");
  const [runNum, setRunNum] = useState<number>(1);
  const [lowerLimit, setLowerLimit] = useState<string>("");
  const [upperLimit, setUpperLimit] = useState<string>("");
  const [showStatusImage, setShowStatusImage] = useState(true);
  const [showLogs, setShowLogs] = useState(true);
  const [frameVars, setFrameVars] = useState<string[]>(['ux', 'uy', 'nan_mask', 'peak_mag']);
  const [frameVarsLoading, setFrameVarsLoading] = useState(false);
  const [activePaths, setActivePaths] = useState<number[]>([]);

  // Ref for log container to enable auto-scroll
  const logContainerRef = useRef<HTMLDivElement>(null);

  // --- Derived State (memoized for performance) ---
  const sourcePaths = useMemo(() => config?.paths?.source_paths || [], [config]);
  const basePaths = useMemo(() => config?.paths?.base_paths || [], [config]);

  // Initialize activePaths when sourcePaths change
  useEffect(() => {
    if (sourcePaths.length > 0) {
      // Default: all paths active
      setActivePaths(sourcePaths.map((_: string, i: number) => i));
    }
  }, [sourcePaths]);

  // Toggle a specific path's active state
  const togglePath = (idx: number) => {
    setActivePaths(prev =>
      prev.includes(idx)
        ? prev.filter(i => i !== idx)
        : [...prev, idx].sort((a, b) => a - b)
    );
  };

  // --- PIV Logic from Custom Hook ---
  const { isLoading, isPolling, progress, statusImage, logs, run, cancel } = usePivRunner({
    sourcePathIdx, varType, cmap, run: runNum, lowerLimit, upperLimit, showStatusImage, activePaths
  });

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
                    onClick={() => setActivePaths(sourcePaths.map((_: string, i: number) => i))}
                  >
                    Select All
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => setActivePaths([])}
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
              <Select value={cmap} onValueChange={setCmap}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['default', 'viridis', 'plasma', 'inferno', 'magma', 'cividis', 'jet', 'gray'].map(c =>
                    <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Lower Limit</label>
              <Input type="number" value={lowerLimit} onChange={e => setLowerLimit(e.target.value)} placeholder="auto" />
            </div>
            <div>
              <label className="text-sm font-medium">Upper Limit</label>
              <Input type="number" value={upperLimit} onChange={e => setUpperLimit(e.target.value)} placeholder="auto" />
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
            onClick={run}
            disabled={isLoading || isPolling || activePaths.length === 0}
          >
            {isPolling ? "Running..." : activePaths.length === 0 ? "Select Paths" : "Run PIV"}
          </Button>
          <Button className="bg-red-600 hover:bg-red-700" onClick={cancel} disabled={!isPolling && !isLoading}>
            Cancel Run
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default RunPIV;