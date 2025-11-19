"use client";
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PolynomialCalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  cameraOptions: number[];
  sourcePaths: string[];
  imageCount?: number;
}

// Helper to show just the last segment of a path
const basename = (p: string) => {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.filter(Boolean).pop() || p;
};

const POLYNOMIAL_TERMS = [
  { id: "const", label: <span>1</span> },
  { id: "s", label: <span><i>s</i></span> },
  { id: "s2", label: <span><i>s</i><sup>2</sup></span> },
  { id: "s3", label: <span><i>s</i><sup>3</sup></span> },
  { id: "t", label: <span><i>t</i></span> },
  { id: "t2", label: <span><i>t</i><sup>2</sup></span> },
  { id: "t3", label: <span><i>t</i><sup>3</sup></span> },
  { id: "st", label: <span><i>st</i></span> },
  { id: "s2t", label: <span><i>s</i><sup>2</sup><i>t</i></span> },
  { id: "st2", label: <span><i>s</i><i>t</i><sup>2</sup></span> },
];

const TERM_SUFFIX_MAPPING: Record<string, string> = {
  "o": "const",
  "s": "s",
  "s2": "s2",
  "s3": "s3",
  "t": "t",
  "t2": "t2",
  "t3": "t3",
  "st": "st",
  "s2t": "s2t",
  "st2": "st2"
};

