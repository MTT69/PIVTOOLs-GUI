"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Minus, Image as ImageIcon, AlertTriangle } from "lucide-react";
import { useConfigUpdate } from "@/hooks/useConfigUpdate";
import { ValidationAlert } from "./ValidationAlert";

interface ImageConfigProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  validation: { valid: boolean; error?: string; checked: boolean };
  sectionsToShow?: ('core' | 'patterns')[];
}

export default function ImageConfig({ config, updateConfig, validation, sectionsToShow = ['core', 'patterns'] }: ImageConfigProps) {
  const [numImages, setNumImages] = useState<string>("");
  const [numCameras, setNumCameras] = useState<string>("1");
  const [timeResolved, setTimeResolved] = useState<boolean>(false);
  const [rawPatterns, setRawPatterns] = useState<string[]>([]);
  const [vectorPattern, setVectorPattern] = useState<string>("");
  const [savingMeta, setSavingMeta] = useState<string>("");
  const [isMacOS, setIsMacOS] = useState(false);
  const [hasUnsupportedFormat, setHasUnsupportedFormat] = useState(false);
  const [zeroBasedIndexing, setZeroBasedIndexing] = useState<boolean>(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);
  const [nonTimeResolvedMode, setNonTimeResolvedMode] = useState<string>("ab_format"); // "ab_format" or "skip_frames"

  const { updateConfig: updateConfigBackend } = useConfigUpdate();

  // Detect macOS
  useEffect(() => {
    const platform = navigator.platform.toLowerCase();
    const userAgent = navigator.userAgent.toLowerCase();
    const isMac = platform.includes('mac') || userAgent.includes('mac');
    setIsMacOS(isMac);
  }, []);

  // Check for unsupported file formats on macOS
  useEffect(() => {
    if (!isMacOS) {
      setHasUnsupportedFormat(false);
      return;
    }

    const imageFormat = config.images?.image_format;
    if (!imageFormat) {
      setHasUnsupportedFormat(false);
      return;
    }

    const formats = Array.isArray(imageFormat) ? imageFormat : [imageFormat];
    const unsupported = formats.some((fmt: string) => {
      const lower = fmt.toLowerCase();
      return lower.includes('.set') || lower.includes('.im7') || lower.includes('.ims');
    });

    console.log('Unsupported format check:', { isMacOS, imageFormat, unsupported });
    setHasUnsupportedFormat(unsupported);
  }, [isMacOS, config.images?.image_format]);

  // Log when parent validation state changes (for debugging)
  useEffect(() => {
    if (sectionsToShow.includes('patterns')) {
      console.log('ImageConfig: Parent validation state changed:', validation);
    }
  }, [validation, sectionsToShow]);

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
    setZeroBasedIndexing(!!images.zero_based_indexing);
    setCameraSubfolders(paths.camera_subfolders || []);
    setVectorPattern(images.vector_format?.[0] || "%05d.mat");

    const rawFmt = images.image_format;
    if (images.time_resolved) {
      // Time-resolved: always single format
      if (typeof rawFmt === 'string') setRawPatterns([rawFmt]);
      else if (Array.isArray(rawFmt) && rawFmt.length) setRawPatterns([rawFmt[0]]);
      else setRawPatterns(['B%05d.tif']);
    } else {
      // Non-time-resolved: detect mode from format
      if (Array.isArray(rawFmt) && rawFmt.length === 2) {
        // A/B format
        setRawPatterns(rawFmt);
        setNonTimeResolvedMode("ab_format");
      } else if (Array.isArray(rawFmt) && rawFmt.length === 1) {
        // Skip frames mode
        setRawPatterns([rawFmt[0]]);
        setNonTimeResolvedMode("skip_frames");
      } else if (typeof rawFmt === 'string') {
        // Single string - skip frames mode
        setRawPatterns([rawFmt]);
        setNonTimeResolvedMode("skip_frames");
      } else {
        // Default to A/B format
        setRawPatterns(['B%05d_A.tif', 'B%05d_B.tif']);
        setNonTimeResolvedMode("ab_format");
      }
    }
  }, [config]);

  // Validation is now handled by useAutoValidation hook in parent

  // Validation is now handled by useAutoValidation hook in parent - no local validation needed

  const saveConfig = async (
    nextNumImages: string,
    nextNumCameras: string,
    nextTimeResolved: boolean,
    nextZeroBasedIndexing: boolean,
    nextCameraSubfolders: string[],
    nextRawPatterns: string[],
    nextVectorPattern: string,
  ) => {
    setSavingMeta("Saving...");
    const payload = {
      images: {
        num_images: nextNumImages === "" ? null : Number(nextNumImages),
        time_resolved: nextTimeResolved,
        zero_based_indexing: nextZeroBasedIndexing,
        image_format: nextTimeResolved ? nextRawPatterns[0] : nextRawPatterns,
        vector_format: [nextVectorPattern],
      },
      paths: {
        camera_count: Number(nextNumCameras),
        camera_subfolders: nextCameraSubfolders,
      },
    };

    const result = await updateConfigBackend(payload);

    if (result.success && result.data?.updated) {
      if (result.data.updated.images) {
        updateConfig(['images'], { ...config.images, ...result.data.updated.images });
      }
      if (result.data.updated.paths) {
        updateConfig(['paths'], { ...config.paths, ...result.data.updated.paths });
      }
      setSavingMeta("Saved successfully!");
      // Note: validation will be triggered automatically by the useEffect watching config changes
    } else {
      setSavingMeta(`Error: ${result.error || 'Unknown error'}`);
    }

    setTimeout(() => setSavingMeta(""), 2000);
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
    saveConfig(numImages, numCameras, isTimeResolved, zeroBasedIndexing, cameraSubfolders, newPatterns, vectorPattern);
  };

  const handleCameraSubfolderChange = (index: number, value: string) => {
    const newSubfolders = [...cameraSubfolders];
    // Ensure array is long enough
    while (newSubfolders.length <= index) {
      newSubfolders.push("");
    }
    newSubfolders[index] = value;
    setCameraSubfolders(newSubfolders);
  };

  const saveCameraSubfolders = () => {
    saveConfig(numImages, numCameras, timeResolved, zeroBasedIndexing, cameraSubfolders, rawPatterns, vectorPattern);
  };

  // Removed - validation handled by parent hook

  const showCore = sectionsToShow.includes('core');
  const showPatterns = sectionsToShow.includes('patterns');

  return (
    <div className="space-y-6">
      {showCore && (
        <>
          <div className="flex items-center space-x-2 mb-6">
            <ImageIcon className="h-6 w-6 text-soton-blue" />
            <h2 className="text-2xl font-bold text-gray-800">Image Configuration</h2>
          </div>

          {/* macOS unsupported format warning */}
          {hasUnsupportedFormat && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Unsupported File Format on macOS</AlertTitle>
              <AlertDescription>
                The .set, .im7, and .ims file formats are not supported on macOS due to library limitations.
                These formats require Windows-specific DLLs from LaVision DaVis.
                <br />
                <strong>Recommendation:</strong> Use .tif, .png, or other standard image formats on macOS, or run this application on Windows/Linux.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Core Properties</CardTitle>
              <CardDescription>Number of images, cameras, and processing mode</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="num_images">Number of Image Files</Label>
                  <Input
                    id="num_images"
                    type="number"
                    min="0"
                    value={numImages}
                    onChange={e => setNumImages(e.target.value)}
                    onBlur={() => saveConfig(numImages, numCameras, timeResolved, zeroBasedIndexing, cameraSubfolders, rawPatterns, vectorPattern)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {timeResolved
                      ? `${numImages} files → ${Math.max(0, parseInt(numImages || '0') - 1)} frame pairs (sequential overlapping)`
                      : nonTimeResolvedMode === "ab_format"
                        ? `${numImages} files → ${numImages} frame pairs (A+B sets)`
                        : `${numImages} files → ${Math.floor((parseInt(numImages || '0')) / 2)} frame pairs (skip frames)`
                    }
                  </p>
                </div>
                <div>
                  <Label htmlFor="num_cameras">Camera Count</Label>
                  <Input
                    id="num_cameras"
                    type="number"
                    min="1"
                    value={numCameras}
                    onChange={e => setNumCameras(e.target.value.replace(/[^0-9]/g, ''))}
                    onBlur={() => saveConfig(numImages, numCameras, timeResolved, zeroBasedIndexing, cameraSubfolders, rawPatterns, vectorPattern)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Total number of cameras in your setup
                  </p>
                </div>
              </div>
              
              {Number(numCameras) > 1 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Label>Custom Camera Subfolders</Label>
                    <span className="text-xs text-muted-foreground">(optional)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {Array.from({ length: Number(numCameras) }).map((_, i) => (
                      <div key={i}>
                        <Label htmlFor={`cam_folder_${i}`} className="text-xs">Camera {i + 1}</Label>
                        <Input
                          id={`cam_folder_${i}`}
                          placeholder={`Cam${i + 1}`}
                          value={cameraSubfolders[i] || ""}
                          onChange={(e) => handleCameraSubfolderChange(i, e.target.value)}
                          onBlur={saveCameraSubfolders}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Leave empty to use default "CamN" folders. Examples: "View_Left", "Camera_A", "Top"
                  </p>
                  {(rawPatterns[0]?.includes('.set') || rawPatterns[0]?.includes('.im7') || rawPatterns[0]?.includes('.ims')) && (
                    <p className="text-xs text-orange-600 mt-1">
                      ⚠️ Camera subfolders are not used for container formats (.set, .im7, .ims) - all cameras are in the source directory.
                    </p>
                  )}
                </div>
              )}

              {Number(numCameras) === 1 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Single camera setup - files expected directly in source path (no subfolder).
                </p>
              )}

              <div className="mt-4 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="time_resolved"
                    checked={timeResolved}
                    onCheckedChange={handleToggleTimeResolved}
                  />
                  <Label htmlFor="time_resolved">Time Resolved (sequential overlapping pairs)</Label>
                </div>

                {!timeResolved && (
                  <div className="ml-6 space-y-2">
                    <div>
                      <Label htmlFor="non_time_resolved_mode" className="text-sm">Pairing Mode</Label>
                      <Select
                        value={nonTimeResolvedMode}
                        onValueChange={(value) => {
                          setNonTimeResolvedMode(value);
                          // Update patterns based on mode
                          let newPatterns: string[];
                          if (value === "ab_format") {
                            // A/B format: create two patterns from the first pattern
                            const base = (rawPatterns[0] || "B%05d").replace(/\.tif$/i, "").replace(/_[AB]$/i, "");
                            newPatterns = [`${base}_A.tif`, `${base}_B.tif`];
                          } else {
                            // Skip frames: use single pattern
                            const pattern = rawPatterns[0] || "B%05d.tif";
                            newPatterns = [pattern.replace(/_[AB]\.tif$/i, ".tif")];
                          }
                          setRawPatterns(newPatterns);
                          saveConfig(numImages, numCameras, timeResolved, zeroBasedIndexing, cameraSubfolders, newPatterns, vectorPattern);
                        }}
                      >
                        <SelectTrigger id="non_time_resolved_mode" className="w-full mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ab_format">A/B Format (B00001_A + B00001_B)</SelectItem>
                          <SelectItem value="skip_frames">Skip Frames (1+2, 3+4, 5+6, ...)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        {nonTimeResolvedMode === "ab_format"
                          ? "Separate A and B files with same index"
                          : "Non-overlapping pairs from single sequence"
                        }
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Switch
                    id="zero_based"
                    checked={zeroBasedIndexing}
                    onCheckedChange={(checked) => {
                      setZeroBasedIndexing(checked);
                      saveConfig(numImages, numCameras, timeResolved, checked, cameraSubfolders, rawPatterns, vectorPattern);
                    }}
                  />
                  <Label htmlFor="zero_based">Zero-based Indexing (start at 0)</Label>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {showPatterns && (
        <>
          <div className="flex items-center space-x-2 mb-6">
            <ImageIcon className="h-6 w-6 text-soton-blue" />
            <h2 className="text-2xl font-bold text-gray-800">Filename Patterns</h2>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Image & Vector Patterns</CardTitle>
              <CardDescription>Define the naming conventions for your raw images and vector output files</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="font-semibold">Raw Image Pattern{timeResolved ? "" : "s"}</Label>
                </div>
                <div className="space-y-3 mt-2">
                  {rawPatterns.map((p, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Input
                          className="font-mono"
                          value={p}
                          onChange={e => {
                            const nextPatterns = [...rawPatterns];
                            nextPatterns[i] = e.target.value;
                            setRawPatterns(nextPatterns);
                          }}
                          onBlur={() => {
                            saveConfig(numImages, numCameras, timeResolved, zeroBasedIndexing, cameraSubfolders, rawPatterns, vectorPattern);
                          }}
                        />
                        {!timeResolved && rawPatterns.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              const nextPatterns = rawPatterns.filter((_, idx) => idx !== i);
                              setRawPatterns(nextPatterns);
                              saveConfig(numImages, numCameras, timeResolved, zeroBasedIndexing, cameraSubfolders, nextPatterns, vectorPattern);
                            }}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Validation Status */}
                  <ValidationAlert validation={validation} />
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
                  onBlur={() => saveConfig(numImages, numCameras, timeResolved, zeroBasedIndexing, cameraSubfolders, rawPatterns, vectorPattern)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Output filename pattern for processed vector fields
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                {savingMeta || "Changes are saved when you finish editing a box."}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}