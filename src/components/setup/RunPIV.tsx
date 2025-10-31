// src/components/RunPIV.tsx

"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePivRunner } from '@/hooks/usePivRunner'; 

// Helper to display a user-friendly path name
const basename = (p: string) => p?.replace(/\\/g, "/").split("/").filter(Boolean).pop() || p;

const RunPIV: React.FC<{ config?: any }> = ({ config }) => {
  // --- UI State ---
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(0);
  const [camera, setCamera] = useState<string>("Cam1");
  const [varType, setVarType] = useState<string>("ux");
  const [cmap, setCmap] = useState<string>("default");
  const [runNum, setRunNum] = useState<number>(1);
  const [lowerLimit, setLowerLimit] = useState<string>("");
  const [upperLimit, setUpperLimit] = useState<string>("");
  const [showStatusImage, setShowStatusImage] = useState(true);
  const [frameVars, setFrameVars] = useState<string[]>(['ux', 'uy', 'nan_mask', 'peak_mag']);
  const [frameVarsLoading, setFrameVarsLoading] = useState(false);

  // --- Derived State (memoized for performance) ---
  const cameraOptions = useMemo(() => {
    const numCameras = config?.paths?.camera_numbers?.[0] ?? 1;
    return Array.from({ length: numCameras }, (_, i) => `Cam${i + 1}`);
  }, [config]);

  const sourcePaths = useMemo(() => config?.paths?.source_paths || [], [config]);

  // --- PIV Logic from Custom Hook ---
  const { isLoading, isPolling, progress, statusImage, run, cancel } = usePivRunner({
    sourcePathIdx, camera, varType, cmap, run: runNum, lowerLimit, upperLimit, showStatusImage
  });

  // --- Effects for UI Sync ---
  // Only fetch available variables when PIV is running
  useEffect(() => {
    if (!isPolling) return;
    const fetchFrameVars = async () => {
      setFrameVarsLoading(true);
      try {
        const params = new URLSearchParams({
          basepath_idx: String(sourcePathIdx),
          camera: camera,
          frame: '1',
          is_uncalibrated: '1',
        });
        const res = await fetch(`/backend/plot/check_vars?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch variables');
        const json = await res.json();
        const allowed = ["ux", "uy", "nan_mask", "peak_mag"];
        const filtered = (json.vars || []).filter((v: string) => allowed.includes(v));
        setFrameVars(filtered.length > 0 ? filtered : allowed);
        if (filtered.length > 0 && !filtered.includes(varType)) {
          setVarType(filtered[0]);
        }
      } catch (error) {
        console.error("Error fetching frame variables:", error);
      } finally {
        setFrameVarsLoading(false);
      }
    };
    fetchFrameVars();
  }, [isPolling, sourcePathIdx, camera]);

  return (
    <Card>
      <CardHeader><CardTitle>Run PIV</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Source Path</label>
            <Select value={String(sourcePathIdx)} onValueChange={v => setSourcePathIdx(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {sourcePaths.length > 0 ? sourcePaths.map((p: string, i: number) => (
                  <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>
                )) : <SelectItem value="0" disabled>No paths</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Camera</label>
            <Select value={camera} onValueChange={setCamera}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {cameraOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div>
                <label className="text-sm font-medium">Variable</label>
                <Select value={varType} onValueChange={setVarType} disabled={frameVarsLoading}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {frameVarsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> : // <-- FIX HERE
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
        <div className="space-y-2">
          <Progress value={progress} />
          <p className="text-sm text-center font-medium text-gray-500">
            {isPolling ? `Processing... ${progress}%` : (progress === 100 ? "✅ Completed!" : "Idle")}
          </p>
        </div>
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
        <div className="flex items-center gap-4 pt-2">
          <Button className="bg-green-600 hover:bg-green-700" onClick={run} disabled={isLoading || isPolling}>
            {isPolling ? "Running..." : "Run PIV"}
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