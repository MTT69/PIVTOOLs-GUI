"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, Minus, Image as ImageIcon, RefreshCcw, CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { useConfigUpdate } from "@/hooks/useConfigUpdate";

interface ImageConfigProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  setPathValidation?: (validation: { valid: boolean; error?: string; checked: boolean }) => void;
  sectionsToShow?: ('core' | 'patterns')[];
}

export default function ImageConfig({ config, updateConfig, setPathValidation, sectionsToShow = ['core', 'patterns'] }: ImageConfigProps) {
  const [numImages, setNumImages] = useState<string>("");
  const [numCameras, setNumCameras] = useState<string>("1");
  const [timeResolved, setTimeResolved] = useState<boolean>(false);
  const [rawPatterns, setRawPatterns] = useState<string[]>([]);
  const [vectorPattern, setVectorPattern] = useState<string>("");
  const [savingMeta, setSavingMeta] = useState<string>("");
  const [patternValidation, setPatternValidation] = useState<{
    status: 'idle' | 'checking' | 'valid' | 'invalid';
    error?: string;
  }>({ status: 'idle' });
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const [isMacOS, setIsMacOS] = useState(false);
  const [hasUnsupportedFormat, setHasUnsupportedFormat] = useState(false);
  const [lastValidatedConfig, setLastValidatedConfig] = useState<string>('');

  // Debounce timer refs
  const validationTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  const validatePatterns = async () => {
    console.log('validatePatterns called');

    // Clear any pending validation timers
    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current);
      validationTimerRef.current = null;
    }

    // Validate that image files exist using the /backend/get_frame_pair endpoint
    const sourcePaths = config.paths?.source_paths || [];
    const cameraNumbers = config.paths?.camera_numbers || [1];

    if (sourcePaths.length === 0) {
      setPatternValidation({
        status: 'invalid',
        error: 'No source paths configured. Please add source directories in Paths Configuration below.',
      });
      setPathValidation?.({
        valid: false,
        error: 'No source paths configured.',
        checked: true,
      });
      return;
    }

    // Check for unsupported formats on macOS
    if (hasUnsupportedFormat) {
      setPatternValidation({
        status: 'invalid',
        error: '.set/.im7/.ims formats are not supported on macOS. Please use .tif or .png formats.',
      });
      setPathValidation?.({
        valid: false,
        error: 'Unsupported file format on macOS',
        checked: true,
      });
      return;
    }

    setPatternValidation({ status: 'checking' });

    try {
      // Use the first camera from camera_numbers (selected cameras for processing)
      const cameraToTest = cameraNumbers[0] || 1;
      const res = await fetch(`/backend/get_frame_pair?camera=${cameraToTest}&idx=1&source_path_idx=0`);

      if (res.ok) {
        console.log('Validation successful - files found');
        setPatternValidation({ status: 'valid' });
        setPathValidation?.({
          valid: true,
          error: undefined,
          checked: true,
        });
      } else {
        const json = await res.json();
        // Construct detailed error message with path information
        let errorMsg = 'Image files not found';

        if (json.detail) {
          // Use the detailed message from backend
          errorMsg = json.detail;
        } else if (json.source_path && json.patterns) {
          // Construct message from parts
          const patterns = Array.isArray(json.patterns)
            ? json.patterns.join(', ')
            : json.patterns;
          errorMsg = `No files found in ${json.source_path} using pattern(s): ${patterns}`;
        } else if (json.file) {
          // Backend returned the specific file that couldn't be found
          errorMsg = `File not found: ${json.file}`;
        } else if (json.error) {
          errorMsg = json.error;
        }

        console.log('Validation failed:', errorMsg);
        setPatternValidation({
          status: 'invalid',
          error: errorMsg,
        });
        setPathValidation?.({
          valid: false,
          error: errorMsg,
          checked: true,
        });
      }
    } catch (e: any) {
      console.error('Validation error:', e);
      const errorMsg = `Failed to validate: ${e.message}`;
      setPatternValidation({
        status: 'invalid',
        error: errorMsg,
      });
      setPathValidation?.({
        valid: false,
        error: errorMsg,
        checked: true,
      });
    }
  };

  // Auto-validation effect - runs when relevant config changes
  useEffect(() => {
    // Create a key from all validation-relevant config
    const validationKey = JSON.stringify({
      sourcePaths: config.paths?.source_paths || [],
      imageFormat: config.images?.image_format,
      cameraNumbers: config.paths?.camera_numbers || [],
      timeResolved: config.images?.time_resolved,
    });

    // Only validate if config actually changed
    if (validationKey !== lastValidatedConfig) {
      console.log('Validation-relevant config changed, resetting and re-validating...');

      // Reset validation state immediately on config change
      setPatternValidation({ status: 'idle' });
      setPathValidation?.({
        valid: true,
        error: undefined,
        checked: false,
      });

      setLastValidatedConfig(validationKey);

      // Clear any pending validation timers
      if (validationTimerRef.current) {
        clearTimeout(validationTimerRef.current);
      }

      // Debounce validation - always validate to show appropriate errors
      validationTimerRef.current = setTimeout(() => {
        console.log('Running debounced validation...');
        validatePatterns();
      }, 500); // Reduced debounce time from 800ms to 500ms for more responsive feel
    }

    return () => {
      if (validationTimerRef.current) {
        clearTimeout(validationTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config.paths?.source_paths,
    config.paths?.camera_numbers,
    config.images?.image_format,
    config.images?.time_resolved,
    hasUnsupportedFormat,
    lastValidatedConfig,
  ]);

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
    saveConfig(numImages, numCameras, isTimeResolved, newPatterns, vectorPattern);
  };

  const handlePatternBlur = () => {
    // Validate patterns when user finishes editing
    if (config.paths?.source_paths?.length > 0) {
      validatePatterns();
    }
  };

  const ValidationIcon = () => {
    if (patternValidation.status === 'checking') {
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    }
    if (patternValidation.status === 'valid') {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
    if (patternValidation.status === 'invalid') {
      return <XCircle className="h-4 w-4 text-red-500" />;
    }
    return null;
  };

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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => validatePatterns()}
                    disabled={patternValidation.status === 'checking'}
                  >
                    {patternValidation.status === 'checking' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Checking...
                      </>
                    ) : (
                      <>
                        <RefreshCcw className="h-4 w-4 mr-2" />
                        Validate Files
                      </>
                    )}
                  </Button>
                </div>
                <div className="space-y-3 mt-2">
                  {rawPatterns.map((p, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Input
                          className={`font-mono ${patternValidation.status === 'invalid' ? 'border-red-500' : patternValidation.status === 'valid' ? 'border-green-500' : ''}`}
                          value={p}
                          onChange={e => {
                            const nextPatterns = [...rawPatterns];
                            nextPatterns[i] = e.target.value;
                            setRawPatterns(nextPatterns);
                            setPatternValidation({ status: 'idle' }); // Reset validation on change
                          }}
                          onBlur={() => {
                            saveConfig(numImages, numCameras, timeResolved, rawPatterns, vectorPattern);
                            handlePatternBlur();
                          }}
                        />
                        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                          <ValidationIcon />
                        </div>
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
                    </div>
                  ))}

                  {/* Show validation error once, outside the pattern loop */}
                  {patternValidation.status === 'invalid' && patternValidation.error && (
                    <Alert variant="destructive" className="mt-2">
                      <XCircle className="h-4 w-4" />
                      <AlertTitle>Validation Failed</AlertTitle>
                      <AlertDescription className="text-sm">
                        {patternValidation.error}
                      </AlertDescription>
                    </Alert>
                  )}
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
                <p className="text-xs text-muted-foreground mt-1">
                  Output filename pattern for processed vector fields
                </p>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <RefreshCcw className="h-3 w-3" /> {savingMeta || "Changes are saved when you finish editing a box."}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}