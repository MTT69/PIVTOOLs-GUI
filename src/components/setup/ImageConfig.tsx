"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Plus, Minus, Image as ImageIcon, RefreshCcw } from "lucide-react";

interface ImageConfigProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

/*
  ImageConfig centralises editing of image-related YAML values without exposing YAML directly.
  Editable:
    - num_images (images.num_images)
    - shape (images.shape [H,W])
    - time_resolved flag (images.time_resolved)
    - raw image filename patterns (images.image_format)
        * If time_resolved = false => two patterns A/B
        * If time_resolved = true => single pattern
    - vector filename pattern (images.vector_format[0])
    - calibration filename pattern (calibration.image_format)

  Saving strategy:
    - num_images / shape / time_resolved => POST /update_config (merge into config.yaml)
    - filename patterns => POST /update_config (new endpoint that merges provided object into config.yaml)

  Debounce: 400ms after last change to any field triggers appropriate POSTs.
*/

export default function ImageConfig({ config, updateConfig }: ImageConfigProps) {
  const initialImages = config.images || {};
  const initialCalibration = config.calibration || {};

  // Use string state for editable fields to allow empty input
  const [numImages, setNumImages] = useState<string>(
    initialImages.num_images !== undefined ? String(initialImages.num_images) : ""
  );
  
  // Update camera_numbers extraction to handle more cases and ensure a default is shown
  const [numCameras, setNumCameras] = useState<string>(() => {
    // First check paths.camera_numbers array
    if (config.paths?.camera_numbers?.length) {
      return String(config.paths.camera_numbers[0]);
    }
    // Then check imProperties.cameraCount
    if (config.imProperties?.cameraCount) {
      return String(config.imProperties.cameraCount);
    }
    // Always default to "1" to ensure something is displayed
    return "1";
  });
  
  const [timeResolved, setTimeResolved] = useState<boolean>(!!initialImages.time_resolved);

  // Always sync state from config when config changes (for hot reloads or backend edits)
  useEffect(() => {
    setNumImages(initialImages.num_images !== undefined ? String(initialImages.num_images) : "");
    
    // Update numCameras from config, but always default to "1" if nothing exists
    if (config.paths?.camera_numbers?.length) {
      setNumCameras(String(config.paths.camera_numbers[0]));
    } else if (config.imProperties?.cameraCount) {
      setNumCameras(String(config.imProperties.cameraCount));
    } else {
      setNumCameras("1");  // Always ensure a value is displayed
    }
    
    setTimeResolved(!!initialImages.time_resolved);

    const rawFmt = initialImages.image_format;
    if (!initialImages.time_resolved) {
      if (Array.isArray(rawFmt)) setRawPatterns(rawFmt as string[]);
      else setRawPatterns(["B%05d_A.tif", "B%05d_B.tif"]);
    } else {
      if (typeof rawFmt === "string") setRawPatterns([rawFmt]);
      else setRawPatterns(["B%05d.tif"]);
    }
    const vf = initialImages.vector_format;
    if (Array.isArray(vf) && vf.length) setVectorPattern(vf[0]);
    else if (typeof vf === "string") setVectorPattern(vf);
    else setVectorPattern("%05d.mat");
    setCalibrationPattern(
      initialCalibration.image_format || initialImages.calibration_image_format || "calib%05d.tif"
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config,
    initialImages.num_images,
    initialImages.time_resolved,
    config.paths?.camera_numbers,
    config.imProperties?.cameraCount
  ]);

  // Raw filename patterns
  const rawFmt = initialImages.image_format;
  const [rawPatterns, setRawPatterns] = useState<string[]>(() => {
    if (!timeResolved) {
      if (Array.isArray(rawFmt)) return rawFmt as string[];
      // fallback default pair
      return ["B%05d_A.tif", "B%05d_B.tif"]; 
    }
    if (typeof rawFmt === "string") return [rawFmt];
    return ["B%05d.tif"]; // single pattern
  });
  const [vectorPattern, setVectorPattern] = useState<string>(() => {
    const vf = initialImages.vector_format;
    if (Array.isArray(vf) && vf.length) return vf[0];
    if (typeof vf === "string") return vf;
    return "%05d.mat";
  });
  const [calibrationPattern, setCalibrationPattern] = useState<string>(
    () => initialCalibration.image_format || initialImages.calibration_image_format || "calib%05d.tif"
  );

  const saveTimer = useRef<number | null>(null);
  const patternsTimer = useRef<number | null>(null);
  const [savingMeta, setSavingMeta] = useState<string>("");

  // Helper to sync changes to parent config (avoid redundant writes by shallow compare where cheap)
  function sync(path: string[], value: any) {
    updateConfig(path, value);
  }

  // Debounced save for numeric + size changes (/update_config)
  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveCore();
    }, 500) as unknown as number;
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numImages, numCameras]);

  // Debounced save for pattern / timeResolved changes (/update_config)
  useEffect(() => {
    if (patternsTimer.current) window.clearTimeout(patternsTimer.current);
    patternsTimer.current = window.setTimeout(() => {
      savePatterns();
    }, 600) as unknown as number;
    return () => {
      if (patternsTimer.current) window.clearTimeout(patternsTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPatterns, vectorPattern, calibrationPattern, timeResolved]);

  async function saveCore() {
    try {
      setSavingMeta("Saving image core...");
      // Only send if at least one numeric field is present and valid
      const validNumImages = numImages !== "" && !isNaN(Number(numImages));
      const validNumCameras = numCameras !== "" && !isNaN(Number(numCameras));
      
      if (validNumImages || validNumCameras) {
        // Merge camera_numbers under paths so it matches YAML structure:
        const payload: any = {
          images: {
            time_resolved: timeResolved,
          },
          paths: {
            base_paths: config.paths?.base_paths || config.paths?.base_dir || [],
            source_paths: config.paths?.source_paths || config.paths?.source || [],
          },
        };
        
        if (validNumImages) payload.images.num_images = Number(numImages);
        
        // Only include camera_numbers if user has entered a value
        if (validNumCameras) payload.paths.camera_numbers = [Number(numCameras)];
        
         const res = await fetch("/backend/update_config", {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify(payload),
         });
         const json = await res.json();
         if (!res.ok) throw new Error(json.error || "Failed to update images");
         setSavingMeta("Image core saved");
         setTimeout(() => setSavingMeta(""), 1000);
       }
     } catch (e: any) {
       setSavingMeta("Error: " + e.message);
     }
   }

  async function savePatterns() {
    try {
      setSavingMeta("Saving filename patterns...");
      const payload: any = {
        paths: {
          base_paths: config.paths?.base_paths || config.paths?.base_dir || [],
          source_paths: config.paths?.source_paths || config.paths?.source || [],
        },
        images: {
          image_format: timeResolved ? rawPatterns[0] : rawPatterns,
          vector_format: Array.isArray(vectorPattern) ? vectorPattern : [vectorPattern],
          time_resolved: timeResolved,
        },
        calibration: {
          image_format: calibrationPattern,
        },
      };
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update config");
      setSavingMeta("Filename patterns saved");
      setTimeout(() => setSavingMeta(""), 1000);
    } catch (e: any) {
      setSavingMeta("Error: " + e.message);
    }
  }

  function addRawPattern() {
    setRawPatterns([...rawPatterns, "B%05d_C.tif"]);
  }
  function removeRawPattern(i: number) {
    setRawPatterns(rawPatterns.filter((_, idx) => idx !== i));
  }
  function updateRawPattern(i: number, value: string) {
    const next = [...rawPatterns];
    next[i] = value;
    setRawPatterns(next);
  }

  // Increment/decrement camera count (clamp >=1). Persist as paths.camera_numbers = [N]
  function changeNumCameras(delta: number) {
    const current = numCameras === "" ? 0 : Number(numCameras);
    const next = Math.max(1, current + delta);
    setNumCameras(String(next));
    updateConfig(["paths", "camera_numbers"], [next]);
  }

  // Update the blur handler to always ensure a valid value (minimum of 1)
  function setNumCamerasFromInput(v: string) {
    // Allow empty string while typing, but ensure a valid number is set
    const n = v === "" ? NaN : Number(v);
    const clamped = !isNaN(n) ? Math.max(1, n) : NaN;
    setNumCameras(v); // Allow empty string temporarily while typing
    
    // Only update config if a valid number was entered
    if (!isNaN(clamped)) {
      updateConfig(["paths", "camera_numbers"], [clamped]);
    }
  }

  // Toggle time resolved resets rawPatterns to single or pair
  function toggleTimeResolved(val: boolean) {
    setTimeResolved(val);
    sync(["images", "time_resolved"], val);
    if (val) {
      // collapse to single pattern
      setRawPatterns([(rawPatterns[0] || "B%05d.tif").replace(/_A\.tif$/i, ".tif")]);
      sync(["images", "image_format"], [(rawPatterns[0] || "B%05d.tif").replace(/_A\.tif$/i, ".tif")]);
    } else {
      // ensure two patterns exist
      if (rawPatterns.length === 1) {
        const base = rawPatterns[0].replace(/\.tif$/i, "");
        const pair = [`${base}_A.tif`, `${base}_B.tif`];
        setRawPatterns(pair);
        sync(["images", "image_format"], pair);
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-6">
        <ImageIcon className="h-6 w-6 text-soton-blue" />
        <h2 className="text-2xl font-bold text-gray-800">Image Configuration</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Core Properties</CardTitle>
          <CardDescription>Number of images and dimensions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="num_images">Number of Images</Label>
              <Input
                id="num_images"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={numImages}
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9]/g, "");
                  setNumImages(v);
                  // Only updateConfig if not empty
                  if (v !== "") updateConfig(["images", "num_images"], Number(v));
                }}
                // Remove spinner arrows
                style={{ MozAppearance: "textfield" } as any}
                className="no-spinner"
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="num_cameras">Number of Cameras</Label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="icon" onClick={() => changeNumCameras(-1)}>
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  id="num_cameras"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={numCameras}
                  onChange={e => {
                    const v = e.target.value.replace(/[^0-9]/g, "");
                    setNumCamerasFromInput(v);
                  }}
                  onBlur={() => {
                    // enforce minimum of 1 if empty or invalid on blur
                    const n = numCameras === "" ? NaN : Number(numCameras);
                    if (isNaN(n) || n < 1) {
                      setNumCameras("1");
                      updateConfig(["paths", "camera_numbers"], [1]);
                    }
                  }}
                  style={{ MozAppearance: "textfield" } as any}
                  className="no-spinner"
                  autoComplete="off"
                />
                <Button type="button" variant="ghost" size="icon" onClick={() => changeNumCameras(1)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Switch id="time_resolved" checked={timeResolved} onCheckedChange={toggleTimeResolved} />
            <Label htmlFor="time_resolved">Time Resolved (single image pattern)</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Filename Patterns</CardTitle>
          <CardDescription>Configure raw, vector & calibration patterns</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label className="font-semibold">Raw Image Pattern{timeResolved ? "" : "s"}</Label>
            <div className="space-y-2 mt-2">
              {rawPatterns.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input className="font-mono" value={p} onChange={e => { updateRawPattern(i, e.target.value); sync(["images", "image_format"], timeResolved ? [e.target.value] : rawPatterns.map((rp, idx) => idx === i ? e.target.value : rp)); }} />
                  {!timeResolved && rawPatterns.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeRawPattern(i)}>
                      <Minus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">Use printf style %05d for frame index.</p>
            </div>
          </div>
          <div>
            <Label className="font-semibold">Vector Pattern</Label>
            <Input className="font-mono mt-2" value={vectorPattern} onChange={e => { setVectorPattern(e.target.value); sync(["images", "vector_format"], [e.target.value]); }} />
          </div>
          <div>
            <Label className="font-semibold">Calibration Pattern</Label>
            <Input className="font-mono mt-2" value={calibrationPattern} onChange={e => { setCalibrationPattern(e.target.value); sync(["calibration", "image_format"], e.target.value); }} />
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <RefreshCcw className="h-3 w-3" /> {savingMeta || "Autosaves ~0.5s after changes"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
