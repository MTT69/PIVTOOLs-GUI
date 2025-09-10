"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function VideoMaker({ backendUrl = '/backend', config }: { backendUrl?: string; config?: any }) {
  // Directory / base paths
  const [directory, setDirectory] = useState<string>('');
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const [basePaths, setBasePaths] = useState<string[]>(() => {
    try {
      return JSON.parse(typeof window !== 'undefined' ? localStorage.getItem('piv_base_paths') || '[]' : '[]');
    } catch {
      return [];
    }
  });
  const [basePathIdx, setBasePathIdx] = useState<number>(0);

  // Camera options derived from config (same logic as VectorViewer)
  const cameraOptions: string[] = useMemo(() => {
    const nFromPaths = config?.paths?.camera_numbers?.length ? Number(config.paths.camera_numbers[0]) : undefined;
    const nFromIm = config?.imProperties?.cameraCount ? Number(config.imProperties.cameraCount) : undefined;
    const n = (Number.isFinite(nFromPaths as number) && (nFromPaths as number) > 0)
      ? (nFromPaths as number)
      : (Number.isFinite(nFromIm as number) && (nFromIm as number) > 0) ? (nFromIm as number) : 1;
    const count = Number.isFinite(n) ? n : 1;
    return Array.from({ length: count }, (_, i) => `Cam${i + 1}`);
  }, [config]);

  const [camera, setCamera] = useState<string>(() => cameraOptions.length > 0 ? cameraOptions[0] : 'Cam1');
  useEffect(() => {
    if (cameraOptions.length === 0) return;
    if (!cameraOptions.includes(camera)) setCamera(cameraOptions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOptions.length, cameraOptions[0]]);

  // Other selection state
  const [type, setType] = useState<string>('ux');
  const [cmap, setCmap] = useState<string>('default');
  const [run, setRun] = useState<number>(1);
  const [lower, setLower] = useState<string>('');
  const [upper, setUpper] = useState<string>('');
  const [merged, setMerged] = useState<boolean>(false);
  const [upscale, setUpscale] = useState<number>(1);
  const [crf, setCrf] = useState<number>(18);
  const [ditherStrength, setDitherStrength] = useState<number>(1.0 / 2048.0);

  // Add new state for handling the video creation process
  const [creating, setCreating] = useState<boolean>(false);
  const [videoResult, setVideoResult] = useState<{ success?: boolean; message?: string; out_path?: string } | null>(null);
  const [videoStatus, setVideoStatus] = useState<{ 
    processing: boolean; 
    progress: number; 
    status: string; 
    message?: string;
    out_path?: string;
    computed_limits?: {
      lower: number;
      upper: number;
      actual_min: number;
      actual_max: number;
      percentile_based: boolean;
    };
  } | null>(null);
  const [showTestOption, setShowTestOption] = useState<boolean>(false);

  // Effective directory: prefer selected base path if available
  const effectiveDir = useMemo(() => {
    if (basePaths.length > 0 && basePathIdx >= 0 && basePathIdx < basePaths.length) {
      return basePaths[basePathIdx];
    }
    return directory;
  }, [basePaths, basePathIdx, directory]);

  // Keep local directory text input in sync when basePaths change
  useEffect(() => {
    if (effectiveDir) setDirectory(effectiveDir);
  }, [effectiveDir]);

  // Directory picker (web fallback)
  const handleBrowse = () => {
    dirInputRef.current?.click();
  };
  const onDirPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const anyFile: any = files[0];
    const rel: string = anyFile.webkitRelativePath || '';
    const root = rel.split('/')[0] || '';
    let folderPath = root;
    if (anyFile.path && rel) {
      // In some electron/tauri contexts file.path contains full paths
      folderPath = anyFile.path.replace(/\\/g, '/').split('/' + rel)[0] || root;
    }
    setDirectory(folderPath);
    e.currentTarget.value = '';
  };

  // Assemble params (but do not send anything yet)
  const buildParams = () => {
    const params: any = {
      base_path: effectiveDir,
      camera: camera.replace(/[^\d]/g, '') || '1',
      var: type,
      run: String(run),
      merged: merged ? '1' : '0',
      cmap,
      lower,
      upper,
      num_images: config?.images?.num_images || 0,
      upscale,
      crf,
      dither_strength: ditherStrength,
    };
    return params;
  };

  // Function to handle video creation
  const handleCreateVideo = async (isTest: boolean = false) => {
    setCreating(true);
    setVideoResult(null);
    setVideoStatus(null);
    
    try {
      const params = buildParams();
      if (isTest) {
        params.test_mode = true;
        params.test_frames = 50;
      }
      const url = `${backendUrl}/video/start_video`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to start video creation');
      }
      
      // Start polling status immediately
      const pollStatus = () => {
        fetch(`${backendUrl}/video/video_status`)
          .then(res => res.json())
          .then(status => {
            setVideoStatus(status);
            if (status.processing) {
              setTimeout(pollStatus, 500); // Poll every 500ms for smoother progress
            } else {
              setCreating(false);
              if (status.error) {
                setVideoResult({
                  success: false,
                  message: status.error
                });
              } else {
                setVideoResult({
                  success: true,
                  message: isTest ? 'Test video created successfully!' : 'Video creation completed!',
                  out_path: status.out_path
                });
              }
            }
          })
          .catch(err => {
            console.error('Polling error', err);
            setCreating(false);
            setVideoResult({
              success: false,
              message: 'Error polling status.'
            });
          });
      };
      pollStatus();
    } catch (error: any) {
      setVideoResult({
        success: false,
        message: `Error: ${error.message}`
      });
      setCreating(false);
    }
  };

  // Function to handle video cancellation
  const handleCancelVideo = async () => {
    try {
      const response = await fetch(`${backendUrl}/video/cancel_video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to cancel video');
      }
      setVideoStatus({ processing: false, progress: 0, status: 'canceled' });
      setVideoResult({
        success: false,
        message: 'Video creation canceled.'
      });
      setCreating(false);
    } catch (error: any) {
      console.error('Cancel error', error);
      setVideoResult({
        success: false,
        message: `Error canceling: ${error.message}`
      });
    }
  };

  // Helper to show just the last segment of a path
  const basename = (p: string) => {
    if (!p) return "";
    const parts = p.replace(/\\/g, "/").split("/");
    return parts.filter(Boolean).pop() || p;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Video Creation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 mb-4">
            <div className="flex flex-col gap-4 mb-4">
              {/* Base path selection */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Base Path:</label>
                {basePaths.length > 0 ? (
                  <Select value={String(basePathIdx)} onValueChange={v => setBasePathIdx(Number(v))}>
                    <SelectTrigger id="basepath"><SelectValue placeholder="Pick base path" /></SelectTrigger>
                    <SelectContent>
                      {basePaths.map((p, i) => (
                        <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <Input
                      type="text"
                      value={directory}
                      onChange={(e) => setDirectory(e.target.value)}
                      placeholder="Select directory"
                      className="w-full"
                    />
                    <input
                      ref={dirInputRef}
                      type="file"
                      style={{ display: 'none' }}
                      onChange={onDirPicked}
                    />
                    <Button variant="outline" onClick={handleBrowse}>
                      Browse
                    </Button>
                  </>
                )}
              </div>

              {/* Camera selection and merged checkbox */}
              <div className="flex items-center gap-4">
                <label htmlFor="camera" className="text-sm font-medium">Camera:</label>
                <Select value={camera} onValueChange={v => setCamera(v)}>
                  <SelectTrigger id="camera"><SelectValue placeholder="Select camera" /></SelectTrigger>
                  <SelectContent>
                    {cameraOptions.map((c, i) => (
                      <SelectItem key={i} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Merged Data checkbox */}
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={merged}
                    onChange={e => setMerged(e.target.checked)}
                    className="accent-soton-blue w-4 h-4 rounded border-gray-300"
                  />
                  Merged Data
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type (variable)</label>
                  <Select value={type} onValueChange={v => setType(v)}>
                    <SelectTrigger id="type"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ux">ux</SelectItem>
                      <SelectItem value="uy">uy</SelectItem>
                      <SelectItem value="mag">mag</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Colormap</label>
                  <Select value={cmap} onValueChange={v => setCmap(v)}>
                    <SelectTrigger id="cmap"><SelectValue placeholder="Select colormap" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">default</SelectItem>
                      <SelectItem value="viridis">viridis</SelectItem>
                      <SelectItem value="plasma">plasma</SelectItem>
                      <SelectItem value="inferno">inferno</SelectItem>
                      <SelectItem value="magma">magma</SelectItem>
                      <SelectItem value="cividis">cividis</SelectItem>
                      <SelectItem value="jet">jet</SelectItem>
                      <SelectItem value="gray">gray</SelectItem>
                      <SelectItem value="bone">bone</SelectItem>
                      <SelectItem value="copper">copper</SelectItem>
                      <SelectItem value="pink">pink</SelectItem>
                      <SelectItem value="spring">spring</SelectItem>
                      <SelectItem value="summer">summer</SelectItem>
                      <SelectItem value="autumn">autumn</SelectItem>
                      <SelectItem value="winter">winter</SelectItem>
                      <SelectItem value="hot">hot</SelectItem>
                      <SelectItem value="cool">cool</SelectItem>
                      <SelectItem value="Wistia">Wistia</SelectItem>
                      <SelectItem value="twilight">twilight</SelectItem>
                      <SelectItem value="hsv">hsv</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Run</label>
                  <Input 
                    type="number" 
                    min={1} 
                    value={run} 
                    onChange={(e) => setRun(Number(e.target.value || 1))} 
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Lower limit</label>
                  <Input 
                    value={lower} 
                    onChange={(e) => setLower(e.target.value)} 
                    placeholder="auto" 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Upper limit</label>
                  <Input 
                    value={upper} 
                    onChange={(e) => setUpper(e.target.value)} 
                    placeholder="auto" 
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Upscale</label>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setUpscale(prev => Math.max(1, prev - 1))}
                  >
                    -
                  </Button>
                  <Input 
                    type="number" 
                    min={1} 
                    value={upscale} 
                    onChange={(e) => setUpscale(Number(e.target.value) || 1)} 
                    className="w-20 text-center" 
                  />
                  <Button 
                    variant="outline" 
                    onClick={() => setUpscale(prev => prev + 1)}
                  >
                    +
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">CRF (quality, lower=better)</label>
                  <Input
                    type="number"
                    min={1}
                    max={51}
                    value={crf}
                    onChange={e => setCrf(Number(e.target.value) || 18)}
                    className="w-20 text-center"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Dither Strength</label>
                  <Input
                    type="number"
                    min={0}
                    step={0.0001}
                    value={ditherStrength}
                    onChange={e => setDitherStrength(Number(e.target.value) || 0)}
                    className="w-20 text-center"
                  />
                </div>
              </div>

              {/* Display result message */}
              {videoResult && (
                <div className={`w-full p-3 mb-3 rounded border ${
                  videoResult.success 
                    ? 'border-green-200 bg-green-50 text-green-700' 
                    : 'border-red-200 bg-red-50 text-red-700'
                } text-sm`}>
                  {videoResult.message}
                  
                  {/* Display computed limits if available */}
                  {videoStatus?.computed_limits && (
                    <div className="mt-2 p-2 bg-white bg-opacity-50 rounded text-xs">
                      <div className="font-medium mb-1">Video Limits:</div>
                      <div>Lower: {videoStatus.computed_limits.lower.toFixed(3)} | Upper: {videoStatus.computed_limits.upper.toFixed(3)}</div>
                      <div>Data range: {videoStatus.computed_limits.actual_min.toFixed(3)} to {videoStatus.computed_limits.actual_max.toFixed(3)}</div>
                      {videoStatus.computed_limits.percentile_based && (
                        <div className="text-gray-600 italic">Limits auto-computed from 5th-95th percentiles</div>
                      )}
                    </div>
                  )}
                  
                  {videoResult.out_path && (
                    <div className="mt-2">
                      <video
                        controls
                        className="w-full max-w-md rounded border"
                        src={`${backendUrl}/video/download?path=${encodeURIComponent(videoResult.out_path)}`}
                      >
                        Your browser does not support the video tag.
                      </video>
                    </div>
                  )}
                </div>
              )}

              {/* Progress bar and status */}
              {videoStatus && videoStatus.processing && (
                <div className="w-full space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Processing video...</span>
                    <span>{videoStatus.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-soton-blue h-2 rounded-full transition-all duration-300"
                      style={{ width: `${videoStatus.progress}%` }}
                    />
                  </div>
                  {videoStatus.message && (
                    <div className="text-xs text-gray-600">{videoStatus.message}</div>
                  )}
                </div>
              )}

              <div className="pt-4 flex flex-col gap-2">
                <div className="flex justify-end gap-2">
                  <Button 
                    variant="outline" 
                    onClick={handleCancelVideo}
                    disabled={!videoStatus?.processing}
                  >
                    Cancel
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => handleCreateVideo(true)}
                    disabled={creating || videoStatus?.processing}
                  >
                    Test Video (50 frames)
                  </Button>
                  <Button 
                    className="bg-soton-blue" 
                    onClick={() => handleCreateVideo(false)}
                    disabled={creating || videoStatus?.processing}
                  >
                    {creating ? "Starting..." : videoStatus?.processing ? "Processing..." : "Create Full Video"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}