"use client";

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";
import { useImagePair } from '@/hooks/useImagePair';
import { useImageFilters } from '@/hooks/useImageFilters';
import ZoomableCanvas from './zoomableCanvas';
import * as Slider from '@radix-ui/react-slider';
import { basename } from "@/lib/utils";

interface ImagePairViewerProps {
  backendUrl?: string;
  config?: any;
  onFiltersChange?: (filters: any[]) => Promise<void>;
}

export default function ImagePairViewer({ backendUrl = "/backend", config, onFiltersChange }: ImagePairViewerProps) {
  // --- UI State ---
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState("Cam1");
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
  
  // Add shared zoom state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // --- Hooks for Logic ---
  const { loading, error, imgARaw, imgBRaw, imgA, imgB, vmin: autoVmin, vmax: autoVmax, metadata } = 
    useImagePair(backendUrl, sourcePathIdx, camera, index);
  const { filters, addFilter, updateBatchSize, removeFilter, runProcessing, procLoading, procImgA, procImgB, fetchProcessed } = 
    useImageFilters(backendUrl);

  useEffect(() => {
    setRawVmin(autoVmin);
    setRawVmax(autoVmax);
  }, [autoVmin, autoVmax]);

  // Add useEffect to fetch processed on camera/index/sourcePathIdx changes
  useEffect(() => {
    fetchProcessed(camera, index, sourcePathIdx);
  }, [camera, index, sourcePathIdx, fetchProcessed]);

  const sourcePaths = useMemo(() => config?.paths?.source_paths || [], [config]);
  const cameraOptions = useMemo(() => { const n = config?.paths?.camera_numbers?.[0] ?? 1; return Array.from({ length: n }, (_, i) => `Cam${i + 1}`); }, [config]);
  const maxVal = metadata?.bitDepth ? 2 ** metadata.bitDepth - 1 : 255;

  // Helper for adding filters with batch_size
  const handleAddFilter = (type: "POD" | "time") => {
    addFilter(type, type === "POD" ? 100 : 50);
  };

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
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => handleAddFilter("time")}>Add Time Filter</Button>
              <Button size="sm" variant="outline" onClick={() => handleAddFilter("POD")}>Add POD Filter</Button>
            </div>
            <div className="space-y-2 p-2 border rounded-md min-h-[100px] bg-muted/50">
              {filters.length === 0 && <p className="text-xs text-center text-muted-foreground pt-8">No filters applied.</p>}
              {filters.map((filter, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm">
                  <span className="font-mono p-1 bg-background rounded flex-1">{idx + 1}. {filter.type}</span>
                  <Input
                    type="number"
                    min={1}
                    value={filter.batch_size ?? 50}
                    onChange={e => updateBatchSize(idx, Math.max(1, Number(e.target.value)))}
                    className="w-16"
                  />
                  <span className="text-xs text-muted-foreground">Chunk</span>
                  <Button size="icon" variant="ghost" onClick={() => removeFilter(idx)}><X className="h-4 w-4"/></Button>
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={() => runProcessing(camera, index, sourcePathIdx)} disabled={procLoading || filters.length === 0}>
              {procLoading ? "Processing..." : "Apply Filters to Frame"}
            </Button>
        </div>

        {/* --- TOP-LEVEL CONTROLS --- */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <Label>Source Path</Label>
            <Select value={String(sourcePathIdx)} onValueChange={v => setSourcePathIdx(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{sourcePaths.map((p: string, i: number) => <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Camera</Label>
            <Select value={camera} onValueChange={setCamera}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{cameraOptions.map(cam => <SelectItem key={cam} value={cam}>{cam}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Frame Index</Label>
            <Input type="number" value={index} onChange={e => setIndex(parseInt(e.target.value, 10) || 1)} />
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

        {/* --- IMAGE VIEWERS --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* RAW IMAGE PANEL */}
          <div className="space-y-4">
            <div className="h-[480px]">
              <ZoomableCanvas
                raw={rawToggle === 'A' ? imgARaw : rawToggle === 'B' ? imgBRaw : undefined}
                src={rawToggle === 'A' ? (imgARaw ? undefined : imgA) : rawToggle === 'B' ? (imgBRaw ? undefined : imgB) : undefined}
                error={loading ? 'Loading...' : error}
                vmin={rawVmin} vmax={rawVmax} colormap={colormap} title={`Raw Image ${rawToggle}`}
                useGrid={useGrid} gridSize={gridSize}
                zoomLevel={zoomLevel} panX={panX} panY={panY} onZoomChange={(zl, px, py) => { setZoomLevel(zl); setPanX(px); setPanY(py); }}
              />
            </div>
            <div className="space-y-3 p-3 border rounded-md">
              <div className="flex items-center gap-2">
                <Label>View</Label>
                <Button size="sm" variant={rawToggle === "A" ? "default" : "outline"} onClick={() => setRawToggle("A")}>A</Button>
                <Button size="sm" variant={rawToggle === "B" ? "default" : "outline"} onClick={() => setRawToggle("B")}>B</Button>
                <div className="flex items-center gap-2 ml-auto">
                  <Switch id="use-grid" checked={useGrid} onCheckedChange={setUseGrid} /><Label htmlFor="use-grid">Grid</Label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input type="number" value={rawVmin} min={0} max={rawVmax} onChange={e => {
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
                  const val = Math.max(Number(e.target.value), rawVmin);
                  setRawVmax(val);
                  if (val < rawVmin) setRawVmin(val);
                }} className="w-20 h-8" />
              </div>
            </div>
          </div>
          {/* PROCESSED IMAGE PANEL */}
          <div className="space-y-4">
            <div className="h-[480px]">
              <ZoomableCanvas
                raw={undefined}
                src={procToggle === 'A' ? procImgA : procImgB}
                vmin={procVmin}
                vmax={procVmax}
                colormap={colormap}
                title={`Processed Image ${procToggle}`}
                zoomLevel={zoomLevel} panX={panX} panY={panY} onZoomChange={(zl, px, py) => { setZoomLevel(zl); setPanX(px); setPanY(py); }}
              />
            </div>
            <div className="space-y-3 p-3 border rounded-md">
                <div className="flex items-center gap-2">
                  <Label>View</Label>
                  <Button size="sm" variant={procToggle === "A" ? "default" : "outline"} onClick={() => setProcToggle("A")}>A</Button>
                  <Button size="sm" variant={procToggle === "B" ? "default" : "outline"} onClick={() => setProcToggle("B")}>B</Button>
                </div>
              <div className="flex items-center gap-2">
                <Input type="number" value={procVmin} min={0} max={procVmax} onChange={e => {
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
                  const val = Math.max(Number(e.target.value), procVmin);
                  setProcVmax(val);
                  if (val < procVmin) setProcVmin(val);
                }} className="w-20 h-8" />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}