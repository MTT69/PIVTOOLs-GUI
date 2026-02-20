"use client";

import { useState, useEffect, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PerformanceSettingsProps {
  config: any;
  updateConfigValue: (path: string[], value: any) => void;
}

const PerformanceSettings = memo(function PerformanceSettings({
  config,
  updateConfigValue,
}: PerformanceSettingsProps) {
  // Memory per worker state
  const [memoryNumber, setMemoryNumber] = useState<string>('8');
  const [memoryUnit, setMemoryUnit] = useState<string>('GB');

  // Memory per worker initialization
  useEffect(() => {
    const mem = config?.processing?.dask_memory_limit || '8GB';
    const match = mem.match(/^(\d+)(MB|GB)?$/);
    if (match) {
      setMemoryNumber(match[1]);
      setMemoryUnit(match[2] || 'GB');
    } else {
      setMemoryNumber('8');
      setMemoryUnit('GB');
    }
  }, [config?.processing?.dask_memory_limit]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="omp-threads">Threads (OMP)</Label>
        <Input
          id="omp-threads"
          type="text"
          value={config?.processing?.omp_threads === '' ? '' : (config?.processing?.omp_threads ?? 4)}
          onChange={(e) => {
            const val = e.target.value;
            const num = parseInt(val, 10);
            updateConfigValue(['processing', 'omp_threads'], isNaN(num) ? '' : num);
          }}
        />
        <p className="text-xs text-muted-foreground">OpenMP threads for parallel processing</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dask-workers">Dask Workers</Label>
        <Input
          id="dask-workers"
          type="text"
          value={config?.processing?.dask_workers_per_node === '' ? '' : (config?.processing?.dask_workers_per_node ?? 2)}
          onChange={(e) => {
            const val = e.target.value;
            const num = parseInt(val, 10);
            updateConfigValue(['processing', 'dask_workers_per_node'], isNaN(num) ? '' : num);
          }}
        />
        <p className="text-xs text-muted-foreground">Number of Dask workers per node</p>
      </div>

      <div className="space-y-2">
        <Label>Memory per Worker</Label>
        <div className="flex gap-2">
          <Input
            type="text"
            value={memoryNumber}
            onChange={(e) => {
              const val = e.target.value;
              setMemoryNumber(val);
              const num = parseInt(val, 10);
              if (!isNaN(num)) {
                updateConfigValue(['processing', 'dask_memory_limit'], `${num}${memoryUnit}`);
              }
            }}
            onBlur={() => {
              if (memoryNumber === '') {
                setMemoryNumber('8');
                updateConfigValue(['processing', 'dask_memory_limit'], `8${memoryUnit}`);
              }
            }}
            className="flex-1"
          />
          <Select
            value={memoryUnit}
            onValueChange={(value) => {
              setMemoryUnit(value);
              const num = parseInt(memoryNumber, 10);
              if (!isNaN(num)) {
                updateConfigValue(['processing', 'dask_memory_limit'], `${num}${value}`);
              }
            }}
          >
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MB">MB</SelectItem>
              <SelectItem value="GB">GB</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">Memory limit per worker</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dask-max-in-flight">Max Tasks per Worker</Label>
        <Input
          id="dask-max-in-flight"
          type="text"
          value={config?.processing?.dask_max_in_flight_per_worker === '' ? '' : (config?.processing?.dask_max_in_flight_per_worker ?? 3)}
          onChange={(e) => {
            const val = e.target.value;
            const num = parseInt(val, 10);
            updateConfigValue(['processing', 'dask_max_in_flight_per_worker'], isNaN(num) ? '' : num);
          }}
        />
        <p className="text-xs text-muted-foreground">Max concurrent tasks queued per Dask worker. Higher values improve I/O pipelining on HPC with fast storage (try 4-6).</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Open Dask Dashboard</Label>
          <Button
            variant={(config?.processing?.open_dashboard) ? "default" : "outline"}
            size="sm"
            onClick={() => updateConfigValue(['processing', 'open_dashboard'], !config?.processing?.open_dashboard)}
          >
            {config?.processing?.open_dashboard ? "Enabled" : "Disabled"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Auto-open the Dask performance dashboard in your browser when processing starts.</p>
      </div>
    </div>
  );
});

export default PerformanceSettings;
