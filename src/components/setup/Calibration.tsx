"use client";

import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCalibration } from '@/hooks/useCalibration';
import { DotboardCalibration } from './DotboardCalibration';
import { ChArUcoCalibration } from './ChArUcoCalibration';
import { StereoCalibration } from './StereoCalibration';
import { StereoCharucoCalibration } from './StereoCharucoCalibration';
// Mono (planar) stepped board was removed — nobody calibrates a planar stepped board.
// The last version of SteppedCalibration.tsx / useSteppedCalibration.ts lives in git history.
import { StereoSteppedCalibration } from './StereoSteppedCalibration';
import { ScaleFactorCalibration } from './ScaleFactorCalibration';

interface CalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
  refetchConfig?: () => Promise<void>;
}

// Supported methods on the calibration backend. Scale-factor is the board-free
// uniform pixel->mm map (pick origin/axes on the image). Stepped is the dual-level
// dot board (both Z planes feed one pinhole fit).
const TABS = [
  { id: 'dotboard', label: 'Planar Dotboard' },
  { id: 'charuco', label: 'Planar ChArUco' },
  { id: 'stereo_dotboard', label: 'Stereo Dotboard' },
  { id: 'stereo_charuco', label: 'Stereo ChArUco' },
  // mono 'stepped' removed — see import note above
  { id: 'stereo_stepped', label: 'Stereo Stepped' },
  { id: 'scale_factor', label: 'Scale Factor' },
];

export const Calibration: React.FC<CalibrationProps> = ({ config, updateConfig }) => {
  // cameraOptions is memoised inside the hook — a stable identity keeps
  // useGlobalCoordinates' pair-merge effect from firing on every re-render.
  const { cameraOptions, sourcePaths } = useCalibration(config);

  // Restore the last-used method tab. The switch itself only touches client
  // state here; `calibration.active` is persisted by each tab hook's debounced
  // save (active: <board>), not by this handler. Fall back to the first tab if
  // the saved method is one no longer shown (e.g. the removed mono 'stepped'),
  // so the user never lands on a blank hidden tab.
  const [tab, setTab] = useState<string>(() => {
    const saved = config?.calibration?.active;
    return saved && TABS.some((t) => t.id === saved) ? saved : TABS[0].id;
  });
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
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-6">
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
            <TabsContent value="stereo_stepped" className="mt-6">
              <StereoSteppedCalibration {...common} />
            </TabsContent>
            <TabsContent value="scale_factor" className="mt-6">
              <ScaleFactorCalibration {...common} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};
