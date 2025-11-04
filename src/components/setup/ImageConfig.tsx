"use client";

import { useEffect, useState } from "react";
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

export default function ImageConfig({ config, updateConfig }: ImageConfigProps) {
  const [numImages, setNumImages] = useState<string>("");
  const [numCameras, setNumCameras] = useState<string>("1");
  const [timeResolved, setTimeResolved] = useState<boolean>(false);
  const [rawPatterns, setRawPatterns] = useState<string[]>([]);
  const [vectorPattern, setVectorPattern] = useState<string>("");
  const [savingMeta, setSavingMeta] = useState<string>("");

  useEffect(() => {
    const images = config.images || {};
    const paths = config.paths || {};

    // Debug: Log what we're receiving
    console.log('ImageConfig received paths:', paths);
    console.log('Camera count from config:', paths.camera_count);

    setNumImages(images.num_images !== undefined ? String(images.num_images) : "");
    
    // Derive camera count from camera_count field or camera_numbers array length
    const cameraCount = paths.camera_count !== undefined 
      ? paths.camera_count 
      : (Array.isArray(paths.camera_numbers) ? paths.camera_numbers.length : 1);
    setNumCameras(String(cameraCount));
    
    setTimeResolved(!!images.time_resolved);
    setVectorPattern(images.vector_format?.[0] || "%05d.mat");

    const rawFmt = images.image_format;
    if (images.time_resolved) {
      if (typeof rawFmt === 'string') setRawPatterns([rawFmt]);
      else if (Array.isArray(rawFmt) && rawFmt.length) setRawPatterns([rawFmt[0]]);
      else setRawPatterns(['B%05d.tif']);
    } else {
      if (Array.isArray(rawFmt) && rawFmt.length) setRawPatterns(rawFmt);
      else setRawPatterns(['B%05d_A.tif', 'B%05d_B.tif']);
    }
  }, [config]);

  const saveConfig = async (
    nextNumImages: string,
    nextNumCameras: string,
    nextTimeResolved: boolean,
    nextRawPatterns: string[],
    nextVectorPattern: string,
  ) => {
    setSavingMeta("Saving...");
    const payload = {
      images: {
        num_images: nextNumImages === "" ? null : Number(nextNumImages),
        time_resolved: nextTimeResolved,
        image_format: nextTimeResolved ? nextRawPatterns[0] : nextRawPatterns,
        vector_format: [nextVectorPattern],
      },
      paths: {
        camera_count: Number(nextNumCameras),
      },
    };
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update config");
      if (json.updated) {
        if (json.updated.images) updateConfig(['images'], { ...config.images, ...json.updated.images });
        if (json.updated.paths) updateConfig(['paths'], { ...config.paths, ...json.updated.paths });
      }
      setSavingMeta("Saved successfully!");
    } catch (e: any) {
      setSavingMeta(`Error: ${e.message}`);
    } finally {
      setTimeout(() => setSavingMeta(""), 2000);
    }
  };

  const handleToggleTimeResolved = (isTimeResolved: boolean) => {
    setTimeResolved(isTimeResolved);
    let newPatterns: string[];
    if (isTimeResolved) {
      const newPattern = (rawPatterns[0] || "B%05d.tif").replace(/_A\.tif$/i, ".tif");
      newPatterns = [newPattern];
      setRawPatterns(newPatterns);
    } else {
      if (rawPatterns.length === 1) {
        const base = rawPatterns[0].replace(/\.tif$/i, "");
        newPatterns = [`${base}_A.tif`, `${base}_B.tif`];
      } else {
        newPatterns = ['B%05d_A.tif', 'B%05d_B.tif'];
      }
      setRawPatterns(newPatterns);
    }
    // Save with the new patterns, not stale rawPatterns
    saveConfig(numImages, numCameras, isTimeResolved, newPatterns, vectorPattern);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-6">
        <ImageIcon className="h-6 w-6 text-soton-blue" />
        <h2 className="text-2xl font-bold text-gray-800">Image Configuration</h2>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Core Properties</CardTitle>
          <CardDescription>Number of images, cameras, and processing mode</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="num_images">Number of Images</Label>
              <Input
                id="num_images"
                type="number"
                min="0"
                value={numImages}
                onChange={e => setNumImages(e.target.value)}
                onBlur={() => saveConfig(numImages, numCameras, timeResolved, rawPatterns, vectorPattern)}
              />
            </div>
            <div>
              <Label htmlFor="num_cameras">Camera Count</Label>
              <Input
                id="num_cameras"
                type="number"
                min="1"
                value={numCameras}
                onChange={e => setNumCameras(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => saveConfig(numImages, numCameras, timeResolved, rawPatterns, vectorPattern)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Total number of cameras in your setup
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Switch
              id="time_resolved"
              checked={timeResolved}
              onCheckedChange={handleToggleTimeResolved}
            />
            <Label htmlFor="time_resolved">Time Resolved (single image pattern)</Label>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Filename Patterns</CardTitle>
          <CardDescription>Define the naming convention for your files</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label className="font-semibold">Raw Image Pattern{timeResolved ? "" : "s"}</Label>
            <div className="space-y-2 mt-2">
              {rawPatterns.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    className="font-mono"
                    value={p}
                    onChange={e => {
                      const nextPatterns = [...rawPatterns];
                      nextPatterns[i] = e.target.value;
                      setRawPatterns(nextPatterns);
                    }}
                    onBlur={() => saveConfig(numImages, numCameras, timeResolved, rawPatterns, vectorPattern)}
                  />
                  {!timeResolved && rawPatterns.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const nextPatterns = rawPatterns.filter((_, idx) => idx !== i);
                        setRawPatterns(nextPatterns);
                        saveConfig(numImages, numCameras, timeResolved, nextPatterns, vectorPattern);
                      }}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {!timeResolved && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const nextPatterns = [...rawPatterns, ''];
                    setRawPatterns(nextPatterns);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" /> Add Pattern
                </Button>
              )}
                <p className="text-xs text-muted-foreground">
                Use format codes like <code>%05d</code> for the frame index. <br />
                <code>%05d</code> means a 5-digit number, zero-padded (e.g. <code>b00001</code>).
                </p>
            </div>
          </div>
          <div>
            <Label className="font-semibold">Vector Pattern</Label>
            <Input
              className="font-mono mt-2"
              value={vectorPattern}
              onChange={e => setVectorPattern(e.target.value)}
              onBlur={() => saveConfig(numImages, numCameras, timeResolved, rawPatterns, vectorPattern)}
            />
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <RefreshCcw className="h-3 w-3" /> {savingMeta || "Changes are saved when you finish editing a box."}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}