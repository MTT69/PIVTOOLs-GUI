'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  BarChart, 
  Plus, 
  Minus, 
  MoveUp, 
  MoveDown, 
  AlertCircle, 
  LayoutGrid, 
  Combine 
} from "lucide-react";

interface EnsemblePIVProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function EnsemblePIV({ config, updateConfig }: EnsemblePIVProps) {
  const ensemble = config.setup.ensemble;
  
  // Convert window sizes, overlap and type to a format easier to work with in the UI
  const [windowPasses, setWindowPasses] = useState<{
    windowX: number;
    windowY: number;
    overlap: number;
    type: string;
  }[]>([]);
  
  const [runs, setRuns] = useState<string>(
    Array.isArray(ensemble.runs) ? ensemble.runs.join(',') : '4,5,6,7,8'
  );
  
  const [sumWindow, setSumWindow] = useState<{x: number, y: number}>({
    x: ensemble.sumWindow?.[0] || 48,
    y: ensemble.sumWindow?.[1] || 48
  });
  
  const [resumeCase, setResumeCase] = useState<number>(ensemble.resumeCase || 5);
  const [convergedRun, setConvergedRun] = useState<number>(ensemble.convergedRun || 3);
  
  // Initialize window passes from configuration
  useEffect(() => {
    if (ensemble.windowSize && Array.isArray(ensemble.windowSize)) {
      const passes = ensemble.windowSize.map((size: number[], index: number) => ({
        windowX: size[0] || 128,
        windowY: size[1] || 128,
        overlap: ensemble.overlap?.[index] || 50,
        type: ensemble.type?.[index] || 'std'
      }));
      setWindowPasses(passes);
    } else {
      setWindowPasses([
        { windowX: 128, windowY: 128, overlap: 50, type: 'std' },
        { windowX: 64, windowY: 64, overlap: 50, type: 'std' },
        { windowX: 32, windowY: 32, overlap: 50, type: 'std' },
        { windowX: 16, windowY: 16, overlap: 50, type: 'std' }
      ]);
    }
  }, []);
  
  // Update configuration when window passes change
  useEffect(() => {
    if (windowPasses.length > 0) {
      const windowSize = windowPasses.map(pass => [pass.windowX, pass.windowY]);
      const overlap = windowPasses.map(pass => pass.overlap);
      const type = windowPasses.map(pass => pass.type);
      
      updateConfig(['setup', 'ensemble', 'windowSize'], windowSize);
      updateConfig(['setup', 'ensemble', 'overlap'], overlap);
      updateConfig(['setup', 'ensemble', 'type'], type);
    }
  }, [windowPasses]);
  
  // Update configuration when runs change
  useEffect(() => {
    try {
      const runsArray = runs.split(',').map(run => parseInt(run.trim())).filter(run => !isNaN(run));
      if (runsArray.length > 0) {
        updateConfig(['setup', 'ensemble', 'runs'], runsArray);
      }
    } catch (e) {
      console.error("Error parsing runs:", e);
    }
  }, [runs]);
  
  // Update configuration when sum window changes
  useEffect(() => {
    updateConfig(['setup', 'ensemble', 'sumWindow'], [sumWindow.x, sumWindow.y]);
  }, [sumWindow]);
  
  // Update configuration when resume case changes
  useEffect(() => {
    updateConfig(['setup', 'ensemble', 'resumeCase'], resumeCase);
  }, [resumeCase]);
  
  // Update configuration when converged run changes
  useEffect(() => {
    updateConfig(['setup', 'ensemble', 'convergedRun'], convergedRun);
  }, [convergedRun]);
  
