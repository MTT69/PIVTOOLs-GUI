"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Image as ImageIcon } from "lucide-react";

interface CalibrationImageConfigProps {
  backendUrl?: string;
  sourcePathIdx: number;
  camera: number;
  onConfigChange?: (config: CalibrationConfig) => void;
  onValidationChange?: (valid: boolean, frameCount: number) => void;
}

export interface CalibrationConfig {
  image_format: string;
  num_images: number;
  image_type: string;
  zero_based_indexing: boolean;
  use_camera_subfolders: boolean;
  is_container_format: boolean;
  camera_subfolders: string[];
  calibration_sources: string[];
}

interface ValidationResult {
  valid: boolean;
  found_count: number | string;
  expected_count: number;
  camera_path: string;
  first_image_preview: string | null;
  image_size: [number, number] | null;
  sample_files: string[];
  format_detected: string | null;
  error: string | null;
  suggested_pattern: string | null;
}

export default function CalibrationImageConfig({
  backendUrl = "/backend",
  sourcePathIdx,
  camera,
  onConfigChange,
  onValidationChange,
}: CalibrationImageConfigProps) {
  // Config state
  const [imageFormat, setImageFormat] = useState("calib%05d.tif");
  const [numImages, setNumImages] = useState(10);
  const [imageType, setImageType] = useState("standard");
  const [zeroBasedIndexing, setZeroBasedIndexing] = useState(false);
  const [useCameraSubfolders, setUseCameraSubfolders] = useState(true);
  const [isContainerFormat, setIsContainerFormat] = useState(false);
  const [cameraSubfolders, setCameraSubfolders] = useState<string[]>([]);
  const [calibrationSources, setCalibrationSources] = useState<string[]>([]);

  // Validation state
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>("");

  // Load config from backend
  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl}/calibration/config`);
      const json = await res.json();

      if (res.ok) {
        setImageFormat(json.image_format || "calib%05d.tif");
        setNumImages(json.num_images || 10);
        setImageType(json.image_type || "standard");
        setZeroBasedIndexing(json.zero_based_indexing || false);
        setUseCameraSubfolders(json.use_camera_subfolders ?? true);
        setIsContainerFormat(json.is_container_format || false);
        setCameraSubfolders(json.camera_subfolders || []);
        setCalibrationSources(json.calibration_sources || []);
      }
    } catch (e) {
      console.error("Failed to load calibration config:", e);
    }
  }, [backendUrl]);

  // Save config to backend
  const saveConfig = useCallback(async (updates: Partial<CalibrationConfig>) => {
    setSaving(true);
    setSaveStatus("Saving...");

    try {
      const res = await fetch(`${backendUrl}/calibration/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const json = await res.json();

      if (res.ok) {
        // Update local state from response
        if (json.image_format) setImageFormat(json.image_format);
        if (json.num_images) setNumImages(json.num_images);
        if (json.image_type) setImageType(json.image_type);
        if (json.zero_based_indexing !== undefined) setZeroBasedIndexing(json.zero_based_indexing);
        if (json.use_camera_subfolders !== undefined) setUseCameraSubfolders(json.use_camera_subfolders);
        if (json.is_container_format !== undefined) setIsContainerFormat(json.is_container_format);
        if (json.camera_subfolders !== undefined) setCameraSubfolders(json.camera_subfolders);
        if (json.calibration_sources !== undefined) setCalibrationSources(json.calibration_sources);

        setSaveStatus("Saved");

        // Notify parent
        onConfigChange?.({
          image_format: json.image_format,
          num_images: json.num_images,
          image_type: json.image_type,
          zero_based_indexing: json.zero_based_indexing,
          use_camera_subfolders: json.use_camera_subfolders,
          is_container_format: json.is_container_format,
          camera_subfolders: json.camera_subfolders,
          calibration_sources: json.calibration_sources,
        });

        // Re-validate after save
        runValidation();
      } else {
        setSaveStatus(`Error: ${json.error}`);
      }
    } catch (e: any) {
      setSaveStatus(`Error: ${e.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(""), 2000);
    }
  }, [backendUrl, onConfigChange]);

  // Run validation
  const runValidation = useCallback(async () => {
    setValidating(true);

    try {
      const res = await fetch(`${backendUrl}/calibration/validate_images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera,
          source_path_idx: sourcePathIdx,
        }),
      });

      const json = await res.json();
      setValidation(json);

      // Notify parent of validation result
      const frameCount = typeof json.found_count === 'number' ? json.found_count : numImages;
      onValidationChange?.(json.valid, frameCount);

    } catch (e: any) {
      setValidation({
        valid: false,
        found_count: 0,
        expected_count: numImages,
        camera_path: "",
        first_image_preview: null,
        image_size: null,
        sample_files: [],
        format_detected: null,
        error: e.message,
        suggested_pattern: null,
      });
      onValidationChange?.(false, 0);
    } finally {
      setValidating(false);
    }
  }, [backendUrl, camera, sourcePathIdx, numImages, onValidationChange]);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Validate when camera or source changes
  useEffect(() => {
    runValidation();
  }, [camera, sourcePathIdx]);

  // Detect image type from format pattern
  const detectImageType = (pattern: string): string => {
    const lower = pattern.toLowerCase();
    if (lower.includes('.cine')) return "cine";
    if (lower.includes('.set')) return "lavision_set";
    if (lower.includes('.im7') || lower.includes('.ims')) return "lavision_im7";
    return "standard";
  };

  // Handle image type change
  const handleImageTypeChange = (newType: string) => {
    setImageType(newType);

    // Set default format for type
    let defaultFormat = imageFormat;
    switch (newType) {
      case "cine":
        defaultFormat = "Camera%d.cine";
        break;
      case "lavision_set":
        defaultFormat = "calib.set";
        break;
      case "lavision_im7":
        defaultFormat = "calib%05d.im7";
        break;
      case "standard":
      default:
        if (!imageFormat.match(/\.(tif|tiff|png|jpg|jpeg)$/i)) {
          defaultFormat = "calib%05d.tif";
        }
        break;
    }

    setImageFormat(defaultFormat);
    setIsContainerFormat(newType !== "standard");

    saveConfig({
      image_format: defaultFormat,
      image_type: newType,
    });
  };

  // Apply suggested pattern
  const applySuggestedPattern = () => {
    if (validation?.suggested_pattern) {
      setImageFormat(validation.suggested_pattern);
      setImageType(detectImageType(validation.suggested_pattern));
      saveConfig({
        image_format: validation.suggested_pattern,
        image_type: detectImageType(validation.suggested_pattern),
      });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Calibration Image Settings</CardTitle>
        </div>
        <CardDescription>
          Configure how calibration images are located and loaded
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Image Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="calib-image-type">Image Type</Label>
            <Select value={imageType} onValueChange={handleImageTypeChange}>
              <SelectTrigger id="calib-image-type" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard (TIFF/PNG/JPG)</SelectItem>
                <SelectItem value="cine">Phantom CINE</SelectItem>
                <SelectItem value="lavision_set">LaVision SET</SelectItem>
                <SelectItem value="lavision_im7">LaVision IM7</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="calib-num-images">Number of Images</Label>
            <Input
              id="calib-num-images"
              type="number"
              min={1}
              value={numImages}
              onChange={e => setNumImages(Number(e.target.value) || 1)}
              onBlur={() => saveConfig({ num_images: numImages })}
              className="mt-1"
            />
          </div>
        </div>

        {/* Image Format Pattern */}
        <div>
          <Label htmlFor="calib-image-format">Image Format Pattern</Label>
          <Input
            id="calib-image-format"
            value={imageFormat}
            onChange={e => setImageFormat(e.target.value)}
            onBlur={() => saveConfig({ image_format: imageFormat })}
            className="mt-1 font-mono"
            placeholder="calib%05d.tif"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Use <code>%05d</code> for 5-digit zero-padded numbers, <code>%d</code> for camera number
          </p>
        </div>

        {/* Options */}
        <div className="flex flex-wrap gap-4 pt-2">
          {imageType === "standard" && (
            <div className="flex items-center gap-2">
              <Switch
                id="calib-zero-based"
                checked={zeroBasedIndexing}
                onCheckedChange={checked => {
                  setZeroBasedIndexing(checked);
                  saveConfig({ zero_based_indexing: checked });
                }}
              />
              <Label htmlFor="calib-zero-based" className="text-sm">Zero-based indexing</Label>
            </div>
          )}
          {/* Use camera subfolders toggle - for standard and IM7 formats */}
          {(imageType === "standard" || imageType === "lavision_im7") && (
            <div className="flex items-center gap-2">
              <Switch
                id="calib-use-camera-subfolders"
                checked={useCameraSubfolders}
                onCheckedChange={checked => {
                  setUseCameraSubfolders(checked);
                  saveConfig({ use_camera_subfolders: checked });
                }}
              />
              <Label htmlFor="calib-use-camera-subfolders" className="text-sm">
                Use camera subfolders
              </Label>
            </div>
          )}
        </div>
        {(imageType === "standard" || imageType === "lavision_im7") && (
          <p className="text-xs text-muted-foreground">
            {useCameraSubfolders
              ? "Images expected in camera subfolders (e.g., Cam1/, Cam2/)."
              : "Images in source directory without camera subfolders."
            }
          </p>
        )}

        {/* Custom Camera Subfolder Name - only show when using camera subfolders */}
        {useCameraSubfolders && (
          <div className="pt-2">
            <Label htmlFor="calib-camera-subfolder">Camera Subfolder Name (Camera {camera})</Label>
            <Input
              id="calib-camera-subfolder"
              value={cameraSubfolders[camera - 1] || ""}
              onChange={e => {
                const newSubfolders = [...cameraSubfolders];
                // Ensure array is long enough
                while (newSubfolders.length < camera) {
                  newSubfolders.push("");
                }
                newSubfolders[camera - 1] = e.target.value;
                setCameraSubfolders(newSubfolders);
              }}
              onBlur={() => {
                // Clean up empty trailing entries
                const cleaned = [...cameraSubfolders];
                while (cleaned.length < camera) {
                  cleaned.push("");
                }
                saveConfig({ camera_subfolders: cleaned });
              }}
              className="mt-1"
              placeholder={`Cam${camera}`}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty to use default &quot;Cam{camera}&quot;. Examples: &quot;camera{camera}&quot;, &quot;View{camera}&quot;
            </p>
          </div>
        )}

        {/* Validation Status */}
        <div className="pt-2 border-t">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-medium">Validation Status</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={runValidation}
              disabled={validating}
            >
              {validating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Validate
            </Button>
          </div>

          {validation && (
            <div className="space-y-2">
              {validation.valid ? (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700">
                    <span className="font-medium">Valid</span> - Found{' '}
                    {typeof validation.found_count === 'number'
                      ? `${validation.found_count} images`
                      : 'container file'}
                    {validation.image_size && ` (${validation.image_size[0]}x${validation.image_size[1]})`}
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>
                    {validation.error || 'Validation failed'}
                  </AlertDescription>
                </Alert>
              )}

              {/* Sample files */}
              {validation.sample_files.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Sample files:</span>{' '}
                  {validation.sample_files.slice(0, 3).join(', ')}
                  {validation.sample_files.length > 3 && ` (+${validation.sample_files.length - 3} more)`}
                </div>
              )}

              {/* Suggested pattern */}
              {!validation.valid && validation.suggested_pattern && (
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <span>
                    Suggested pattern: <code className="bg-muted px-1 rounded">{validation.suggested_pattern}</code>
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={applySuggestedPattern}
                  >
                    Apply
                  </Button>
                </div>
              )}

              {/* Camera path */}
              {validation.camera_path && (
                <div className="text-xs text-muted-foreground truncate">
                  <span className="font-medium">Path:</span> {validation.camera_path}
                </div>
              )}

              {/* Preview thumbnail */}
              {validation.first_image_preview && (
                <div className="mt-2">
                  <img
                    src={`data:image/png;base64,${validation.first_image_preview}`}
                    alt="First calibration image preview"
                    className="max-w-[200px] max-h-[150px] rounded border object-contain"
                  />
                </div>
              )}
            </div>
          )}

          {validating && !validation && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Validating...
            </div>
          )}
        </div>

        {/* Save status */}
        {saveStatus && (
          <div className="text-xs text-muted-foreground">{saveStatus}</div>
        )}
      </CardContent>
    </Card>
  );
}
