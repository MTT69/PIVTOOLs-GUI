'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import InstantaneousPIV from '@/components/setup/InstantaneousPIV';
import EnsemblePIV from '@/components/setup/EnsemblePIV';
import PathsConfig from '@/components/setup/PathsConfig';
import POD from '@/components/setup/POD';
import ImagePairViewer from '@/components/viewer/ImagePairViewer';
import RunPIV from '@/components/setup/RunPIV';
import ImageConfig from '@/components/setup/ImageConfig';
import VectorViewer from '@/components/viewer/VectorViewer';
import VideoMaker from '@/components/viewer/VideoMaker';
import Masking from '@/components/setup/Masking';
import { Calibration } from '@/components/setup/Calibration';
import { useAutoValidation, useConfigUpdate } from '@/hooks/useConfigUpdate';
import { PivJobProvider } from '@/contexts/PivJobContext';

// Initial empty config; will be replaced by backend YAML
const emptyConfig: any = { paths: { base_dir: [], source: [] }, images: {} };

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState<any>(emptyConfig);
  const [configError, setConfigError] = useState<string | null>(null);
  const [showValidationWarning, setShowValidationWarning] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);

  // Auto-validate when config changes
  const pathValidation = useAutoValidation(config);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch config from backend and update state
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/backend/config');
      if (!res.ok) {
        setConfigError('Cannot connect to backend server. Please ensure the server is running.');
        return;
      }
      const json = await res.json();
      const mapped = {
        ...json,
        paths: {
          base_paths: json.paths?.base_paths || [],
          source_paths: json.paths?.source_paths || [],
          camera_numbers: json.paths?.camera_numbers || [],
          camera_count: json.paths?.camera_count,
          camera_subfolders: json.paths?.camera_subfolders || [],
        },
        images: json.images || {},
        batches: json.batches || {},
        processing: json.processing || {},
        post_processing: json.post_processing || [],
        plots: json.plots || {},
        videos: json.videos || [],
        statistics_extraction: json.statistics_extraction ?? null,
        instantaneous_piv: json.instantaneous_piv || {},
        ensemble_piv: json.ensemble_piv || {},
        calibration_format: json.calibration_format || {},
        calibration: json.calibration || {},
        filters: json.filters || [],
      };
      setConfig(mapped);
      setConfigError(null);
    } catch (e) {
      setConfigError('Cannot connect to backend server. Please ensure the server is running.');
    }
  }, []);

  // Load config on mount
  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);
  const [activeTab, setActiveTab] = useState("setup");

  // Hook for updating backend config
  const { updateConfig: updateConfigBackend } = useConfigUpdate();

  // Function to update config state (memoized to avoid infinite effect loops in children)
  const updateConfig = useCallback((path: string[], value: any) => {
    if (!Array.isArray(path) || path.length === 0) return;
    setConfig((prevConfig: any) => {
      const newConfig = JSON.parse(JSON.stringify(prevConfig || {}));
      let current: any = newConfig;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') {
          current[key] = {};
        }
        current = current[key];
      }
      current[path[path.length - 1]] = value;
      return newConfig;
    });
  }, []);

  // Handle tab change with validation check and auto-toggle processing mode
  const handleTabChange = useCallback(async (newTab: string) => {
    // If leaving setup tab and validation has been checked but failed, show warning
    if (activeTab === 'setup' && newTab !== 'setup' && pathValidation.checked && !pathValidation.valid) {
      setPendingTab(newTab);
      setShowValidationWarning(true);
      return;
    }

    // Auto-toggle processing mode when switching between PIV and Ensemble tabs
    if (newTab === 'instantaneous' || newTab === 'ensemble') {
      const isEnsemble = newTab === 'ensemble';
      const processingUpdate = {
        processing: {
          instantaneous: !isEnsemble,
          ensemble: isEnsemble
        }
      };

      // Update backend
      try {
        await updateConfigBackend(processingUpdate);
        // Update local state
        updateConfig(['processing', 'instantaneous'], !isEnsemble);
        updateConfig(['processing', 'ensemble'], isEnsemble);
      } catch (e) {
        console.error('Failed to update processing mode:', e);
      }
    }

    setActiveTab(newTab);
  }, [activeTab, pathValidation, updateConfigBackend, updateConfig]);

  // Confirm navigation despite validation errors
  const confirmNavigationWithErrors = useCallback(() => {
    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
    setShowValidationWarning(false);
  }, [pendingTab]);

  // Cancel navigation
  const cancelNavigation = useCallback(() => {
    setPendingTab(null);
    setShowValidationWarning(false);
  }, []);

  return (
    <main className="min-h-screen bg-gray-50">
      {mounted && <Navigation />}

      { !mounted ? (
        <div className="max-w-7xl mx-auto px-4 pt-24 pb-16" />
      ) : configError ? (
          <div className="max-w-2xl mx-auto px-4 pt-24 pb-16">
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-6 rounded-xl shadow-lg">
              <h2 className="text-2xl font-bold mb-2">Backend Server Not Detected</h2>
              <p>{configError}</p>
              <p className="mt-2 text-gray-700">The frontend cannot run without the backend server. Please start the backend and reload this page.</p>
            </div>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto px-4 pt-24 pb-16">
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h1 className="text-3xl font-bold text-soton-blue mb-2">PIVTOOLS Configuration</h1>
              <p className="text-gray-600 mb-6">
                Configure your PIV processing pipeline with this intuitive interface. Changes are applied automatically.
              </p>
              
              <PivJobProvider config={config} activeTab={activeTab}>
              <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="grid grid-cols-7 mb-6">
                  <TabsTrigger value="setup" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                    Setup
                  </TabsTrigger>
                  <TabsTrigger value="masking" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                    Masking
                  </TabsTrigger>
                  <TabsTrigger value="instantaneous" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                    PIV
                  </TabsTrigger>
                  <TabsTrigger value="ensemble" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                    Ensemble
                  </TabsTrigger>
                  <TabsTrigger value="calibration" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                    Calibration
                  </TabsTrigger>
                  <TabsTrigger value="results" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                    Results
                  </TabsTrigger>
                  <TabsTrigger value="video" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                    Video
                  </TabsTrigger>
                </TabsList>
                
                {/* Environment tab content removed */}
                
                <TabsContent value="setup">
                  <div className="space-y-6">
                    {/* Core Image Properties */}
                    <ImageConfig
                      config={config}
                      updateConfig={updateConfig}
                      validation={pathValidation}
                      sectionsToShow={['core']}
                    />

                    {/* Directories Configuration - shown before patterns */}
                    <PathsConfig
                      config={config}
                      updateConfig={updateConfig}
                      validation={pathValidation}
                    />

                    {/* Filename Patterns */}
                    <ImageConfig
                      config={config}
                      updateConfig={updateConfig}
                      validation={pathValidation}
                      sectionsToShow={['patterns']}
                    />
                  </div>
                </TabsContent>
                
                <TabsContent value="masking">
                  {/* Masking tab content */}
                  <Masking config={config} updateConfig={updateConfig} />
                </TabsContent>
                {/*
                <TabsContent value="pipeline">
                  <PipelineConfig config={config} updateConfig={updateConfig} />
                </TabsContent>
                */}
                
                <TabsContent value="instantaneous">
                  <div className="space-y-6">
                    {/* InstantaneousPIV section */}
                    <div>
                      <InstantaneousPIV config={config} updateConfig={updateConfig} />
                    </div>
                    
                  </div>
                </TabsContent>
                
                <TabsContent value="calibration">
                  <Calibration config={config} updateConfig={updateConfig} refetchConfig={fetchConfig} />
                </TabsContent>

                <TabsContent value="ensemble">
                  <EnsemblePIV config={config} updateConfig={updateConfig} />
                </TabsContent>

                <TabsContent value="pod">
                  <POD config={config} updateConfig={updateConfig} />
                </TabsContent>

                <TabsContent value="results">
                  <VectorViewer config={config} />
                </TabsContent>

                {/* <TabsContent value="viewer">
                  <ImagePairViewer config={config} />
                </TabsContent> */}

                <TabsContent value="video">
                  <VideoMaker config={config} />
                </TabsContent>

              </Tabs>
              </PivJobProvider>
            </div>
          </div>
        )}

      {/* Validation warning dialog */}
      <AlertDialog open={showValidationWarning} onOpenChange={setShowValidationWarning}>
        <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Image Path Validation Failed</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>The configured image paths and patterns could not be validated.</p>
              {pathValidation.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-800 font-mono break-words">
                    {pathValidation.error}
                  </p>
                </div>
              )}
              <p className="text-sm">
                Do you want to continue anyway? It's recommended to fix the path configuration before proceeding.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel onClick={cancelNavigation} className="m-0">
              Stay and Fix Configuration
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmNavigationWithErrors}>
              Continue Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}