"use client";
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { useVectorViewer, GroupedVariables, DataSourceType } from "@/hooks/useVectorViewer";
import { useStatisticsCalculation } from "@/hooks/useStatisticsCalculation";
import DataSourceToggle from "@/components/shared/DataSourceToggle";
import ColormapSelect from "@/components/shared/ColormapSelect";

// Available statistics options matching backend VectorStatisticsProcessor.VALID_STATISTICS
const AVAILABLE_STATISTICS = {
  timeAveraged: [
    { id: "mean_velocity", label: "Mean Velocity" },
    { id: "mean_vorticity", label: "Mean Vorticity" },
    { id: "mean_divergence", label: "Mean Divergence" },
    { id: "mean_stresses", label: "Stresses" },  // Full stress tensor (uu, vv, uv + ww, uw, vw for stereo)
    { id: "mean_tke", label: "Mean TKE" },
    { id: "mean_peak_height", label: "Mean Peak Height" },
  ],
  instantaneous: [
    { id: "inst_velocity", label: "Inst. Velocity" },
    { id: "inst_stresses", label: "Inst. Stresses" },  // Per-frame stress tensor
    { id: "inst_vorticity", label: "Inst. Vorticity" },
    { id: "inst_divergence", label: "Inst. Divergence" },
    { id: "inst_gamma", label: "Inst. Gamma" },
  ]
};

// Variable label formatting helpers
const formatVarLabel = (varName: string, source: 'inst' | 'inst_stat' | 'mean' | 'ens'): string => {
  // Special formatting for known variables
  const specialLabels: Record<string, Record<string, string>> = {
    inst_stat: {
      // Instantaneous stress tensor components
      uu_inst: "u'u'",
      vv_inst: "v'v'",
      ww_inst: "w'w'",
      uv_inst: "u'v'",
      uw_inst: "u'w'",
      vw_inst: "v'w'",
      // Legacy fluctuations (backward compat)
      u_prime: "u'",
      v_prime: "v'",
      w_prime: "w'",
      // Other instantaneous stats
      gamma1: "γ₁",
      gamma2: "γ₂",
      vorticity: "ω",
      divergence: "∇·u",
    },
    mean: {
      ux: "Mean ux",
      uy: "Mean uy",
      uz: "Mean uz",
      uu: "⟨u'u'⟩",
      vv: "⟨v'v'⟩",
      ww: "⟨w'w'⟩",
      uv: "⟨u'v'⟩",
      uw: "⟨u'w'⟩",
      vw: "⟨v'w'⟩",
      tke: "TKE",
      vorticity: "Mean ω",
      divergence: "Mean ∇·u",
    },
    ens: {
      ux: "Ensemble ux",
      uy: "Ensemble uy",
      uz: "Ensemble uz",
      UU_stress: "⟨u'u'⟩",
      VV_stress: "⟨v'v'⟩",
      WW_stress: "⟨w'w'⟩",
      UV_stress: "⟨u'v'⟩",
      UW_stress: "⟨u'w'⟩",
      VW_stress: "⟨v'w'⟩",
      tke: "TKE",
      vorticity: "Ensemble ω",
      divergence: "Ensemble ∇·u",
    },
  };

  if (source === 'inst_stat' && specialLabels.inst_stat[varName]) {
    return specialLabels.inst_stat[varName];
  }
  if (source === 'mean' && specialLabels.mean[varName]) {
    return specialLabels.mean[varName];
  }
  if (source === 'ens' && specialLabels.ens[varName]) {
    return specialLabels.ens[varName];
  }
  return varName;
};

// Check if any grouped vars are available
const hasGroupedVars = (allVars: { instantaneous: string[]; instantaneous_stats: string[]; mean_stats: string[]; ensemble: string[] }): boolean => {
  return (allVars.instantaneous.length > 0 || allVars.instantaneous_stats.length > 0 || allVars.mean_stats.length > 0 || allVars.ensemble.length > 0);
};

