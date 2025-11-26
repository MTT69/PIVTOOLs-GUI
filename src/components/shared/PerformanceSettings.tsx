"use client";

import { useState, useEffect, memo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PerformanceSettingsProps {
  config: any;
  updateConfigValue: (path: string[], value: any) => void;
  showFilterWorkerCount?: boolean;
}

const PerformanceSettings = memo(function PerformanceSettings({
  config,
  updateConfigValue,
  showFilterWorkerCount = false
}: PerformanceSettingsProps) {
  // Memory per worker state
  const [memoryNumber, setMemoryNumber] = useState<string>('6');
  const [memoryUnit, setMemoryUnit] = useState<string>('GB');

  // Memory per worker initialization
  useEffect(() => {
    const mem = config?.processing?.dask_memory_limit || '6GB';
    const match = mem.match(/^(\d+)(MB|GB)?$/);
    if (match) {
      setMemoryNumber(match[1]);
      setMemoryUnit(match[2] || 'GB');
    } else {
      setMemoryNumber('6');
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
          value={config?.processing?.dask_workers_per_node === '' ? '' : (config?.processing?.dask_workers_per_node ?? 10)}
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
                setMemoryNumber('6');
                updateConfigValue(['processing', 'dask_memory_limit'], `6${memoryUnit}`);
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

      {showFilterWorkerCount && (
        <div className="space-y-2">
          <Label htmlFor="filter-workers">Filter Worker Count</Label>
          <Input
            id="filter-workers"
            type="text"
            value={config?.processing?.filter_worker_count === '' ? '' : (config?.processing?.filter_worker_count ?? 1)}
            onChange={(e) => {
              const val = e.target.value;
              const num = parseInt(val, 10);
              updateConfigValue(['processing', 'filter_worker_count'], isNaN(num) ? '' : num);
            }}
          />
          <p className="text-xs text-muted-foreground">Number of workers for filtering operations</p>
        </div>
      )}
    </div>
  );
});

export default PerformanceSettings;
