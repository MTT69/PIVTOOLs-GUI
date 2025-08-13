'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Settings, 
  Activity, 
  BarChart, 
  GitMerge,
  Scale, 
  Layers,
  FileStack, 
  SquareStack 
} from "lucide-react";

interface PipelineConfigProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function PipelineConfig({ config, updateConfig }: PipelineConfigProps) {
  const pipeline = config.setup.pipeline;
  
  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-6">
        <Settings className="h-6 w-6 text-soton-blue" />
        <h2 className="text-2xl font-bold text-gray-800">Pipeline Configuration</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-soton-blue" />
              <CardTitle>Processing Mode</CardTitle>
            </div>
            <CardDescription>
              Select PIV processing methods
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="instantaneous">Instantaneous PIV</Label>
                  <p className="text-sm text-muted-foreground">
                    Frame-by-frame analysis
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="instantaneous" 
                        checked={pipeline.instantaneous}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'instantaneous'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Process each image pair individually</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="ensemble">Ensemble PIV</Label>
                  <p className="text-sm text-muted-foreground">
                    Sum of correlations method
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="ensemble" 
                        checked={pipeline.ensemble}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'ensemble'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Process using ensemble averaging for better statistics</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="store-planes">Store Correlation Planes</Label>
                  <p className="text-sm text-muted-foreground">
                    Save correlation data
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="store-planes" 
                        checked={pipeline.storePlanes}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'storePlanes'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Save correlation planes for further analysis</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="calculate-sum-window">Auto Calculate Sum Window</Label>
                  <p className="text-sm text-muted-foreground">
                    Optimise encompassing window size
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="calculate-sum-window" 
                        checked={pipeline.calculateSumWindow}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'calculateSumWindow'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Automatically determine optimal sum window size</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-soton-blue" />
              <CardTitle>Calibration</CardTitle>
            </div>
            <CardDescription>
              Configure PIV calibration settings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="calibrate-inst">Calibrate Instantaneous</Label>
                  <p className="text-sm text-muted-foreground">
                    For instantaneous processing
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="calibrate-inst" 
                        checked={pipeline.calibrate_inst}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'calibrate_inst'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Apply calibration to instantaneous PIV results</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="calibrate-sum">Calibrate Ensemble</Label>
                  <p className="text-sm text-muted-foreground">
                    For ensemble processing
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="calibrate-sum" 
                        checked={pipeline.calibrate_sum}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'calibrate_sum'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Apply calibration to ensemble PIV results</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="calibrate-stereo">Stereo Calibration</Label>
                  <p className="text-sm text-muted-foreground">
                    For multi-camera setups
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="calibrate-stereo" 
                        checked={pipeline.calibrate_stereo}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'calibrate_stereo'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Enable stereo calibration for 3D reconstruction</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div>
                <Label htmlFor="calibrate-type" className="mb-2 block">Calibration Type</Label>
                <Select 
                  value={pipeline.calibrateType}
                  onValueChange={(value) => updateConfig(['setup', 'pipeline', 'calibrateType'], value)}
                >
                  <SelectTrigger id="calibrate-type">
                    <SelectValue placeholder="Select calibration type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic</SelectItem>
                    <SelectItem value="pinhole">Pinhole</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-soton-blue" />
              <CardTitle>Masking</CardTitle>
            </div>
            <CardDescription>
              Configure masking options
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="create-mask">Create Mask</Label>
                  <p className="text-sm text-muted-foreground">
                    Define new processing mask
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="create-mask" 
                        checked={pipeline.createMask}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'createMask'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Create a new mask for processing</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="load-mask">Load Mask</Label>
                  <p className="text-sm text-muted-foreground">
                    Use existing mask file
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="load-mask" 
                        checked={pipeline.loadMask}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'loadMask'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Load a pre-existing mask from file</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="polygons-to-remove" className="col-span-2">Polygons to Remove</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="polygons-to-remove"
                        type="number"
                        className="col-span-2"
                        value={pipeline.polygonsToRemove}
                        onChange={(e) => updateConfig(['setup', 'pipeline', 'polygonsToRemove'], parseInt(e.target.value))}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Number of polygons to remove or use [top, right, bottom, left] for square mask</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart className="h-5 w-5 text-soton-blue" />
              <CardTitle>Statistics Options</CardTitle>
            </div>
            <CardDescription>
              Configure statistical calculations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="stats-correlation">Correlation Statistics</Label>
                  <p className="text-sm text-muted-foreground">
                    Quality metrics
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="stats-correlation" 
                        checked={pipeline.statistics_correlation}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'statistics_correlation'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Generate correlation quality statistics</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="stats-inst">Instantaneous Statistics</Label>
                  <p className="text-sm text-muted-foreground">
                    For instantaneous PIV
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="stats-inst" 
                        checked={pipeline.statistics_inst}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'statistics_inst'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Generate statistics for instantaneous PIV results</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="stats-ensemble">Ensemble Statistics</Label>
                  <p className="text-sm text-muted-foreground">
                    For ensemble PIV
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="stats-ensemble" 
                        checked={pipeline.statistics_ensemble}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'statistics_ensemble'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Generate statistics for ensemble PIV results</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="merge">Merge Vectors</Label>
                  <p className="text-sm text-muted-foreground">
                    From different cameras
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="merge" 
                        checked={pipeline.merge}
                        onCheckedChange={(checked) => updateConfig(['setup', 'pipeline', 'merge'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Merge vectors from multiple cameras</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
