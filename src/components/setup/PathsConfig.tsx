'use client';

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Folder, Plus, X, CheckCircle, XCircle, Loader2, RefreshCcw } from "lucide-react";
import { useConfigUpdate, usePathValidation } from "@/hooks/useConfigUpdate";

interface PathsConfigProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  setPathValidation?: (validation: { valid: boolean; error?: string; checked: boolean }) => void;
}

export default function PathsConfig({ config, updateConfig, setPathValidation }: PathsConfigProps) {
  const [baseDirs, setBaseDirs] = useState<string[]>([]);
  const [sourceDirs, setSourceDirs] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  // Use custom hooks
  const { updateConfig: updateConfigBackend } = useConfigUpdate();
  const { validationStatus, validationError, validatePaths, resetValidation } = usePathValidation();

  // Debounce timer
  const validationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [lastValidatedConfig, setLastValidatedConfig] = useState<string>('');

  useEffect(() => {
    setBaseDirs(config.paths?.base_paths || []);
    setSourceDirs(config.paths?.source_paths || []);
    setSaveStatus('idle');

    // Auto-resize textareas after content loads
    setTimeout(() => {
      const textareas = document.querySelectorAll('textarea.font-mono');
      textareas.forEach((textarea) => {
        const element = textarea as HTMLTextAreaElement;
        element.style.height = 'auto';
        element.style.height = element.scrollHeight + 'px';
      });
    }, 100);
  }, [config.paths]);

  const sanitizePath = (p: string) => p.replace(/^["']+|["']+$/g, "").trim();

  const runValidation = async () => {
    const sourcePaths = config.paths?.source_paths || [];
    const cameraNumbers = config.paths?.camera_numbers || [1];

    const result = await validatePaths(sourcePaths, cameraNumbers);
    setPathValidation?.(result);
  };

  const postUpdatePaths = async (nextBaseDirs: string[], nextSourceDirs: string[]) => {
    setSaveStatus('saving');
    const payload = {
      paths: {
        base_paths: nextBaseDirs.filter(Boolean).map(sanitizePath),
        source_paths: nextSourceDirs.filter(Boolean).map(sanitizePath),
        camera_numbers: config.paths?.camera_numbers,
      },
    };

    const result = await updateConfigBackend(payload);

    if (result.success && result.data?.updated?.paths) {
      updateConfig(['paths'], { ...config.paths, ...result.data.updated.paths });
      setSaveStatus('success');
      // Note: validation will be triggered automatically by the useEffect
    } else {
      setSaveStatus('error');
    }
  };

  // Auto-validate when relevant config changes
  useEffect(() => {
    // Create a key from all validation-relevant config
    const validationKey = JSON.stringify({
      sourcePaths: config.paths?.source_paths || [],
      cameraNumbers: config.paths?.camera_numbers || [],
      imageFormat: config.images?.image_format,
    });

    // Only validate if config actually changed
    if (validationKey !== lastValidatedConfig) {
      console.log('Validation-relevant config changed in PathsConfig, resetting and re-validating...');

      // Reset validation state immediately on config change
      resetValidation();
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
        console.log('Running debounced validation in PathsConfig...');
        runValidation();
      }, 500); // Reduced debounce time for more responsive feel
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
    lastValidatedConfig,
  ]);

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
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 h-8">
            <SaveStatusIcon />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => runValidation()}
            disabled={validationStatus === 'checking'}
          >
            {validationStatus === 'checking' ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCcw className="h-4 w-4 mr-2" />
                Validate Paths
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Validation Status Alert */}
      {validationStatus === 'valid' && (
        <Alert className="border-green-500 bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-sm text-green-800">
            Directory paths are valid and image files were found successfully!
          </AlertDescription>
        </Alert>
      )}

      {validationStatus === 'invalid' && validationError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Path Validation Failed</AlertTitle>
          <AlertDescription className="text-sm">
            {validationError}
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Source Directories</CardTitle>
            <CardDescription>
              Locations where your raw image sequences are stored. These directories will be searched for image files matching your patterns.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {sourceDirs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Folder className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No source directories configured</p>
                  <p className="text-xs mt-1">Click the button below to add your first source directory</p>
                </div>
              ) : (
                sourceDirs.map((dir, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <div className="flex-1">
                      <Textarea
                        value={dir}
                        onChange={e => {
                          const newSourceDirs = [...sourceDirs];
                          newSourceDirs[index] = e.target.value;
                          setSourceDirs(newSourceDirs);
                        }}
                        onBlur={() => postUpdatePaths(baseDirs, sourceDirs)}
                        placeholder="/path/to/your/raw/images/"
                        className="font-mono min-h-[60px] resize-y"
                        rows={1}
                        style={{
                          height: 'auto',
                          minHeight: '60px',
                        }}
                        onInput={(e) => {
                          const target = e.target as HTMLTextAreaElement;
                          target.style.height = 'auto';
                          target.style.height = target.scrollHeight + 'px';
                        }}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const newSourceDirs = sourceDirs.filter((_, i) => i !== index);
                        setSourceDirs(newSourceDirs);
                        postUpdatePaths(baseDirs, newSourceDirs);
                      }}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 mt-2"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
              <Button
                variant="outline"
                onClick={() => {
                  const newSourceDirs = [...sourceDirs, ""];
                  setSourceDirs(newSourceDirs);
                }}
                className="flex items-center gap-2 w-full hover:bg-soton-blue hover:text-white transition-colors"
              >
                <Plus className="h-4 w-4" /> Add Source Directory
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Output Directories</CardTitle>
            <CardDescription>
              Locations where processed PIV results, vector fields, and analysis outputs will be saved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {baseDirs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Folder className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No output directories configured</p>
                  <p className="text-xs mt-1">Click the button below to add your first output directory</p>
                </div>
              ) : (
                baseDirs.map((dir, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <div className="flex-1">
                      <Textarea
                        value={dir}
                        onChange={e => {
                          const newBaseDirs = [...baseDirs];
                          newBaseDirs[index] = e.target.value;
                          setBaseDirs(newBaseDirs);
                        }}
                        onBlur={() => postUpdatePaths(baseDirs, sourceDirs)}
                        placeholder="/path/to/your/output/results/"
                        className="font-mono min-h-[60px] resize-y"
                        rows={1}
                        style={{
                          height: 'auto',
                          minHeight: '60px',
                        }}
                        onInput={(e) => {
                          const target = e.target as HTMLTextAreaElement;
                          target.style.height = 'auto';
                          target.style.height = target.scrollHeight + 'px';
                        }}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const newBaseDirs = baseDirs.filter((_, i) => i !== index);
                        setBaseDirs(newBaseDirs);
                        postUpdatePaths(newBaseDirs, sourceDirs);
                      }}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 mt-2"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
              <Button
                variant="outline"
                onClick={() => {
                  const newBaseDirs = [...baseDirs, ""];
                  setBaseDirs(newBaseDirs);
                }}
                className="flex items-center gap-2 w-full hover:bg-soton-blue hover:text-white transition-colors"
              >
                <Plus className="h-4 w-4" /> Add Output Directory
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}