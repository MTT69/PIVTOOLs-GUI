'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Cpu, Server, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SetupEnvironmentProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function SetupEnvironment({ config, updateConfig }: SetupEnvironmentProps) {
  const environment = config.setup.environment;
  
  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-6">
        <Cpu className="h-6 w-6 text-soton-blue" />
        <h2 className="text-2xl font-bold text-gray-800">Computing Environment</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Execution Environment</CardTitle>
            <CardDescription>
              Configure where and how PIVTOOLS will execute
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="local-execution">Local Execution</Label>
                  <p className="text-sm text-muted-foreground">
                    Run on local machine (disable for cluster)
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="local-execution" 
                        checked={environment.local}
                        onCheckedChange={(checked) => updateConfig(['setup', 'environment', 'local'], checked)} 
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Enable for local machine, disable for cluster execution</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="restart-parpool">Restart Parallel Pool</Label>
                  <p className="text-sm text-muted-foreground">
                    Reinitialize parallel workers before processing
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch 
                        id="restart-parpool" 
                        checked={environment.restartParpool}
                        onCheckedChange={(checked) => updateConfig(['setup', 'environment', 'restartParpool'], checked)} 
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Restart the parallel pool before processing to ensure clean state</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Core Allocation</CardTitle>
            <CardDescription>
              Optimize performance with parallel processing settings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="num-tasks" className="col-span-2">Number of Tasks</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="num-tasks"
                        type="number"
                        className="col-span-2" 
                        value={environment.numTasks}
                        onChange={(e) => updateConfig(['setup', 'environment', 'numTasks'], parseInt(e.target.value))}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Number of parallel workers for heavy computational tasks</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="image-load-cores" className="col-span-2">Image Load Cores</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="image-load-cores"
                        type="number"
                        className="col-span-2" 
                        value={environment.imageLoadCores}
                        onChange={(e) => updateConfig(['setup', 'environment', 'imageLoadCores'], parseInt(e.target.value))}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Number of workers dedicated to image loading operations</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="grid grid-cols-4 items-center">
                <Label htmlFor="max-cores" className="col-span-2">Maximum Cores</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input 
                        id="max-cores"
                        type="number"
                        className="col-span-2" 
                        value={environment.maxCores}
                        onChange={(e) => updateConfig(['setup', 'environment', 'maxCores'], parseInt(e.target.value))}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Maximum number of workers for light processing tasks</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-amber-500" />
            <CardTitle>Performance Guidelines</CardTitle>
          </div>
          <CardDescription>
            Recommendations for optimizing PIVTOOLS performance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none">
            <ul className="space-y-2">
              <li><strong>Number of Tasks:</strong> Set to the number of physical CPU cores for best performance.</li>
              <li><strong>Image Load Cores:</strong> Should be less than or equal to Number of Tasks.</li>
              <li><strong>Maximum Cores:</strong> For machines with limited RAM, reduce this value to prevent memory issues.</li>
              <li><strong>Local Execution:</strong> Enable for desktop computers, disable when running on HPC clusters.</li>
              <li><strong>Restart Parallel Pool:</strong> Enable for clean processing but adds startup time.</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
