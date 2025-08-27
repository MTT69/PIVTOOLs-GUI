"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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

  // Add new state for handling the video creation process
  const [creating, setCreating] = useState<boolean>(false);
  const [videoResult, setVideoResult] = useState<{ success?: boolean; message?: string } | null>(null);

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
  const buildParams = () => ({
    base_path: effectiveDir,
    camera: camera.replace(/[^\d]/g, '') || '1',
    var: type,
    run: String(run),
    merged: merged ? '1' : '0',
    cmap,
    lower,
    upper,
  });

  // Function to handle video creation
  const handleCreateVideo = async () => {
    setCreating(true);
    setVideoResult(null);
    
    try {
      const params = buildParams();
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
        throw new Error(result.error || 'Failed to create video');
      }
      
      setVideoResult({
        success: true,
        message: result.message || 'Video creation started successfully. This process runs in the background.'
      });
    } catch (error: any) {
      setVideoResult({
        success: false,
        message: `Error: ${error.message}`
      });
    } finally {
      setCreating(false);
    }
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
                  <>
                    <select
                      value={String(basePathIdx)}
                      onChange={(e) => setBasePathIdx(Number(e.target.value))}
                      className="border rounded px-2 py-1 flex-1"
                    >
                      {basePaths.map((p, i) => {
                        // Show last two segments of the path
                        const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
                        const parts = norm.split("/").filter(Boolean);
                        const lastTwo = parts.length >= 2 ? parts.slice(-2).join("/") : norm;
                        return <option key={i} value={i}>{`${i}: /${lastTwo}`}</option>;
                      })}
                    </select>
                  </>
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
                <select
                  id="camera"
                  value={camera}
                  onChange={e => setCamera(e.target.value)}
                  className="border rounded px-2 py-1"
                >
                  {cameraOptions.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

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
                  <select 
                    value={type} 
                    onChange={(e) => setType(e.target.value)}
                    className="w-full border rounded px-2 py-1"
                  >
                    <option value="ux">ux</option>
                    <option value="uy">uy</option>
                    <option value="mag">mag</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Colormap</label>
                  <select 
                    value={cmap} 
                    onChange={(e) => setCmap(e.target.value)}
                    className="w-full border rounded px-2 py-1"
                  >
                    <option value="default">default</option>
                    <option value="viridis">viridis</option>
                    <option value="plasma">plasma</option>
                    <option value="inferno">inferno</option>
                    <option value="magma">magma</option>
                    <option value="cividis">cividis</option>
                    <option value="jet">jet</option>
                    <option value="gray">gray</option>
                    <option value="bone">bone</option>
                    <option value="copper">copper</option>
                    <option value="pink">pink</option>
                    <option value="spring">spring</option>
                    <option value="summer">summer</option>
                    <option value="autumn">autumn</option>
                    <option value="winter">winter</option>
                    <option value="hot">hot</option>
                    <option value="cool">cool</option>
                    <option value="Wistia">Wistia</option>
                    <option value="twilight">twilight</option>
                    <option value="hsv">hsv</option>
                  </select>
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

              {/* Display result message */}
              {videoResult && (
                <div className={`w-full p-3 mb-3 rounded border ${
                  videoResult.success 
                    ? 'border-green-200 bg-green-50 text-green-700' 
                    : 'border-red-200 bg-red-50 text-red-700'
                } text-sm`}>
                  {videoResult.message}
                </div>
              )}

              <div className="pt-4 flex flex-col gap-2">
                <div className="flex justify-end">
                  <Button 
                    className="bg-soton-blue" 
                    onClick={handleCreateVideo}
                    disabled={creating || !effectiveDir}
                  >
                    {creating ? "Starting..." : "Create Video"}
                  </Button>
                </div>
                <div className="mt-2 text-xs bg-gray-100 p-2 rounded">
                  <div className="font-medium mb-1">Request Parameters:</div>
                  <pre className="overflow-auto">{JSON.stringify(buildParams(), null, 2)}</pre>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}