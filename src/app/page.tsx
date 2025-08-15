'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
// import SetupEnvironment from '@/components/setup/SetupEnvironment';
import InstantaneousPIV from '@/components/setup/InstantaneousPIV';
// import EnsemblePIV from '@/components/setup/EnsemblePIV';
import PathsConfig from '@/components/setup/PathsConfig';
import ImageConfig from '@/components/setup/ImageConfig';
import VectorViewer from '@/components/viewer/VectorViewer';
import { Download, Play, Save, Image as ImageIcon } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import ImagePairViewer from '@/components/viewer/ImagePairViewer';
import Masking from '@/components/setup/Masking';
import Calibration from '@/components/setup/Calibration';

// Initial empty config; will be replaced by backend YAML
const emptyConfig: any = { paths: { base_dir: [], source: [] }, images: {} };

export default function Home() {
  const [config, setConfig] = useState<any>(emptyConfig);
  // Load YAML config from backend once on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/backend/config');
        const json = await res.json();
        if (!cancelled && res.ok) {
          // Map YAML structure to frontend structure minimally
          const mapped = {
            ...json,
            paths: {
              base_dir: json.paths?.base_paths || [],
              source: json.paths?.source_paths || [],
            },
          };
            setConfig(mapped);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load backend config', e);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);
  const [activeTab, setActiveTab] = useState("environment");
  const { toast } = useToast();

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

  // Function to export configuration as JSON
  const exportConfig = () => {
    const dataStr = JSON.stringify(config, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'pivtools-config.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    toast({
      title: "Configuration Exported",
      description: "Your PIVTOOLS configuration has been exported successfully.",
      duration: 3000,
    });
  };

  // Function to save configuration
  const saveConfig = () => {
    // In a real app, this would save the config to local storage or the filesystem
    localStorage.setItem('pivtools-config', JSON.stringify(config));
    toast({
      title: "Configuration Saved",
      description: "Your configuration has been saved successfully.",
      duration: 3000,
    });
  };

  // Function to run MATLAB with the current configuration
  const runMatlab = () => {
    // In a real app, this would trigger the MATLAB execution
    toast({
      title: "Running MATLAB",
      description: "PIVTOOLS is now processing with your configuration...",
      duration: 5000,
    });
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 pt-24 pb-16">
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h1 className="text-3xl font-bold text-soton-blue mb-2">PIVTOOLS Configuration</h1>
          <p className="text-gray-600 mb-6">
            Configure your PIV processing pipeline with this intuitive interface. Changes are applied automatically.
          </p>
          
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid grid-cols-12 mb-6">
              {/* Environment tab removed */}
              <TabsTrigger value="setup" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Setup
              </TabsTrigger>
              {/* <TabsTrigger value="pipeline" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Pipeline
              </TabsTrigger> */}
              <TabsTrigger value="instantaneous" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                PIV
              </TabsTrigger>
              {/* <TabsTrigger value="ensemble" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Ensemble
              </TabsTrigger> */}
              {/* <TabsTrigger value="filters" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Filters
              </TabsTrigger> */}
              {/* <TabsTrigger value="paths" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Paths
              </TabsTrigger> */}
              {/* <TabsTrigger value="runPIV" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Run PIV
              </TabsTrigger> */}
              <TabsTrigger value="results" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Results
              </TabsTrigger>
              <TabsTrigger value="viewer" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Viewer
              </TabsTrigger>
              <TabsTrigger value="masking" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Masking
              </TabsTrigger>
              <TabsTrigger value="calibration" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Calibration
              </TabsTrigger>
            </TabsList>
            
            {/* Environment tab content removed */}
            
            <TabsContent value="setup">
              {/* Combined Setup tab: ImageProperties and PathsConfig merged, batch size removed, image config and dimensions horizontal above paths */}
              <div className="space-y-6">
                <ImageConfig config={config} updateConfig={updateConfig} />
                {/* PathsConfig below image config/dimensions, backend logic retained */}
                <div>
                  {/* Inline PathsConfig logic here, backend logic retained */}
                  {/* ...existing PathsConfig code, using config and updateConfig... */}
                  <PathsConfig config={config} updateConfig={updateConfig} />
                </div>
              </div>
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
                {/* RunPIV section with dummy Test button */}
                <div className="mt-4">
                  <div className="flex flex-col gap-4">
                    <Button className="w-fit bg-soton-gold text-soton-darkblue hover:bg-yellow-400" onClick={() => alert('Test run (dummy): Processing a temporal length of images...')}>
                      Test (Temporal Length)
                    </Button>
                  </div>
                </div>
                {/* Window Size Selection Guidelines below RunPIV */}
                <div className="mt-4">
                  <div className="bg-white rounded-xl shadow p-6">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-block"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-soton-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="7" height="7" strokeWidth="2"/><rect x="14" y="3" width="7" height="7" strokeWidth="2"/><rect x="3" y="14" width="7" height="7" strokeWidth="2"/><rect x="14" y="14" width="7" height="7" strokeWidth="2"/></svg></span>
                      <span className="text-xl font-semibold">Window Size Selection Guidelines</span>
                    </div>
                    <div className="text-gray-600 mb-4">Best practices for configuring correlation windows</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h3 className="text-lg font-medium mb-2">Window Size Recommendations</h3>
                        <ul className="space-y-1 text-sm list-disc pl-5">
                          <li>Start with larger windows (128x128, 64x64) and progressively refine</li>
                          <li>For final pass, aim for 16x16 or 32x32 depending on particle density</li>
                          <li>Window size should contain at least 5-10 particles for good correlation</li>
                          <li>Keep window sizes as powers of 2 for optimal FFT performance</li>
                        </ul>
                      </div>
                      <div>
                        <h3 className="text-lg font-medium mb-2">Overlap Settings</h3>
                        <ul className="space-y-1 text-sm list-disc pl-5">
                          <li>50% overlap is standard and provides good vector density</li>
                          <li>Higher overlap (75%) increases spatial resolution but not information content</li>
                          <li>Lower overlap (25%) reduces computation time but may miss flow features</li>
                          <li>Consistent overlap between passes maintains stable refinement</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
            
            {/* <TabsContent value="ensemble">
              <EnsemblePIV config={config} updateConfig={updateConfig} />
            </TabsContent> */}

            <TabsContent value="results">
              <VectorViewer />
            </TabsContent>

            <TabsContent value="viewer">
              <ImagePairViewer />
            </TabsContent>

            <TabsContent value="masking">
              {/* Masking tab content */}
              <Masking />
            </TabsContent>

            <TabsContent value="calibration">
              <Calibration />
            </TabsContent>

          </Tabs>
        </div>
        
        <div className="flex justify-between">
          <div className="space-x-4">
            <Button 
              className="bg-soton-blue hover:bg-soton-darkblue"
              onClick={saveConfig}
            >
              <Save className="mr-2 h-4 w-4" />
              Save Configuration
            </Button>
            <Button 
              className="bg-soton-gold text-soton-darkblue hover:bg-yellow-400"
              onClick={exportConfig}
            >
              <Download className="mr-2 h-4 w-4" />
              Export JSON
            </Button>
          </div>
          <Button 
            className="bg-green-600 hover:bg-green-700"
            onClick={runMatlab}
          >
            <Play className="mr-2 h-4 w-4" />
            Run PIVTOOLS
          </Button>
        </div>
      </div>
    </main>
  );
}
