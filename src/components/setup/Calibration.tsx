"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCalibration } from '@/hooks/useCalibration';
import { ScaleFactorCalibration } from './ScaleFactorCalibration';
import { PinholeCalibration } from './PinholeCalibration';
import { StereoCalibration } from './StereoCalibration';

interface CalibrationProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export const Calibration: React.FC<CalibrationProps> = ({
  config,
  updateConfig,
}) => {
  const {
    activeMethod,
    setActiveMethod,
    getCameraOptions,
    sourcePaths,
  } = useCalibration(config, updateConfig);

  const cameraOptions = getCameraOptions();
  const imageCount = config?.images?.num_images || 1000;

  const calibrationMethods = [
    { id: 'scale_factor', label: 'Scale Factor', component: ScaleFactorCalibration },
    { id: 'pinhole', label: 'Pinhole', component: PinholeCalibration },
    { id: 'stereo', label: 'Stereo', component: StereoCalibration },
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
            <li><strong>Pinhole:</strong> Calibrate individual camera intrinsic parameters</li>
            <li><strong>Stereo:</strong> Calibrate camera pairs for 3D reconstruction</li>
          </ul>

          <Tabs value={activeMethod} onValueChange={(value) => setActiveMethod(value as any)}>
            <TabsList className="grid w-full grid-cols-3">
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
                    setActive={() => setActiveMethod(method.id as any)}
                    isActive={activeMethod === method.id}
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