  // Add a new window pass
  const addWindowPass = () => {
    // Copy settings from the last pass but with smaller window size
    const lastPass = windowPasses[windowPasses.length - 1];
    const newWindowX = Math.max(4, lastPass.windowX / 2);
    const newWindowY = Math.max(4, lastPass.windowY / 2);
    
    // Use single correlation for smaller windows
    const newType = newWindowX <= 16 ? 'single' : 'std';
    
    setWindowPasses([
      ...windowPasses,
      {
        windowX: newWindowX,
        windowY: newWindowY,
        overlap: lastPass.overlap,
        type: newType
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
  const updateWindowPass = (index: number, field: 'windowX' | 'windowY' | 'overlap' | 'type', value: any) => {
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
        <BarChart className="h-6 w-6 text-soton-blue" />
        <h2 className="text-2xl font-bold text-gray-800">Ensemble PIV Configuration</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Multi-Pass Configuration</CardTitle>
            <CardDescription>
              Configure window sizes, overlap, and correlation type for each processing pass
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
                  <TableHead>Type</TableHead>
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
                      <Select 
                        value={pass.type} 
                        onValueChange={(value) => updateWindowPass(index, 'type', value)}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="std">Standard</SelectItem>
                          <SelectItem value="single">Single</SelectItem>
                        </SelectContent>
                      </Select>
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
            <CardTitle>Ensemble Parameters</CardTitle>
            <CardDescription>
              Configure ensemble processing parameters
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
                      placeholder="e.g., 3,4,5,6,7,8"
                    />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Comma-separated list of run numbers to include in the ensemble average.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <p className="text-sm text-muted-foreground">Comma-separated list of runs (e.g., 4,5,6,7,8)</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="resume-case">Resume Case</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input
                        id="resume-case"
                        type="number"
                        value={resumeCase}
                        onChange={(e) => setResumeCase(parseInt(e.target.value))}
                        min={0}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Resume from previous run (0 = start fresh)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="space-y-2">
                <Label htmlFor="converged-run">Converged Run</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input
                        id="converged-run"
                        type="number"
                        value={convergedRun}
                        onChange={(e) => setConvergedRun(parseInt(e.target.value))}
                        min={1}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Run number for calculating optimal sum window size</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Sum Window Size</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Input
                          type="number"
                          value={sumWindow.x}
                          onChange={(e) => setSumWindow({...sumWindow, x: parseInt(e.target.value)})}
                          min={4}
                          step={4}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>X dimension of ensemble summing window</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <span className="text-xs text-muted-foreground">Width (px)</span>
                </div>
                <div className="space-y-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Input
                          type="number"
                          value={sumWindow.y}
                          onChange={(e) => setSumWindow({...sumWindow, y: parseInt(e.target.value)})}
                          min={4}
                          step={4}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Y dimension of ensemble summing window</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <span className="text-xs text-muted-foreground">Height (px)</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Combine className="h-5 w-5 text-soton-blue" />
            <CardTitle>Ensemble PIV Explained</CardTitle>
          </div>
          <CardDescription>
            Understand the ensemble correlation technique
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="bg-blue-50 border border-blue-200 mb-4">
            <AlertCircle className="h-4 w-4 text-blue-500" />
            <AlertTitle>Key Benefits</AlertTitle>
            <AlertDescription className="text-sm text-blue-800">
              <ul className="list-disc pl-5 space-y-1">
                <li>Higher signal-to-noise ratio through correlation averaging</li>
                <li>Better results in low-seeding or challenging imaging conditions</li>
                <li>Reveals mean flow structure with excellent accuracy</li>
                <li>Reduces computational cost for large datasets</li>
              </ul>
            </AlertDescription>
          </Alert>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Correlation Types</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="font-semibold min-w-[80px]">Standard:</span>
                  <span>Computes full correlation matrix, better for large windows and complex flows</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold min-w-[80px]">Single:</span>
                  <span>optimised for smaller windows, uses peak tracking for better performance</span>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-medium mb-2">Window Progression</h3>
              <p className="text-sm">The optimal window progression typically follows:</p>
              <ol className="list-decimal pl-5 space-y-1 text-sm mt-2">
                <li>Start with large windows (128×128) using standard correlation</li>
                <li>Progressively halve window size with each pass (64×64, 32×32)</li>
                <li>Switch to single correlation for smaller windows (16×16, 8×8)</li>
                <li>Final passes with very small windows (6×6, 4×4) for detail</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

