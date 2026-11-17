'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Folder, Plus, X, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { mergeUpdatedSections, useConfigUpdate, ValidationState, applySetupSuggestion, entryLabel } from "@/hooks/useConfigUpdate";
import { DiagnosisEntry } from "@/lib/sourceDiagnosis";
import { sanitizePath } from "@/lib/sourcePath";
import { ValidationAlert } from "./ValidationAlert";
import { SourceDiagnosis } from "./SourceDiagnosis";
import { ValidationDetails } from "./ValidationDetails";
import { RunImport } from "./RunImport";

interface PathsConfigProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  validation: ValidationState;
  /** Re-read the whole config from the backend (after a run import rewrites it). */
  reloadConfig: () => Promise<void>;
}

export default function PathsConfig({ config, updateConfig, validation, reloadConfig }: PathsConfigProps) {
  const [baseDirs, setBaseDirs] = useState<string[]>([]);
  const [sourceDirs, setSourceDirs] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  const { updateConfig: updateConfigBackend } = useConfigUpdate();

  useEffect(() => {
    setBaseDirs(config.paths?.base_paths || []);
    setSourceDirs(config.paths?.source_paths || []);
    setSaveStatus('idle');
  }, [config.paths]);

  // Diagnosis entries per source, memoized on the validation state: SourceDiagnosis
  // clears a shown apply error whenever the `entries` identity changes.
  const diagnosisBySource = useMemo(
    () => validation.sources.map((s): { sourcePath: string; entries: DiagnosisEntry[] } => ({
      sourcePath: s.sourcePath,
      entries: s.cameras.map((c) => ({
        label: entryLabel(1, s.sourceIdx, c.camera),
        found: c.found,
        suggestions: c.suggestions,
        streams: c.streams,
        warnings: c.warnings,
      })),
    })),
    [validation.sources],
  );

  const postUpdatePaths = async (nextBaseDirs: string[], nextSourceDirs: string[]) => {
    setSaveStatus('saving');
    const payload = {
      paths: {
        base_paths: nextBaseDirs.filter(Boolean).map(sanitizePath),
        source_paths: nextSourceDirs.filter(Boolean).map(sanitizePath),
      },
    };

    const result = await updateConfigBackend(payload);

    if (result.success && result.data?.updated?.paths) {
      // A source change re-pairs the run: the response's images carry the new pair status.
      mergeUpdatedSections(result.data.updated, config, updateConfig);
      setSaveStatus('success');
    } else {
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

      {/* Validation Status */}
      <ValidationAlert validation={validation} />
      <ValidationDetails validation={validation} />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{config.images?.image_type === "lavision_set" ? "Source Files" : "Source Directories"}</CardTitle>
            <CardDescription>
              {config.images?.image_type === "lavision_set" ? (
                <>Point at the .set file (not its folder). Its data lives in the folder of the same name next to it.</>
              ) : (
                <>Locations where your raw image sequences are stored. These directories will be searched for image files matching your patterns.</>
              )}
              {config.images?.image_type === "pivraw" && (
                <> For a PIVTOOLs acquisition run, the source is the run folder (it holds Camera1.pivraw and run.yaml).</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {sourceDirs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Folder className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No source {config.images?.image_type === "lavision_set" ? "files" : "directories"} configured</p>
                  <p className="text-xs mt-1">Click the button below to add your first source {config.images?.image_type === "lavision_set" ? "file" : "directory"}</p>
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
                        placeholder={config.images?.image_type === "lavision_set" ? "/path/to/your/data.set" : "/path/to/your/raw/images/"}
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
                      {config.images?.image_type === "lavision_set" && /\.set$/i.test(sanitizePath(dir)) && (() => {
                        const base = sanitizePath(dir).replace(/\.set$/i, '');
                        const validated = diagnosisBySource[index]?.sourcePath === sanitizePath(dir);
                        const dataFound = validated && diagnosisBySource[index].entries.some(e => e.streams !== null);
                        return (
                          <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                            <p>
                              Data folder: <code className="bg-muted px-1">{base}/</code>
                              {validated && (dataFound
                                ? <span className="ml-2 text-green-600">✓ found</span>
                                : <span className="ml-2 text-red-600">✗ missing</span>)}
                            </p>
                            <p>Masks saved in: <code className="bg-muted px-1">{base}_data/</code></p>
                          </div>
                        );
                      })()}
                      {diagnosisBySource[index]?.sourcePath === sanitizePath(dir) && (
                        <SourceDiagnosis
                          entries={diagnosisBySource[index].entries}
                          onApply={a => applySetupSuggestion(a, { config, sourcePathIdx: index, updateConfig })}
                          busy={!validation.checked}
                        />
                      )}
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
                <Plus className="h-4 w-4" /> Add Source {config.images?.image_type === "lavision_set" ? "File" : "Directory"}
              </Button>
              <RunImport reloadConfig={reloadConfig} />
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