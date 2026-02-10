"use client";
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

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
  { id: "const", label: <span>1</span>, index: 0 },
  { id: "s", label: <span><i>s</i></span>, index: 1 },
  { id: "s2", label: <span><i>s</i><sup>2</sup></span>, index: 2 },
  { id: "s3", label: <span><i>s</i><sup>3</sup></span>, index: 3 },
  { id: "t", label: <span><i>t</i></span>, index: 4 },
  { id: "t2", label: <span><i>t</i><sup>2</sup></span>, index: 5 },
  { id: "t3", label: <span><i>t</i><sup>3</sup></span>, index: 6 },
  { id: "st", label: <span><i>st</i></span>, index: 7 },
  { id: "s2t", label: <span><i>s</i><sup>2</sup><i>t</i></span>, index: 8 },
  { id: "st2", label: <span><i>s</i><i>t</i><sup>2</sup></span>, index: 9 },
];

const TERM_SUFFIX_MAPPING: Record<string, number> = {
  "o": 0,
  "s": 1,
  "s2": 2,
  "s3": 3,
  "t": 4,
  "t2": 5,
  "t3": 6,
  "st": 7,
  "s2t": 8,
  "st2": 9
};

// Camera params structure matching config.yaml
interface CameraParams {
  origin: { x: number; y: number };
  normalisation: { nx: number; ny: number };
  mm_per_pixel: number;
  coefficients_x: number[];
  coefficients_y: number[];
}

