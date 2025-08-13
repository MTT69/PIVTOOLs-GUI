'use client';

import { useState, useEffect } from 'react';
import Navigation from '@/components/Navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import SetupEnvironment from '@/components/setup/SetupEnvironment';
import ImageProperties from '@/components/setup/ImageProperties';
import PipelineConfig from '@/components/setup/PipelineConfig';
import InstantaneousPIV from '@/components/setup/InstantaneousPIV';
import EnsemblePIV from '@/components/setup/EnsemblePIV';
import FilterManagement from '@/components/setup/FilterManagement';
import PathsConfig from '@/components/setup/PathsConfig';
import { Download, Play, Save, Image as ImageIcon } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import ImagePairViewer from '@/components/viewer/ImagePairViewer';

// Default configuration
const defaultConfig = {
  "setup": {
    "environment": {
      "local": true,
      "numTasks": 6,
      "restartParpool": true,
      "imageLoadCores": 6,
      "maxCores": 6
    },
    "imProperties": {
      "imageCount": 1000,
      "batchSize": 1000,
      "parforbatch": 25,
      "imageSize": [1024, 1024],
      "imageType": "im",
      "reader": "matlab",
      "timeResolved": false,
      "cameraCount": 1,
      "combineRuns": false,
      "caseImages": 1000,
      "scaleFactor": 3.416666667,
      "yOffset": -150,
      "xOffset": 0,
      "dt": 0.0275
    },
    "pipeline": {
      "compile": true,
      "createMask": false,
      "loadMask": false,
      "polygonsToRemove": 4,
      "prefilter": false,
      "instantaneous": false,
      "ensemble": true,
      "storePlanes": true,
      "calculateSumWindow": false,
      "calibrate_inst": false,
      "calibrate_sum": true,
      "calibrate_stereo": false,
      "calibrateType": "basic",
      "merge": false,
      "statistics_correlation": false,
      "statistics_inst": false,
      "statistics_inst_stereo": false,
      "statistics_ensemble": true,
      "statistics_ensemble_stereo": false,
      "statistics_use_merged": false
    },
    "instantaneous": {
      "windowSize": [
        [128, 128],
        [64, 64],
        [32, 32],
        [16, 16],
        [16, 16],
        [16, 16]
      ],
      "overlap": [50, 50, 50, 50, 50, 50],
      "runs": [6]
    },
    "ensemble": {
      "windowSize": [
        [128, 128],
        [64, 64],
        [32, 32],
        [16, 16],
        [12, 12],
        [8, 8],
        [6, 6],
        [4, 4]
      ],
      "overlap": [50, 50, 50, 50, 50, 50, 50, 50],
      "type": ["std", "std", "std", "std", "single", "single", "single", "single"],
      "resumeCase": 5,
      "sumWindow": [48, 48],
      "runs": [4, 5, 6, 7, 8],
      "convergedRun": 3
    },
    "directory": {
      "base": "",
      "source": "",
      "code": ""
    }
  },
  "filters": [
    {
      "type": "null"
    }
  ],
  "paths": {
    "base_dir": ["C:\\Users\\mtt1e23\\OneDrive - University of Southampton\\Documents\\#current_processing\\query_JHTDB\\Planar_Images\\ProcessedPIV"],
    "source": ["C:\\Users\\mtt1e23\\OneDrive - University of Southampton\\Documents\\#current_processing\\query_JHTDB\\Planar_Images"]
  }
};

export default function Home() {
  const [config, setConfig] = useState(defaultConfig);
  const [activeTab, setActiveTab] = useState("environment");
  const { toast } = useToast();

  // Function to update config state
  const updateConfig = (path: string[], value: any) => {
    setConfig(prevConfig => {
      const newConfig = JSON.parse(JSON.stringify(prevConfig));
      let current = newConfig;
      
      // Navigate to the nested property
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]];
      }
      
      // Update the value
      current[path[path.length - 1]] = value;
      return newConfig;
    });
  };

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
            <TabsList className="grid grid-cols-8 mb-6">
              <TabsTrigger value="environment" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Environment
              </TabsTrigger>
              <TabsTrigger value="images" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Images
              </TabsTrigger>
              <TabsTrigger value="pipeline" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Pipeline
              </TabsTrigger>
              <TabsTrigger value="instantaneous" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Instantaneous
              </TabsTrigger>
              <TabsTrigger value="ensemble" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Ensemble
              </TabsTrigger>
              <TabsTrigger value="filters" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Filters
              </TabsTrigger>
              <TabsTrigger value="paths" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Paths
              </TabsTrigger>
              <TabsTrigger value="viewer" className="data-[state=active]:bg-soton-blue data-[state=active]:text-white">
                Viewer
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="environment">
              <SetupEnvironment config={config} updateConfig={updateConfig} />
            </TabsContent>
            
            <TabsContent value="images">
              <ImageProperties config={config} updateConfig={updateConfig} />
            </TabsContent>
            
            <TabsContent value="pipeline">
              <PipelineConfig config={config} updateConfig={updateConfig} />
            </TabsContent>
            
            <TabsContent value="instantaneous">
              <InstantaneousPIV config={config} updateConfig={updateConfig} />
            </TabsContent>
            
            <TabsContent value="ensemble">
              <EnsemblePIV config={config} updateConfig={updateConfig} />
            </TabsContent>
            
            <TabsContent value="filters">
              <FilterManagement config={config} updateConfig={updateConfig} />
            </TabsContent>
            
            <TabsContent value="paths">
              <PathsConfig config={config} updateConfig={updateConfig} />
            </TabsContent>

            <TabsContent value="viewer">
              <ImagePairViewer />
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
