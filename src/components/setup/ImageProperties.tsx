'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Image, Layers, Clock, Grid, Camera } from "lucide-react";

interface ImagePropertiesProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function ImageProperties({ config, updateConfig }: ImagePropertiesProps) {
  const imProperties = config.setup.imProperties;
  
  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-6">
        <Image className="h-6 w-6 text-soton-blue" />
        <h2 className="text-2xl font-bold text-gray-800">Image Properties</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Basic Configuration</CardTitle>
            <CardDescription>
              Configure fundamental image properties
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="image-count" className="col-span-2">Image Count</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="image-count"
                        type="number"
                        className="col-span-2"
                        value={imProperties.imageCount}
                        onChange={(e) => updateConfig(['setup', 'imProperties', 'imageCount'], parseInt(e.target.value))}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Total number of images to process</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="batch-size" className="col-span-2">Batch Size</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="batch-size"
                        type="number"
                        className="col-span-2"
                        value={imProperties.batchSize}
                        onChange={(e) => updateConfig(['setup', 'imProperties', 'batchSize'], parseInt(e.target.value))}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Number of image pairs processed in a single batch</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="parfor-batch" className="col-span-2">Parallel Batch Size</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="parfor-batch"
                        type="number"
                        className="col-span-2"
                        value={imProperties.parforbatch}
                        onChange={(e) => updateConfig(['setup', 'imProperties', 'parforbatch'], parseInt(e.target.value))}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Number of images to process in a parallel sub-batch</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="dt" className="col-span-2">Time Interval (dt)</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="dt"
                        type="number"
                        className="col-span-2"
                        value={imProperties.dt}
                        onChange={(e) => updateConfig(['setup', 'imProperties', 'dt'], parseFloat(e.target.value))}
                        step={0.001}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Time interval between consecutive images</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Image Dimensions</CardTitle>
            <CardDescription>
              Configure image resolution and format
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="image-width" className="mb-2 block">Width (px)</Label>
                  <Input 
                    id="image-width"
                    type="number"
                    value={imProperties.imageSize ? imProperties.imageSize[0] : 1024}
                    onChange={(e) => {
                      const currentSize = [...(imProperties.imageSize || [1024, 1024])];
                      currentSize[0] = parseInt(e.target.value);
                      updateConfig(['setup', 'imProperties', 'imageSize'], currentSize);
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="image-height" className="mb-2 block">Height (px)</Label>
                  <Input 
                    id="image-height"
                    type="number"
                    value={imProperties.imageSize ? imProperties.imageSize[1] : 1024}
                    onChange={(e) => {
                      const currentSize = [...(imProperties.imageSize || [1024, 1024])];
                      currentSize[1] = parseInt(e.target.value);
                      updateConfig(['setup', 'imProperties', 'imageSize'], currentSize);
                    }}
                  />
                </div>
              </div>
              
              <div>
                <Label htmlFor="image-type" className="mb-2 block">Image Format</Label>
                <Select 
                  value={imProperties.imageType}
                  onValueChange={(value) => updateConfig(['setup', 'imProperties', 'imageType'], value)}
                >
                  <SelectTrigger id="image-type">
                    <SelectValue placeholder="Select image format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="im">IM</SelectItem>
                    <SelectItem value="im7">IM7</SelectItem>
                    <SelectItem value="ims">IMS</SelectItem>
                    <SelectItem value="cine">CINE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="image-reader" className="mb-2 block">Image Reader</Label>
                <Select 
                  value={imProperties.reader}
                  onValueChange={(value) => updateConfig(['setup', 'imProperties', 'reader'], value)}
                >
                  <SelectTrigger id="image-reader">
                    <SelectValue placeholder="Select image reader" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="matlab">MATLAB</SelectItem>
                    <SelectItem value="im">IM</SelectItem>
                    <SelectItem value="im7">IM7</SelectItem>
                    <SelectItem value="ims">IMS</SelectItem>
                    <SelectItem value="cine">CINE</SelectItem>
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
            <CardTitle>Camera Setup</CardTitle>
            <CardDescription>
              Configure camera properties
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="camera-count" className="col-span-2">Camera Count</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="camera-count"
                        type="number"
                        className="col-span-2"
                        value={imProperties.cameraCount}
                        onChange={(e) => updateConfig(['setup', 'imProperties', 'cameraCount'], parseInt(e.target.value))}
                        min={1}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Number of cameras used (1=single camera, 2=stereo)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="time-resolved">Time Resolved</Label>
                  <p className="text-sm text-muted-foreground">
                    Enable for time-resolved measurements
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="time-resolved" 
                        checked={imProperties.timeResolved}
                        onCheckedChange={(checked) => updateConfig(['setup', 'imProperties', 'timeResolved'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Enable for temporal accuracy in measurements</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="combine-runs">Combine Runs</Label>
                  <p className="text-sm text-muted-foreground">
                    Process multiple runs as one dataset
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="combine-runs" 
                        checked={imProperties.combineRuns}
                        onCheckedChange={(checked) => updateConfig(['setup', 'imProperties', 'combineRuns'], checked)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Look for _0, _1 folders and process as single dataset</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Calibration</CardTitle>
            <CardDescription>
              Configure calibration parameters
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="scale-factor" className="col-span-2">Scale Factor</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="scale-factor"
                        type="number"
                        className="col-span-2"
                        value={imProperties.scaleFactor}
                        onChange={(e) => updateConfig(['setup', 'imProperties', 'scaleFactor'], parseFloat(e.target.value))}
                        step={0.0001}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Calibration scale factor (pixels per mm)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="x-offset" className="col-span-2">X Offset</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="x-offset"
                        type="number"
                        className="col-span-2"
                        value={imProperties.xOffset}
                        onChange={(e) => updateConfig(['setup', 'imProperties', 'xOffset'], parseInt(e.target.value))}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>X coordinate calibration offset</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="y-offset" className="col-span-2">Y Offset</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="y-offset"
                        type="number"
                        className="col-span-2"
                        value={imProperties.yOffset}
                        onChange={(e) => updateConfig(['setup', 'imProperties', 'yOffset'], parseInt(e.target.value))}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Y coordinate calibration offset</p>
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
