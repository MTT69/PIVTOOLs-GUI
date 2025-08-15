'use client';

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Folder, FolderInput, FolderOutput, Plus, X, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PathsConfigProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function PathsConfig({ config, updateConfig }: PathsConfigProps) {
  const [baseDirs, setBaseDirs] = useState<string[]>(config.paths?.base_dir || []);
  const [sourceDirs, setSourceDirs] = useState<string[]>(config.paths?.source || []);
  // Filename patterns
  const imageFormatRaw = (config.images?.image_format);
  const [rawFormats, setRawFormats] = useState<string[]>(() => {
    if (Array.isArray(imageFormatRaw)) return imageFormatRaw as string[];
    if (typeof imageFormatRaw === 'string') return [imageFormatRaw];
    return ['B%05d_A.tif', 'B%05d_B.tif'];
  });
  const [vectorFormat, setVectorFormat] = useState<string>(() => {
    const vf = config.images?.vector_format;
    if (Array.isArray(vf) && vf.length) return vf[0];
    if (typeof vf === 'string') return vf;
    return '%05d.mat';
  });
  const [calibrationFormat, setCalibrationFormat] = useState<string>(() => (
    config.calibration?.image_format || config.images?.calibration_image_format || 'calib%05d.tif'
  ));
  // Hidden directory picker for web fallback
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const pendingCallbackRef = useRef<((p: string) => void) | null>(null);
  // Debounce timer for autosave
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    updateConfig(['paths', 'base_dir'], baseDirs);
  }, [baseDirs, updateConfig]);

  useEffect(() => {
    updateConfig(['paths', 'source'], sourceDirs);
  }, [sourceDirs, updateConfig]);

  // Reflect format changes into parent config state
  useEffect(() => {
    // raw image formats
    updateConfig(['images', 'image_format'], rawFormats);
  }, [rawFormats, updateConfig]);
  useEffect(() => {
    updateConfig(['images', 'vector_format'], [vectorFormat]);
  }, [vectorFormat, updateConfig]);
  useEffect(() => {
    updateConfig(['calibration', 'image_format'], calibrationFormat);
  }, [calibrationFormat, updateConfig]);

  // Add a new base directory
  const addBaseDir = () => {
    setBaseDirs([...baseDirs, '']);
  };

  // Remove a base directory
  const removeBaseDir = (index: number) => {
    const newBaseDirs = [...baseDirs];
    newBaseDirs.splice(index, 1);
    setBaseDirs(newBaseDirs);
  };

  // Update a base directory
  const updateBaseDir = (index: number, value: string) => {
    const newBaseDirs = [...baseDirs];
    newBaseDirs[index] = value;
    setBaseDirs(newBaseDirs);
  };

  // Add a new source directory
  const addSourceDir = () => {
    setSourceDirs([...sourceDirs, '']);
  };

  // Remove a source directory
  const removeSourceDir = (index: number) => {
    const newSourceDirs = [...sourceDirs];
    newSourceDirs.splice(index, 1);
    setSourceDirs(newSourceDirs);
  };

  // Update a source directory
  const updateSourceDir = (index: number, value: string) => {
    const newSourceDirs = [...sourceDirs];
    newSourceDirs[index] = value;
    setSourceDirs(newSourceDirs);
  };

  // Folder picker: prefer Tauri dialog if present, else webkitdirectory fallback
  const selectFolder = async (callback: (path: string) => void) => {
    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.dialog?.open) {
        const selected = await tauri.dialog.open({ directory: true, multiple: false });
        if (typeof selected === "string") callback(selected);
        return;
      }
      // Optional: File System Access API (no absolute path; will fallback to prompt)
      if ((window as any).showDirectoryPicker) {
        try {
          await (window as any).showDirectoryPicker();
          // No absolute path available in browsers; will ask user to paste below
        } catch {
          // user canceled
          return;
        }
      }
    } catch {
      // ignore and fallback
    }
    // Fallback via hidden input[webkitdirectory]
    pendingCallbackRef.current = callback;
    dirInputRef.current?.click();
  };

  const onDirPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const anyFile: any = files[0];
    const rel: string = anyFile?.webkitRelativePath || "";
    const root = rel.split("/")[0] || "";
    let folderPath: string | null = null;

    // Try to reconstruct absolute path if available (Electron/Tauri/Firefox)
    if (anyFile?.path && rel) {
      const abs = String(anyFile.path); // absolute to the file
      folderPath = abs.substring(0, abs.length - rel.length) + root;
    } else if (anyFile?.mozFullPath && rel) {
      const abs = String(anyFile.mozFullPath);
      folderPath = abs.substring(0, abs.length - rel.length) + root;
    }

    // Validate we really have an absolute-like path
    const looksAbsolute = (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
    if (!folderPath || !looksAbsolute(folderPath)) {
      // Ask user to paste the absolute path to avoid saving only the last segment
      const manual = window.prompt("Your browser cannot provide the full folder path. Please paste the absolute path:", root);
      if (manual && looksAbsolute(manual)) {
        folderPath = manual;
      } else {
        // User canceled or invalid; do not change the field to a truncated value
        e.currentTarget.value = "";
        pendingCallbackRef.current = null;
        return;
      }
    }

    pendingCallbackRef.current?.(folderPath);
    pendingCallbackRef.current = null;
    e.currentTarget.value = "";
  };

  // Utility: sanitize a path (remove leading/trailing quotes, whitespace only)
  function sanitizePath(p: string) {
    return p
      .replace(/^["']+|["']+$/g, "") // remove leading/trailing quotes
      .trim();
  }

  // POST updated paths to backend (debounced)
  async function postUpdatePaths() {
    const payload = {
      base_paths: baseDirs.filter(Boolean).map(sanitizePath),
      source_paths: sourceDirs.filter(Boolean).map(sanitizePath),
      image_format: rawFormats.length === 1 ? rawFormats[0] : rawFormats,
      vector_format: vectorFormat,
      calibration_image_format: calibrationFormat,
    };
    try {
      const res = await fetch("/backend/update_paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");
      // Mirror to localStorage for viewers
      localStorage.setItem("piv_base_paths", JSON.stringify(json.base_paths));
      localStorage.setItem("piv_source_paths", JSON.stringify(json.source_paths));
      localStorage.setItem("piv_image_format", JSON.stringify(json.image_format));
      localStorage.setItem("piv_vector_format", JSON.stringify(json.vector_format));
      localStorage.setItem("piv_calibration_image_format", JSON.stringify(json.calibration_image_format));
      // eslint-disable-next-line no-console
      console.log("Path configuration updated");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Auto-saving path configuration failed", err);
    }
  }

  // Debounce autosave on any change
  useEffect(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      postUpdatePaths();
      saveTimerRef.current = null;
    }, 400) as unknown as number;

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [baseDirs, sourceDirs, rawFormats, vectorFormat, calibrationFormat]);

  return (
    <div className="space-y-6">
      {/* Hidden input for web directory selection */}
      {/* If using Tauri/Electron, add folder picker button here for each directory field */}
      {/* @ts-ignore */}
      <input
        ref={dirInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={onDirPicked}
        multiple
        // @ts-ignore - non-standard attributes for Chrome/Edge
        webkitdirectory="true"
        // @ts-ignore
        directory="true"
      />
      <div className="flex items-center space-x-2 mb-6">
        <Folder className="h-6 w-6 text-soton-blue" />
        <h2 className="text-2xl font-bold text-gray-800">Directories Configuration</h2>
      </div>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FolderOutput className="h-5 w-5 text-soton-blue" />
              <CardTitle>Output Directories</CardTitle>
            </div>
            <CardDescription>
              Locations where PIV results will be saved
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {baseDirs.map((dir, index) => {
                // Path hint logic
                const looksAbsolute = (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
                const showHint = dir && !looksAbsolute(dir);
                return (
                  <div key={index} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Input
                        value={dir}
                        onChange={(e) => {
                          // Only trim whitespace and quotes
                          const val = sanitizePath(e.target.value);
                          const newBaseDirs = [...baseDirs];
                          newBaseDirs[index] = val;
                          setBaseDirs(newBaseDirs);
                        }}
                        placeholder="/your/output/path/"
                        className="font-mono"
                        onFocus={e => {
                          // Optionally select all text on focus for easier editing
                          e.target.select();
                        }}
                      />
                      {/* If using Tauri/Electron, add a browse button here */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          const newBaseDirs = [...baseDirs];
                          newBaseDirs.splice(index, 1);
                          setBaseDirs(newBaseDirs);
                        }}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {showHint && (
                      <span className="text-xs text-yellow-700 bg-yellow-50 rounded px-2 py-0.5 mt-0.5">
                        Path should start with <span className="font-mono">/</span> or a drive letter (e.g. <span className="font-mono">C:/</span>)
                      </span>
                    )}
                  </div>
                );
              })}

              <Button
                variant="outline"
                onClick={() => setBaseDirs([...baseDirs, ""])}
                className="flex items-center gap-2 w-full"
              >
                <Plus className="h-4 w-4" />
                Add Output Directory
              </Button>
            </div>
            {/* Example output directory tree */}
            <div className="mt-6">
              <div className="font-semibold mb-1">How output folders are auto-created and used:</div>
              <div className="text-xs text-muted-foreground mb-2">
                After you set your base output directory, the following subfolders are automatically created and read from by the backend:
              </div>
              <pre className="bg-gray-50 rounded p-2 text-xs overflow-x-auto">
{`
base_dir/
├── calibrated_piv/
│   └── {num_images}/
│       └── {cam_folder}/
│           └── {type_name}/
│               └── [endpoint]/
├── statistics/
│   └── {num_images}/
│       └── {cam_folder}/
│           └── {type_name}/
│               └── [endpoint]/
├── videos/
│   └── {num_images}/
│       └── {cam_folder}/
│           └── [endpoint]/
`}
              </pre>
              <div className="text-xs text-muted-foreground mt-1">
                <span className="font-mono">base_dir</span> is your output directory.<br />
                <span className="font-mono">{`{num_images}`}</span>: number of images in sequence<br />
                <span className="font-mono">{`{cam_folder}`}</span>: e.g. Cam1, Cam2<br />
                <span className="font-mono">{`{type_name}`}</span>: e.g. piv, mask, etc.<br />
                <span className="font-mono">{`[endpoint]`}</span>: optional subfolder
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FolderInput className="h-5 w-5 text-soton-blue" />
              <CardTitle>Source Directories</CardTitle>
            </div>
            <CardDescription>
              Locations of raw image sequences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {sourceDirs.map((dir, index) => {
                const looksAbsolute = (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
                const showHint = dir && !looksAbsolute(dir);
                return (
                  <div key={index} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Input
                        value={dir}
                        onChange={(e) => {
                          const val = sanitizePath(e.target.value);
                          const newSourceDirs = [...sourceDirs];
                          newSourceDirs[index] = val;
                          setSourceDirs(newSourceDirs);
                        }}
                        placeholder="/your/source/path/"
                        className="font-mono"
                        onFocus={e => e.target.select()}
                      />
                      {/* If using Tauri/Electron, add a browse button here */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          const newSourceDirs = [...sourceDirs];
                          newSourceDirs.splice(index, 1);
                          setSourceDirs(newSourceDirs);
                        }}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {showHint && (
                      <span className="text-xs text-yellow-700 bg-yellow-50 rounded px-2 py-0.5 mt-0.5">
                        Path should start with <span className="font-mono">/</span> or a drive letter (e.g. <span className="font-mono">C:/</span>)
                      </span>
                    )}
                  </div>
                );
              })}

              <Button
                variant="outline"
                onClick={() => setSourceDirs([...sourceDirs, ""])}
                className="flex items-center gap-2 w-full"
              >
                <Plus className="h-4 w-4" />
                Add Source Directory
              </Button>
            </div>
            {/* Example source directory tree */}
            <div className="mt-6">
              <div className="font-semibold mb-1">How source folders are auto-read:</div>
              <div className="text-xs text-muted-foreground mb-2">
                After you set your source directory, the backend will automatically look for the following structure:
              </div>
              <pre className="bg-gray-50 rounded p-2 text-xs overflow-x-auto">
{`
source_dir/
├── Cam1/
│   └── image_0001.tif
│   └── image_0002.tif
│   └── ...
├── Cam2/
│   └── image_0001.tif
│   └── image_0002.tif
│   └── ...
`}
              </pre>
              <div className="text-xs text-muted-foreground mt-1">
                <span className="font-mono">source_dir</span> should contain <span className="font-mono">Cam1</span>, <span className="font-mono">Cam2</span> folders with raw images.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
  <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-soton-blue" />
            <CardTitle>Directory Guidelines</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Alert className="bg-blue-50 border border-blue-200">
            <div className="flex gap-2">
              <Info className="h-4 w-4 text-blue-500 mt-0.5" />
              <AlertDescription>
                <ul className="list-disc pl-4 space-y-1 text-sm">
                  <li>Source directories should contain raw image sequences in "Cam1", "Cam2" subfolders</li>
                  <li>Output directories will store all PIV results, including vector fields and statistics</li>
                  <li>For best results, use absolute paths rather than relative paths</li>
                  <li>For Windows paths, use double backslashes (\\) or forward slashes (/)</li>
                </ul>
              </AlertDescription>
            </div>
          </Alert>
          <p className="text-xs text-muted-foreground mt-3">
            Changes are saved automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