export const PolynomialCalibration: React.FC<PolynomialCalibrationProps> = ({
  config,
  updateConfig,
  cameraOptions,
  sourcePaths,
}) => {
  // Camera params in the new config structure
  const [cameraParams, setCameraParams] = useState<Record<number, CameraParams>>({});
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(0);
  const [calibrating, setCalibrating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("not_started");
  const [jobDetails, setJobDetails] = useState<any>(null);

  // Vector type and XML validation
  const [vectorTypeName, setVectorTypeName] = useState<'instantaneous' | 'ensemble'>('instantaneous');
  const [xmlValidation, setXmlValidation] = useState<{valid: boolean, error?: string, cameras?: string[]} | null>(null);
  const [validatingXml, setValidatingXml] = useState(false);

  // XML path and use_xml flag
  const [xmlPath, setXmlPath] = useState<string>('');
  const [useXml, setUseXml] = useState<boolean>(true);
  const [loadingXml, setLoadingXml] = useState(false);

  // Initialize state from config
  useEffect(() => {
    const polyConfig = config.calibration?.polynomial || {};
    const cameras = polyConfig.cameras || {};

    // Convert config cameras to our state format
    const params: Record<number, CameraParams> = {};
    Object.entries(cameras).forEach(([camIdStr, camData]: [string, any]) => {
      const camId = parseInt(camIdStr, 10);
      if (isNaN(camId)) return;

      params[camId] = {
        origin: camData.origin || { x: 0, y: 0 },
        normalisation: camData.normalisation || { nx: 512, ny: 384 },
        mm_per_pixel: camData.mm_per_pixel || 0,
        coefficients_x: camData.coefficients_x || Array(10).fill(0),
        coefficients_y: camData.coefficients_y || Array(10).fill(0),
      };
    });

    setCameraParams(params);
    setSourcePathIdx(polyConfig.source_path_idx ?? 0);
    setXmlPath(polyConfig.xml_path ?? '');
    setUseXml(polyConfig.use_xml ?? true);
  }, [config]);

  // Load piv_type from config on mount
  useEffect(() => {
    const pivType = config.calibration?.piv_type;
    if (pivType === 'instantaneous' || pivType === 'ensemble') {
      setVectorTypeName(pivType);
    }
  }, [config.calibration?.piv_type]);

  // Save piv_type when changed
  const handleVectorTypeChange = async (value: 'instantaneous' | 'ensemble') => {
    setVectorTypeName(value);
    try {
      const res = await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calibration: { piv_type: value }
        })
      });
      const json = await res.json();
      if (res.ok && json.updated?.calibration) {
        // Sync parent config state so other tabs see the update
        updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
      }
    } catch (e) {
      console.error('Failed to save piv_type:', e);
    }
  };

  // Validate XML on path change
  useEffect(() => {
    const validateXml = async () => {
      // Only validate if useXml is enabled and we have a path
      if (!useXml) {
        setXmlValidation(null);
        return;
      }

      setValidatingXml(true);
      try {
        const res = await fetch('/backend/calibration/polynomial/validate_xml', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            xml_path: xmlPath || undefined,
            source_path_idx: sourcePathIdx
          })
        });
        const data = await res.json();
        setXmlValidation(data);
      } catch (e) {
        setXmlValidation({ valid: false, error: 'Failed to validate XML' });
      } finally {
        setValidatingXml(false);
      }
    };
    validateXml();
  }, [xmlPath, sourcePathIdx, useXml]);

  // Save camera params to config
  const saveCameraToConfig = async (camId: number, params: CameraParams) => {
    try {
      await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calibration: {
            polynomial: {
              cameras: {
                [camId]: params
              }
            }
          }
        })
      });
    } catch (e) {
      console.error(`Failed to save camera ${camId} params:`, e);
    }
  };

  // Handle xmlPath change - save to config
  const handleXmlPathChange = async (value: string) => {
    setXmlPath(value);
    try {
      await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calibration: { polynomial: { xml_path: value } }
        })
      });
    } catch (e) {
      console.error('Failed to save xml_path:', e);
    }
  };

  // Handle useXml change - save to config
  const handleUseXmlChange = async (checked: boolean) => {
    setUseXml(checked);
    try {
      await fetch('/backend/update_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calibration: { polynomial: { use_xml: checked } }
        })
      });
    } catch (e) {
      console.error('Failed to save use_xml:', e);
    }
  };

  // Load XML to config (manual button)
  const loadXmlToConfig = async () => {
    setLoadingXml(true);
    try {
      const res = await fetch('/backend/calibration/polynomial/load_xml_to_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          xml_path: xmlPath || undefined,
          source_path_idx: sourcePathIdx
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        // Reload config to get updated camera params
        window.location.reload();
      } else {
        console.error('Failed to load XML:', data.error);
      }
    } catch (e) {
      console.error('Failed to load XML to config:', e);
    } finally {
      setLoadingXml(false);
    }
  };

  // Auto-fetch XML calibration data when path changes (if useXml is true)
  useEffect(() => {
    // Skip auto-loading if useXml is false
    if (!useXml) return;

    const fetchXmlData = async () => {
      try {
        const response = await fetch('/backend/calibration/polynomial/read_xml', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            xml_path: xmlPath || undefined,
            source_path_idx: sourcePathIdx
          })
        });
        const data = await response.json();

        if (data.status === 'success' && data.cameras) {
          const newCameraParams: Record<number, CameraParams> = {};

          Object.entries(data.cameras).forEach(([camIdStr, camData]: [string, any]) => {
             const match = camIdStr.match(/\d+/);
             if (!match) return;
             const camNum = parseInt(match[0], 10);

             if (!cameraOptions.includes(camNum)) return;

             // Extract origin
             const origin = {
               x: camData.origin?.s_o ?? camData.origin?.x ?? 0,
               y: camData.origin?.t_o ?? camData.origin?.y ?? 0,
             };

             // Extract normalisation
             const normalisation = {
               nx: camData.normalisation?.nx ?? 512,
               ny: camData.normalisation?.ny ?? 384,
             };

             // Extract mm_per_pixel
             const mm_per_pixel = camData.mm_per_pixel || 0;

             // Convert coefficients from dict {a_o, a_s, ...} to array [10]
             const coefficients_x: number[] = Array(10).fill(0);
             const coefficients_y: number[] = Array(10).fill(0);

             const coeffsA = camData.coefficients_a || {};
             const coeffsB = camData.coefficients_b || {};

             Object.entries(coeffsA).forEach(([key, val]) => {
                const suffix = key.split('_').slice(1).join('_');
                const idx = TERM_SUFFIX_MAPPING[suffix];
                if (idx !== undefined) coefficients_x[idx] = Number(val);
             });

             Object.entries(coeffsB).forEach(([key, val]) => {
                const suffix = key.split('_').slice(1).join('_');
                const idx = TERM_SUFFIX_MAPPING[suffix];
                if (idx !== undefined) coefficients_y[idx] = Number(val);
             });

             newCameraParams[camNum] = {
               origin,
               normalisation,
               mm_per_pixel,
               coefficients_x,
               coefficients_y,
             };
          });

          // Update local state
          setCameraParams(prev => {
            const updated = { ...prev };
            let hasChanges = false;

            for (const [camIdStr, params] of Object.entries(newCameraParams)) {
              const camId = parseInt(camIdStr, 10);
              if (JSON.stringify(updated[camId]) !== JSON.stringify(params)) {
                updated[camId] = params;
                hasChanges = true;
                // Save to config
                saveCameraToConfig(camId, params);
              }
            }

            return hasChanges ? updated : prev;
          });
        }
      } catch (e) {
        console.error("Failed to load polynomial XML:", e);
      }
    };

    fetchXmlData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xmlPath, sourcePathIdx, useXml, JSON.stringify(cameraOptions)]);

  // Handle coefficient change
  const handleCoefficientChange = (camId: number, axis: 'x' | 'y', index: number, value: string) => {
    setCameraParams(prev => {
      const cam = prev[camId] || {
        origin: { x: 0, y: 0 },
        normalisation: { nx: 512, ny: 384 },
        mm_per_pixel: 0,
        coefficients_x: Array(10).fill(0),
        coefficients_y: Array(10).fill(0),
      };

      const coeffs = axis === 'x' ? [...cam.coefficients_x] : [...cam.coefficients_y];
      coeffs[index] = parseFloat(value) || 0;

      const updated = {
        ...cam,
        [axis === 'x' ? 'coefficients_x' : 'coefficients_y']: coeffs,
      };

      // Save to config
      saveCameraToConfig(camId, updated);

      return { ...prev, [camId]: updated };
    });
  };

  // Handle param change (origin, normalisation)
  const handleParamChange = (camId: number, field: 'origin_x' | 'origin_y' | 'nx' | 'ny', value: string) => {
    setCameraParams(prev => {
      const cam = prev[camId] || {
        origin: { x: 0, y: 0 },
        normalisation: { nx: 512, ny: 384 },
        mm_per_pixel: 0,
        coefficients_x: Array(10).fill(0),
        coefficients_y: Array(10).fill(0),
      };

      let updated: CameraParams;
      if (field === 'origin_x') {
        updated = { ...cam, origin: { ...cam.origin, x: parseFloat(value) || 0 } };
      } else if (field === 'origin_y') {
        updated = { ...cam, origin: { ...cam.origin, y: parseFloat(value) || 0 } };
      } else if (field === 'nx') {
        updated = { ...cam, normalisation: { ...cam.normalisation, nx: parseFloat(value) || 1 } };
      } else {
        updated = { ...cam, normalisation: { ...cam.normalisation, ny: parseFloat(value) || 1 } };
      }

      // Save to config
      saveCameraToConfig(camId, updated);

      return { ...prev, [camId]: updated };
    });
  };

  // Check if all cameras have coefficients
  const allPopulated = cameraOptions.length > 0 && cameraOptions.every(camId => {
    const cam = cameraParams[camId];
    if (!cam) return false;
    // Check that at least some coefficients are non-zero
    return cam.coefficients_x.some(c => c !== 0) || cam.coefficients_y.some(c => c !== 0);
  });

  const calibrateVectors = async () => {
    setCalibrating(true);

    try {
      // Always calibrate all cameras from config.camera_numbers
      const response = await fetch('/backend/calibration/polynomial/calibrate_all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          type_name: vectorTypeName
        })
      });

      const result = await response.json();
      if (response.ok) {
        console.log(`Polynomial calibration started for all cameras! Job ID: ${result.job_id}`);
        setJobId(result.job_id);
      } else {
        console.error(result.error || 'Failed to start polynomial calibration');
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
        const res = await fetch(`/backend/calibration/polynomial/job/${jobId}`);
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
        <CardTitle>Polynomial Calibration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
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

        {/* XML Path and Use XML Settings */}
        <div className="space-y-4 p-4 border rounded-md bg-slate-50">
          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="useXml"
                checked={useXml}
                onCheckedChange={handleUseXmlChange}
              />
              <Label htmlFor="useXml" className="text-sm font-medium cursor-pointer">
                Use XML values
              </Label>
            </div>
            <span className="text-xs text-muted-foreground">
              {useXml ? "(disable to use manually entered values)" : "(enable to load from XML file)"}
            </span>
          </div>

          <div className="space-y-2">
            <Label>Calibration XML Path</Label>
            <div className="flex gap-2">
              <Input
                placeholder="/path/to/Calibration.xml (leave empty for default location)"
                value={xmlPath}
                onChange={(e) => handleXmlPathChange(e.target.value)}
                disabled={!useXml}
                className={!useXml ? "bg-gray-100" : ""}
              />
              <Button
                onClick={loadXmlToConfig}
                disabled={!useXml || loadingXml || !xmlValidation?.valid}
                variant="outline"
                className="whitespace-nowrap"
              >
                {loadingXml ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                Load from XML
              </Button>
            </div>
            {!xmlPath && useXml && (
              <p className="text-xs text-muted-foreground">
                Default: source_path/calibration_subfolder/Calibration.xml
              </p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {cameraOptions.map((camId) => {
            const cam = cameraParams[camId] || {
              origin: { x: 0, y: 0 },
              normalisation: { nx: 512, ny: 384 },
              mm_per_pixel: 0,
              coefficients_x: Array(10).fill(0),
              coefficients_y: Array(10).fill(0),
            };

            return (
            <div key={camId} className="space-y-3 border p-4 rounded-md">
              <Label className="text-base font-semibold">Camera {camId} Coefficients</Label>

              {/* Equations Display */}
              <div className="bg-slate-50 p-4 rounded border mb-4 font-mono text-sm space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                          <div className="font-semibold text-muted-foreground mb-1">Normalized Coordinates:</div>
                          <div className="flex items-center gap-1 mb-1">
                              <span>s(x&apos;) = 2 &middot; (x&apos; - </span>
                              <Input
                                className="h-6 w-20 px-1 text-center bg-white"
                                placeholder="s_o"
                                value={cam.origin.x || ""}
                                onChange={(e) => handleParamChange(camId, 'origin_x', e.target.value)}
                              />
                              <span>) / </span>
                              <Input
                                className="h-6 w-20 px-1 text-center bg-white"
                                placeholder="n_x"
                                value={cam.normalisation.nx || ""}
                                onChange={(e) => handleParamChange(camId, 'nx', e.target.value)}
                              />
                          </div>
                          <div className="flex items-center gap-1">
                              <span>t(y&apos;) = 2 &middot; (y&apos; - </span>
                              <Input
                                className="h-6 w-20 px-1 text-center bg-white"
                                placeholder="t_o"
                                value={cam.origin.y || ""}
                                onChange={(e) => handleParamChange(camId, 'origin_y', e.target.value)}
                              />
                              <span>) / </span>
                              <Input
                                className="h-6 w-20 px-1 text-center bg-white"
                                placeholder="n_y"
                                value={cam.normalisation.ny || ""}
                                onChange={(e) => handleParamChange(camId, 'ny', e.target.value)}
                              />
                          </div>
                      </div>
                      <div>
                          <div className="font-semibold text-muted-foreground mb-1">World Coordinates:</div>
                          <div className="h-6 flex items-center">x = x&apos; - dx(s(x&apos;), t(y&apos;))</div>
                          <div className="h-6 flex items-center">y = y&apos; - dy(s(x&apos;), t(y&apos;))</div>
                      </div>
                  </div>
              </div>

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
                                      value={cam.coefficients_x[term.index] || ""}
                                      onChange={(e) => handleCoefficientChange(camId, 'x', term.index, e.target.value)}
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
                                      value={cam.coefficients_y[term.index] || ""}
                                      onChange={(e) => handleCoefficientChange(camId, 'y', term.index, e.target.value)}
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
          )})}
        </div>

        {/* XML Validation Status */}
        {useXml && validatingXml && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Validating Calibration.xml...
          </div>
        )}

        {useXml && xmlValidation && !validatingXml && (
          xmlValidation.valid ? (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">Calibration.xml Found</AlertTitle>
              <AlertDescription className="text-green-700">
                Found {xmlValidation.cameras?.length || 0} camera(s) in XML
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>XML Not Found</AlertTitle>
              <AlertDescription>{xmlValidation.error}</AlertDescription>
            </Alert>
          )
        )}

        {/* Calibration Controls */}
        <div className="flex gap-2 items-center flex-wrap">
          {/* Calibrate Vectors with type selection */}
          <div className="flex items-center gap-1">
            <Button
                onClick={calibrateVectors}
                disabled={
                  (useXml && !xmlValidation?.valid) ||
                  calibrating ||
                  jobStatus === 'running' ||
                  (!useXml && !allPopulated)
                }
                className="bg-green-600 hover:bg-green-700 text-white rounded-r-none"
            >
                {calibrating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Calibrating...
                  </>
                ) : (
                  'Calibrate Vectors'
                )}
            </Button>
            <Select value={vectorTypeName} onValueChange={handleVectorTypeChange} disabled={calibrating}>
              <SelectTrigger className="w-[130px] rounded-l-none border-l-0 bg-green-600 hover:bg-green-700 text-white border-green-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instantaneous">Instantaneous</SelectItem>
                <SelectItem value="ensemble">Ensemble</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={setAsActiveMethod}
            disabled={isActive}
            className={isActive ? "bg-green-600 hover:bg-green-600 text-white" : ""}
            variant={isActive ? "default" : "outline"}
          >
            {isActive ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Active
              </>
            ) : (
              'Set as Active'
            )}
          </Button>
        </div>

        {/* Vector Calibration Progress */}
        {jobId && jobDetails && (jobStatus === 'running' || jobStatus === 'starting') && (
          <div className="mt-4 p-3 border rounded bg-green-50">
            <div className="flex items-center gap-2 text-sm mb-2">
              <Loader2 className="h-4 w-4 animate-spin text-green-600" />
              <strong>Vector Calibration:</strong>
              <span className="capitalize">{jobStatus}</span>
            </div>
            <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
              <div className="h-2 bg-green-600 transition-all" style={{ width: `${jobDetails.progress || 0}%` }}></div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Progress: {jobDetails.progress || 0}%
              {jobDetails.processed_frames !== undefined && jobDetails.total_frames !== undefined &&
                ` (Frames: ${jobDetails.processed_frames}/${jobDetails.total_frames})`}
            </div>
          </div>
        )}

        {/* Vector Calibration Completed */}
        {jobId && jobStatus === 'completed' && (
          <div className="mt-4 p-3 border rounded bg-green-50 text-green-700 text-sm">
            <CheckCircle2 className="h-4 w-4 inline mr-2" />
            Vector calibration completed!
          </div>
        )}

        {/* Vector Calibration Failed */}
        {jobId && jobStatus === 'failed' && jobDetails?.error && (
          <div className="mt-4 p-3 border rounded bg-red-50 text-red-700 text-sm">
            <AlertTriangle className="h-4 w-4 inline mr-2" />
            Vector calibration error: {jobDetails.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
