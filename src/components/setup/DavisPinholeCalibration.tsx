"use client";
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

interface DavisPinholeCalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  cameraOptions: number[];
  sourcePaths: string[];
  imageCount?: number;
}

const basename = (p: string) => {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.filter(Boolean).pop() || p;
};

interface ImportedCamera {
  davis_cam_id: number;
  pivtools_cam: number;
  model_path: string;
  n_poses: number;
}

export const DavisPinholeCalibration: React.FC<DavisPinholeCalibrationProps> = ({
  config,
  updateConfig,
}) => {
  const [xmlPath, setXmlPath] = useState<string>("");
  const [dt, setDt] = useState<string>("1.0");
  const [basePathIdx, setBasePathIdx] = useState<number>(0);
  const [cameraMapStr, setCameraMapStr] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportedCamera[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Apply calibration job state
  const [vectorTypeName, setVectorTypeName] = useState<"instantaneous" | "ensemble">("instantaneous");
  const [calibrating, setCalibrating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("not_started");
  const [jobDetails, setJobDetails] = useState<any>(null);

  const basePaths: string[] = config?.paths?.base_paths || [];

  useEffect(() => {
    const davisConfig = config?.calibration?.davis_pinhole || {};
    if (davisConfig.xml_path) setXmlPath(davisConfig.xml_path);
    if (davisConfig.dt != null) setDt(String(davisConfig.dt));
    if (davisConfig.base_path_idx != null) setBasePathIdx(Number(davisConfig.base_path_idx));
    if (davisConfig.camera_map) setCameraMapStr(davisConfig.camera_map);
  }, [config]);

  const parseCameraMap = (): Record<string, number> | undefined => {
    if (!cameraMapStr.trim()) return undefined;
    const map: Record<string, number> = {};
    for (const pair of cameraMapStr.split(",")) {
      const [k, v] = pair.trim().split(":");
      if (k && v) map[k.trim()] = parseInt(v.trim(), 10);
    }
    return Object.keys(map).length > 0 ? map : undefined;
  };

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);
    setImportError(null);

    try {
      const body: any = {
        xml_path: xmlPath || undefined,
        dt: parseFloat(dt) || 1.0,
        base_path_idx: basePathIdx,
      };
      const cameraMap = parseCameraMap();
      if (cameraMap) body.camera_map = cameraMap;

      const res = await fetch("/backend/calibrate/davis_pinhole/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setImportError(data.error || "Import failed");
        return;
      }

      setImportResult(data.cameras || []);

      await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calibration: {
            active: "davis_pinhole",
            davis_pinhole: {
              xml_path: xmlPath,
              dt: parseFloat(dt) || 1.0,
              base_path_idx: basePathIdx,
              camera_map: cameraMapStr || undefined,
            },
          },
        }),
      }).then(async (r) => {
        const json = await r.json();
        if (json.updated?.calibration) {
          updateConfig(["calibration"], { ...config.calibration, ...json.updated.calibration });
        }
      });
    } catch (e: any) {
      setImportError(e.message || "Network error");
    } finally {
      setImporting(false);
    }
  };

  const calibrateVectors = async () => {
    setCalibrating(true);
    setJobId(null);
    setJobStatus("not_started");
    setJobDetails(null);
    try {
      const res = await fetch("/backend/calibrate/davis_pinhole/calibrate_all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_path_idx: basePathIdx,
          type_name: vectorTypeName,
        }),
      });
      const result = await res.json();
      if (res.ok && result.job_id) {
        setJobId(result.job_id);
      } else {
        console.error(result.error || "Failed to start calibration");
      }
    } catch (e: any) {
      console.error(`Error starting calibration: ${e.message}`);
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
        const res = await fetch(`/backend/calibrate/davis_pinhole/job/${jobId}`);
        const data = await res.json();
        if (active) {
          setJobStatus(data.status || "not_started");
          setJobDetails(data);
          if (data.status === "completed" || data.status === "failed") {
            clearInterval(interval);
          }
        }
      } catch (e) {
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
        body: JSON.stringify({ calibration: { active: "davis_pinhole" } }),
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

  const isActive = config?.calibration?.active === "davis_pinhole";

  return (
    <Card>
      <CardHeader>
        <CardTitle>DaVis Pinhole (OpenCV) Calibration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Import a DaVis <code>Calibration.xml</code> containing a{" "}
          <code>PinholeOpenCV</code> model. The camera matrix and distortion
          coefficients are extracted and saved as PIVTOOLs{" "}
          <code>.mat</code> model files for each camera.
        </p>

        {/* XML path */}
        <div className="space-y-2">
          <Label>Calibration XML Path</Label>
          <Input
            placeholder="\\server\share\Properties\Calibration\Calibration.xml"
            value={xmlPath}
            onChange={(e) => setXmlPath(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Full path to the DaVis <code>Calibration.xml</code> file.
          </p>
        </div>

        {/* dt and base path row */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>dt (s)</Label>
            <Input
              type="text"
              inputMode="numeric"
              value={dt}
              onChange={(e) => setDt(e.target.value)}
              placeholder="1.0"
            />
          </div>

          <div className="space-y-2">
            <Label>Output Base Path</Label>
            <Select
              value={String(basePathIdx)}
              onValueChange={(v) => setBasePathIdx(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select output path" />
              </SelectTrigger>
              <SelectContent>
                {basePaths.length === 0 ? (
                  <SelectItem value="0">Default (idx 0)</SelectItem>
                ) : (
                  basePaths.map((p, idx) => (
                    <SelectItem key={idx} value={String(idx)}>
                      {basename(p)}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Camera map */}
        <div className="space-y-2">
          <Label>Camera Map (optional)</Label>
          <Input
            placeholder="1:1,2:2,3:3"
            value={cameraMapStr}
            onChange={(e) => setCameraMapStr(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Map DaVis camera IDs to PIVTOOLs camera numbers as{" "}
            <code>davis_id:pivtools_num</code> pairs, comma-separated. Leave
            blank to use 1:1 mapping.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 items-center flex-wrap">
          {/* Import button */}
          <Button
            onClick={handleImport}
            disabled={importing || !xmlPath.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing…
              </>
            ) : (
              "Import DaVis XML"
            )}
          </Button>

          {/* Apply Calibration button + vector type selector */}
          <div className="flex items-center gap-1">
            <Button
              onClick={calibrateVectors}
              disabled={calibrating || jobStatus === "running"}
              className="bg-green-600 hover:bg-green-700 text-white rounded-r-none"
            >
              {calibrating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Calibrating…
                </>
              ) : (
                "Calibrate Vectors"
              )}
            </Button>
            <Select
              value={vectorTypeName}
              onValueChange={(v) => setVectorTypeName(v as "instantaneous" | "ensemble")}
              disabled={calibrating}
            >
              <SelectTrigger className="w-[130px] rounded-l-none border-l-0 bg-green-600 hover:bg-green-700 text-white border-green-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instantaneous">Instantaneous</SelectItem>
                <SelectItem value="ensemble">Ensemble</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Set as Active button */}
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
              "Set as Active"
            )}
          </Button>
        </div>

        {/* Import error */}
        {importError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Import Failed</AlertTitle>
            <AlertDescription>{importError}</AlertDescription>
          </Alert>
        )}

        {/* Import success result */}
        {importResult && importResult.length > 0 && (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800">Import Successful</AlertTitle>
            <AlertDescription className="text-green-700">
              <p className="mb-2">
                Imported {importResult.length} camera model
                {importResult.length !== 1 ? "s" : ""} and set as active
                calibration method.
              </p>
              <table className="text-xs w-full mt-2 border-collapse">
                <thead>
                  <tr className="border-b border-green-300">
                    <th className="text-left py-1 pr-4">DaVis Cam</th>
                    <th className="text-left py-1 pr-4">PIVTOOLs Cam</th>
                    <th className="text-left py-1 pr-4">Poses</th>
                    <th className="text-left py-1">Model Path</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.map((cam, i) => (
                    <tr key={i} className="border-b border-green-100">
                      <td className="py-1 pr-4">{cam.davis_cam_id}</td>
                      <td className="py-1 pr-4">{cam.pivtools_cam}</td>
                      <td className="py-1 pr-4">{cam.n_poses}</td>
                      <td className="py-1 font-mono break-all">{cam.model_path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AlertDescription>
          </Alert>
        )}

        {/* Calibration running */}
        {jobId && jobDetails && (jobStatus === "running" || jobStatus === "starting") && (
          <div className="mt-2 p-3 border rounded bg-green-50">
            <div className="flex items-center gap-2 text-sm mb-2">
              <Loader2 className="h-4 w-4 animate-spin text-green-600" />
              <strong>Calibrating vectors:</strong>
              <span className="capitalize">{jobStatus}</span>
              {jobDetails.current_camera != null && (
                <span className="text-muted-foreground">— Camera {jobDetails.current_camera}</span>
              )}
            </div>
            <div className="w-full bg-gray-200 h-2 rounded overflow-hidden">
              <div
                className="h-2 bg-green-600 transition-all"
                style={{ width: `${jobDetails.progress || 0}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {jobDetails.processed_cameras ?? 0} / {jobDetails.total_cameras ?? "?"} cameras
            </div>
          </div>
        )}

        {/* Calibration completed */}
        {jobId && jobStatus === "completed" && (
          <div className="mt-2 p-3 border rounded bg-green-50 text-green-700 text-sm">
            <CheckCircle2 className="h-4 w-4 inline mr-2" />
            Vector calibration completed successfully.
          </div>
        )}

        {/* Calibration failed */}
        {jobId && jobStatus === "failed" && jobDetails?.error && (
          <div className="mt-2 p-3 border rounded bg-red-50 text-red-700 text-sm">
            <AlertTriangle className="h-4 w-4 inline mr-2" />
            Calibration failed: {jobDetails.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
