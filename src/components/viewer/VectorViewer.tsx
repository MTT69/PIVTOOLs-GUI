"use client";
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useVectorViewer } from "@/hooks/useVectorViewer";
import { useStatisticsCalculation } from "@/hooks/useStatisticsCalculation";

// Inline Vector Merging Hook
const useVectorMerging = (backendUrl: string, basePathIdx: number, cameraOptions: number[], maxFrameCount: number) => {
  const [selectedCameras, setSelectedCameras] = useState<number[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergingJobId, setMergingJobId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [jobStatus, setJobStatus] = useState<string>("not_started");
  const [jobDetails, setJobDetails] = useState<any>(null);

  // Initialize selected cameras when options change
  useEffect(() => {
    if (cameraOptions.length >= 2 && selectedCameras.length === 0) {
      setSelectedCameras([cameraOptions[0], cameraOptions[1]]);
    }
  }, [cameraOptions, selectedCameras.length]);

  const mergeVectors = useCallback(async (frameIdx?: number) => {
    if (selectedCameras.length < 2) {
      alert("Please select at least 2 cameras to merge");
      return;
    }

    setMerging(true);
    setJobStatus("starting");

    try {
      const endpoint = frameIdx !== undefined ? "/merge_vectors/merge_one" : "/merge_vectors/merge_all";
      const body: any = {
        base_path_idx: basePathIdx,
        cameras: selectedCameras,
        type_name: "instantaneous",
        endpoint: "",
        image_count: maxFrameCount,
      };

      if (frameIdx !== undefined) {
        body.frame_idx = frameIdx;
      }

      const response = await fetch(`${backendUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to start merging");
      }

      if (frameIdx !== undefined) {
        // Single frame merge - completed immediately
        setJobStatus("completed");
        setJobDetails({ progress: 100, message: data.message });
        setMerging(false);
      } else {
        // Batch merge - start polling
        setMergingJobId(data.job_id);
        setJobStatus("running");
      }
    } catch (error: any) {
      console.error("Error starting merge:", error);
      setJobStatus("failed");
      setJobDetails({ error: error.message });
      setMerging(false);
    }
  }, [backendUrl, basePathIdx, selectedCameras, maxFrameCount]);

  // Poll for job status
  useEffect(() => {
    if (!mergingJobId || jobStatus === "completed" || jobStatus === "failed") {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${backendUrl}/merge_vectors/status/${mergingJobId}`);
        const data = await response.json();

        setJobStatus(data.status);
        setJobDetails(data);

        if (data.status === "completed" || data.status === "failed") {
          setMerging(false);
          clearInterval(pollInterval);
        }
      } catch (error) {
        console.error("Error polling merge status:", error);
      }
    }, 1000);

    return () => clearInterval(pollInterval);
  }, [mergingJobId, jobStatus, backendUrl]);

  const resetMerging = useCallback(() => {
    setMerging(false);
    setMergingJobId(null);
    setJobStatus("not_started");
    setJobDetails(null);
  }, []);

  return {
    selectedCameras,
    setSelectedCameras,
    merging,
    mergingJobId,
    showDialog,
    setShowDialog,
    jobStatus,
    jobDetails,
    mergeVectors,
    resetMerging,
  };
};

