'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  LayoutGrid, 
  Plus, 
  Minus, 
  MoveUp, 
  MoveDown, 
  AlertCircle, 
  ArrowRightLeft,
  Grid3X3
} from "lucide-react";

interface InstantaneousPIVProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function InstantaneousPIV({ config, updateConfig }: InstantaneousPIVProps) {
  const instantaneous = config.setup.instantaneous;
  
  // Convert window sizes and overlap to a format easier to work with in the UI
  const [windowPasses, setWindowPasses] = useState<{
    windowX: number;
    windowY: number;
    overlap: number;
  }[]>([]);
  
  const [runs, setRuns] = useState<string>(
    Array.isArray(instantaneous.runs) ? instantaneous.runs.join(',') : '6'
  );
  
  // Initialize window passes from configuration
  useEffect(() => {
    if (instantaneous.windowSize && Array.isArray(instantaneous.windowSize)) {
      const passes = instantaneous.windowSize.map((size: number[], index: number) => ({
        windowX: size[0] || 128,
        windowY: size[1] || 128,
        overlap: instantaneous.overlap?.[index] || 50
      }));
      setWindowPasses(passes);
    } else {
      setWindowPasses([{ windowX: 128, windowY: 128, overlap: 50 }]);
    }
  }, []);
  
  // Update configuration when window passes change
  useEffect(() => {
    if (windowPasses.length > 0) {
      const windowSize = windowPasses.map(pass => [pass.windowX, pass.windowY]);
      const overlap = windowPasses.map(pass => pass.overlap);
      
      updateConfig(['setup', 'instantaneous', 'windowSize'], windowSize);
      updateConfig(['setup', 'instantaneous', 'overlap'], overlap);
    }
  }, [windowPasses]);
  
  // Update configuration when runs change
  useEffect(() => {
    try {
      const runsArray = runs.split(',').map(run => parseInt(run.trim())).filter(run => !isNaN(run));
      if (runsArray.length > 0) {
        updateConfig(['setup', 'instantaneous', 'runs'], runsArray);
      }
    } catch (e) {
      console.error("Error parsing runs:", e);
    }
  }, [runs]);
  
  // Add a new window pass
  const addWindowPass = () => {
    // Copy settings from the last pass but with smaller window size
    const lastPass = windowPasses[windowPasses.length - 1];
    const newWindowX = Math.max(4, lastPass.windowX / 2);
    const newWindowY = Math.max(4, lastPass.windowY / 2);
    
    setWindowPasses([
      ...windowPasses,
      {
        windowX: newWindowX,
        windowY: newWindowY,
        overlap: lastPass.overlap
      }
    ]);
  };
  
  // Remove the last window pass
  const removeWindowPass = () => {
    if (windowPasses.length > 1) {
      setWindowPasses(windowPasses.slice(0, -1));
    }
  };
  
  // Update a window pass
  const updateWindowPass = (index: number, field: 'windowX' | 'windowY' | 'overlap', value: number) => {
    const newWindowPasses = [...windowPasses];
    newWindowPasses[index][field] = value;
    setWindowPasses(newWindowPasses);
  };
  
  // Move a window pass up
  const movePassUp = (index: number) => {
    if (index <= 0) return;
    const newPasses = [...windowPasses];
    [newPasses[index], newPasses[index - 1]] = [newPasses[index - 1], newPasses[index]];
    setWindowPasses(newPasses);
  };
  
  // Move a window pass down
  const movePassDown = (index: number) => {
    if (index >= windowPasses.length - 1) return;
    const newPasses = [...windowPasses];
    [newPasses[index], newPasses[index + 1]] = [newPasses[index + 1], newPasses[index]];
    setWindowPasses(newPasses);
  };
  
  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-6">
        <LayoutGrid className="h-6 w-6 text-soton-blue" />
        <h2 className="text-2xl font-bold text-gray-800">Instantaneous PIV Configuration</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Multi-Pass Configuration</CardTitle>
            <CardDescription>
              Configure window sizes and overlap for each processing pass
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex justify-end gap-2">
              <Button 
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
                onClick={addWindowPass}
              >
                <Plus className="h-4 w-4" />
                Add Pass
              </Button>
              <Button 
                variant="outline"
                size="sm"
                className="flex items-center gap-2 text-red-500"
                onClick={removeWindowPass}
                disabled={windowPasses.length <= 1}
              >
                <Minus className="h-4 w-4" />
                Remove Pass
              </Button>
            </div>
            
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Pass</TableHead>
                  <TableHead>Window X (px)</TableHead>
                  <TableHead>Window Y (px)</TableHead>
                  <TableHead>Overlap (%)</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {windowPasses.map((pass, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">
                      Pass {index + 1}
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Input 
                              type="number"
                              value={pass.windowX}
                              onChange={(e) => updateWindowPass(index, 'windowX', parseInt(e.target.value))}
                              className="w-24"
                              min={4}
                              step={4}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Window size in X direction (pixels)</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Input 
                              type="number"
                              value={pass.windowY}
                              onChange={(e) => updateWindowPass(index, 'windowY', parseInt(e.target.value))}
                              className="w-24"
                              min={4}
                              step={4}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Window size in Y direction (pixels)</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Input 
                              type="number"
                              value={pass.overlap}
                              onChange={(e) => updateWindowPass(index, 'overlap', parseInt(e.target.value))}
                              className="w-24"
                              min={0}
                              max={99}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Window overlap percentage (0-99%)</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          disabled={index === 0}
                          onClick={() => movePassUp(index)}
                        >
                          <MoveUp className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          disabled={index === windowPasses.length - 1}
                          onClick={() => movePassDown(index)}
                        >
                          <MoveDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Processing Parameters</CardTitle>
            <CardDescription>
              Configure general processing parameters
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="runs">Run Numbers</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Input
                      id="runs"
                      value={runs}
                      onChange={(e) => setRuns(e.target.value)}
                      placeholder="e.g., 1,2,3,4,5,6"
                    />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Comma-separated list of run numbers to process. These correspond to experimental runs or dataset segments.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <p className="text-sm text-muted-foreground">Comma-separated list of runs (e.g., 6,7,8)</p>
            </div>
            
            <Alert className="bg-blue-50 border border-blue-200">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              <AlertTitle>Processing Strategy</AlertTitle>
              <AlertDescription className="text-sm text-blue-800">
                <p className="mb-2">The instantaneous PIV mode processes each image pair individually and is suitable for:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Time-resolved flow analysis</li>
                  <li>Transient phenomena investigation</li>
                  <li>Turbulence statistics from temporal data</li>
                </ul>
              </AlertDescription>
            </Alert>
            
            <div className="flex justify-center mt-2">
              <div className="text-center">
                <h3 className="text-lg font-semibold mb-1">Multi-Pass Approach</h3>
                <div className="flex items-center justify-center">
                  <ArrowRightLeft className="h-5 w-5 text-soton-blue mr-2" />
                  <p className="text-sm text-gray-600">
                    Progressively refines vectors from larger to smaller windows
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Grid3X3 className="h-5 w-5 text-soton-blue" />
            <CardTitle>Window Size Selection Guidelines</CardTitle>
          </div>
          <CardDescription>
            Best practices for configuring correlation windows
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
