"use client";
import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CalibrationMethod = "scale_factor" | "pinhole" | "stereo";

interface Config {
  images: { num_images?: number };
  paths: { camera_numbers?: number[] };
  calibration?: {
    active?: CalibrationMethod;
    scale_factor?: any;
    pinhole?: any;
    stereo?: any;
    [key: string]: any;
  };
}

function useConfig(): [Config, (path: string[], value: any) => void] {
  // Minimal config loader for this page
  const [config, setConfig] = useState<Config>({ images: {}, paths: {} });
  useEffect(() => {
    fetch("/backend/config")
      .then(r => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);
  // Improved updateConfig: POST to backend and update local state, with safe deep update
  function updateConfig(path: string[], value: any) {
    fetch("/backend/update_config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(path.length === 1 ? { [path[0]]: value } : { [path[0]]: { [path[1]]: value } }),
    }).then(() => {
      // After updating, refetch config from backend to ensure latest camera_numbers
      fetch("/backend/config")
        .then(r => r.json())
        .then(setConfig)
        .catch(() => {});
    });
  }
  return [config, updateConfig];
}

// --- Scale Factor Calibration UI ---
const ScaleFactorCalibration: React.FC<{ config: Config; updateConfig: (path: string[], value: any) => void; setActive: () => void; isActive: boolean }> = ({ config, updateConfig, setActive, isActive }) => {
  // Determine number of cameras robustly
  const camNums = config.paths?.camera_numbers;
  let numCameras = 1;
  if (Array.isArray(camNums)) {
    if (camNums.length === 1) {
      const maybeCount = Number(camNums[0]);
      if (!Number.isNaN(maybeCount) && maybeCount > 0) numCameras = maybeCount;
    } else if (camNums.length > 1) {
      numCameras = camNums.length;
    }
  }
  const calib = config.calibration?.scale_factor || {};
  const [dt, setDt] = useState<string>(calib.dt !== undefined ? String(calib.dt) : "");
  const [pxPerMm, setPxPerMm] = useState<string>(calib.px_per_mm !== undefined ? String(calib.px_per_mm) : "");
  const [xOffsets, setXOffsets] = useState<string[]>(Array.isArray(calib.x_offset) ? calib.x_offset.map(String) : Array(numCameras).fill(""));
  const [yOffsets, setYOffsets] = useState<string[]>(Array.isArray(calib.y_offset) ? calib.y_offset.map(String) : Array(numCameras).fill(""));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDt(calib.dt !== undefined ? String(calib.dt) : "");
    setPxPerMm(calib.px_per_mm !== undefined ? String(calib.px_per_mm) : "");
    setXOffsets(Array.isArray(calib.x_offset) ? calib.x_offset.map(String) : Array(numCameras).fill(""));
    setYOffsets(Array.isArray(calib.y_offset) ? calib.y_offset.map(String) : Array(numCameras).fill(""));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numCameras, config.calibration?.scale_factor]);

  // Update offsets if number of cameras changes
  useEffect(() => {
    setXOffsets(prev => {
      const arr = [...prev];
      while (arr.length < numCameras) arr.push("");
      return arr.slice(0, numCameras);
    });
    setYOffsets(prev => {
      const arr = [...prev];
      while (arr.length < numCameras) arr.push("");
      return arr.slice(0, numCameras);
    });
  }, [numCameras]);

  // Debounced auto-save
  const debounceTimer = React.useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const block = {
        dt: Number(dt),
        px_per_mm: Number(pxPerMm),
        x_offset: xOffsets.map(Number),
        y_offset: yOffsets.map(Number),
      };
      updateConfig(["calibration", "scale_factor"], block);
    }, 500);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dt, pxPerMm, xOffsets, yOffsets]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scale Factor Calibration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium">Δt (seconds)</label>
            <Input type="number" step="any" value={dt} onChange={e=>setDt(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium">Pixels per mm</label>
            <Input type="number" step="any" value={pxPerMm} onChange={e=>setPxPerMm(e.target.value)} />
          </div>
        </div>
        {/* Table/grid for X/Y offsets per camera */}
        <div>
          <label className="block text-xs font-medium mb-1">Camera Offsets (px)</label>
          <div className="overflow-x-auto">
            <table className="min-w-[320px] border text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 border">Camera</th>
                  <th className="px-2 py-1 border">X Offset</th>
                  <th className="px-2 py-1 border">Y Offset</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({length: numCameras}).map((_,i)=>(
                  <tr key={i}>
                    <td className="px-2 py-1 border text-center">{i+1}</td>
                    <td className="px-2 py-1 border">
                      <Input
                        type="number"
                        step="any"
                        value={xOffsets[i]||""}
                        onChange={e=>{
                          const next = [...xOffsets]; next[i]=e.target.value; setXOffsets(next);
                        }}
                        className="w-24"
                        placeholder="X"
                      />
                    </td>
                    <td className="px-2 py-1 border">
                      <Input
                        type="number"
                        step="any"
                        value={yOffsets[i]||""}
                        onChange={e=>{
                          const next = [...yOffsets]; next[i]=e.target.value; setYOffsets(next);
                        }}
                        className="w-24"
                        placeholder="Y"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex gap-2">
          {/* <Button onClick={handleSave} disabled={saving || !dt || !pxPerMm}>Save Scale Factor Calibration</Button> */}
          {!isActive && <Button variant="outline" onClick={setActive}>Set as Active</Button>}
          {isActive && <span className="text-green-600 text-xs font-semibold ml-2">Active</span>}
        </div>
        <div className="text-xs text-gray-500 mt-2">
          This method sets the scale using known pixels/mm, dt, and camera offsets.<br />
          Updates the calibration.scale_factor block in config.yaml.
        </div>
      </CardContent>
    </Card>
  );
};

// --- Pinhole Calibration UI (Production CV2) ---
const PinholeCalibration: React.FC<{ config: Config; updateConfig: (path: string[], value: any) => void; setActive: () => void; isActive: boolean }> = ({ config, updateConfig, setActive, isActive }) => {
  // States for calibration parameters
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [camera, setCamera] = useState("1");
  const [imageIndex, setImageIndex] = useState(0);
  const [filePattern, setFilePattern] = useState("planar_calibration_plate_*.tif");
  const [patternCols, setPatternCols] = useState(10);
  const [patternRows, setPatternRows] = useState(10);
  const [dotSpacingMm, setDotSpacingMm] = useState(28.89);
  const [enhanceDots, setEnhanceDots] = useState(true);
  const [asymmetric, setAsymmetric] = useState(false);
  
  // States for display
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [totalImages, setTotalImages] = useState(0);
  const [gridPoints, setGridPoints] = useState<[number, number][]>([]);
  const [showIndices, setShowIndices] = useState(true);
  const [dewarpedB64, setDewarpedB64] = useState<string | null>(null);
  const [cameraModel, setCameraModel] = useState<any>(null);
  const [gridData, setGridData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [nativeSize, setNativeSize] = useState<{ w: number; h: number }>({ w: 1024, h: 1024 });
  
  // Get source paths from config
  const sourcePaths = config?.paths || [];
  
  const loadImage = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/backend/calibration/planar/get_image?source_path_idx=${sourcePathIdx}&camera=${camera}&image_index=${imageIndex}&file_pattern=${encodeURIComponent(filePattern)}`);
      const data = await response.json();
      
      if (response.ok) {
        setImageB64(data.image);
        setNativeSize({ w: data.width, h: data.height });
        setTotalImages(data.total_images);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (e: any) {
      alert(`Error loading image: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  const detectGrid = async () => {
    setLoading(true);
    try {
      const response = await fetch('/backend/calibration/planar/detect_grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: camera,
          image_index: imageIndex,
          file_pattern: filePattern,
          pattern_cols: patternCols,
          pattern_rows: patternRows,
          enhance_dots: enhanceDots,
          asymmetric: asymmetric
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.found) {
        setGridPoints(data.grid_points);
      } else {
        alert(`Grid detection failed: ${data.error || 'Unknown error'}`);
        setGridPoints([]);
      }
    } catch (e: any) {
      alert(`Error detecting grid: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  const computeCalibration = async () => {
    setLoading(true);
    try {
      const response = await fetch('/backend/calibration/planar/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: camera,
          image_index: imageIndex,
          file_pattern: filePattern,
          pattern_cols: patternCols,
          pattern_rows: patternRows,
          dot_spacing_mm: dotSpacingMm,
          enhance_dots: enhanceDots,
          asymmetric: asymmetric
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        if (data.results?.grid_data) {
          setGridData(data.results.grid_data);
          setGridPoints(data.results.grid_data.grid_points);
        }
        if (data.results?.camera_model) {
          setCameraModel(data.results.camera_model);
        }
        if (data.results?.dewarped_image) {
          setDewarpedB64(data.results.dewarped_image);
        }
        alert('Calibration computed successfully!');
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (e: any) {
      alert(`Error computing calibration: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  const loadResults = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/backend/calibration/planar/load_results?source_path_idx=${sourcePathIdx}&camera=${camera}&image_index=${imageIndex}`);
      const data = await response.json();
      
      if (response.ok && data.exists) {
        if (data.results?.grid_data) {
          setGridData(data.results.grid_data);
          setGridPoints(data.results.grid_data.grid_points);
        }
        if (data.results?.camera_model) {
          setCameraModel(data.results.camera_model);
        }
        if (data.results?.dewarped_image) {
          setDewarpedB64(data.results.dewarped_image);
        }
        alert('Previous results loaded successfully!');
      } else {
        alert('No previous results found for this configuration.');
      }
    } catch (e: any) {
      alert(`Error loading results: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // Camera dropdown options
  const cameraDropdownOptions = React.useMemo(() => {
    const camNums = config?.paths?.camera_numbers;
    let count = 1;
    if (Array.isArray(camNums)) {
      count = camNums.length;
    }
    return Array.from({ length: Math.max(1, Math.floor(count)) }, (_, i) => String(i + 1));
  }, [config]);
  
  // Auto-load image when parameters change
  useEffect(() => {
    if (filePattern) {
      loadImage();
    }
  }, [sourcePathIdx, camera, imageIndex, filePattern]);
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pinhole Calibration (CV2 Production)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Source Path Index:</label>
              <Input
                type="number"
                value={sourcePathIdx}
                onChange={e => setSourcePathIdx(parseInt(e.target.value) || 0)}
                min="0"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Camera:</label>
              <select 
                value={camera} 
                onChange={e => setCamera(e.target.value)} 
                className="border rounded px-2 py-1 w-full"
              >
                {cameraDropdownOptions.map(c => (
                  <option key={c} value={c}>{`Camera ${c}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Image Index:</label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  value={imageIndex}
                  onChange={e => setImageIndex(parseInt(e.target.value) || 0)}
                  min="0"
                  max={totalImages - 1}
                />
                <span className="text-xs text-gray-500 self-center">/ {totalImages}</span>
              </div>
            </div>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">File Pattern:</label>
              <Input
                value={filePattern}
                onChange={e => setFilePattern(e.target.value)}
                placeholder="planar_calibration_plate_*.tif"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pattern Cols:</label>
              <Input
                type="number"
                value={patternCols}
                onChange={e => setPatternCols(parseInt(e.target.value) || 10)}
                min="1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pattern Rows:</label>
              <Input
                type="number"
                value={patternRows}
                onChange={e => setPatternRows(parseInt(e.target.value) || 10)}
                min="1"
              />
            </div>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Dot Spacing (mm):</label>
              <Input
                type="number"
                step="0.01"
                value={dotSpacingMm}
                onChange={e => setDotSpacingMm(parseFloat(e.target.value) || 28.89)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                <input
                  type="checkbox"
                  checked={enhanceDots}
                  onChange={e => setEnhanceDots(e.target.checked)}
                  className="mr-2"
                />
                Enhance Dots
              </label>
            </div>
            <div>
              <label className="text-sm font-medium">
                <input
                  type="checkbox"
                  checked={asymmetric}
                  onChange={e => setAsymmetric(e.target.checked)}
                  className="mr-2"
                />
                Asymmetric Grid
              </label>
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button onClick={loadImage} disabled={loading}>Load Image</Button>
            <Button onClick={detectGrid} disabled={!imageB64 || loading}>Detect Grid</Button>
            <Button onClick={computeCalibration} disabled={!gridPoints.length || loading}>Compute Calibration</Button>
            <Button variant="outline" onClick={loadResults} disabled={loading}>Load Previous Results</Button>
            <Button variant="outline" onClick={() => setShowIndices(!showIndices)}>
              {showIndices ? "Hide Indices" : "Show Indices"}
            </Button>
          </div>
        </CardContent>
      </Card>
      
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Calibration Image</CardTitle>
          </CardHeader>
          <CardContent>
            {imageB64 ? (
              <div className="relative border rounded inline-block">
                <canvas
                  width={nativeSize.w}
                  height={nativeSize.h}
                  style={{ maxWidth: "512px", width: "100%", imageRendering: "pixelated" }}
                  ref={el => {
                    if (el && imageB64) {
                      const ctx = el.getContext('2d');
                      if (ctx) {
                        const img = new Image();
                        img.onload = () => {
                          ctx.clearRect(0, 0, el.width, el.height);
                          ctx.drawImage(img, 0, 0, el.width, el.height);
                          
                          // Draw detected grid points
                          ctx.strokeStyle = 'lime';
                          ctx.fillStyle = 'rgba(0,255,0,0.6)';
                          gridPoints.forEach((point, i) => {
                            ctx.beginPath();
                            ctx.arc(
                              point[0] * (el.width / nativeSize.w),
                              point[1] * (el.height / nativeSize.h),
                              4, 0, Math.PI * 2
                            );
                            ctx.fill();
                            
                            // Show indices if enabled
                            if (showIndices) {
                              const row = Math.floor(i / patternCols);
                              const col = i % patternCols;
                              ctx.fillStyle = 'cyan';
                              ctx.font = '10px sans-serif';
                              ctx.fillText(
                                `(${row},${col})`,
                                point[0] * (el.width / nativeSize.w) + 8,
                                point[1] * (el.height / nativeSize.h) - 8
                              );
                              ctx.fillStyle = 'rgba(0,255,0,0.6)';
                            }
                          });
                        };
                        img.src = 'data:image/png;base64,' + imageB64;
                      }
                    }
                  }}
                />
              </div>
            ) : (
              <div className="text-gray-500">No image loaded</div>
            )}
            
            {gridPoints.length > 0 && (
              <div className="text-xs text-gray-600 mt-2">
                Grid points detected: {gridPoints.length}
              </div>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Dewarped Image</CardTitle>
          </CardHeader>
          <CardContent>
            {dewarpedB64 ? (
              <img 
                src={`data:image/png;base64,${dewarpedB64}`}
                alt="Dewarped calibration image"
                style={{ maxWidth: "512px", width: "100%" }}
              />
            ) : (
              <div className="text-gray-500">No dewarped image available</div>
            )}
          </CardContent>
        </Card>
      </div>
      
      {(cameraModel || gridData) && (
        <Card>
          <CardHeader>
            <CardTitle>Calibration Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              {gridData && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">Grid Detection</h4>
                  <div className="text-xs space-y-1">
                    <div>Reprojection Error: {gridData.reprojection_error?.toFixed(2)} px</div>
                    <div>Pattern Size: {gridData.pattern_size?.join(' x ')}</div>
                    <div>Dot Spacing: {gridData.dot_spacing_mm} mm</div>
                  </div>
                </div>
              )}
              
              {cameraModel && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">Camera Model</h4>
                  <div className="text-xs space-y-1">
                    <div>Focal Length: fx={cameraModel.focal_length?.[0]?.toFixed(1)}, fy={cameraModel.focal_length?.[1]?.toFixed(1)}</div>
                    <div>Principal Point: cx={cameraModel.principal_point?.[0]?.toFixed(1)}, cy={cameraModel.principal_point?.[1]?.toFixed(1)}</div>
                    <div>Reprojection Error: {cameraModel.reprojection_error?.toFixed(3)} px</div>
                    <div>Distortion Coeffs: [{cameraModel.dist_coeffs?.map((d: number) => d.toFixed(4)).join(', ')}]</div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      
      <div className="flex gap-2">
        {!isActive && <Button variant="outline" onClick={setActive}>Set as Active</Button>}
        {isActive && <span className="text-green-600 text-xs font-semibold ml-2">Active</span>}
      </div>
    </div>
  );
};

// --- Stereo Calibration UI ---
const StereoCalibration: React.FC<{ config: Config; updateConfig: (path: string[], value: any) => void; setActive: () => void; isActive: boolean }> = ({ config, updateConfig, setActive, isActive }) => {
  // States for calibration parameters
  const [sourcePathIdx, setSourcePathIdx] = useState(0);
  const [cameraPair, setCameraPair] = useState([1, 2]);
  const [filePattern, setFilePattern] = useState("planar_calibration_plate_*.tif");
  const [patternCols, setPatternCols] = useState(10);
  const [patternRows, setPatternRows] = useState(10);
  const [dotSpacingMm, setDotSpacingMm] = useState(28.89);
  const [enhanceDots, setEnhanceDots] = useState(true);
  const [asymmetric, setAsymmetric] = useState(false);
  
  // States for display
  const [stereoModel, setStereoModel] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  // Get available cameras from config
  const availableCameras = React.useMemo(() => {
    const camNums = config?.paths?.camera_numbers;
    if (Array.isArray(camNums)) {
      return camNums;
    }
    return [1, 2]; // Default
  }, [config]);
  
  const computeStereoCalibration = async () => {
    setLoading(true);
    try {
      const response = await fetch('/backend/calibration/stereo/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera_pair: cameraPair,
          file_pattern: filePattern,
          pattern_cols: patternCols,
          pattern_rows: patternRows,
          dot_spacing_mm: dotSpacingMm,
          enhance_dots: enhanceDots,
          asymmetric: asymmetric
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        if (data.stereo_model) {
          setStereoModel(data.stereo_model);
        }
        alert('Stereo calibration computed successfully!');
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (e: any) {
      alert(`Error computing stereo calibration: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  const loadStereoResults = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/backend/calibration/stereo/load_results?source_path_idx=${sourcePathIdx}&camera_pair=${cameraPair.join(',')}`);
      const data = await response.json();
      
      if (response.ok && data.exists) {
        setStereoModel(data.results);
        alert('Previous stereo results loaded successfully!');
      } else {
        alert('No previous stereo results found for this configuration.');
      }
    } catch (e: any) {
      alert(`Error loading stereo results: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Stereo Calibration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Source Path Index:</label>
              <Input
                type="number"
                value={sourcePathIdx}
                onChange={e => setSourcePathIdx(parseInt(e.target.value) || 0)}
                min="0"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Camera 1:</label>
              <select 
                value={cameraPair[0]} 
                onChange={e => setCameraPair([parseInt(e.target.value), cameraPair[1]])} 
                className="border rounded px-2 py-1 w-full"
              >
                {availableCameras.map(c => (
                  <option key={c} value={c}>{`Camera ${c}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Camera 2:</label>
              <select 
                value={cameraPair[1]} 
                onChange={e => setCameraPair([cameraPair[0], parseInt(e.target.value)])} 
                className="border rounded px-2 py-1 w-full"
              >
                {availableCameras.map(c => (
                  <option key={c} value={c}>{`Camera ${c}`}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">File Pattern:</label>
              <Input
                value={filePattern}
                onChange={e => setFilePattern(e.target.value)}
                placeholder="planar_calibration_plate_*.tif"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pattern Cols:</label>
              <Input
                type="number"
                value={patternCols}
                onChange={e => setPatternCols(parseInt(e.target.value) || 10)}
                min="1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pattern Rows:</label>
              <Input
                type="number"
                value={patternRows}
                onChange={e => setPatternRows(parseInt(e.target.value) || 10)}
                min="1"
              />
            </div>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Dot Spacing (mm):</label>
              <Input
                type="number"
                step="0.01"
                value={dotSpacingMm}
                onChange={e => setDotSpacingMm(parseFloat(e.target.value) || 28.89)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                <input
                  type="checkbox"
                  checked={enhanceDots}
                  onChange={e => setEnhanceDots(e.target.checked)}
                  className="mr-2"
                />
                Enhance Dots
              </label>
            </div>
            <div>
              <label className="text-sm font-medium">
                <input
                  type="checkbox"
                  checked={asymmetric}
                  onChange={e => setAsymmetric(e.target.checked)}
                  className="mr-2"
                />
                Asymmetric Grid
              </label>
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button onClick={computeStereoCalibration} disabled={loading}>Compute Stereo Calibration</Button>
            <Button variant="outline" onClick={loadStereoResults} disabled={loading}>Load Previous Results</Button>
          </div>
        </CardContent>
      </Card>
      
      {stereoModel && (
        <Card>
          <CardHeader>
            <CardTitle>Stereo Calibration Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-semibold text-sm mb-2">Camera Pair</h4>
                <div className="text-xs space-y-1">
                  <div>Cameras: {stereoModel.camera_pair?.join(' - ')}</div>
                  <div>Images Used: {stereoModel.num_images}</div>
                  <div>Stereo Reprojection Error: {stereoModel.stereo_reprojection_error?.toFixed(3)} px</div>
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold text-sm mb-2">Fundamental Matrix</h4>
                <div className="text-xs font-mono bg-gray-100 p-2 rounded">
                  {stereoModel.fundamental_matrix && 
                    stereoModel.fundamental_matrix.map((row: number[], i: number) => (
                      <div key={i}>
                        [{row.map(val => val.toFixed(6)).join(', ')}]
                      </div>
                    ))
                  }
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold text-sm mb-2">Essential Matrix</h4>
                <div className="text-xs font-mono bg-gray-100 p-2 rounded">
                  {stereoModel.essential_matrix && 
                    stereoModel.essential_matrix.map((row: number[], i: number) => (
                      <div key={i}>
                        [{row.map(val => val.toFixed(6)).join(', ')}]
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      <div className="flex gap-2">
        {!isActive && <Button variant="outline" onClick={setActive}>Set as Active</Button>}
        {isActive && <span className="text-green-600 text-xs font-semibold ml-2">Active</span>}
      </div>
    </div>
  );
};

// --- Main Calibration Page ---
const Calibration: React.FC = () => {
  const [method, setMethod] = useState<CalibrationMethod>("pinhole");
  const [config, updateConfig] = useConfig();
  const active = config.calibration?.active || "pinhole";

  // Only change active method, do not overwrite configs
  function setActiveMethod(m: CalibrationMethod) {
    updateConfig(["calibration", "active"], m);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Calibration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-center">
            <label className="text-sm font-medium">Method:</label>
            <select value={method} onChange={e=>setMethod(e.target.value as CalibrationMethod)} className="border rounded px-2 py-1">
              <option value="scale_factor">Scale Factor</option>
              <option value="pinhole">Pinhole (CV2 Production)</option>
              <option value="stereo">Stereo Calibration</option>
            </select>
            <span className="ml-4 text-xs text-gray-500">Active: <b>{active}</b></span>
          </div>
        </CardContent>
      </Card>
      {method === "scale_factor" && (
        <ScaleFactorCalibration
          config={config}
          updateConfig={updateConfig}
          setActive={() => setActiveMethod("scale_factor")}
          isActive={active === "scale_factor"}
        />
      )}
      {method === "pinhole" && (
        <PinholeCalibration
          config={config}
          updateConfig={updateConfig}
          setActive={() => setActiveMethod("pinhole")}
          isActive={active === "pinhole"}
        />
      )}
      {method === "stereo" && (
        <StereoCalibration
          config={config}
          updateConfig={updateConfig}
          setActive={() => setActiveMethod("stereo")}
          isActive={active === "stereo"}
        />
      )}
      {/* Stereo method can be added here in the future */}
    </div>
  );
};

export default Calibration;
