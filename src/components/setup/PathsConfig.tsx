'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Folder, FolderInput, FolderOutput, Plus, X, Info, FileUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PathsConfigProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function PathsConfig({ config, updateConfig }: PathsConfigProps) {
  const [baseDirs, setBaseDirs] = useState<string[]>(config.paths.base_dir || []);
  const [sourceDirs, setSourceDirs] = useState<string[]>(config.paths.source || []);

  useEffect(() => {
    updateConfig(['paths', 'base_dir'], baseDirs);
  }, [baseDirs, updateConfig]);

  useEffect(() => {
    updateConfig(['paths', 'source'], sourceDirs);
  }, [sourceDirs, updateConfig]);

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

  // TODO: In a Tauri app, this would use the dialog APIs for folder selection
  const selectFolder = async (callback: (path: string) => void) => {
    // Simulate folder selection (this would be replaced with Tauri dialog)
    const mockPath = "/selected/folder/path";
    callback(mockPath);
  };

  return (
    <div className="space-y-6">
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
              {baseDirs.map((dir, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input 
                    value={dir}
                    onChange={(e) => updateBaseDir(index, e.target.value)}
                    placeholder="Enter output directory path"
                  />
                  <Button 
                    variant="outline" 
                    size="icon" 
                    onClick={() => selectFolder((path) => updateBaseDir(index, path))}
                  >
                    <Folder className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => removeBaseDir(index)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              
              <Button 
                variant="outline" 
                onClick={addBaseDir}
                className="flex items-center gap-2 w-full"
              >
                <Plus className="h-4 w-4" />
                Add Output Directory
              </Button>
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
              {sourceDirs.map((dir, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input 
                    value={dir}
                    onChange={(e) => updateSourceDir(index, e.target.value)}
                    placeholder="Enter source directory path"
                  />
                  <Button 
                    variant="outline" 
                    size="icon" 
                    onClick={() => selectFolder((path) => updateSourceDir(index, path))}
                  >
                    <Folder className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => removeSourceDir(index)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              
              <Button 
                variant="outline" 
                onClick={addSourceDir}
                className="flex items-center gap-2 w-full"
              >
                <Plus className="h-4 w-4" />
                Add Source Directory
              </Button>
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
        </CardContent>
        <CardFooter className="border-t bg-gray-50 p-4 flex justify-end">
          <Button 
            variant="outline" 
            className="flex items-center gap-2"
            onClick={() => {
              // In a real app, this would save the current configuration
              console.log("Saving path configuration");
            }}
          >
            <FileUp className="h-4 w-4" />
            Save Configuration
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
