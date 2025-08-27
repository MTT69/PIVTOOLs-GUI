'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import Hero from '@/components/Hero';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
// import SetupEnvironment from '@/components/setup/SetupEnvironment';
import InstantaneousPIV from '@/components/setup/InstantaneousPIV';
// import EnsemblePIV from '@/components/setup/EnsemblePIV';
import PathsConfig from '@/components/setup/PathsConfig';
import POD from '@/components/setup/POD';
import ImageConfig from '@/components/setup/ImageConfig';
import VectorViewer from '@/components/viewer/VectorViewer';
import ImagePairViewer from '@/components/viewer/ImagePairViewer';
import VideoMaker from '@/components/viewer/VideoMaker';
import Masking from '@/components/setup/Masking';
import Calibration from '@/components/setup/Calibration';

// Initial empty config; will be replaced by backend YAML
const emptyConfig: any = { paths: { base_dir: [], source: [] }, images: {} };

// Force reset localStorage for testing - remove in production
const FORCE_RESET_HERO = true; // Set to false in production

export default function Home() {
  // Don't read localStorage during render — keep server and client markup identical.
  const [seenHero, setSeenHero] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Clear localStorage hero flag if FORCE_RESET_HERO is true
    if (FORCE_RESET_HERO) {
      try {
        localStorage.removeItem('pivtools_seen_hero');
        console.log('Hero state reset for testing');
      } catch (error) {
        console.error('Failed to reset hero state:', error);
      }
    }

    try {
      const v = localStorage.getItem('pivtools_seen_hero');
      // Only set seenHero to true if the value is specifically 'true'
      setSeenHero(v === 'true');
      console.log('Hero visibility check:', { v, seenHero: v === 'true', mounted: true });
    } catch (error) {
      console.error('Error accessing localStorage:', error);
      setSeenHero(false);
    }
    setMounted(true);
  }, []);
  const [config, setConfig] = useState<any>(emptyConfig);
  // Load YAML config from backend once on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/backend/config');
        const json = await res.json();
        if (!cancelled && res.ok) {
          // Map YAML structure to frontend structure, preserving all fields in paths
          const mapped = {
            ...json,
            paths: {
              ...json.paths,
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

  // DEBUG: Log component state on each render
  console.log('Render state:', { mounted, seenHero });

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Only show Navigation when not showing the Hero */}
      {mounted && seenHero && <Navigation />}
      
      { !mounted ? (
        <div className="max-w-7xl mx-auto px-4 pt-24 pb-16" />
      ) : (
        !seenHero ? (
          <Hero onGetStarted={() => { 
            try { 
              localStorage.setItem('pivtools_seen_hero', 'true'); 
              console.log('Hero marked as seen');
            } catch (error) {
              console.error('Error setting localStorage:', error);
            }
            // mark hero seen and switch to the setup tab
            setSeenHero(true);
            setActiveTab('setup');
          }} />
        ) : (
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
                  <TabsTrigger value="pod" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                    POD
                  </TabsTrigger>
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
                  <TabsTrigger value="video" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                    Video
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

                <TabsContent value="pod">
                  <POD config={config} updateConfig={updateConfig} />
                </TabsContent>

                <TabsContent value="results">
                  <VectorViewer config={config} />
                </TabsContent>

                <TabsContent value="viewer">
                  <ImagePairViewer config={config} />
                </TabsContent>

                <TabsContent value="video">
                  <VideoMaker config={config} />
                </TabsContent>

                <TabsContent value="masking">
                  {/* Masking tab content */}
                  <Masking config={config} />
                </TabsContent>

                <TabsContent value="calibration">
                  <Calibration />
                </TabsContent>

              </Tabs>
            </div>
          </div>
        )
      )}
    </main>
  );
}