export const PolynomialCalibration: React.FC<PolynomialCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
  imageCount = 1000,
}) => {
  const [coefficients, setCoefficients] = useState<Record<string, { dx: Record<string, string>, dy: Record<string, string> }>>({});
  const [cameraParams, setCameraParams] = useState<Record<number, { s_o: number, t_o: number, nx: number, ny: number }>>({});
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(0);
  const [calibrating, setCalibrating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("not_started");
  const [jobDetails, setJobDetails] = useState<any>(null);

  // Initialize state from config
  useEffect(() => {
    const polyConfig = config.calibration?.polynomial || {};
    setCoefficients(polyConfig.coefficients || {});
    setSourcePathIdx(polyConfig.source_path_idx ?? 0);
  }, [config]);

  // Fetch XML calibration data
  useEffect(() => {
    const fetchXmlData = async () => {
      try {
        const response = await fetch('/backend/calibration/polynomial/read_xml', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_path_idx: sourcePathIdx })
        });
        const data = await response.json();
        
        if (data.status === 'success' && data.cameras) {
          const newCoefficients: Record<string, { dx: Record<string, string>, dy: Record<string, string> }> = {};
          const newCameraParams: Record<number, { s_o: number, t_o: number, nx: number, ny: number }> = {};
          
          Object.entries(data.cameras).forEach(([camIdStr, camData]: [string, any]) => {
             const match = camIdStr.match(/\d+/);
             if (!match) return;
             const camNum = parseInt(match[0], 10);
             
             if (!cameraOptions.includes(camNum)) return;
             
             // Extract params
             if (camData.origin && camData.normalisation) {
                 newCameraParams[camNum] = {
                     s_o: camData.origin.s_o,
                     t_o: camData.origin.t_o,
                     nx: camData.normalisation.nx,
                     ny: camData.normalisation.ny
                 };
             }
             
             const coeffsA = camData.coefficients_a || {};
             const coeffsB = camData.coefficients_b || {};
             
             const mappedDx: Record<string, string> = {};
             const mappedDy: Record<string, string> = {};
             
             Object.entries(coeffsA).forEach(([key, val]) => {
                const suffix = key.split('_').slice(1).join('_');
                const termId = TERM_SUFFIX_MAPPING[suffix];
                if (termId) mappedDx[termId] = String(val);
             });

             Object.entries(coeffsB).forEach(([key, val]) => {
                const suffix = key.split('_').slice(1).join('_');
                const termId = TERM_SUFFIX_MAPPING[suffix];
                if (termId) mappedDy[termId] = String(val);
             });
             
             if (Object.keys(mappedDx).length > 0 || Object.keys(mappedDy).length > 0) {
                 newCoefficients[camNum] = { dx: mappedDx, dy: mappedDy };
             }
          });
          
          if (Object.keys(newCameraParams).length > 0) {
              setCameraParams(newCameraParams);
          }
          
          if (Object.keys(newCoefficients).length > 0) {
              setCoefficients(prev => {
                  // Check for changes to avoid infinite loops
                  let hasChanges = false;
                  for (const [camId, coeffs] of Object.entries(newCoefficients)) {
                      if (!prev[camId]) {
                          hasChanges = true;
                          break;
                      }
                      if (JSON.stringify(prev[camId]) !== JSON.stringify(coeffs)) {
                          hasChanges = true;
                          break;
                      }
                  }

                  if (hasChanges) {
                      const updated = { ...prev, ...newCoefficients };
                      updateConfig(["calibration", "polynomial", "coefficients"], updated);
                      return updated;
                  }
                  return prev;
              });
          }
        }
      } catch (e) {
        console.error("Failed to load polynomial XML:", e);
      }
    };
    
    fetchXmlData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePathIdx, JSON.stringify(cameraOptions)]);

  // Handle coefficient change
  const handleCoefficientChange = (camId: number, axis: 'dx' | 'dy', termId: string, value: string) => {
    const camCoeffs = coefficients[camId] || { dx: {}, dy: {} };
    const axisCoeffs = camCoeffs[axis] || {};
    const newAxisCoeffs = { ...axisCoeffs, [termId]: value };
    const newCamCoeffs = { ...camCoeffs, [axis]: newAxisCoeffs };
    const newCoefficients = { ...coefficients, [camId]: newCamCoeffs };
    setCoefficients(newCoefficients);
    
    // Update config
    updateConfig(["calibration", "polynomial", "coefficients"], newCoefficients);
  };

  // Check if all cameras have coefficients
  const allPopulated = cameraOptions.length > 0 && cameraOptions.every(camId => {
    const camCoeffs = coefficients[camId];
    if (!camCoeffs) return false;
    return ['dx', 'dy'].every(axis => {
        const axisCoeffs = camCoeffs[axis as 'dx' | 'dy'];
        if (!axisCoeffs) return false;
        return POLYNOMIAL_TERMS.every(term => {
            const val = axisCoeffs[term.id];
            return val && val.trim().length > 0;
        });
    });
  });

  const calibrateVectors = async () => {
    if (!allPopulated) return;
    setCalibrating(true);
    try {
      const response = await fetch('/backend/calibration/polynomial/calibrate_vectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          coefficients: coefficients,
          image_count: imageCount,
          type_name: "instantaneous"
        })
      });
      const result = await response.json();
      if (response.ok) {
        console.log(`Polynomial calibration started! Job ID: ${result.job_id}`);
        setJobId(result.job_id);
      } else {
        console.error(result.error || "Failed to start polynomial calibration");
      }
    } catch (e: any) {
      console.error(`Error starting polynomial calibration: ${e.message}`);
    } finally {
      setCalibrating(false);
    }
  };

  // Poll job status
  useEffect(() => {
    if (!jobId) {
        setJobStatus("not_started");
        setJobDetails(null);
        return;
    }

    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/backend/calibration/polynomial/status/${jobId}`);
        const data = await res.json();
        if (active) {
            setJobStatus(data.status || "not_started");
            setJobDetails(data);
            if (data.status === 'completed' || data.status === 'failed' || data.progress >= 100) {
                clearInterval(interval);
            }
        }
      } catch (e) {
        console.error(e);
        if (active) setJobStatus("not_started");
        clearInterval(interval);
      }
    }, 1000);

    return () => {
        active = false;
        clearInterval(interval);
    };
  }, [jobId]);

  const setAsActiveMethod = async () => {
    try {
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calibration: {
            active: "polynomial",
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to set active method");
      if (json.updated?.calibration) {
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (err) {
      console.error("Failed to set active calibration method:", err);
    }
  };

  const isActive = config.calibration?.active === "polynomial";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex justify-between items-center">
            <span>Polynomial Calibration</span>
            <Button 
                variant={isActive ? "default" : "outline"}
                size="sm"
                onClick={setAsActiveMethod}
                disabled={isActive}
            >
                {isActive ? "Active Method" : "Set as Active Method"}
            </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Display */}
        {jobId && jobDetails && (
            <div className="mb-4 p-4 border rounded bg-blue-50">
            <div className="flex items-center gap-2 text-sm mb-2">
                <strong>Calibration Progress:</strong>
                <span className="font-medium">{jobStatus}</span>
            </div>
            {(jobStatus === 'running' || jobStatus === 'starting') && (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full"></span>
                Processing files...
                </div>
            )}
            <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
                <div className={`h-2 bg-green-600`} style={{ width: `${jobDetails.progress || 0}%` }}></div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
                Progress: {jobDetails.progress || 0}%
                {jobDetails.processed_files !== undefined && jobDetails.total_files !== undefined &&
                ` (Files: ${jobDetails.processed_files}/${jobDetails.total_files})`}
            </div>
            {jobStatus === 'completed' && (
                <div className="mt-2 text-xs text-green-600">
                Calibration completed! Processed {jobDetails.processed_files} files.
                </div>
            )}
            </div>
        )}

        <div className="space-y-2">
          <Label>Source Path</Label>
          <Select
            value={String(sourcePathIdx)}
            onValueChange={(v) => {
                const idx = Number(v);
                setSourcePathIdx(idx);
                updateConfig(["calibration", "polynomial", "source_path_idx"], idx);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select source path" />
            </SelectTrigger>
            <SelectContent>
              {sourcePaths.map((path, idx) => (
                <SelectItem key={idx} value={String(idx)}>
                  {basename(path)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-6">
          {cameraOptions.map((camId) => (
            <div key={camId} className="space-y-3 border p-4 rounded-md">
              <Label className="text-base font-semibold">Camera {camId} Coefficients</Label>
              
              {/* Equations Display */}
              {cameraParams[camId] && (
                  <div className="bg-slate-50 p-4 rounded border mb-4 font-mono text-sm space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                              <div className="font-semibold text-muted-foreground mb-1">Normalized Coordinates:</div>
                              <div>s(x&apos;) = 2 · (x&apos; - {cameraParams[camId].s_o.toFixed(4)}) / {cameraParams[camId].nx}</div>
                              <div>t(y&apos;) = 2 · (y&apos; - {cameraParams[camId].t_o.toFixed(4)}) / {cameraParams[camId].ny}</div>
                          </div>
                          <div>
                              <div className="font-semibold text-muted-foreground mb-1">World Coordinates:</div>
                              <div>x = x&apos; - dx(s(x&apos;), t(y&apos;))</div>
                              <div>y = y&apos; - dy(s(x&apos;), t(y&apos;))</div>
                          </div>
                      </div>
                  </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* DX Section */}
                  <div className="space-y-2">
                     <Label className="text-sm font-medium text-muted-foreground">dx = (Horizontal Displacement)</Label>
                     <div className="flex flex-col gap-3 pl-2 border-l-2 border-blue-100">
                        {[
                          POLYNOMIAL_TERMS.slice(0, 4),
                          POLYNOMIAL_TERMS.slice(4, 7),
                          POLYNOMIAL_TERMS.slice(7, 10)
                        ].map((group, groupIndex) => (
                          <div key={groupIndex} className="flex flex-wrap items-center gap-2">
                            {groupIndex > 0 && (
                                <span className="text-muted-foreground font-bold mr-1">+</span>
                            )}
                            {group.map((term, termIndex) => (
                              <React.Fragment key={term.id}>
                                <div className="flex items-center gap-1">
                                    <Input
                                      placeholder="0.0"
                                      value={((coefficients[camId] || {}).dx || {})[term.id] || ""}
                                      onChange={(e) => handleCoefficientChange(camId, 'dx', term.id, e.target.value)}
                                      className="h-8 w-20 font-mono text-sm text-right"
                                    />
                                    <Label className="text-sm">
                                        {term.label}
                                    </Label>
                                </div>
                                {termIndex < group.length - 1 && (
                                    <span className="text-muted-foreground font-bold">+</span>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        ))}
                     </div>
                  </div>

                  {/* DY Section */}
                  <div className="space-y-2">
                     <Label className="text-sm font-medium text-muted-foreground">dy = (Vertical Displacement)</Label>
                     <div className="flex flex-col gap-3 pl-2 border-l-2 border-green-100">
                        {[
                          POLYNOMIAL_TERMS.slice(0, 4),
                          POLYNOMIAL_TERMS.slice(4, 7),
                          POLYNOMIAL_TERMS.slice(7, 10)
                        ].map((group, groupIndex) => (
                          <div key={groupIndex} className="flex flex-wrap items-center gap-2">
                            {groupIndex > 0 && (
                                <span className="text-muted-foreground font-bold mr-1">+</span>
                            )}
                            {group.map((term, termIndex) => (
                              <React.Fragment key={term.id}>
                                <div className="flex items-center gap-1">
                                    <Input
                                      placeholder="0.0"
                                      value={((coefficients[camId] || {}).dy || {})[term.id] || ""}
                                      onChange={(e) => handleCoefficientChange(camId, 'dy', term.id, e.target.value)}
                                      className="h-8 w-20 font-mono text-sm text-right"
                                    />
                                    <Label className="text-sm">
                                        {term.label}
                                    </Label>
                                </div>
                                {termIndex < group.length - 1 && (
                                    <span className="text-muted-foreground font-bold">+</span>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        ))}
                     </div>
                  </div>
              </div>

            </div>
          ))}
        </div>

        <Button 
            onClick={calibrateVectors} 
            disabled={!allPopulated || calibrating || jobStatus === 'running'}
            className="w-full"
        >
            {calibrating ? "Starting..." : "Calibrate All Vectors"}
        </Button>
      </CardContent>
    </Card>
  );
};