export default function VectorViewer({ backendUrl = "/backend", config }: { backendUrl?: string; config?: any }) {
  const {
    basePaths,
    basePathIdx,
    setBasePathIdx,
    index,
    setIndex,
    type,
    setType,
    run,
    setRun,
    lower,
    setLower,
    upper,
    setUpper,
    cmap,
    setCmap,
    // New: axis limits and custom title
    xlimMin,
    setXlimMin,
    xlimMax,
    setXlimMax,
    ylimMin,
    setYlimMin,
    ylimMax,
    setYlimMax,
    plotTitle,
    setPlotTitle,
    imageSrc,
    meta,
    loading,
    error,
    cameraOptions: hookCameraOptions,
    camera,
    setCamera,
    merged,
    setMerged,
    isUncalibrated,
    setIsUncalibrated,
    playing,
    setPlaying,
    limitsLoading,
    meanMode,
    setMeanMode,
    statsLoading,
    statsError,
    statVars,
    statVarsLoading,
    frameVars,
    frameVarsLoading,
    datumMode,
    setDatumMode,
    xOffset,
    setXOffset,
    yOffset,
    setYOffset,
    cornerCoordinates,
    showCorners,
    setShowCorners,
    imgRef,
    hoverData,
    magnifierRef,
    magVisible,
    magPos,
    maxFrameCount,
    handlePlayToggle,
    handleRender,
    toggleMeanMode,
    handleImageClick,
    updateOffsets,
    fetchCornerCoordinates,
    onMouseMove,
    onMouseLeave,
    handleMagnifierMove,
    handleMagnifierLeave,
    basename,
    downloadCurrentView,
    copyCurrentView,
    fetchLimits,
    applyTransformation,
    applyTransformationToAllFrames,
    transformationJob,
    appliedTransforms,
    setAppliedTransforms,
    clearTransforms,
    MAG_SIZE,
    dpr,
    effectiveDir,
    prefetchSurrounding,
    // New data source management
    dataSource,
    setDataSource,
    availableDataSources,
    availabilityLoading,
    // Derived feature flags
    isEnsemble,
    isMerged,
    isStatistics,
    canTransform,
    canEditCoordinates,
    canMerge,
    canViewMerged,
    canCalculateStatistics,
    canViewStatistics,
    hasFrameNavigation,
  } = useVectorViewer({ backendUrl, config });

  // Additional UI state for improved controls
  const [frameInputValue, setFrameInputValue] = useState<string>(String(index));
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // FPS: 0.5, 1, 2, 5, 10
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Collapsible section states
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [showStatistics, setShowStatistics] = useState(false);
  const [showTransforms, setShowTransforms] = useState(false);
  const [showMerging, setShowMerging] = useState(false);

  // Sync frame input value with index
  useEffect(() => {
    setFrameInputValue(String(index));
  }, [index]);

  // Override camera options with config if available
  const cameraOptions = useMemo(() => {
    const cameras = config?.paths?.camera_numbers || [];
    return cameras.length > 0 ? cameras : hookCameraOptions;
  }, [config?.paths?.camera_numbers, hookCameraOptions]);

  // Initialize camera from first available option when config loads
  useEffect(() => {
    if (cameraOptions.length > 0 && !camera) {
      setCamera(cameraOptions[0]);
    }
  }, [cameraOptions, camera, setCamera]);

  // Remember last valid hover values
  const [lastValidHover, setLastValidHover] = useState<any | null>(null);
  useEffect(() => {
    if (hoverData && typeof hoverData.x === "number" && !isNaN(hoverData.x) && hoverData.i >= 0) {
      setLastValidHover(hoverData);
    }
  }, [hoverData]);

  // Use statistics calculation hook
  const {
    selectedCameras,
    includeMerged,
    calculating,
    statisticsJobId,
    showDialog: showStatisticsDialog,
    setSelectedCameras,
    setIncludeMerged,
    setShowDialog: setShowStatisticsDialog,
    jobStatus: statisticsStatus,
    jobDetails: statisticsDetails,
    calculateStatistics,
    resetStatistics,
  } = useStatisticsCalculation(
    backendUrl,
    basePathIdx,
    cameraOptions,
    maxFrameCount
  );

  // Derived values from job details
  const statisticsProgress = statisticsDetails?.overall_progress || statisticsDetails?.progress || 0;
  const statisticsError = statisticsDetails?.error || null;

  // Use vector merging hook
  const {
    selectedCameras: selectedMergeCameras,
    merging,
    mergingJobId,
    showDialog: showMergingDialog,
    setSelectedCameras: setSelectedMergeCameras,
    setShowDialog: setShowMergingDialog,
    jobStatus: mergingStatus,
    jobDetails: mergingDetails,
    mergeVectors,
    resetMerging,
  } = useVectorMerging(
    backendUrl,
    basePathIdx,
    cameraOptions,
    maxFrameCount
  );

  // Derived values from merging job details
  const mergingProgress = mergingDetails?.progress || 0;
  const mergingError = mergingDetails?.error || null;

  // Improved Play/Pause functionality with smart prefetching
  useEffect(() => {
    if (playing && !meanMode) {
      // Prefetch ahead based on playback speed
      const prefetchCount = Math.max(5, Math.ceil(playbackSpeed * 3));
      prefetchSurrounding(index, prefetchCount);

      const advanceFrame = () => {
        setIndex(prev => {
          const next = prev >= maxFrameCount ? 1 : prev + 1;
          // Prefetch frames ahead while playing
          prefetchSurrounding(next, prefetchCount);
          return next;
        });
      };

      // Calculate interval based on playback speed (FPS)
      const intervalMs = 1000 / playbackSpeed;
      playIntervalRef.current = setInterval(advanceFrame, intervalMs);
    } else if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [playing, maxFrameCount, playbackSpeed, meanMode, index, prefetchSurrounding]);

  // Stop playing on error
  useEffect(() => {
    if (error && playing) {
      setPlaying(false);
    }
  }, [error, playing, setPlaying]);

  // Enhanced error message
  const getErrorMessage = (err: string | null) => {
    if (!err) return null;
    if (err.includes("not found") || err.includes("does not exist")) {
      return `${err}. Please check your setup and ensure PIV has been run.`;
    }
    return err;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Results Viewer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* ========== SECTION 1: CONFIGURATION ========== */}
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Configuration</h3>

            {/* Base path selection */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium min-w-[100px]">Base Path:</label>
              <Select value={String(basePathIdx)} onValueChange={v => setBasePathIdx(Number(v))}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Pick base path" /></SelectTrigger>
                <SelectContent>
                  {basePaths.map((p, i) => (
                    <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Data Source Selection - Dynamic based on availability */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium min-w-[100px]">Data Source:</label>
              <Select
                value={dataSource}
                onValueChange={v => setDataSource(v as any)}
                disabled={availabilityLoading}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={availabilityLoading ? "Loading..." : "Select data source"} />
                </SelectTrigger>
                <SelectContent>
                  {/* Instantaneous options */}
                  {availableDataSources.calibrated_instantaneous.exists && (
                    <SelectItem value="calibrated_instantaneous">
                      Calibrated Instantaneous ({availableDataSources.calibrated_instantaneous.frame_count} frames)
                    </SelectItem>
                  )}
                  {availableDataSources.uncalibrated_instantaneous.exists && (
                    <SelectItem value="uncalibrated_instantaneous">
                      Uncalibrated Instantaneous ({availableDataSources.uncalibrated_instantaneous.frame_count} frames)
                    </SelectItem>
                  )}
                  {/* Ensemble options */}
                  {availableDataSources.calibrated_ensemble.exists && (
                    <SelectItem value="calibrated_ensemble">
                      Calibrated Ensemble (Mean)
                    </SelectItem>
                  )}
                  {availableDataSources.uncalibrated_ensemble.exists && (
                    <SelectItem value="uncalibrated_ensemble">
                      Uncalibrated Ensemble (Mean)
                    </SelectItem>
                  )}
                  {/* Merged options - only for calibrated */}
                  {availableDataSources.merged_instantaneous.exists && cameraOptions.length > 1 && (
                    <SelectItem value="merged_instantaneous">
                      Merged Instantaneous ({availableDataSources.merged_instantaneous.frame_count} frames)
                    </SelectItem>
                  )}
                  {availableDataSources.merged_ensemble.exists && cameraOptions.length > 1 && (
                    <SelectItem value="merged_ensemble">
                      Merged Ensemble (Mean)
                    </SelectItem>
                  )}
                  {/* Statistics - only for calibrated instantaneous */}
                  {availableDataSources.statistics.exists && (
                    <SelectItem value="statistics">
                      Mean Statistics
                    </SelectItem>
                  )}
                  {availableDataSources.merged_statistics?.exists && cameraOptions.length > 1 && (
                    <SelectItem value="merged_statistics">
                      Merged Mean Statistics
                    </SelectItem>
                  )}
                  {/* Show message if nothing available */}
                  {!availableDataSources.calibrated_instantaneous.exists &&
                   !availableDataSources.uncalibrated_instantaneous.exists &&
                   !availableDataSources.calibrated_ensemble.exists &&
                   !availableDataSources.uncalibrated_ensemble.exists && (
                    <SelectItem value="none" disabled>No data available</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Camera Selection - Only show when not merged */}
            {!isMerged && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium min-w-[100px]">Camera:</label>
                <Select value={String(camera)} onValueChange={v => setCamera(Number(v))} disabled={cameraOptions.length === 0}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={cameraOptions.length === 0 ? "No cameras" : "Select"} />
                  </SelectTrigger>
                  <SelectContent>
                    {cameraOptions.length === 0 ? (
                      <SelectItem value="none" disabled>No cameras available</SelectItem>
                    ) : (
                      cameraOptions.map((c: number, i: number) => (
                        <SelectItem key={i} value={String(c)}>{c}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Show Statistics Toggle - Only for calibrated instantaneous */}
            {canViewStatistics && !isStatistics && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium min-w-[100px]">Show Statistics:</label>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="show-statistics"
                    checked={meanMode}
                    onCheckedChange={() => toggleMeanMode()}
                  />
                  <label htmlFor="show-statistics" className="text-sm text-gray-600">
                    {meanMode ? "Enabled" : "Disabled"}
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Error Messages */}
          {error && (
            <div className="p-4 bg-red-50 border-l-4 border-red-500 rounded-r-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <div>
                  <h4 className="text-sm font-semibold text-red-800">Error</h4>
                  <p className="text-sm text-red-700 mt-1">{getErrorMessage(error)}</p>
                </div>
              </div>
            </div>
          )}

          {meanMode && statsError && (
            <div className="p-4 bg-amber-50 border-l-4 border-amber-400 rounded-r-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div>
                  <h4 className="text-sm font-semibold text-amber-800">Mean Statistics Not Available</h4>
                  <p className="text-sm text-amber-700">{statsError}</p>
                  <p className="text-sm text-amber-600 mt-2">
                    Calculate statistics first using the "Statistics" section below.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ========== SECTION 2: VISUALISATION SETTINGS ========== */}
          <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Visualisation Settings</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Variable */}
              <div>
                <label htmlFor="type" className="text-sm font-medium block mb-2">Variable:</label>
                <Select value={type} onValueChange={v => setType(v)}>
                  <SelectTrigger id="type">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {meanMode ? (
                      statVarsLoading ? (
                        <SelectItem value="loading">Loading...</SelectItem>
                      ) : statVars && statVars.length > 0 ? (
                        statVars.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)
                      ) : (
                        <SelectItem value="none" disabled>No variables</SelectItem>
                      )
                    ) : (
                      frameVarsLoading ? (
                        <SelectItem value="loading">Loading...</SelectItem>
                      ) : frameVars && frameVars.length > 0 ? (
                        frameVars.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)
                      ) : (
                        <>
                          <SelectItem value="ux">ux</SelectItem>
                          <SelectItem value="uy">uy</SelectItem>
                        </>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Colormap */}
              <div>
                <label htmlFor="cmap" className="text-sm font-medium block mb-2">Colormap:</label>
                <Select value={cmap} onValueChange={v => setCmap(v)}>
                  <SelectTrigger id="cmap">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">default</SelectItem>
                    <SelectItem value="viridis">viridis</SelectItem>
                    <SelectItem value="plasma">plasma</SelectItem>
                    <SelectItem value="inferno">inferno</SelectItem>
                    <SelectItem value="magma">magma</SelectItem>
                    <SelectItem value="cividis">cividis</SelectItem>
                    <SelectItem value="jet">jet</SelectItem>
                    <SelectItem value="gray">gray</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Run */}
              <div>
                <label htmlFor="run" className="text-sm font-medium block mb-2">Run:</label>
                <Input
                  id="run"
                  type="number"
                  min={1}
                  value={run}
                  onChange={e => setRun(Math.max(1, Number(e.target.value)))}
                />
              </div>
            </div>

            {/* Limits */}
            <div className="flex items-end gap-4 flex-wrap">
              <div className="flex-1 min-w-[150px]">
                <label className="text-sm font-medium block mb-2">Lower Limit:</label>
                <Input
                  type="number"
                  value={lower}
                  onChange={e => setLower(e.target.value)}
                  placeholder="auto"
                />
              </div>

              <div className="flex-1 min-w-[150px]">
                <label className="text-sm font-medium block mb-2">Upper Limit:</label>
                <Input
                  type="number"
                  value={upper}
                  onChange={e => setUpper(e.target.value)}
                  placeholder="auto"
                />
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => { void fetchLimits(); }}
                disabled={limitsLoading}
              >
                {limitsLoading ? "Getting..." : "Auto-Calculate"}
              </Button>
            </div>

            {/* X/Y Axis Limits */}
            <div className="flex items-end gap-4 flex-wrap">
              <div className="flex-1 min-w-[100px]">
                <label className="text-sm font-medium block mb-2">X Min:</label>
                <Input
                  type="number"
                  value={xlimMin}
                  onChange={e => setXlimMin(e.target.value)}
                  placeholder="auto"
                />
              </div>

              <div className="flex-1 min-w-[100px]">
                <label className="text-sm font-medium block mb-2">X Max:</label>
                <Input
                  type="number"
                  value={xlimMax}
                  onChange={e => setXlimMax(e.target.value)}
                  placeholder="auto"
                />
              </div>

              <div className="flex-1 min-w-[100px]">
                <label className="text-sm font-medium block mb-2">Y Min:</label>
                <Input
                  type="number"
                  value={ylimMin}
                  onChange={e => setYlimMin(e.target.value)}
                  placeholder="auto"
                />
              </div>

              <div className="flex-1 min-w-[100px]">
                <label className="text-sm font-medium block mb-2">Y Max:</label>
                <Input
                  type="number"
                  value={ylimMax}
                  onChange={e => setYlimMax(e.target.value)}
                  placeholder="auto"
                />
              </div>
            </div>

            {/* Custom Plot Title */}
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium block mb-2">Plot Title:</label>
                <Input
                  type="text"
                  value={plotTitle}
                  onChange={e => setPlotTitle(e.target.value)}
                  placeholder="auto-generated"
                />
              </div>
            </div>

            {/* Render Button */}
            <div className="flex gap-2">
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => { void handleRender(); }}
                disabled={loading || statsLoading || frameVarsLoading}
              >
                {(loading || statsLoading || frameVarsLoading) ? "Loading..." : "Render"}
              </Button>

              {imageSrc && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={downloadCurrentView}
                    disabled={!imageSrc || loading || statsLoading}
                  >
                    Download PNG
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { void copyCurrentView(); }}
                    disabled={!imageSrc || loading || statsLoading}
                  >
                    Copy PNG
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* ========== SECTION 3: CURSOR POSITION (Hidden when uncalibrated) ========== */}
          {imageSrc && !error && !isUncalibrated && (
            <div className="p-3 bg-gradient-to-r from-gray-50 to-gray-100 border rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="text-sm font-medium text-gray-700">
                    Cursor Position:
                  </div>
                  {(() => {
                    const isHoverValid = hoverData && typeof hoverData.x === "number" && !isNaN(hoverData.x) && hoverData.i >= 0;
                    const display = isHoverValid ? hoverData : lastValidHover;
                    if (!display) {
                      return (
                        <div className="text-sm text-gray-500 italic">
                          Hover over the plot area to see coordinates
                        </div>
                      );
                    }

                    let varVal: number | null = null;
                    if (type === "ux" && display.ux != null) varVal = display.ux;
                    else if (type === "uy" && display.uy != null) varVal = display.uy;
                    else if (display.value != null) varVal = display.value;

                    return (
                      <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-600 uppercase">X:</span>
                          <span className="font-mono text-sm font-semibold text-blue-600 bg-white px-2 py-1 rounded border">
                            {display.x.toFixed(3)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-600 uppercase">Y:</span>
                          <span className="font-mono text-sm font-semibold text-blue-600 bg-white px-2 py-1 rounded border">
                            {display.y.toFixed(3)}
                          </span>
                        </div>
                        {varVal != null && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-600 uppercase">
                              {type}:
                            </span>
                            <span className="font-mono text-sm font-semibold text-white bg-blue-600 px-2 py-1 rounded border">
                              {varVal.toFixed(3)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="text-xs text-gray-500">
                  {meanMode ? "Mean Statistics Mode" : `Frame ${index}`}
                </div>
              </div>
            </div>
          )}

          {/* ========== SECTION 4: PLOT/IMAGE DISPLAY ========== */}
          {imageSrc && !error ? (
            <>
              {/* Image container */}
              <div
                className="flex flex-col items-center relative"
                style={{
                  width: '100%',
                  maxWidth: '1100px',
                  margin: '0 auto',
                  cursor: datumMode ? 'crosshair' : magVisible ? 'none' : 'default'
                }}
                onMouseMove={e => { onMouseMove(e); handleMagnifierMove(e); }}
                onMouseLeave={e => { onMouseLeave(); handleMagnifierLeave(); }}
                onClick={e => { if (datumMode) handleImageClick(e); }}
              >
                {/* Frame navigation arrows - Only show when frame navigation is available */}
                {hasFrameNavigation && !meanMode && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIndex(Math.max(1, index - 1))}
                      disabled={index <= 1}
                      title="Previous frame"
                      className="absolute left-3 top-1/2 -translate-y-1/2 z-50 rounded-full p-2 bg-white bg-opacity-90"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 4L6 10l6 6" />
                      </svg>
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIndex(Math.min(maxFrameCount, index + 1))}
                      disabled={index >= maxFrameCount}
                      title="Next frame"
                      className="absolute right-3 top-1/2 -translate-y-1/2 z-50 rounded-full p-2 bg-white bg-opacity-90"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 4l6 6-6 6" />
                      </svg>
                    </Button>
                  </>
                )}

                <img
                  ref={imgRef}
                  src={`data:image/png;base64,${imageSrc}`}
                  alt="Vector Result"
                  className="rounded border w-full max-w-5xl select-none"
                  style={{ width: '100%', maxWidth: '1000px', height: 'auto' }}
                  draggable={false}
                />

                {/* Magnifier Canvas */}
                <canvas
                  ref={magnifierRef}
                  style={{
                    display: magVisible ? 'block' : 'none',
                    position: 'fixed',
                    pointerEvents: 'none',
                    zIndex: 9999,
                    width: MAG_SIZE,
                    height: MAG_SIZE,
                    left: magPos.left,
                    top: magPos.top,
                    borderRadius: '50%',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                    border: '2px solid #333',
                  }}
                  width={MAG_SIZE * dpr}
                  height={MAG_SIZE * dpr}
                />

                {/* Loading overlay */}
                {loading && !playing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60 rounded">
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                      <span className="text-gray-600 text-sm">Rendering...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Frame controls - Hidden for ensemble and statistics */}
              {maxFrameCount > 0 && hasFrameNavigation && !meanMode && (
                <div className="flex flex-col md:flex-row items-center justify-center gap-4 p-4 bg-gray-50 border rounded-lg">
                  {/* Frame slider + numeric input */}
                  <div className="flex items-center gap-3 flex-1 w-full">
                    <label htmlFor="frame-slider" className="text-sm font-medium whitespace-nowrap">Frame:</label>
                    <input
                      id="frame-slider"
                      type="range"
                      min={1}
                      max={maxFrameCount}
                      value={index}
                      onChange={e => setIndex(Number(e.target.value))}
                      className="flex-1 min-w-[200px]"
                    />
                    <Input
                      id="frame-input"
                      type="number"
                      min={1}
                      max={maxFrameCount}
                      value={frameInputValue}
                      onChange={e => {
                        const val = e.target.value;
                        setFrameInputValue(val);
                        if (val && !isNaN(Number(val))) {
                          const num = Math.max(1, Math.min(maxFrameCount, Number(val)));
                          setIndex(num);
                        }
                      }}
                      onBlur={e => {
                        const val = e.target.value;
                        if (!val || isNaN(Number(val))) {
                          setFrameInputValue(String(index));
                        } else {
                          const num = Math.max(1, Math.min(maxFrameCount, Number(val)));
                          setIndex(num);
                          setFrameInputValue(String(num));
                        }
                      }}
                      className="w-24"
                    />
                    <span className="text-xs text-gray-500 whitespace-nowrap">{index} / {maxFrameCount}</span>
                  </div>

                  {/* Play button with speed control */}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={playing ? "default" : "outline"}
                      onClick={() => setPlaying(!playing)}
                      className="flex items-center gap-1"
                    >
                      {playing ? <span>&#10073;&#10073; Pause</span> : <span>&#9654; Play</span>}
                    </Button>

                    <Select
                      value={String(playbackSpeed)}
                      onValueChange={(v) => setPlaybackSpeed(Number(v))}
                      disabled={playing}
                    >
                      <SelectTrigger className="w-24 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0.5">0.5 FPS</SelectItem>
                        <SelectItem value="1">1 FPS</SelectItem>
                        <SelectItem value="2">2 FPS</SelectItem>
                        <SelectItem value="5">5 FPS</SelectItem>
                        <SelectItem value="10">10 FPS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-64 flex items-center justify-center bg-gray-100 border rounded">
              <div className="text-center">
                <svg className="w-16 h-16 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-gray-500">
                  {error ? "Error loading image" : "No image loaded. Click 'Render' to visualise vectors."}
                </span>
              </div>
            </div>
          )}

          {/* ========== SECTION 5: COLLAPSIBLE BUTTONS ROW ========== */}
          <div className="space-y-4">
            {/* Horizontal row of collapsible buttons - only show available features */}
            <div className="flex flex-wrap gap-2">
              {/* Coordinates - Only for calibrated data */}
              {canEditCoordinates && (
                <Button
                  variant={showCoordinates ? "default" : "outline"}
                  onClick={() => setShowCoordinates(!showCoordinates)}
                  className="flex items-center gap-2"
                >
                  Coordinates
                  <svg
                    className={`w-4 h-4 transition-transform ${showCoordinates ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </Button>
              )}

              {/* Statistics - Only for calibrated instantaneous */}
              {canCalculateStatistics && (
                <Button
                  variant={showStatistics ? "default" : "outline"}
                  onClick={() => setShowStatistics(!showStatistics)}
                  className="flex items-center gap-2"
                >
                  Statistics
                  <svg
                    className={`w-4 h-4 transition-transform ${showStatistics ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </Button>
              )}

              {/* Transforms - Only for calibrated data */}
              {canTransform && (
                <Button
                  variant={showTransforms ? "default" : "outline"}
                  onClick={() => setShowTransforms(!showTransforms)}
                  className="flex items-center gap-2"
                >
                  Transforms
                  <svg
                    className={`w-4 h-4 transition-transform ${showTransforms ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </Button>
              )}

              {/* Merging - Only for calibrated instantaneous with multiple cameras */}
              {canMerge && cameraOptions.length > 1 && (
                <Button
                  variant={showMerging ? "default" : "outline"}
                  onClick={() => setShowMerging(!showMerging)}
                  className="flex items-center gap-2"
                >
                  Merging
                  <svg
                    className={`w-4 h-4 transition-transform ${showMerging ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </Button>
              )}
            </div>

            {/* Coordinates Panel - Only for calibrated data */}
            {showCoordinates && canEditCoordinates && !meanMode && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-4">
                <h3 className="text-lg font-semibold text-blue-900">Coordinate System</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium block mb-2">X Offset:</label>
                    <Input
                      type="number"
                      value={xOffset}
                      onChange={e => setXOffset(e.target.value)}
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium block mb-2">Y Offset:</label>
                    <Input
                      type="number"
                      value={yOffset}
                      onChange={e => setYOffset(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={updateOffsets}>
                    Update Offsets
                  </Button>

                  <Button
                    size="sm"
                    variant={datumMode ? "default" : "outline"}
                    onClick={() => setDatumMode(!datumMode)}
                    className={`${datumMode ? "bg-yellow-500 hover:bg-yellow-600" : ""}`}
                  >
                    {datumMode ? "Cancel Set Datum" : "Set New Datum"}
                  </Button>

                  <Button size="sm" variant="outline" onClick={() => fetchCornerCoordinates()}>
                    Show Corner Coordinates
                  </Button>
                </div>

                {/* Display corner coordinates */}
                {showCorners && cornerCoordinates && (
                  <div className="p-3 bg-white border rounded-md">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-medium">Vector Field Corner Coordinates:</h4>
                      <Button size="sm" variant="ghost" onClick={() => setShowCorners(false)}>
                        ✕
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>Top Left: ({cornerCoordinates.topLeft.x.toFixed(2)}, {cornerCoordinates.topLeft.y.toFixed(2)})</div>
                      <div>Top Right: ({cornerCoordinates.topRight.x.toFixed(2)}, {cornerCoordinates.topRight.y.toFixed(2)})</div>
                      <div>Bottom Left: ({cornerCoordinates.bottomLeft.x.toFixed(2)}, {cornerCoordinates.bottomLeft.y.toFixed(2)})</div>
                      <div>Bottom Right: ({cornerCoordinates.bottomRight.x.toFixed(2)}, {cornerCoordinates.bottomRight.y.toFixed(2)})</div>
                    </div>
                  </div>
                )}

                {datumMode && (
                  <div className="p-3 bg-yellow-50 border-l-4 border-yellow-400 rounded-r">
                    <strong>Set Datum Mode Active:</strong> Click on the image to set a new coordinate system origin.
                  </div>
                )}
              </div>
            )}

            {/* Statistics Panel - Only for calibrated instantaneous */}
            {showStatistics && canCalculateStatistics && (
              <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg space-y-3">
                <h3 className="text-lg font-semibold text-blue-900">Statistics Calculation</h3>
                <p className="text-xs text-blue-800">
                  Calculate mean velocities and Reynolds stresses across all frames.
                </p>

                {!statisticsJobId && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-gray-700 mb-1.5 block">Select Cameras:</label>
                      <div className="flex flex-wrap gap-2">
                        {cameraOptions.map((cam: number) => (
                          <label key={cam} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer transition-colors text-sm">
                            <input
                              type="checkbox"
                              checked={selectedCameras.includes(String(cam))}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedCameras([...selectedCameras, String(cam)]);
                                } else {
                                  setSelectedCameras(selectedCameras.filter(c => c !== String(cam)));
                                }
                              }}
                              className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                            />
                            <span className="font-medium">Cam {cam}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <label className="inline-flex items-center gap-2 px-2.5 py-1.5 bg-white border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer transition-colors text-sm">
                      <input
                        type="checkbox"
                        checked={includeMerged}
                        onChange={e => setIncludeMerged(e.target.checked)}
                        className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                      />
                      <span className="font-medium">Include Merged Data</span>
                      <span className="text-xs text-gray-500">(if available)</span>
                    </label>

                    <Button
                      onClick={calculateStatistics}
                      disabled={calculating || (selectedCameras.length === 0 && !includeMerged)}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                      size="sm"
                    >
                      {calculating ? "Starting Calculation..." : "Calculate Statistics"}
                    </Button>
                  </div>
                )}

                {/* Progress display */}
                {statisticsJobId && statisticsStatus !== "completed" && statisticsStatus !== "failed" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-gray-700">Status:</span>
                      <span className={`font-medium ${statisticsStatus === "running" ? "text-blue-600" : "text-gray-600"}`}>
                        {statisticsStatus === "running" ? "Processing..." : statisticsStatus}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                        <div
                          className="h-2 bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
                          style={{ width: `${statisticsProgress}%` }}
                        ></div>
                      </div>
                      <p className="text-xs text-gray-600 text-right">
                        {statisticsProgress.toFixed(1)}% complete
                      </p>
                    </div>

                    {statisticsDetails?.camera && (
                      <p className="text-xs text-gray-600">
                        Processing: <span className="font-medium">{statisticsDetails.camera}</span>
                      </p>
                    )}
                  </div>
                )}

                {statisticsStatus === "completed" && (
                  <div className="space-y-2">
                    <div className="p-3 bg-green-50 border-l-4 border-green-500 rounded-r">
                      <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <div>
                          <h5 className="text-xs font-semibold text-green-800">Statistics Calculated!</h5>
                          <p className="text-xs text-green-700 mt-0.5">
                            Select "Mean Statistics" data source to view them.
                          </p>
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={resetStatistics}
                      variant="outline"
                      className="w-full text-xs"
                    >
                      Calculate New Statistics
                    </Button>
                  </div>
                )}

                {statisticsStatus === "failed" && statisticsError && (
                  <div className="space-y-2">
                    <div className="p-3 bg-red-50 border-l-4 border-red-500 rounded-r">
                      <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        <div>
                          <h5 className="text-xs font-semibold text-red-800">Calculation Failed</h5>
                          <p className="text-xs text-red-700 mt-0.5">{statisticsError}</p>
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={resetStatistics}
                      variant="outline"
                      className="w-full text-xs"
                    >
                      Try Again
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Transforms Panel - Only for calibrated data */}
            {showTransforms && canTransform && imageSrc && !error && !meanMode && (
              <div className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 rounded-lg">
                <h3 className="text-lg font-semibold text-purple-900 mb-3">Transformations</h3>

                <div className="flex flex-col gap-3">
                  {/* Applied transforms indicator */}
                  {appliedTransforms.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-purple-700 bg-purple-100 px-3 py-1 rounded-full">
                        {appliedTransforms.length} transform{appliedTransforms.length !== 1 ? 's' : ''} applied
                      </span>
                    </div>
                  )}

                  {/* Individual transform buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm font-semibold text-gray-700 mr-2">Apply to current frame:</label>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('rotate_90_ccw')}>Rotate Left</Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('rotate_90_cw')}>Rotate Right</Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('flip_lr')}>Flip Horizontal</Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('flip_ud')}>Flip Vertical</Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('swap_ux_uy')}>Swap UX/UY</Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('invert_ux_uy')}>Invert UX/UY</Button>
                  </div>

                  {/* Apply to all frames buttons */}
                  <div className="flex items-center gap-3 pt-2 border-t border-purple-200">
                    <Button
                      size="default"
                      onClick={() => applyTransformationToAllFrames(appliedTransforms)}
                      disabled={loading || appliedTransforms.length === 0}
                      className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 14h-5a2 2 0 0 1-2-2V7" />
                        <path d="M14 2L7 9l7 7" />
                      </svg>
                      Apply to All Frames
                    </Button>
                    <Button
                      size="default"
                      variant="destructive"
                      onClick={clearTransforms}
                      disabled={loading}
                    >
                      Clear Transforms
                    </Button>
                  </div>
                </div>

                {/* Transformation progress */}
                {transformationJob && (
                  <div className="mt-4 p-3 bg-white border border-purple-200 rounded">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-purple-900">
                        Applying transformations...
                      </span>
                      <span className="text-sm text-purple-700">
                        {transformationJob.status === 'completed' ? 'Complete' :
                         transformationJob.status === 'failed' ? 'Failed' :
                         `${transformationJob.progress}%`}
                      </span>
                    </div>
                    <div className="w-full bg-purple-200 rounded-full h-2">
                      <div
                        className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${transformationJob.progress}%` }}
                      ></div>
                    </div>
                    <div className="mt-2 text-xs text-purple-700">
                      {transformationJob.processed_frames} / {transformationJob.total_frames} frames
                      {transformationJob.elapsed_time && (
                        <span className="ml-2">
                          ({Math.round(transformationJob.elapsed_time)}s elapsed)
                        </span>
                      )}
                    </div>
                    {transformationJob.error && (
                      <div className="mt-2 text-xs text-red-600">
                        Error: {transformationJob.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Merging Panel - Only for calibrated instantaneous with multiple cameras */}
            {showMerging && canMerge && cameraOptions.length > 1 && !meanMode && (
              <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg space-y-3">
                <h3 className="text-lg font-semibold text-green-900">Merge Vectors</h3>
                <p className="text-xs text-green-800">
                  Merge vector fields from multiple cameras into a single combined field.
                </p>

                {!mergingJobId && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-gray-700 mb-1.5 block">Select Cameras to Merge:</label>
                      <div className="flex flex-wrap gap-2">
                        {cameraOptions.map((cam: number) => (
                          <label key={cam} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer transition-colors text-sm">
                            <input
                              type="checkbox"
                              checked={selectedMergeCameras.includes(cam)}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedMergeCameras([...selectedMergeCameras, cam]);
                                } else {
                                  setSelectedMergeCameras(selectedMergeCameras.filter(c => c !== cam));
                                }
                              }}
                              className="w-3.5 h-3.5 text-green-600 border-gray-300 rounded focus:ring-green-500"
                            />
                            <span className="text-xs font-medium">Cam {cam}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={() => mergeVectors(index)}
                        disabled={merging || selectedMergeCameras.length < 2}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs py-2"
                        size="sm"
                      >
                        {merging ? "Merging..." : `Merge Frame ${index}`}
                      </Button>
                      <Button
                        onClick={() => mergeVectors()}
                        disabled={merging || selectedMergeCameras.length < 2}
                        className="flex-1 bg-green-700 hover:bg-green-800 text-white text-xs py-2"
                        size="sm"
                      >
                        {merging ? "Merging..." : `Merge All (${maxFrameCount})`}
                      </Button>
                    </div>
                  </div>
                )}

                {mergingJobId && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <div className="text-xs font-medium text-gray-700 mb-1">
                          {mergingStatus === "completed" ? "Merge Complete!" :
                           mergingStatus === "failed" ? "Merge Failed" :
                           mergingStatus === "running" ? "Merging vectors..." : "Starting..."}
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-green-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${mergingProgress}%` }}
                          />
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {mergingDetails?.processed_frames || 0} / {mergingDetails?.total_frames || 0} frames
                        </div>
                      </div>
                    </div>

                    {mergingStatus === "completed" && (
                      <div className="p-3 bg-green-50 border-l-4 border-green-500 rounded-r">
                        <div className="flex items-start gap-2">
                          <svg className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <div>
                            <h5 className="text-xs font-semibold text-green-800">Merge Successful</h5>
                            <p className="text-xs text-green-700 mt-0.5">
                              Vectors merged successfully. Select "Merged Cameras" data source to view results.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {mergingStatus === "failed" && mergingError && (
                      <div className="space-y-2">
                        <div className="p-3 bg-red-50 border-l-4 border-red-500 rounded-r">
                          <div className="flex items-start gap-2">
                            <svg className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            <div>
                              <h5 className="text-xs font-semibold text-red-800">Merge Failed</h5>
                              <p className="text-xs text-red-700 mt-0.5">{mergingError}</p>
                            </div>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={resetMerging}
                          variant="outline"
                          className="w-full text-xs"
                        >
                          Try Again
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
