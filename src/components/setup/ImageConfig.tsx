"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Minus, Image as ImageIcon, AlertTriangle, Info, CheckCircle, XCircle } from "lucide-react";
import { useConfigUpdate, PatternValidation, ValidationState } from "@/hooks/useConfigUpdate";
import { ValidationAlert } from "./ValidationAlert";
import { cn } from "@/lib/utils";

// Helper to detect image type from format pattern
const detectImageType = (pattern: string | undefined): string => {
  if (!pattern) return "standard";
  const lower = pattern.toLowerCase();
  if (lower.includes('.cine')) return "cine";
  if (lower.includes('.set')) return "lavision_set";
  if (lower.includes('.im7') || lower.includes('.ims')) return "lavision_im7";
  return "standard";
};

// Helper to detect container formats (.set, .im7, .ims, .cine) which store multiple frames
const isContainerFormat = (pattern: string | undefined): boolean => {
  if (!pattern) return false;
  const lower = pattern.toLowerCase();
  return lower.includes('.set') || lower.includes('.im7') || lower.includes('.ims') || lower.includes('.cine');
};

// Helper to derive A/B pattern pair from a single pattern
const deriveABPatterns = (pattern: string): [string, string] => {
  const replacePreservingCase = (str: string, from: string, to: string): string => {
    const regex = new RegExp(`([_-])${from}(\\.[a-zA-Z]+)$`, 'i');
    const match = str.match(regex);
    if (!match) return str;
    const originalChar = str.charAt(str.indexOf(match[0]) + 1);
    const isUpperCase = originalChar === originalChar.toUpperCase();
    const replacement = isUpperCase ? to.toUpperCase() : to.toLowerCase();
    return str.replace(regex, `$1${replacement}$2`);
  };

  if (/[_-]A\.[a-zA-Z]+$/i.test(pattern)) {
    const patternB = replacePreservingCase(pattern, 'A', 'B');
    return [pattern, patternB];
  }
  if (/[_-]B\.[a-zA-Z]+$/i.test(pattern)) {
    const patternA = replacePreservingCase(pattern, 'B', 'A');
    return [patternA, pattern];
  }
  const extMatch = pattern.match(/\.[a-zA-Z]+$/i);
  const ext = extMatch ? extMatch[0] : '.tif';
  const base = pattern.replace(/\.[a-zA-Z]+$/i, '');
  return [`${base}_A${ext}`, `${base}_B${ext}`];
};

// Preset → stride mapping
const PRESET_STRIDES: Record<string, { fs: number; ps: number }> = {
  ab_format:     { fs: 0, ps: 1 },
  pre_paired:    { fs: 0, ps: 1 },
  time_resolved: { fs: 1, ps: 1 },
  skip_frames:   { fs: 1, ps: 2 },
};

// Compute number of frame pairs from strides
const computeNumPairs = (numImages: number, fs: number, ps: number): number => {
  if (fs === 0) return numImages;
  if (ps <= 0) return 0;
  return Math.max(0, Math.floor((numImages - 1 - fs) / ps) + 1);
};

interface SaveOverrides {
  numImages?: string;
  numCameras?: string;
  pairingPreset?: string;
  startIndex?: number;
  frameStride?: number;
  pairStride?: number;
  cameraSubfolders?: string[];
  rawPatterns?: string[];
  vectorPattern?: string;
  imageType?: string;
  useCameraSubfoldersIM7?: boolean;
}

interface ImageConfigProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  validation: ValidationState;
  sectionsToShow?: ('core' | 'patterns')[];
}

