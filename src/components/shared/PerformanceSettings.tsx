"use client";

import { useState, useEffect, useRef, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNumericInput } from "@/hooks/useNumericInput";

interface PerformanceSettingsProps {
  config: any;
  updateConfigValue: (path: string[], value: any) => void;
}

const PerformanceSettings = memo(function PerformanceSettings({
  config,
  updateConfigValue,
}: PerformanceSettingsProps) {
  // Numeric inputs with local buffering to prevent sticky value reversion
  const ompThreads = useNumericInput({
    configValue: config?.processing?.omp_threads,
    defaultValue: 4,
    onCommit: (val) => updateConfigValue(['processing', 'omp_threads'], val),
    min: 1,
  });

  const daskWorkers = useNumericInput({
    configValue: config?.processing?.dask_workers_per_node,
    defaultValue: 1,
    onCommit: (val) => updateConfigValue(['processing', 'dask_workers_per_node'], val),
    min: 1,
  });

  const daskMaxInFlight = useNumericInput({
    configValue: config?.processing?.dask_max_in_flight_per_worker,
    defaultValue: 3,
    onCommit: (val) => updateConfigValue(['processing', 'dask_max_in_flight_per_worker'], val),
    min: 1,
  });

  const batchSize = useNumericInput({
    configValue: config?.batches?.size,
    defaultValue: 10,
    onCommit: (val) => updateConfigValue(['batches', 'size'], val),
    min: 1,
  });

  // Post-processing workers state
  const [ppWorkers, setPpWorkers] = useState<string>('');
  const isEditingPpWorkersRef = useRef(false);

  // Memory per worker state
  const [memoryNumber, setMemoryNumber] = useState<string>('12');
  const [memoryUnit, setMemoryUnit] = useState<string>('GB');
  const isEditingMemoryRef = useRef(false);

  // Post-processing workers initialization — only sync when not editing
  useEffect(() => {
    if (isEditingPpWorkersRef.current) return;
    const val = config?.processing?.post_processing_workers;
    setPpWorkers(val != null ? String(val) : '');
  }, [config?.processing?.post_processing_workers]);

  // Memory per worker initialization — only sync when not editing
  useEffect(() => {
    if (isEditingMemoryRef.current) return;
    const mem = config?.processing?.dask_memory_limit || '12GB';
    const match = mem.match(/^(\d+)(MB|GB)?$/);
    if (match) {
      setMemoryNumber(match[1]);
      setMemoryUnit(match[2] || 'GB');
    } else {
      setMemoryNumber('12');
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
          inputMode="numeric"
          value={ompThreads.value}
          onChange={ompThreads.onChange}
          onFocus={ompThreads.onFocus}
          onBlur={ompThreads.onBlur}
        />
        <p className="text-xs text-muted-foreground">OpenMP threads for parallel processing</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dask-workers">Dask Workers</Label>
        <Input
          id="dask-workers"
          type="text"
          inputMode="numeric"
          value={daskWorkers.value}
          onChange={daskWorkers.onChange}
          onFocus={daskWorkers.onFocus}
          onBlur={daskWorkers.onBlur}
        />
        <p className="text-xs text-muted-foreground">Number of Dask workers per node</p>
      </div>

      <div className="space-y-2">
        <Label>Memory per Worker</Label>
        <div className="flex gap-2">
          <Input
            type="text"
            inputMode="numeric"
            value={memoryNumber}
            onChange={(e) => {
              setMemoryNumber(e.target.value);
            }}
            onFocus={() => { isEditingMemoryRef.current = true; }}
            onBlur={() => {
              isEditingMemoryRef.current = false;
              const num = parseInt(memoryNumber, 10);
              if (isNaN(num) || memoryNumber === '') {
                setMemoryNumber('12');
                updateConfigValue(['processing', 'dask_memory_limit'], `12${memoryUnit}`);
              } else {
                setMemoryNumber(String(num));
                updateConfigValue(['processing', 'dask_memory_limit'], `${num}${memoryUnit}`);
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
          inputMode="numeric"
          value={daskMaxInFlight.value}
          onChange={daskMaxInFlight.onChange}
          onFocus={daskMaxInFlight.onFocus}
          onBlur={daskMaxInFlight.onBlur}
        />
        <p className="text-xs text-muted-foreground">Max concurrent tasks queued per Dask worker. Higher values improve I/O pipelining on HPC with fast storage (try 4-6).</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="batch-size">Batch Size</Label>
        <Input
          id="batch-size"
          type="text"
          inputMode="numeric"
          value={batchSize.value}
          onChange={batchSize.onChange}
          onFocus={batchSize.onFocus}
          onBlur={batchSize.onBlur}
        />
        <p className="text-xs text-muted-foreground">Number of image pairs per processing batch. Controls memory usage and I/O pipelining.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="post-processing-workers">Post-Processing Workers</Label>
        <Input
          id="post-processing-workers"
          type="text"
          inputMode="numeric"
          placeholder="auto"
          value={ppWorkers}
          onChange={(e) => {
            setPpWorkers(e.target.value);
          }}
          onFocus={() => { isEditingPpWorkersRef.current = true; }}
          onBlur={() => {
            isEditingPpWorkersRef.current = false;
            const trimmed = ppWorkers.trim();
            if (trimmed === '') {
              setPpWorkers('');
              updateConfigValue(['processing', 'post_processing_workers'], null);
            } else {
              const num = parseInt(trimmed, 10);
              if (isNaN(num) || num < 1) {
                setPpWorkers('');
                updateConfigValue(['processing', 'post_processing_workers'], null);
              } else {
                setPpWorkers(String(num));
                updateConfigValue(['processing', 'post_processing_workers'], num);
              }
            }
          }}
        />
        <p className="text-xs text-muted-foreground">Max parallel workers for calibration, statistics, transforms, and merging. Leave empty for auto (min of CPU count and 16).</p>
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
