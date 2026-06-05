"use client";

import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCalibration } from '@/hooks/useCalibration';
import { DotboardCalibration } from './DotboardCalibration';
import { ChArUcoCalibration } from './ChArUcoCalibration';
import { StereoCalibration } from './StereoCalibration';
import { StereoCharucoCalibration } from './StereoCharucoCalibration';

interface CalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  refetchConfig?: () => Promise<void>;
}

// The four supported methods on the calibration2 (pinhole) backend. Stepped board,
// polynomial and self-calibration return as a follow-up project.
const TABS = [
  { id: 'dotboard', label: 'Planar Dotboard' },
  { id: 'charuco', label: 'Planar ChArUco' },
  { id: 'stereo_dotboard', label: 'Stereo Dotboard' },
  { id: 'stereo_charuco', label: 'Stereo ChArUco' },
];

export const Calibration: React.FC<CalibrationProps> = ({ config, updateConfig }) => {
  const { getCameraOptions, sourcePaths } = useCalibration(config, updateConfig);
  const cameraOptions = getCameraOptions();

  // Restore the last-used method tab; persist it so the backend default agrees.
  const [tab, setTab] = useState<string>(config?.calibration?.active || TABS[0].id);
  const onTab = useCallback((id: string) => {
    setTab(id);
    updateConfig(['calibration', 'active'], id);
  }, [updateConfig]);

  const common = { config, updateConfig, cameraOptions, sourcePaths };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Calibration Setup</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={onTab}>
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="dotboard" className="mt-6">
              <DotboardCalibration {...common} />
            </TabsContent>
            <TabsContent value="charuco" className="mt-6">
              <ChArUcoCalibration {...common} />
            </TabsContent>
            <TabsContent value="stereo_dotboard" className="mt-6">
              <StereoCalibration {...common} />
            </TabsContent>
            <TabsContent value="stereo_charuco" className="mt-6">
              <StereoCharucoCalibration {...common} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};