export default function ImageConfig({ config, updateConfig, validation, sectionsToShow = ['core', 'patterns'] }: ImageConfigProps) {
  const [numImages, setNumImages] = useState<string>("");
  const [numCameras, setNumCameras] = useState<string>("1");
  const [pairingPreset, setPairingPreset] = useState<string>("ab_format");
  const [frameStride, setFrameStride] = useState<number>(0);
  const [pairStride, setPairStride] = useState<number>(1);
  const [startIndex, setStartIndex] = useState<number>(1);
  const [rawPatterns, setRawPatterns] = useState<string[]>([]);
  const [vectorPattern, setVectorPattern] = useState<string>("");
  const [savingMeta, setSavingMeta] = useState<string>("");
  const [isMacOS, setIsMacOS] = useState(false);
  const [hasUnsupportedFormat, setHasUnsupportedFormat] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);
  const [imageType, setImageType] = useState<string>("standard");
  const [useCameraSubfoldersIM7, setUseCameraSubfoldersIM7] = useState<boolean>(false);
  const [framePairPreview, setFramePairPreview] = useState<any>(null);
  const [numLoops, setNumLoops] = useState<string>("1");
  // String editing states for number inputs (lets user clear and retype)
  const [frameStrideStr, setFrameStrideStr] = useState<string>("0");
  const [pairStrideStr, setPairStrideStr] = useState<string>("1");
  const [startIndexStr, setStartIndexStr] = useState<string>("1");

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
    setHasUnsupportedFormat(unsupported);
  }, [isMacOS, config.images?.image_format]);

  // Load config into state
  useEffect(() => {
    const images = config.images || {};
    const paths = config.paths || {};

    setNumImages(images.num_images !== undefined ? String(images.num_images) : "");

    const cameraCount = paths.camera_count !== undefined
      ? paths.camera_count
      : (Array.isArray(paths.camera_numbers) ? paths.camera_numbers.length : 1);
    setNumCameras(String(cameraCount));

    // New stride-based config
    setPairingPreset(images.pairing_preset || "ab_format");
    const si = images.start_index ?? 1;
    const fs = images.frame_stride ?? 0;
    const ps = images.pair_stride ?? 1;
    setStartIndex(si);
    setFrameStride(fs);
    setPairStride(ps);
    setStartIndexStr(String(si));
    setFrameStrideStr(String(fs));
    setPairStrideStr(String(ps));

    setCameraSubfolders(paths.camera_subfolders || []);
    setUseCameraSubfoldersIM7(!!images.use_camera_subfolders);
    setNumLoops(String(images.num_loops ?? 1));
    setVectorPattern(images.vector_format?.[0] || "%05d.mat");

    const detectedType = images.image_type || detectImageType(
      Array.isArray(images.image_format) ? images.image_format[0] : images.image_format
    );
    setImageType(detectedType);

    // Load patterns
    const rawFmt = images.image_format;
    if (Array.isArray(rawFmt)) {
      setRawPatterns(rawFmt);
    } else if (typeof rawFmt === 'string') {
      setRawPatterns([rawFmt]);
    } else {
      setRawPatterns(['B%05d_A.tif', 'B%05d_B.tif']);
    }
  }, [config]);

  // Auto-fill num_images when empty and validation detects a count
  useEffect(() => {
    if (
      validation.checked &&
      validation.detectedCount != null &&
      validation.detectedCount > 0 &&
      (numImages === "" || numImages === "0")
    ) {
      const val = String(validation.detectedCount);
      setNumImages(val);
      saveConfig({ numImages: val });
    }
  }, [validation.detectedCount, validation.checked]);

  // Fetch frame pair preview
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/backend/preview_frame_pairs?count=5');
        if (response.ok) {
          const data = await response.json();
          setFramePairPreview(data);
        }
      } catch {
        // Ignore errors
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [config.images?.num_images, config.images?.start_index, config.images?.frame_stride,
      config.images?.pair_stride, config.images?.pairing_preset, config.images?.image_format,
      config.images?.num_loops]);

  const saveConfig = async (overrides: SaveOverrides = {}) => {
    setSavingMeta("Saving...");
    const ni = overrides.numImages ?? numImages;
    const nc = overrides.numCameras ?? numCameras;
    const preset = overrides.pairingPreset ?? pairingPreset;
    const si = overrides.startIndex ?? startIndex;
    const fs = overrides.frameStride ?? frameStride;
    const ps = overrides.pairStride ?? pairStride;
    const csf = overrides.cameraSubfolders ?? cameraSubfolders;
    const rp = overrides.rawPatterns ?? rawPatterns;
    const vp = overrides.vectorPattern ?? vectorPattern;
    const it = overrides.imageType ?? imageType;
    const ucsfIM7 = overrides.useCameraSubfoldersIM7 ?? useCameraSubfoldersIM7;

    const camCount = Number(nc) || 1;
    const cameraNumbers = Array.from({ length: camCount }, (_, i) => i + 1);

    const payload = {
      images: {
        num_images: ni === "" ? null : Number(ni),
        start_index: si,
        frame_stride: fs,
        pair_stride: ps,
        pairing_preset: preset,
        image_format: rp,
        vector_format: [vp],
        image_type: it,
        use_camera_subfolders: ucsfIM7,
        num_loops: Number(numLoops) || 1,
      },
      paths: {
        camera_count: camCount,
        camera_numbers: cameraNumbers,
        camera_subfolders: csf,
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
    } else {
      setSavingMeta(`Error: ${result.error || 'Unknown error'}`);
    }

    setTimeout(() => setSavingMeta(""), 2000);
  };

  const handlePresetChange = (newPreset: string) => {
    setPairingPreset(newPreset);

    const strides = PRESET_STRIDES[newPreset];
    let newFs = strides?.fs ?? frameStride;
    let newPs = strides?.ps ?? pairStride;

    if (newPreset !== "custom") {
      setFrameStride(newFs);
      setPairStride(newPs);
      setFrameStrideStr(String(newFs));
      setPairStrideStr(String(newPs));
    } else {
      newFs = frameStride;
      newPs = pairStride;
    }

    // Transform patterns if needed (standard image type only)
    let newPatterns = [...rawPatterns];
    if (imageType === "standard") {
      if (newPreset === "ab_format") {
        // Switch to A/B: derive A/B patterns from first pattern
        if (rawPatterns.length === 1) {
          newPatterns = deriveABPatterns(rawPatterns[0]);
        }
      } else if (rawPatterns.length === 2) {
        // Switch from A/B to single pattern: strip _A suffix
        const stripped = rawPatterns[0].replace(/_A\.([a-zA-Z]+)$/i, '.$1');
        newPatterns = [stripped];
      }
      setRawPatterns(newPatterns);
    }

    saveConfig({
      pairingPreset: newPreset,
      frameStride: newFs,
      pairStride: newPs,
      rawPatterns: newPatterns,
    });
  };

  const handleCameraSubfolderChange = (index: number, value: string) => {
    const newSubfolders = [...cameraSubfolders];
    while (newSubfolders.length <= index) {
      newSubfolders.push("");
    }
    newSubfolders[index] = value;
    setCameraSubfolders(newSubfolders);
  };

  const saveCameraSubfolders = () => {
    saveConfig();
  };

  const showCore = sectionsToShow.includes('core');
  const showPatterns = sectionsToShow.includes('patterns');

  // Compute pairs for display
  const n = parseInt(numImages || '0');
  const numPairs = computeNumPairs(n, frameStride, pairStride);

  // Get preset options for current image type
  const getPresetOptions = () => {
    switch (imageType) {
      case "cine":
        return [
          { value: "time_resolved", label: "Overlapping Pairs (1+2, 2+3, 3+4)" },
          { value: "skip_frames", label: "Consecutive Pairs (1+2, 3+4, 5+6)" },
          { value: "custom", label: "Custom..." },
        ];
      case "lavision_set":
      case "lavision_im7":
        return [
          { value: "pre_paired", label: "Pre-paired A+B (built into each file)" },
          { value: "time_resolved", label: "Overlapping Pairs (across files)" },
          { value: "skip_frames", label: "Consecutive Pairs (across files)" },
          { value: "custom", label: "Custom..." },
        ];
      default: // standard
        return [
          { value: "ab_format", label: "A/B File Pairs (1A+1B, 2A+2B, ...)" },
          { value: "skip_frames", label: "Consecutive Pairs (1+2, 3+4, 5+6)" },
          { value: "time_resolved", label: "Overlapping Pairs (1+2, 2+3, 3+4)" },
          { value: "custom", label: "Custom..." },
        ];
    }
  };

  // Pairs description for helper text
  const loops = Number(numLoops) || 1;
  const totalPairs = numPairs * loops;
  const getPairsDescription = (): string => {
    const fileWord = imageType === "cine" ? "frames" : imageType.startsWith("lavision") ? "entries" : "files";
    const loopSuffix = loops > 1
      ? ` per loop (\u00d7${loops} loops = ${totalPairs} total)`
      : "";
    if (pairingPreset === "ab_format") return `${numImages} ${fileWord} → ${numPairs} frame pairs (A+B sets)${loopSuffix}`;
    if (pairingPreset === "pre_paired") return `${numImages} ${fileWord} → ${numPairs} frame pairs (internal A+B)${loopSuffix}`;
    return `${numImages} ${fileWord} → ${numPairs} pairs${loopSuffix}`;
  };

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
                  <Label htmlFor="image_type">Image Type</Label>
                  <Select
                    value={imageType}
                    onValueChange={(value) => {
                      setImageType(value);
                      let defaultFormat = "";
                      let defaultPreset = pairingPreset;
                      let defaultFs = frameStride;
                      let defaultPs = pairStride;
                      let defaultSi = startIndex;

                      switch(value) {
                        case "cine":
                          defaultFormat = "Camera%d.cine";
                          defaultPreset = "time_resolved";
                          defaultFs = 1; defaultPs = 1; defaultSi = 1;
                          break;
                        case "lavision_set":
                          defaultFormat = "data.set";
                          defaultPreset = "pre_paired";
                          defaultFs = 0; defaultPs = 1;
                          break;
                        case "lavision_im7":
                          defaultFormat = "B%05d.im7";
                          defaultPreset = "pre_paired";
                          defaultFs = 0; defaultPs = 1;
                          break;
                        default:
                          defaultFormat = "B%05d_A.tif";
                          defaultPreset = "ab_format";
                          defaultFs = 0; defaultPs = 1;
                      }

                      const newPatterns = value === "standard" && defaultPreset === "ab_format"
                        ? ["B%05d_A.tif", "B%05d_B.tif"]
                        : [defaultFormat];

                      setRawPatterns(newPatterns);
                      setPairingPreset(defaultPreset);
                      setFrameStride(defaultFs);
                      setPairStride(defaultPs);
                      setStartIndex(defaultSi);
                      setFrameStrideStr(String(defaultFs));
                      setPairStrideStr(String(defaultPs));
                      setStartIndexStr(String(defaultSi));

                      saveConfig({
                        imageType: value,
                        pairingPreset: defaultPreset,
                        frameStride: defaultFs,
                        pairStride: defaultPs,
                        startIndex: defaultSi,
                        rawPatterns: newPatterns,
                      });
                    }}
                  >
                    <SelectTrigger id="image_type" className="w-full mt-1">
                      <SelectValue placeholder="Select format type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard (TIFF/PNG/JPG)</SelectItem>
                      <SelectItem value="cine">Phantom CINE</SelectItem>
                      <SelectItem value="lavision_set">LaVision SET</SelectItem>
                      <SelectItem value="lavision_im7">LaVision IM7</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {imageType === "cine" && "High-speed camera video files"}
                    {imageType === "lavision_set" && "LaVision container (all cameras in one file)"}
                    {imageType === "lavision_im7" && "LaVision image sequence"}
                    {imageType === "standard" && "Standard image sequences"}
                  </p>
                </div>
                <div>
                  <Label htmlFor="num_images">Number of {imageType === "cine" ? "Frames" : "Image Files"}</Label>
                  <Input
                    id="num_images"
                    type="text" inputMode="numeric"
                    min="0"
                    value={numImages}
                    onChange={e => setNumImages(e.target.value)}
                    onBlur={() => saveConfig()}
                  />
                  {validation.checked && validation.detectedCount != null && validation.detectedCount > 0 && (
                    Number(numImages) !== validation.detectedCount ? (
                      <button
                        type="button"
                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline mt-1 cursor-pointer"
                        onClick={() => {
                          const val = String(validation.detectedCount);
                          setNumImages(val);
                          saveConfig({ numImages: val });
                        }}
                      >
                        Detected: {validation.detectedCount} {imageType === "cine" ? "frames" : "files"} — click to apply
                      </button>
                    ) : (
                      <p className="text-xs text-green-600 mt-1">
                        ✓ Matches detected count
                      </p>
                    )
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {getPairsDescription()}
                  </p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div>
                  <Label htmlFor="num_loops">Number of Loops</Label>
                  <Input
                    id="num_loops"
                    type="text" inputMode="numeric"
                    min="1"
                    value={numLoops}
                    onChange={e => setNumLoops(e.target.value)}
                    onBlur={() => saveConfig()}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {Number(numLoops) > 1
                      ? `${numPairs} pairs/loop \u00d7 ${numLoops} loops = ${numPairs * Number(numLoops)} total frame pairs`
                      : "Single acquisition (no loops)"}
                  </p>
                  {Number(numLoops) > 1 && (() => {
                    const sourcePath = config?.paths?.source_paths?.[0] || "";
                    const name = sourcePath.replace(/\\/g, "/").split("/").pop() || "";
                    // Find the last number in the folder/file name
                    const matches = [...name.matchAll(/(\d+)/g)];
                    if (matches.length === 0) return (
                      <p className="text-xs text-amber-600 mt-1">
                        No number found in source path name &quot;{name}&quot; — cannot resolve loop folders.
                      </p>
                    );
                    const lastMatch = matches[matches.length - 1];
                    const baseNum = parseInt(lastMatch[1]);
                    const pos = lastMatch.index!;
                    const numWidth = lastMatch[1].length;
                    const loops = Number(numLoops) || 1;
                    const loopNames = Array.from({ length: Math.min(loops, 8) }, (_, i) => {
                      const newNum = numWidth > 1
                        ? String(baseNum + i).padStart(numWidth, "0")
                        : String(baseNum + i);
                      return name.slice(0, pos) + newNum + name.slice(pos + numWidth);
                    });
                    return (
                      <div className="mt-2 p-2 bg-muted/50 rounded-md border text-xs">
                        <p className="font-medium text-muted-foreground mb-1">
                          Loop sources (last number in name incremented):
                        </p>
                        <div className="space-y-0.5 font-mono">
                          {loopNames.map((ln, i) => (
                            <div key={i} className="text-muted-foreground">
                              <span className="text-foreground font-medium">Loop {i}:</span> {ln}
                            </div>
                          ))}
                          {loops > 8 && (
                            <div className="text-muted-foreground italic">... and {loops - 8} more</div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div>
                  <Label htmlFor="num_cameras">Camera Count</Label>
                  <Input
                    id="num_cameras"
                    type="text" inputMode="numeric"
                    min="1"
                    value={numCameras}
                    onChange={e => setNumCameras(e.target.value.replace(/[^0-9]/g, ''))}
                    onBlur={() => {
                      const camCount = Number(numCameras) || 1;
                      let adjustedSubfolders: string[];

                      if (camCount === 1) {
                        adjustedSubfolders = [];
                      } else if (camCount < cameraSubfolders.length) {
                        adjustedSubfolders = cameraSubfolders.slice(0, camCount);
                      } else {
                        adjustedSubfolders = cameraSubfolders;
                      }

                      setCameraSubfolders(adjustedSubfolders);
                      saveConfig({ cameraSubfolders: adjustedSubfolders });
                    }}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Total number of cameras in your setup
                  </p>
                </div>
              </div>

              {Number(numCameras) > 1 && imageType === "standard" && (
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
                </div>
              )}

              {Number(numCameras) > 1 && imageType === "lavision_set" && (
                <div className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
                  <Info className="h-4 w-4 mt-0.5 text-blue-500" />
                  <p>LaVision .set files store all cameras in a single file - no camera subfolders needed.</p>
                </div>
              )}

              {Number(numCameras) > 1 && imageType === "lavision_im7" && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="im7_use_camera_subfolders"
                      checked={useCameraSubfoldersIM7}
                      onCheckedChange={(checked) => {
                        setUseCameraSubfoldersIM7(checked);
                        saveConfig({ useCameraSubfoldersIM7: checked });
                      }}
                    />
                    <Label htmlFor="im7_use_camera_subfolders">
                      IM7 files in camera subfolders (one camera per file)
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    {useCameraSubfoldersIM7
                      ? "Each .im7 file contains ONE camera only. Files expected in Cam1/, Cam2/ subfolders."
                      : "Each .im7 file contains ALL cameras. Files in source directory, camera extracted by index."
                    }
                  </p>
                  {useCameraSubfoldersIM7 && (
                    <div className="ml-6">
                      <div className="flex items-center gap-2 mb-2">
                        <Label>Camera Subfolders</Label>
                        <span className="text-xs text-muted-foreground">(optional)</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {Array.from({ length: Number(numCameras) }).map((_, i) => (
                          <div key={i}>
                            <Label htmlFor={`im7_cam_folder_${i}`} className="text-xs">Camera {i + 1}</Label>
                            <Input
                              id={`im7_cam_folder_${i}`}
                              placeholder={`Cam${i + 1}`}
                              value={cameraSubfolders[i] || ""}
                              onChange={(e) => handleCameraSubfolderChange(i, e.target.value)}
                              onBlur={saveCameraSubfolders}
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Leave empty to use default "CamN" folders.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {Number(numCameras) > 1 && imageType === "cine" && (
                <div className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
                  <Info className="h-4 w-4 mt-0.5 text-blue-500" />
                  <p>CINE files: One file per camera in source directory (e.g., Camera1.cine, Camera2.cine). Pattern uses %d for camera number.</p>
                </div>
              )}

              {Number(numCameras) === 1 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Single camera setup - files expected directly in source path (no subfolder).
                </p>
              )}

              {/* Frame Pairing Section */}
              <div className="mt-6 space-y-4">
                <div>
                  <Label htmlFor="pairing_preset" className="text-sm font-semibold">Frame Pairing Mode</Label>
                  <Select
                    value={pairingPreset}
                    onValueChange={handlePresetChange}
                  >
                    <SelectTrigger id="pairing_preset" className="w-full mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getPresetOptions().map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {pairingPreset === "skip_frames" && (
                    <div className="flex items-center gap-1 mt-2 text-xs font-mono">
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">1+2</span>
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">3+4</span>
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">5+6</span>
                      <span className="text-muted-foreground">...</span>
                      <span className="ml-2 text-muted-foreground font-sans">Non-overlapping consecutive pairs</span>
                    </div>
                  )}
                  {pairingPreset === "time_resolved" && (
                    <div className="flex items-center gap-1 mt-2 text-xs font-mono">
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">1+2</span>
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">2+3</span>
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">3+4</span>
                      <span className="text-muted-foreground">...</span>
                      <span className="ml-2 text-muted-foreground font-sans">Overlapping pairs — typical for high-speed PIV</span>
                    </div>
                  )}
                  {pairingPreset === "ab_format" && (
                    <div className="flex items-center gap-1 mt-2 text-xs font-mono">
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">1A+1B</span>
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">2A+2B</span>
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">3A+3B</span>
                      <span className="text-muted-foreground">...</span>
                      <span className="ml-2 text-muted-foreground font-sans">Separate A and B files per pair</span>
                    </div>
                  )}
                  {pairingPreset === "pre_paired" && (
                    <div className="flex items-center gap-1 mt-2 text-xs font-mono">
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">[1: A+B]</span>
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">[2: A+B]</span>
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">[3: A+B]</span>
                      <span className="text-muted-foreground">...</span>
                      <span className="ml-2 text-muted-foreground font-sans">Each entry contains both frames</span>
                    </div>
                  )}
                  {pairingPreset === "custom" && (
                    <p className="text-xs text-muted-foreground mt-1">Custom frame stride and pair stride values</p>
                  )}
                </div>

                {/* Custom stride inputs */}
                {pairingPreset === "custom" && (
                  <div className="ml-4 grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="frame_stride" className="text-sm">Frame Stride</Label>
                      <Input
                        id="frame_stride"
                        type="text"
                        inputMode="numeric"
                        value={frameStrideStr}
                        onChange={e => setFrameStrideStr(e.target.value)}
                        onBlur={() => {
                          const val = Math.max(0, parseInt(frameStrideStr) || 0);
                          setFrameStride(val);
                          setFrameStrideStr(String(val));
                          saveConfig({ frameStride: val });
                        }}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Gap between frame A and frame B within a pair
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="pair_stride" className="text-sm">Pair Stride</Label>
                      <Input
                        id="pair_stride"
                        type="text"
                        inputMode="numeric"
                        value={pairStrideStr}
                        onChange={e => setPairStrideStr(e.target.value)}
                        onBlur={() => {
                          const val = Math.max(1, parseInt(pairStrideStr) || 1);
                          setPairStride(val);
                          setPairStrideStr(String(val));
                          saveConfig({ pairStride: val });
                        }}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        How much the start frame advances between pairs
                      </p>
                    </div>
                  </div>
                )}

                {/* Start Index */}
                <div className="flex items-center gap-3">
                  <Label className="text-sm">First Frame Number:</Label>
                  <div className="flex gap-1">
                    <Button
                      variant={startIndex === 0 ? "default" : "outline"}
                      size="sm"
                      className="w-10"
                      onClick={() => {
                        setStartIndex(0);
                        setStartIndexStr("0");
                        saveConfig({ startIndex: 0 });
                      }}
                    >
                      0
                    </Button>
                    <Button
                      variant={startIndex === 1 ? "default" : "outline"}
                      size="sm"
                      className="w-10"
                      onClick={() => {
                        setStartIndex(1);
                        setStartIndexStr("1");
                        saveConfig({ startIndex: 1 });
                      }}
                    >
                      1
                    </Button>
                  </div>
                  <Input
                    type="text"
                    inputMode="numeric"
                    className="w-20"
                    value={startIndexStr}
                    onChange={e => setStartIndexStr(e.target.value)}
                    onBlur={() => {
                      const val = Math.max(0, parseInt(startIndexStr) || 0);
                      setStartIndex(val);
                      setStartIndexStr(String(val));
                      saveConfig({ startIndex: val });
                    }}
                  />
                </div>

                {/* Frame Pair Preview */}
                {framePairPreview && framePairPreview.pairs?.length > 0 && (
                  <div className="p-3 bg-muted/50 rounded-md border">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Preview (first {framePairPreview.pairs.length} of {framePairPreview.total_pairs} pairs)
                    </p>
                    <div className="space-y-0.5 font-mono text-xs">
                      {framePairPreview.pairs.map((pair: any) => (
                        <div key={pair.pair} className="text-muted-foreground">
                          <span className="text-foreground font-medium">Pair {pair.pair}:</span>{" "}
                          {pair.frame_a} + {pair.frame_b}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 font-medium">
                      Total: {framePairPreview.total_pairs} pairs
                      {framePairPreview.num_loops > 1
                        ? ` from ${framePairPreview.num_loops} loops (\u00d7${framePairPreview.per_loop_pairs} per loop)`
                        : ` from ${framePairPreview.num_images} images`}
                    </p>
                  </div>
                )}
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
              {imageType === "lavision_set" ? (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>LaVision .set Files</AlertTitle>
                  <AlertDescription>
                    For .set files, enter the full path to each .set file in Source Paths (e.g., <code>/data/experiment.set</code>).
                    No filename pattern is needed. Masks will be stored in a <code>*_data</code> subfolder next to each .set file.
                  </AlertDescription>
                </Alert>
              ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="font-semibold">Raw Image Pattern{pairingPreset === "ab_format" ? "s" : ""}</Label>
                </div>
                <div className="space-y-3 mt-2">
                  {rawPatterns.map((p, i) => {
                    const patternValidation = validation.patternValidations?.[i];
                    const isValid = patternValidation?.valid;
                    const hasValidation = patternValidation !== undefined && validation.checked;

                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center gap-2">
                          {rawPatterns.length === 2 && (
                            <span className="text-xs font-medium text-muted-foreground w-4">
                              {i === 0 ? 'A' : 'B'}
                            </span>
                          )}
                          <Input
                            className={cn(
                              "font-mono flex-1",
                              hasValidation && isValid === false && "border-red-500 focus-visible:ring-red-500",
                              hasValidation && isValid === true && "border-green-500 focus-visible:ring-green-500"
                            )}
                            value={p}
                            onChange={e => {
                              const nextPatterns = [...rawPatterns];
                              nextPatterns[i] = e.target.value;
                              setRawPatterns(nextPatterns);
                            }}
                            onBlur={() => saveConfig()}
                          />
                          {hasValidation && (
                            isValid
                              ? <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                              : <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                          )}
                          {pairingPreset !== "ab_format" && rawPatterns.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                const nextPatterns = rawPatterns.filter((_, idx) => idx !== i);
                                setRawPatterns(nextPatterns);
                                saveConfig({ rawPatterns: nextPatterns });
                              }}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                          )}
                        </div>

                        {hasValidation && !isValid && patternValidation?.suggested_pattern && (
                          <div className="flex items-center gap-2 text-sm ml-5">
                            <span className="text-muted-foreground">Did you mean:</span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const nextPatterns = [...rawPatterns];
                                nextPatterns[i] = patternValidation.suggested_pattern!;
                                setRawPatterns(nextPatterns);
                                saveConfig({ rawPatterns: nextPatterns });
                              }}
                              className="font-mono text-xs text-blue-600 border-blue-300 hover:bg-blue-50"
                            >
                              {patternValidation.suggested_pattern}
                            </Button>
                          </div>
                        )}

                        {hasValidation && !isValid && !patternValidation?.suggested_pattern && patternValidation?.error && (
                          <p className="text-xs text-red-600 ml-5">
                            {patternValidation.error}
                          </p>
                        )}
                      </div>
                    );
                  })}

                  <ValidationAlert
                    validation={validation}
                    currentMode={pairingPreset === 'ab_format' ? 'ab_format' : 'skip_frames'}
                    onApplySuggestedPattern={(pattern, patternB, suggestedMode) => {
                      let newPatterns: string[];
                      const shouldUseABMode =
                        suggestedMode === 'ab_format' || pairingPreset === 'ab_format';

                      if (shouldUseABMode) {
                        if (patternB) {
                          newPatterns = [pattern, patternB];
                        } else {
                          newPatterns = deriveABPatterns(pattern);
                        }
                      } else {
                        newPatterns = [pattern];
                      }

                      setRawPatterns(newPatterns);
                      saveConfig({ rawPatterns: newPatterns });
                    }}
                    onApplySuggestedSubfolder={(subfolder) => {
                      // Derive subfolders for all cameras by replacing the numeric portion
                      const newSubfolders = Array.from(
                        { length: Number(numCameras) },
                        (_, i) => subfolder.replace(/\d+/, String(i + 1))
                      );
                      setCameraSubfolders(newSubfolders);
                      saveConfig({ cameraSubfolders: newSubfolders });
                    }}
                  />
                  {pairingPreset !== "ab_format" && (
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
              )}
              <div>
                <Label className="font-semibold">Vector Pattern</Label>
                <Input
                  className="font-mono mt-2"
                  value={vectorPattern}
                  onChange={e => setVectorPattern(e.target.value)}
                  onBlur={() => saveConfig()}
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