// Filter allVars based on current data source
const getFilteredVars = (
  allVars: GroupedVariables,
  dataSource: DataSourceType
): GroupedVariables => {
  const isEnsembleSource = dataSource.includes('ensemble');
  const isStatisticsSource = dataSource.includes('statistics');

  if (isEnsembleSource) {
    // Ensemble mode: only show ensemble variables
    return {
      instantaneous: [],
      instantaneous_stats: [],
      mean_stats: [],
      ensemble: allVars.ensemble,
    };
  }

  if (isStatisticsSource) {
    // Statistics mode: only show mean stats
    return {
      instantaneous: [],
      instantaneous_stats: [],
      mean_stats: allVars.mean_stats,
      ensemble: [],
    };
  }

  // Instantaneous mode: show instantaneous + stats, not ensemble
  return {
    instantaneous: allVars.instantaneous,
    instantaneous_stats: allVars.instantaneous_stats,
    mean_stats: allVars.mean_stats,
    ensemble: [],
  };
};

// Unit lookup for hover tooltip (calibrated mode)
const VARIABLE_UNITS: Record<string, string> = {
  // Velocities
  ux: "m/s", uy: "m/s", uz: "m/s",
  mean_ux: "m/s", mean_uy: "m/s", mean_uz: "m/s",
  // Fluctuations
  u_prime: "m/s", v_prime: "m/s", w_prime: "m/s",
  // Mean stresses
  uu: "m\u00B2/s\u00B2", vv: "m\u00B2/s\u00B2", ww: "m\u00B2/s\u00B2",
  uv: "m\u00B2/s\u00B2", uw: "m\u00B2/s\u00B2", vw: "m\u00B2/s\u00B2",
  // Instantaneous stresses
  uu_inst: "m\u00B2/s\u00B2", vv_inst: "m\u00B2/s\u00B2", ww_inst: "m\u00B2/s\u00B2",
  uv_inst: "m\u00B2/s\u00B2", uw_inst: "m\u00B2/s\u00B2", vw_inst: "m\u00B2/s\u00B2",
  // Ensemble stresses
  UU_stress: "m\u00B2/s\u00B2", VV_stress: "m\u00B2/s\u00B2", WW_stress: "m\u00B2/s\u00B2",
  UV_stress: "m\u00B2/s\u00B2", UW_stress: "m\u00B2/s\u00B2", VW_stress: "m\u00B2/s\u00B2",
  // TKE
  tke: "m\u00B2/s\u00B2",
  // Vorticity / divergence
  vorticity: "1/s", divergence: "1/s",
  // Gamma (dimensionless)
  gamma1: "", gamma2: "",
  // Peak magnitude (dimensionless)
  peak_mag: "", peakheight: "",
  mean_peak_height: "",
};

