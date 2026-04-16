"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, History, CheckCircle2 } from 'lucide-react';
import { useCalibration } from '@/hooks/useCalibration';
import { useCalibrationSnapshot } from '@/hooks/useCalibrationSnapshot';
import { ScaleFactorCalibration } from './ScaleFactorCalibration';
import { DotboardCalibration } from './DotboardCalibration';
import { StereoCalibration } from './StereoCalibration';
import { StereoCharucoCalibration } from './StereoCharucoCalibration';
import { PolynomialCalibration } from './PolynomialCalibration';
import { ChArUcoCalibration } from './ChArUcoCalibration';
import { SteppedBoardCalibration } from './SteppedBoardCalibration';
import { SteppedPlanarCalibration } from './SteppedPlanarCalibration';

interface CalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  refetchConfig?: () => Promise<void>;
}

export const Calibration: React.FC<CalibrationProps> = ({
  config,
  updateConfig,
  refetchConfig,
}) => {
  const {
    activeMethod,
    setActiveMethod,
    getCameraOptions,
    sourcePaths,
  } = useCalibration(config, updateConfig);

  const cameraOptions = getCameraOptions();
  const imageCount = config?.images?.num_images || 1000;

  const { snapshotInfo, loading, loadError, loadSuccess, loadSnapshot: loadSnapshotFn } = useCalibrationSnapshot(0, refetchConfig);

  // Counter to force child remount after snapshot restore
  const [configVersion, setConfigVersion] = useState(0);

  const handleLoadSnapshot = useCallback(async () => {
    await loadSnapshotFn();
    setConfigVersion(v => v + 1);
  }, [loadSnapshotFn]);

  // Local state for which tab is currently visible (not the active method)
  const [currentTab, setCurrentTab] = useState<string>(activeMethod);

  // Sync currentTab with activeMethod when it changes (e.g., from clicking "Set as Active Method")
  useEffect(() => {
    setCurrentTab(activeMethod);
  }, [activeMethod]);

  const calibrationMethods = [
    { id: 'scale_factor', label: 'Scale Factor', component: ScaleFactorCalibration },
    { id: 'dotboard', label: 'Planar Dotboard', component: DotboardCalibration },
    { id: 'charuco', label: 'Planar ChArUco', component: ChArUcoCalibration },
    { id: 'polynomial', label: 'Polynomial', component: PolynomialCalibration },
    { id: 'stereo_dotboard', label: 'Stereo Dotboard', component: StereoCalibration },
    { id: 'stereo_charuco', label: 'Stereo ChArUco', component: StereoCharucoCalibration },
    { id: 'stepped_planar', label: 'Stepped (Planar)', component: SteppedPlanarCalibration },
    { id: 'stepped_board', label: 'Stepped (Stereo)', component: SteppedBoardCalibration },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Calibration Setup</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Configure and run calibration procedures for your PIV system. Each calibration method serves a different purpose:
          </p>
          <ul className="text-sm text-muted-foreground space-y-1 mb-6">
            <li><strong>Scale Factor:</strong> Calibrate physical dimensions and coordinate system</li>
            <li><strong>Planar Dotboard:</strong> Calibrate individual camera intrinsic parameters using dot grid</li>
            <li><strong>Planar ChArUco:</strong> Calibrate using ChArUco board (ArUco + chessboard) for robust detection</li>
            <li><strong>Polynomial:</strong> Calibrate using 3rd order polynomial coefficients</li>
            <li><strong>Stereo Dotboard:</strong> Calibrate camera pairs for 3D reconstruction using dot grid</li>
            <li><strong>Stereo ChArUco:</strong> Calibrate camera pairs for 3D reconstruction using ChArUco board</li>
            <li><strong>Stepped (Planar):</strong> Use one face of a stepped dotboard as a planar calibration target (single-camera)</li>
            <li><strong>Stepped Board:</strong> Stereo calibration using stepped dotboard with two Z-planes</li>
          </ul>

          {snapshotInfo.exists && (
            <Alert variant="info" className="mb-6">
              <History className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>
                  Saved calibration found ({snapshotInfo.calibration_method}
                  {snapshotInfo.date && `, ${new Date(snapshotInfo.date).toLocaleDateString()}`})
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadSnapshot}
                  disabled={loading}
                  className="ml-4"
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Restore Calibration
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {loadError && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}

          {loadSuccess && (
            <Alert className="mb-6 border-green-200 text-green-800">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertDescription>Calibration restored successfully</AlertDescription>
            </Alert>
          )}

          <Tabs key={configVersion} value={currentTab} onValueChange={setCurrentTab}>
            <TabsList className="grid w-full grid-cols-8">
              {calibrationMethods.map((method) => (
                <TabsTrigger key={method.id} value={method.id}>
                  {method.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {calibrationMethods.map((method) => {
              const Component = method.component;
              return (
                <TabsContent key={method.id} value={method.id} className="mt-6">
                  <Component
                    config={config}
                    updateConfig={updateConfig}
                    cameraOptions={cameraOptions}
                    sourcePaths={sourcePaths}
                    imageCount={imageCount}
                  />
                </TabsContent>
              );
            })}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};
