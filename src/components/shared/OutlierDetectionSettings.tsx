"use client";

import { useState, useEffect, memo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus } from "lucide-react";

interface OutlierDetectionSettingsProps {
  config: any;
  updateConfigValue: (path: string[], value: any) => void;
  configPath?: 'outlier_detection' | 'ensemble_outlier_detection';
}

interface OutlierMethod {
  type: 'peak_mag' | 'median_2d' | 'sigma';
  threshold?: number;
  epsilon?: number;
  sigma_threshold?: number;
}

interface LocalOutlierMethod {
  type: 'peak_mag' | 'median_2d' | 'sigma';
  threshold: string;
  epsilon: string;
  sigma_threshold: string;
}

const OutlierDetectionSettings = memo(function OutlierDetectionSettings({
  config,
  updateConfigValue,
  configPath = 'outlier_detection'
}: OutlierDetectionSettingsProps) {
  const outlierConfig = config?.[configPath] || { enabled: true, methods: [] };
  const methods = outlierConfig.methods || [];

  const [localMethods, setLocalMethods] = useState<LocalOutlierMethod[]>([]);
  const isUserEditingRef = useRef(false);

  useEffect(() => {
    // Don't sync from config while user is editing
    if (isUserEditingRef.current) return;

    const locals: LocalOutlierMethod[] = methods.map((m: OutlierMethod) => ({
      ...m,
      threshold: m.threshold?.toString() ?? (m.type === 'median_2d' ? '2.0' : '0.4'),
      epsilon: m.epsilon?.toString() ?? '0.2',
      sigma_threshold: m.sigma_threshold?.toString() ?? '3.0'
    }));
    setLocalMethods(locals);
  }, [methods]);

  const addOutlierMethod = () => {
    const newMethods = [...methods, { type: 'peak_mag', threshold: 0.4 }];
    updateConfigValue([configPath, 'methods'], newMethods);
  };

  const removeOutlierMethod = (index: number) => {
    const newMethods = methods.filter((_: any, i: number) => i !== index);
    updateConfigValue([configPath, 'methods'], newMethods);
  };

  const updateOutlierMethod = (index: number, field: string, value: any) => {
    const newMethods = [...methods];
    newMethods[index] = { ...newMethods[index], [field]: value };
    updateConfigValue([configPath, 'methods'], newMethods);
  };

  const toggleOutlierEnabled = () => {
    updateConfigValue([configPath, 'enabled'], !outlierConfig.enabled);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Enable Outlier Detection</Label>
        <Button
          variant={outlierConfig.enabled ? "default" : "outline"}
          size="sm"
          onClick={toggleOutlierEnabled}
        >
          {outlierConfig.enabled ? "Enabled" : "Disabled"}
        </Button>
      </div>

      {outlierConfig.enabled && (
        <>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Detection Methods</Label>
            <Button variant="outline" size="sm" onClick={addOutlierMethod}>
              <Plus className="h-3 w-3 mr-1" /> Add Method
            </Button>
          </div>

          <div className="space-y-3">
            {methods.map((method: OutlierMethod, i: number) => (
              <div key={i} className="p-3 bg-white border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Method {i + 1}</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeOutlierMethod(i)}
                  >
                    <X className="h-3 w-3 text-red-500" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={method.type || 'peak_mag'}
                      onValueChange={(value) => updateOutlierMethod(i, 'type', value)}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="peak_mag">Peak Magnitude</SelectItem>
                        <SelectItem value="median_2d">Median 2D</SelectItem>
                        <SelectItem value="sigma">Sigma (Local Std Dev)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {method.type === 'peak_mag' && (
                    <div className="space-y-1">
                      <Label className="text-xs">Threshold</Label>
                      <Input
                        className="h-8 text-sm"
                        type="text"
                        value={localMethods[i]?.threshold ?? '0.4'}
                        onFocus={() => { isUserEditingRef.current = true; }}
                        onChange={(e) => {
                          const val = e.target.value;
                          const newLocal = [...localMethods];
                          newLocal[i] = { ...newLocal[i], threshold: val };
                          setLocalMethods(newLocal);
                        }}
                        onBlur={() => {
                          isUserEditingRef.current = false;
                          const val = localMethods[i]?.threshold;
                          const num = parseFloat(val);
                          if (!isNaN(num) && val !== '' && val !== undefined) {
                            updateOutlierMethod(i, 'threshold', num);
                          } else {
                            const defaultVal = 0.4;
                            const newLocal = [...localMethods];
                            newLocal[i] = { ...newLocal[i], threshold: defaultVal.toString() };
                            setLocalMethods(newLocal);
                            updateOutlierMethod(i, 'threshold', defaultVal);
                          }
                        }}
                      />
                    </div>
                  )}

                  {method.type === 'median_2d' && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Epsilon</Label>
                        <Input
                          className="h-8 text-sm"
                          type="text"
                          value={localMethods[i]?.epsilon ?? '0.2'}
                          onFocus={() => { isUserEditingRef.current = true; }}
                          onChange={(e) => {
                            const val = e.target.value;
                            const newLocal = [...localMethods];
                            newLocal[i] = { ...newLocal[i], epsilon: val };
                            setLocalMethods(newLocal);
                          }}
                          onBlur={() => {
                            isUserEditingRef.current = false;
                            const val = localMethods[i]?.epsilon;
                            const num = parseFloat(val);
                            if (!isNaN(num) && val !== '' && val !== undefined) {
                              updateOutlierMethod(i, 'epsilon', num);
                            } else {
                              const defaultVal = 0.2;
                              const newLocal = [...localMethods];
                              newLocal[i] = { ...newLocal[i], epsilon: defaultVal.toString() };
                              setLocalMethods(newLocal);
                              updateOutlierMethod(i, 'epsilon', defaultVal);
                            }
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Threshold</Label>
                        <Input
                          className="h-8 text-sm"
                          type="text"
                          value={localMethods[i]?.threshold ?? '2.0'}
                          onFocus={() => { isUserEditingRef.current = true; }}
                          onChange={(e) => {
                            const val = e.target.value;
                            const newLocal = [...localMethods];
                            newLocal[i] = { ...newLocal[i], threshold: val };
                            setLocalMethods(newLocal);
                          }}
                          onBlur={() => {
                            isUserEditingRef.current = false;
                            const val = localMethods[i]?.threshold;
                            const num = parseFloat(val);
                            if (!isNaN(num) && val !== '' && val !== undefined) {
                              updateOutlierMethod(i, 'threshold', num);
                            } else {
                              const defaultVal = 2.0;
                              const newLocal = [...localMethods];
                              newLocal[i] = { ...newLocal[i], threshold: defaultVal.toString() };
                              setLocalMethods(newLocal);
                              updateOutlierMethod(i, 'threshold', defaultVal);
                            }
                          }}
                        />
                      </div>
                    </>
                  )}

                  {method.type === 'sigma' && (
                    <div className="space-y-1">
                      <Label className="text-xs">Sigma Threshold</Label>
                      <Input
                        className="h-8 text-sm"
                        type="text"
                        value={localMethods[i]?.sigma_threshold ?? '3.0'}
                        onFocus={() => { isUserEditingRef.current = true; }}
                        onChange={(e) => {
                          const val = e.target.value;
                          const newLocal = [...localMethods];
                          newLocal[i] = { ...newLocal[i], sigma_threshold: val };
                          setLocalMethods(newLocal);
                        }}
                        onBlur={() => {
                          isUserEditingRef.current = false;
                          const val = localMethods[i]?.sigma_threshold;
                          const num = parseFloat(val);
                          if (!isNaN(num) && val !== '' && val !== undefined) {
                            updateOutlierMethod(i, 'sigma_threshold', num);
                          } else {
                            const defaultVal = 3.0;
                            const newLocal = [...localMethods];
                            newLocal[i] = { ...newLocal[i], sigma_threshold: defaultVal.toString() };
                            setLocalMethods(newLocal);
                            updateOutlierMethod(i, 'sigma_threshold', defaultVal);
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {methods.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No detection methods configured. Click "Add Method" to add one.
            </p>
          )}
        </>
      )}
    </div>
  );
});

export default OutlierDetectionSettings;