// Inline Vector Merging Hook
const useVectorMerging = (backendUrl: string, basePathIdx: number, cameraOptions: number[], maxFrameCount: number, config?: any) => {
  const [selectedCameras, setSelectedCameras] = useState<number[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergingJobId, setMergingJobId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [jobStatus, setJobStatus] = useState<string>("not_started");
  const [jobDetails, setJobDetails] = useState<any>(null);

  // Get merging config values
  const mergingConfig = config?.merging || {};
  const configCameras = mergingConfig.cameras || [];
  const configTypeName = mergingConfig.type_name || "instantaneous";
  const configEndpoint = mergingConfig.endpoint || "";

  // Initialize selected cameras: prefer config, then first 2 camera options
  useEffect(() => {
    if (selectedCameras.length === 0) {
      if (configCameras.length >= 2) {
        setSelectedCameras(configCameras);
      } else if (cameraOptions.length >= 2) {
        setSelectedCameras([cameraOptions[0], cameraOptions[1]]);
      }
    }
  }, [cameraOptions, configCameras, selectedCameras.length]);

  // Save camera selection to config when changed by user
  const updateSelectedCameras = useCallback(async (cameras: number[]) => {
    setSelectedCameras(cameras);
    // Save to config.yaml
    try {
      await fetch(`${backendUrl}/update_config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merging: { cameras } }),
      });
    } catch (e) {
      console.error("Failed to save merging cameras to config:", e);
    }
  }, [backendUrl]);

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
        type_name: configTypeName,
        endpoint: configEndpoint,
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
  }, [backendUrl, basePathIdx, selectedCameras, maxFrameCount, configTypeName, configEndpoint]);

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
    updateSelectedCameras,
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
    runInput,
    setRunInput,
    runError,
    setRunError,
    availableRuns,
    validateAndSetRun,
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
    clearOperationsList,
    MAG_SIZE,
    dpr,
    effectiveDir,
    // New data source management
    dataSource,
    setDataSource,
    availableDataSources,
    availabilityLoading,
    fetchAvailableDataSources,
    fetchStatVars,
    fetchFrameVars,
    // Grouped variables for unified dropdown
    allVars,
    allVarsLoading,
    fetchAllVars,
    // Derived feature flags
    isEnsemble,
    isMerged,
    isStatistics,
    isStereo,
    isStereoData,  // Based on selected dataSource (not config)
    isMeanVar,
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

  // Filter variables based on current data source
  const filteredVars = useMemo(
    () => getFilteredVars(allVars, dataSource),
    [allVars, dataSource]
  );

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

  // Clear stale hover data when data source changes (coordinates/units will differ)
  useEffect(() => {
    setLastValidHover(null);
  }, [dataSource]);

  // Use statistics calculation hook (with config for checkbox/gamma sync)
  const {
    processMerged,
    setProcessMerged,
    cameraCount: statsCameraCount,
    isStereoStats,
    requestedStatistics,
    gammaRadius,
    calculating,
    statisticsJobId,
    showDialog: showStatisticsDialog,
    setRequestedStatistics,
    setGammaRadius,
    setShowDialog: setShowStatisticsDialog,
    jobStatus: statisticsStatus,
    jobDetails: statisticsDetails,
    calculateStatistics,
    resetStatistics,
  } = useStatisticsCalculation(
    backendUrl,
    basePathIdx,
    cameraOptions,
    maxFrameCount,
    config,  // Pass config for initializing from enabled_methods and gamma_radius
    dataSource  // Pass dataSource directly to avoid race with config sync
  );

  // Derived values from job details
  const statisticsProgress = statisticsDetails?.overall_progress || statisticsDetails?.progress || 0;
  const statisticsError = statisticsDetails?.error || null;

  // Track if we've already refreshed after statistics completion (avoid infinite loop)
  const hasRefreshedAfterStatsCompletion = useRef(false);

  // Refresh available data sources and variables when statistics calculation completes
  // Using ref guard to prevent infinite loop from circular dependencies in fetch functions
  useEffect(() => {
    if (statisticsStatus === "completed" && !hasRefreshedAfterStatsCompletion.current) {
      hasRefreshedAfterStatsCompletion.current = true;
      // Force refresh available data sources to pick up new statistics
      fetchAvailableDataSources(true);
      // Refresh grouped variables to show new stats in dropdown
      fetchAllVars();
      // Also refresh legacy mode vars
      if (meanMode) {
        fetchStatVars();
      } else {
        fetchFrameVars();
      }
    }
    // Reset the ref when status changes away from completed
    if (statisticsStatus !== "completed") {
      hasRefreshedAfterStatsCompletion.current = false;
    }
  }, [statisticsStatus]);  // Only depend on status, not fetch functions (avoids circular dependency)

  // Use vector merging hook
  const {
    selectedCameras: selectedMergeCameras,
    merging,
    mergingJobId,
    showDialog: showMergingDialog,
    setSelectedCameras: setSelectedMergeCameras,
    updateSelectedCameras: updateMergeCameras,
    setShowDialog: setShowMergingDialog,
    jobStatus: mergingStatus,
    jobDetails: mergingDetails,
    mergeVectors,
    resetMerging,
  } = useVectorMerging(
    backendUrl,
    basePathIdx,
    cameraOptions,
    maxFrameCount,
    config
  );

  // Derived values from merging job details
  const mergingProgress = mergingDetails?.progress || 0;
  const mergingError = mergingDetails?.error || null;

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
                  {/* Stereo options - show when stereo data exists (file-based detection) */}
                  {availableDataSources.stereo_instantaneous?.exists && (
                    <SelectItem value="stereo_instantaneous">
                      Stereo Instantaneous ({availableDataSources.stereo_instantaneous.frame_count} frames)
                    </SelectItem>
                  )}
                  {availableDataSources.stereo_ensemble?.exists && (
                    <SelectItem value="stereo_ensemble">
                      Stereo Ensemble (Mean)
                    </SelectItem>
                  )}
                  {/* Merged options - only for calibrated, multi-camera, non-stereo */}
                  {availableDataSources.merged_instantaneous?.exists && cameraOptions.length > 1 && !isStereo && (
                    <SelectItem value="merged_instantaneous">
                      Merged Instantaneous ({availableDataSources.merged_instantaneous.frame_count} frames)
                    </SelectItem>
                  )}
                  {availableDataSources.merged_ensemble?.exists && cameraOptions.length > 1 && !isStereo && (
                    <SelectItem value="merged_ensemble">
                      Merged Ensemble (Mean)
                    </SelectItem>
                  )}
                  {/* Mean Statistics removed - now accessible via Variable dropdown with mean: prefix */}
                  {/* Show message if nothing available */}
                  {!availableDataSources.calibrated_instantaneous?.exists &&
                   !availableDataSources.uncalibrated_instantaneous?.exists &&
                   !availableDataSources.calibrated_ensemble?.exists &&
                   !availableDataSources.uncalibrated_ensemble?.exists &&
                   !availableDataSources.stereo_instantaneous?.exists &&
                   !availableDataSources.stereo_ensemble?.exists && (
                    <SelectItem value="none" disabled>No data available</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Camera Selection - Hide when merged, show "Stereo" only when viewing stereo data */}
            {!isMerged && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium min-w-[100px]">
                  {isStereoData ? "Source:" : "Camera:"}
                </label>
                {isStereoData ? (
                  // Stereo data selected: show fixed "Stereo" label (no dropdown)
                  <div className="flex-1 px-3 py-2 bg-muted rounded-md text-sm">
                    Stereo (3D)
                  </div>
                ) : (
                  // Non-stereo data: show camera dropdown
                  <Select value={String(camera)} onValueChange={v => setCamera(Number(v))} disabled={cameraOptions.length === 0}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={cameraOptions.length === 0 ? "No cameras" : "Select"} />
                    </SelectTrigger>
                    <SelectContent>
                      {cameraOptions.length === 0 ? (
                        <SelectItem value="none" disabled>No cameras available</SelectItem>
                      ) : (
                        cameraOptions.map((c: number, i: number) => (
                          <SelectItem key={i} value={String(c)}>Camera {c}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                )}
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

          {isMeanVar && statsError && (
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
              {/* Variable - Unified Grouped Dropdown */}
              <div>
                <label htmlFor="type" className="text-sm font-medium block mb-2">Variable:</label>
                <Select value={type} onValueChange={v => setType(v)}>
                  <SelectTrigger id="type">
                    <SelectValue placeholder="Select variable" />
                  </SelectTrigger>
                  <SelectContent>
                    {allVarsLoading ? (
                      <SelectItem value="loading" disabled>Loading...</SelectItem>
                    ) : hasGroupedVars(filteredVars) ? (
                      <>
                        {/* Instantaneous Variables from frame files */}
                        {filteredVars.instantaneous.length > 0 && (
                          <SelectGroup>
                            <SelectLabel className="text-xs text-gray-500 px-2">Instantaneous</SelectLabel>
                            {filteredVars.instantaneous.map(v => (
                              <SelectItem key={`inst:${v}`} value={`inst:${v}`}>
                                {formatVarLabel(v, 'inst')}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}

                        {/* Calculated Per-Frame Stats (if computed) */}
                        {filteredVars.instantaneous_stats.length > 0 && (
                          <>
                            <SelectSeparator />
                            <SelectGroup>
                              <SelectLabel className="text-xs text-gray-500 px-2">Calculated (Per-Frame)</SelectLabel>
                              {filteredVars.instantaneous_stats.map(v => (
                                <SelectItem key={`inst_stat:${v}`} value={`inst_stat:${v}`}>
                                  {formatVarLabel(v, 'inst_stat')}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </>
                        )}

                        {/* Mean Statistics (if computed) */}
                        {filteredVars.mean_stats.length > 0 && (
                          <>
                            <SelectSeparator />
                            <SelectGroup>
                              <SelectLabel className="text-xs text-gray-500 px-2">Mean Statistics</SelectLabel>
                              {filteredVars.mean_stats.map(v => (
                                <SelectItem key={`mean:${v}`} value={`mean:${v}`}>
                                  {formatVarLabel(v, 'mean')}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </>
                        )}

                        {/* Ensemble Variables (from ensemble_result.mat) */}
                        {filteredVars.ensemble.length > 0 && (
                          <>
                            <SelectSeparator />
                            <SelectGroup>
                              <SelectLabel className="text-xs text-gray-500 px-2">Ensemble (Mean)</SelectLabel>
                              {filteredVars.ensemble.map(v => (
                                <SelectItem key={`ens:${v}`} value={`ens:${v}`}>
                                  {formatVarLabel(v, 'ens')}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </>
                        )}
                      </>
                    ) : (
                      // Fallback if no grouped vars loaded yet
                      <>
                        <SelectItem value="inst:ux">ux</SelectItem>
                        <SelectItem value="inst:uy">uy</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Colormap */}
              <div>
                <label htmlFor="cmap" className="text-sm font-medium block mb-2">Colormap:</label>
                <ColormapSelect
                  id="cmap"
                  value={cmap}
                  onValueChange={setCmap}
                  placeholder="Select"
                />
              </div>

              {/* Run */}
              <div>
                <label htmlFor="pass" className="text-sm font-medium block mb-2">Pass:</label>
                <Input
                  id="pass"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={runInput}
                  onChange={e => setRunInput(e.target.value)}
                  onBlur={() => validateAndSetRun(runInput)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      validateAndSetRun(runInput);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className={runError ? "border-red-500" : ""}
                />
                {runError && (
                  <p className="text-xs text-red-500 mt-1">{runError}</p>
                )}
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

          {/* ========== SECTION 3: CURSOR POSITION ========== */}
          {imageSrc && !error && (
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
                            {display.x.toFixed(3)}{isUncalibrated ? " px" : " mm"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-600 uppercase">Y:</span>
                          <span className="font-mono text-sm font-semibold text-blue-600 bg-white px-2 py-1 rounded border">
                            {display.y.toFixed(3)}{isUncalibrated ? " px" : " mm"}
                          </span>
                        </div>
                        {varVal != null && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-600 uppercase">
                              {type.includes(':') ? type.split(':').slice(1).join(':') : type}:
                            </span>
                            <span className="font-mono text-sm font-semibold text-white bg-blue-600 px-2 py-1 rounded border">
                              {(() => {
                                const varName = type.includes(':') ? type.split(':').slice(1).join(':') : type;
                                const unit = isUncalibrated ? "px" : (VARIABLE_UNITS[varName] ?? "m/s");
                                return `${varVal.toFixed(3)}${unit ? ` ${unit}` : ""}`;
                              })()}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="text-xs text-gray-500">
                  {isMeanVar ? "Mean Statistics Mode" : isUncalibrated ? `Frame ${index} (Uncalibrated)` : `Frame ${index}`}
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
                {hasFrameNavigation && (
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

                {/* Loading overlay - full overlay when paused, corner indicator when playing */}
                {loading && !playing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60 rounded">
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                      <span className="text-gray-600 text-sm">Rendering...</span>
                    </div>
                  </div>
                )}
                {/* Subtle corner loading indicator during playback */}
                {loading && playing && (
                  <div className="absolute top-3 right-3 flex items-center gap-2 bg-white bg-opacity-80 px-2 py-1 rounded shadow">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    <span className="text-gray-600 text-xs">Loading...</span>
                  </div>
                )}
              </div>

              {/* Frame controls - Hidden for ensemble, statistics, and mean variables */}
              {maxFrameCount > 0 && hasFrameNavigation && (
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

                  {/* Play button - advances as fast as frames load, capped at ~3 FPS */}
                  <Button
                    size="sm"
                    variant={playing ? "default" : "outline"}
                    onClick={() => setPlaying(!playing)}
                    className="flex items-center gap-1"
                  >
                    {playing ? <span>&#10073;&#10073; Pause</span> : <span>&#9654; Play</span>}
                  </Button>
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

              {/* Transforms - For calibrated data (including merged), not statistics/mean vars or stereo */}
              {canTransform && !isStatistics && !isMeanVar && !isStereoData && (
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

              {/* Merging - Only for calibrated instantaneous with multiple cameras, not stereo */}
              {canMerge && cameraOptions.length > 1 && !isStereo && (
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
            {showCoordinates && canEditCoordinates && !isMeanVar && (
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
                    {/* Statistics Selection */}
                    <div className="space-y-2 bg-white p-2 rounded border border-gray-200">
                      <label className="text-xs font-medium text-gray-700 block mb-1">Select Statistics:</label>

                      <div className="grid grid-cols-2 gap-4">
                        {/* Time Averaged */}
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Time-Averaged</p>
                          <div className="space-y-1">
                            {AVAILABLE_STATISTICS.timeAveraged.map((stat) => (
                              <label key={stat.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-0.5 rounded">
                                <input
                                  type="checkbox"
                                  checked={requestedStatistics.includes(stat.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setRequestedStatistics([...requestedStatistics, stat.id]);
                                    } else {
                                      setRequestedStatistics(requestedStatistics.filter((id: string) => id !== stat.id));
                                    }
                                  }}
                                  className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <span className="text-xs text-gray-700">{stat.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Instantaneous */}
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Instantaneous</p>
                          <div className="space-y-1">
                            {AVAILABLE_STATISTICS.instantaneous.map((stat) => (
                              <label key={stat.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-0.5 rounded">
                                <input
                                  type="checkbox"
                                  checked={requestedStatistics.includes(stat.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setRequestedStatistics([...requestedStatistics, stat.id]);
                                    } else {
                                      setRequestedStatistics(requestedStatistics.filter((id: string) => id !== stat.id));
                                    }
                                  }}
                                  className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <span className="text-xs text-gray-700">{stat.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end mt-2 pt-1 border-t border-gray-100">
                         <button
                            type="button"
                            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                            onClick={() => setRequestedStatistics([
                                ...AVAILABLE_STATISTICS.timeAveraged.map(s => s.id),
                                ...AVAILABLE_STATISTICS.instantaneous.map(s => s.id)
                            ])}
                         >
                            Select All
                         </button>
                         <span className="mx-2 text-xs text-gray-300">|</span>
                         <button
                            type="button"
                            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                            onClick={() => setRequestedStatistics([])}
                         >
                            Clear
                         </button>
                      </div>
                    </div>

                    {/* Gamma Radius Setting */}
                    <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                      <label className="text-xs font-medium text-gray-700">Gamma Radius:</label>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={gammaRadius}
                        onChange={e => setGammaRadius(Math.max(1, Number(e.target.value)))}
                        className="w-20 h-8 text-sm"
                      />
                      <span className="text-xs text-gray-500">(grid points for vortex detection)</span>
                    </div>

                    {/* Data Source Selection */}
                    <DataSourceToggle
                      cameraCount={statsCameraCount}
                      hasMergedData={availableDataSources.merged_instantaneous?.exists ?? false}
                      value={processMerged ? "merged" : "all_cameras"}
                      onChange={(val) => setProcessMerged(val === "merged")}
                      disabled={calculating}
                      isStereo={isStereoStats}
                    />

                    <Button
                      onClick={calculateStatistics}
                      disabled={calculating}
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
                            Select from the Variable dropdown to view them.
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

            {/* Transforms Panel - For calibrated data (including merged), not statistics/mean vars or stereo */}
            {showTransforms && canTransform && imageSrc && !error && !isStatistics && !isMeanVar && !isStereoData && (
              <div className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 rounded-lg">
                <h3 className="text-lg font-semibold text-purple-900 mb-3">Transformations</h3>
                <p className="text-xs text-purple-700 mb-3">
                  Transforms modify calibrated vector data (.mat files) on disk. Preview changes on a single frame, then apply to all frames. Statistics should be recalculated after transforming.
                </p>

                {/* Data source indicator */}
                <div className="mb-3 text-sm text-purple-700">
                  <span className="font-medium">Source: </span>
                  <span className="bg-purple-100 px-2 py-0.5 rounded">
                    {isMerged ? "Merged" : isStereoData ? "Stereo" : `Camera ${camera}`}
                  </span>
                </div>

                <div className="flex flex-col gap-3">
                  {/* Applied transforms indicator */}
                  {appliedTransforms.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-purple-700 bg-purple-100 px-3 py-1 rounded-full">
                        {appliedTransforms.length} transform{appliedTransforms.length !== 1 ? 's' : ''} applied
                      </span>
                    </div>
                  )}

                  {/* Geometric transforms */}
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm font-semibold text-gray-700 mr-2">Geometric:</label>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('rotate_90_ccw')}>Rotate Left</Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('rotate_90_cw')}>Rotate Right</Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('flip_lr')}>Flip Horizontal</Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('flip_ud')}>Flip Vertical</Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('swap_ux_uy')}>Swap UX/UY</Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('invert_ux_uy')}>Invert UX/UY</Button>
                  </div>

                  {/* Scale Velocities */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-purple-200">
                    <label className="text-sm font-semibold text-gray-700 mr-2">Scale Velocities:</label>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('scale_velocity:1000')}>
                      ×1000 (m/s→mm/s)
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('scale_velocity:0.001')}>
                      ×0.001 (mm/s→m/s)
                    </Button>
                    <div className="flex items-center gap-1">
                      <Input
                        id="velocity-scale-custom"
                        type="number"
                        step="any"
                        placeholder="Custom factor"
                        className="w-32 h-8 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const input = e.currentTarget as HTMLInputElement;
                            const factor = parseFloat(input.value);
                            if (!isNaN(factor) && factor !== 0) {
                              applyTransformation(`scale_velocity:${factor}`);
                              input.value = '';
                            } else {
                              alert('Please enter a non-zero number');
                            }
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const input = document.getElementById('velocity-scale-custom') as HTMLInputElement;
                          const factor = parseFloat(input.value);
                          if (!isNaN(factor) && factor !== 0) {
                            applyTransformation(`scale_velocity:${factor}`);
                            input.value = '';
                          } else {
                            alert('Please enter a non-zero number');
                          }
                        }}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>

                  {/* Scale Coordinates */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-purple-200">
                    <label className="text-sm font-semibold text-gray-700 mr-2">Scale Coordinates:</label>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('scale_coords:1000')}>
                      ×1000 (m→mm)
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => applyTransformation('scale_coords:0.001')}>
                      ×0.001 (mm→m)
                    </Button>
                    <div className="flex items-center gap-1">
                      <Input
                        id="coords-scale-custom"
                        type="number"
                        step="any"
                        placeholder="Custom factor"
                        className="w-32 h-8 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const input = e.currentTarget as HTMLInputElement;
                            const factor = parseFloat(input.value);
                            if (!isNaN(factor) && factor !== 0) {
                              applyTransformation(`scale_coords:${factor}`);
                              input.value = '';
                            } else {
                              alert('Please enter a non-zero number');
                            }
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const input = document.getElementById('coords-scale-custom') as HTMLInputElement;
                          const factor = parseFloat(input.value);
                          if (!isNaN(factor) && factor !== 0) {
                            applyTransformation(`scale_coords:${factor}`);
                            input.value = '';
                          } else {
                            alert('Please enter a non-zero number');
                          }
                        }}
                      >
                        Apply
                      </Button>
                    </div>
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
                      variant="outline"
                      onClick={clearOperationsList}
                      disabled={appliedTransforms.length === 0}
                      title="Clear the pending operations list without modifying files"
                    >
                      Clear List
                    </Button>
                    <Button
                      size="default"
                      variant="destructive"
                      onClick={clearTransforms}
                      disabled={loading}
                      title="Undo transforms from current frame (restores original data)"
                    >
                      Undo Frame
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

            {/* Merging Panel - Only for calibrated instantaneous with multiple cameras, not stereo */}
            {showMerging && canMerge && cameraOptions.length > 1 && !isMeanVar && !isStereo && (
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
                                  updateMergeCameras([...selectedMergeCameras, cam]);
                                } else {
                                  updateMergeCameras(selectedMergeCameras.filter(c => c !== cam));
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
