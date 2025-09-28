'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Folder, Plus, X, CheckCircle, XCircle, Loader2 } from "lucide-react";

interface PathsConfigProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function PathsConfig({ config, updateConfig }: PathsConfigProps) {
  const [baseDirs, setBaseDirs] = useState<string[]>([]);
  const [sourceDirs, setSourceDirs] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  useEffect(() => {
    setBaseDirs(config.paths?.base_paths || []);
    setSourceDirs(config.paths?.source_paths || []);
    setSaveStatus('idle');
  }, [config.paths]);

  const sanitizePath = (p: string) => p.replace(/^["']+|["']+$/g, "").trim();

  const postUpdatePaths = async (nextBaseDirs: string[], nextSourceDirs: string[]) => {
    setSaveStatus('saving');
    const payload = {
      paths: {
        base_paths: nextBaseDirs.filter(Boolean).map(sanitizePath),
        source_paths: nextSourceDirs.filter(Boolean).map(sanitizePath),
        camera_numbers: config.paths?.camera_numbers,
      },
    };
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save paths");
      if (json.updated?.paths) {
        updateConfig(['paths'], { ...config.paths, ...json.updated.paths });
        // Remove localStorage updates
        // localStorage.setItem("piv_source_paths", JSON.stringify(json.updated.paths.source_paths || []));
        // localStorage.setItem("piv_base_paths", JSON.stringify(json.updated.paths.base_paths || []));
      }
      setSaveStatus('success');
    } catch (err) {
      setSaveStatus('error');
    }
  };

  const SaveStatusIcon = () => {
    if (saveStatus === 'saving') return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (saveStatus === 'success') return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (saveStatus === 'error') return <XCircle className="h-4 w-4 text-red-500" />;
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
            <Folder className="h-6 w-6 text-soton-blue" />
            <h2 className="text-2xl font-bold text-gray-800">Directories Configuration</h2>
        </div>
        <div className="flex items-center gap-2 h-8">
            <SaveStatusIcon />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Output Directories</CardTitle>
            <CardDescription>Locations for saved results</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {baseDirs.map((dir, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={dir}
                      onChange={e => {
                        const newBaseDirs = [...baseDirs];
                        newBaseDirs[index] = e.target.value;
                        setBaseDirs(newBaseDirs);
                      }}
                      onBlur={() => postUpdatePaths(baseDirs, sourceDirs)}
                      placeholder="/your/output/path/"
                      className="font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const newBaseDirs = baseDirs.filter((_, i) => i !== index);
                        setBaseDirs(newBaseDirs);
                        postUpdatePaths(newBaseDirs, sourceDirs);
                      }}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
              ))}
              <Button variant="outline" onClick={() => {
                const newBaseDirs = [...baseDirs, ""];
                setBaseDirs(newBaseDirs);
              }} className="flex items-center gap-2 w-full">
                <Plus className="h-4 w-4" /> Add Output Directory
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Source Directories</CardTitle>
            <CardDescription>Locations of raw image sequences</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {sourceDirs.map((dir, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={dir}
                      onChange={e => {
                        const newSourceDirs = [...sourceDirs];
                        newSourceDirs[index] = e.target.value;
                        setSourceDirs(newSourceDirs);
                      }}
                      onBlur={() => postUpdatePaths(baseDirs, sourceDirs)}
                      placeholder="/your/source/path/"
                      className="font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const newSourceDirs = sourceDirs.filter((_, i) => i !== index);
                        setSourceDirs(newSourceDirs);
                        postUpdatePaths(baseDirs, newSourceDirs);
                      }}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
              ))}
              <Button variant="outline" onClick={() => {
                const newSourceDirs = [...sourceDirs, ""];
                setSourceDirs(newSourceDirs);
              }} className="flex items-center gap-2 w-full">
                <Plus className="h-4 w-4" /> Add Source Directory
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}