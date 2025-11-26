"use client";

import { useState, useEffect, memo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface InfillingSettingsProps {
  config: any;
  updateConfigValue: (path: string[], value: any) => void;
  configPath?: 'infilling' | 'ensemble_infilling';
}

const InfillingSettings = memo(function InfillingSettings({
  config,
  updateConfigValue,
  configPath = 'infilling'
}: InfillingSettingsProps) {
  const infillingConfig = config?.[configPath] || { mid_pass: {}, final_pass: {} };

  // Local state for text inputs
  const [localMidKsize, setLocalMidKsize] = useState<string>('');
  const [localMidNeighbors, setLocalMidNeighbors] = useState<string>('');
  const [localFinalKsize, setLocalFinalKsize] = useState<string>('');
  const [localFinalNeighbors, setLocalFinalNeighbors] = useState<string>('');
  const isUserEditingRef = useRef(false);

  // Sync local state from config
  useEffect(() => {
    if (isUserEditingRef.current) return;
    setLocalMidKsize(infillingConfig.mid_pass?.parameters?.ksize?.toString() ?? '3');
    setLocalMidNeighbors(infillingConfig.mid_pass?.parameters?.n_neighbors?.toString() ?? '');
    setLocalFinalKsize(infillingConfig.final_pass?.parameters?.ksize?.toString() ?? '3');
    setLocalFinalNeighbors(infillingConfig.final_pass?.parameters?.n_neighbors?.toString() ?? '');
  }, [infillingConfig.mid_pass?.parameters?.ksize, infillingConfig.mid_pass?.parameters?.n_neighbors,
      infillingConfig.final_pass?.parameters?.ksize, infillingConfig.final_pass?.parameters?.n_neighbors]);

  const updateMidPass = (field: string, value: any) => {
    const updated = { ...infillingConfig.mid_pass, [field]: value };
    updateConfigValue([configPath, 'mid_pass'], updated);
  };

  const updateMidPassParam = (param: string, value: any) => {
    const params = { ...(infillingConfig.mid_pass?.parameters || {}), [param]: value };
    updateMidPass('parameters', params);
  };

  const updateFinalPass = (field: string, value: any) => {
    const updated = { ...infillingConfig.final_pass, [field]: value };
    updateConfigValue([configPath, 'final_pass'], updated);
  };

  const updateFinalPassParam = (param: string, value: any) => {
    const params = { ...(infillingConfig.final_pass?.parameters || {}), [param]: value };
    updateFinalPass('parameters', params);
  };

  return (
    <div className="space-y-6">
      {/* Mid-Pass Infilling */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold">Mid-Pass Infilling</Label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Method</Label>
            <Select
              value={infillingConfig.mid_pass?.method || 'local_median'}
              onValueChange={(value) => updateMidPass('method', value)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local_median">Local Median</SelectItem>
                <SelectItem value="knn">K-Nearest Neighbors</SelectItem>
                <SelectItem value="biharmonic">Biharmonic</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(infillingConfig.mid_pass?.method === 'local_median' || infillingConfig.mid_pass?.method === 'biharmonic') && (
            <div className="space-y-1">
              <Label className="text-xs">Kernel Size</Label>
              <Input
                className="h-8 text-sm"
                type="text"
                value={localMidKsize}
                onFocus={() => { isUserEditingRef.current = true; }}
                onChange={(e) => setLocalMidKsize(e.target.value)}
                onBlur={() => {
                  isUserEditingRef.current = false;
                  const num = parseInt(localMidKsize, 10);
                  if (!isNaN(num) && localMidKsize !== '') {
                    updateMidPassParam('ksize', num);
                  } else {
                    setLocalMidKsize('3');
                    updateMidPassParam('ksize', 3);
                  }
                }}
              />
            </div>
          )}

          {infillingConfig.mid_pass?.method === 'knn' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Neighbors</Label>
                <Input
                  className="h-8 text-sm"
                  type="text"
                  value={localMidNeighbors}
                  onFocus={() => { isUserEditingRef.current = true; }}
                  onChange={(e) => setLocalMidNeighbors(e.target.value)}
                  onBlur={() => {
                    isUserEditingRef.current = false;
                    const num = parseInt(localMidNeighbors, 10);
                    if (!isNaN(num) && localMidNeighbors !== '') {
                      updateMidPassParam('n_neighbors', num);
                    }
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Weights</Label>
                <Select
                  value={infillingConfig.mid_pass?.parameters?.weights || 'distance'}
                  onValueChange={(value) => updateMidPassParam('weights', value)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="uniform">Uniform</SelectItem>
                    <SelectItem value="distance">Distance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Algorithm</Label>
                <Select
                  value={infillingConfig.mid_pass?.parameters?.algorithm || 'kd_tree'}
                  onValueChange={(value) => updateMidPassParam('algorithm', value)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="ball_tree">Ball Tree</SelectItem>
                    <SelectItem value="kd_tree">KD Tree</SelectItem>
                    <SelectItem value="brute">Brute Force</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Final Pass Infilling */}
      <div className="space-y-3 pt-3 border-t">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Final Pass Infilling</Label>
          <Button
            variant={infillingConfig.final_pass?.enabled ? "default" : "outline"}
            size="sm"
            onClick={() => updateFinalPass('enabled', !infillingConfig.final_pass?.enabled)}
          >
            {infillingConfig.final_pass?.enabled ? "Enabled" : "Disabled"}
          </Button>
        </div>

        {infillingConfig.final_pass?.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Method</Label>
              <Select
                value={infillingConfig.final_pass?.method || 'local_median'}
                onValueChange={(value) => updateFinalPass('method', value)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local_median">Local Median</SelectItem>
                  <SelectItem value="knn">K-Nearest Neighbors</SelectItem>
                  <SelectItem value="biharmonic">Biharmonic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(infillingConfig.final_pass?.method === 'local_median' || infillingConfig.final_pass?.method === 'biharmonic') && (
              <div className="space-y-1">
                <Label className="text-xs">Kernel Size</Label>
                <Input
                  className="h-8 text-sm"
                  type="text"
                  value={localFinalKsize}
                  onFocus={() => { isUserEditingRef.current = true; }}
                  onChange={(e) => setLocalFinalKsize(e.target.value)}
                  onBlur={() => {
                    isUserEditingRef.current = false;
                    const num = parseInt(localFinalKsize, 10);
                    if (!isNaN(num) && localFinalKsize !== '') {
                      updateFinalPassParam('ksize', num);
                    } else {
                      setLocalFinalKsize('3');
                      updateFinalPassParam('ksize', 3);
                    }
                  }}
                />
              </div>
            )}

            {infillingConfig.final_pass?.method === 'knn' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Neighbors</Label>
                  <Input
                    className="h-8 text-sm"
                    type="text"
                    value={localFinalNeighbors}
                    onFocus={() => { isUserEditingRef.current = true; }}
                    onChange={(e) => setLocalFinalNeighbors(e.target.value)}
                    onBlur={() => {
                      isUserEditingRef.current = false;
                      const num = parseInt(localFinalNeighbors, 10);
                      if (!isNaN(num) && localFinalNeighbors !== '') {
                        updateFinalPassParam('n_neighbors', num);
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Weights</Label>
                  <Select
                    value={infillingConfig.final_pass?.parameters?.weights || 'distance'}
                    onValueChange={(value) => updateFinalPassParam('weights', value)}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="uniform">Uniform</SelectItem>
                      <SelectItem value="distance">Distance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Algorithm</Label>
                  <Select
                    value={infillingConfig.final_pass?.parameters?.algorithm || 'kd_tree'}
                    onValueChange={(value) => updateFinalPassParam('algorithm', value)}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="ball_tree">Ball Tree</SelectItem>
                      <SelectItem value="kd_tree">KD Tree</SelectItem>
                      <SelectItem value="brute">Brute Force</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default InfillingSettings;
