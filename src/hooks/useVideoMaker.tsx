import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Types for data source checking
interface DataSourceInfo {
  exists: boolean;
  frame_count: number;
  path: string | null;
  camera_pair?: number[] | null;
}

interface DataSourcesAvailability {
  calibrated: DataSourceInfo;
  uncalibrated: DataSourceInfo;
  merged: DataSourceInfo;
  stereo: DataSourceInfo;
  inst_stats: DataSourceInfo;
}

export type DataSourceType = 'calibrated' | 'uncalibrated' | 'merged' | 'stereo' | 'inst_stats';

// Types for available variables
export interface VariableInfo {
  name: string;
  label: string;
  group: 'piv' | 'stats';
}

// Grouped variables structure (matching VectorViewer)
export interface GroupedVariables {
  instantaneous: string[];
  instantaneous_stats: string[];
}

// Path info interface for CameraSelector
interface PathInfo {
  source: string;
  base: string;
}

// Batch job status interface
interface BatchJobStatus {
  parent_job_id: string;
  sub_jobs: Array<{
    job_id: string;
    type: string;
    path_idx: number;
    label: string;
  }>;
  overall_progress: number;
  status: string;
  sub_job_statuses?: Array<{
    status: string;
    progress: number;
    label: string;
    out_path?: string;
  }>;
}

// Video constraints interface
export interface VideoConstraints {
  allowed_source_endpoints: string[];
  ensemble_blocked: boolean;
  ensemble_reason: string;
}

export function useVideoMaker(backendUrl: string = '/backend', config?: any) {
  // Directory / base paths - now from config instead of localStorage
  const [directory, setDirectory] = useState<string>('');
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const basePaths = useMemo(() => config?.paths?.base_paths || [], [config]);
  const sourcePaths = useMemo(() => config?.paths?.source_paths || [], [config]);
  const [basePathIdx, setBasePathIdx] = useState<number>(0);

  // Multi-path batch selection
  const [activePaths, setActivePaths] = useState<number[]>(() => {
    const configPaths = config?.video?.active_paths;
    if (Array.isArray(configPaths) && configPaths.length > 0) {
      return configPaths;
    }
    return [0];
  });

  // Build paths array for CameraSelector
  const paths: PathInfo[] = useMemo(() => {
    return basePaths.map((base: string, idx: number) => ({
      base,
      source: sourcePaths[idx] || base,
    }));
  }, [basePaths, sourcePaths]);

  // Multi-camera selection for batch
  const [selectedCameras, setSelectedCameras] = useState<number[]>(() => {
    const configCameras = config?.video?.cameras;
    if (Array.isArray(configCameras) && configCameras.length > 0) {
      return configCameras;
    }
    return config?.paths?.camera_numbers || [1];
  });

  // Include merged data in batch
  const [includeMerged, setIncludeMerged] = useState<boolean>(
    config?.video?.include_merged ?? false
  );

  // Batch mode toggle
  const [batchMode, setBatchMode] = useState<boolean>(false);

  // Batch job status
  const [batchJobStatus, setBatchJobStatus] = useState<BatchJobStatus | null>(null);

  // Video constraints (ensemble blocked)
  const [constraints, setConstraints] = useState<VideoConstraints | null>(null);

  // Fetch constraints on mount
  useEffect(() => {
    const fetchConstraints = async () => {
      try {
        const res = await fetch(`${backendUrl}/video/constraints`);
        if (res.ok) {
          const data = await res.json();
          setConstraints(data);
        }
      } catch (err) {
        console.error("Error fetching video constraints:", err);
      }
    };
    fetchConstraints();
  }, [backendUrl]);

  // Camera options derived from config
  const cameraOptions: string[] = useMemo(() => {
    const cameras = config?.paths?.camera_numbers || [];
    return cameras.map((num: number) => `Cam${num}`);
  }, [config?.paths?.camera_numbers]);

  const [camera, setCamera] = useState<number>(() => cameraOptions.length > 0 ? parseInt(cameraOptions[0].replace('Cam', '')) : 1);
  useEffect(() => {
    if (cameraOptions.length === 0) return;
    if (!cameraOptions.includes(`Cam${camera}`)) setCamera(parseInt(cameraOptions[0].replace('Cam', '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOptions.length, cameraOptions[0]]);

  // Data sources availability
  const [dataSources, setDataSources] = useState<DataSourcesAvailability | null>(null);
  const [dataSourcesLoading, setDataSourcesLoading] = useState<boolean>(false);
  const [dataSource, setDataSource] = useState<DataSourceType>('calibrated');

  // Available runs
  const [availableRuns, setAvailableRuns] = useState<number[]>([1]);
  const [highestRun, setHighestRun] = useState<number>(1);
  const [runsLoading, setRunsLoading] = useState<boolean>(false);

  // Available variables (dynamically fetched)
  const [availableVariables, setAvailableVariables] = useState<VariableInfo[]>([
    { name: 'ux', label: 'Velocity (x)', group: 'piv' },
    { name: 'uy', label: 'Velocity (y)', group: 'piv' },
    { name: 'mag', label: 'Velocity Magnitude', group: 'piv' },
  ]);
  const [groupedVariables, setGroupedVariables] = useState<GroupedVariables>({
    instantaneous: [],
    instantaneous_stats: [],
  });
  const [variablesLoading, setVariablesLoading] = useState<boolean>(false);

  // Other selection state
  const [type, setType] = useState<string>('ux');
  const [cmap, setCmap] = useState<string>('default');
  const [run, setRun] = useState<number>(1);
  const [lower, setLower] = useState<string>('');
  const [upper, setUpper] = useState<string>('');
  const [merged, setMerged] = useState<boolean>(false);

  // Resolution settings
  const [resolution, setResolution] = useState<string>('1080p');
  const resolutionOptions = [
    { label: 'Native (no upscale)', value: 'native' },
    { label: '1080p (1920x1080)', value: '1080p' },
    { label: '4K (3840x2160)', value: '4k' },
  ];
  const [fps, setFps] = useState<number>(30);

  // Quality preset (maps to CRF)
  const [quality, setQuality] = useState<string>('high');
  const qualityOptions = [
    { label: 'Standard (smaller files)', value: 'standard' },
    { label: 'High (recommended)', value: 'high' },
    { label: 'Publication (near-lossless)', value: 'publication' },
  ];
  const qualityToCrf: Record<string, number> = {
    standard: 18,
    high: 15,
    publication: 8,
  };

  // Video browser state
  const [activeTab, setActiveTab] = useState<string>('create');
  const [availableVideos, setAvailableVideos] = useState<string[]>([]);
  const [availableVideosMeta, setAvailableVideosMeta] = useState<Array<{
    path: string;
    filename: string;
    size_mb: number;
    modified: number;
    data_source: string;
  }>>([]);
  const [selectedVideo, setSelectedVideo] = useState<string>('');
  const [loadingVideos, setLoadingVideos] = useState<boolean>(false);

  // Video creation process state
  const [creating, setCreating] = useState<boolean>(false);
  const [videoResult, setVideoResult] = useState<{ success?: boolean; message?: string; out_path?: string } | null>(null);
  const [videoStatus, setVideoStatus] = useState<{ 
    processing: boolean; 
    progress: number; 
    status: string; 
    message?: string;
    out_path?: string;
    computed_limits?: {
      lower: number;
      upper: number;
      actual_min: number;
      actual_max: number;
      percentile_based: boolean;
    };
  } | null>(null);

  // Video ready/error/loading state
  const [videoReady, setVideoReady] = useState<boolean>(false);
  const [videoError, setVideoError] = useState<boolean>(false);
  const [videoLoading, setVideoLoading] = useState<boolean>(false);

  // Effective directory
  const effectiveDir = useMemo(() => {
    if (basePaths.length > 0 && basePathIdx >= 0 && basePathIdx < basePaths.length) {
      return basePaths[basePathIdx];
    }
    return directory;
  }, [basePaths, basePathIdx, directory]);

  // Sync directory with effectiveDir
  useEffect(() => {
    if (effectiveDir) setDirectory(effectiveDir);
  }, [effectiveDir]);

  // Check data sources when camera or effectiveDir changes
  const checkDataSources = useCallback(async () => {
    if (!effectiveDir) return;

    setDataSourcesLoading(true);
    try {
      const response = await fetch(
        `${backendUrl}/video/check_data_sources?base_path=${encodeURIComponent(effectiveDir)}&camera=${camera}`
      );
      const data = await response.json();

      if (data.success && data.available) {
        setDataSources(data.available);

        // Auto-select the default source if current selection is not available
        if (data.default_source && !data.available[dataSource]?.exists) {
          setDataSource(data.default_source as DataSourceType);
        }
      } else {
        setDataSources(null);
      }
    } catch (error) {
      console.error('Error checking data sources:', error);
      setDataSources(null);
    } finally {
      setDataSourcesLoading(false);
    }
  }, [backendUrl, effectiveDir, camera, dataSource]);

  useEffect(() => {
    checkDataSources();
  }, [effectiveDir, camera]);

  // Check available runs when data source changes
  const checkAvailableRuns = useCallback(async () => {
    if (!effectiveDir || !dataSource) return;

    setRunsLoading(true);
    try {
      const response = await fetch(
        `${backendUrl}/video/check_runs?base_path=${encodeURIComponent(effectiveDir)}&camera=${camera}&data_source=${dataSource}&var=${type}`
      );
      const data = await response.json();

      if (data.success && data.runs) {
        setAvailableRuns(data.runs);
        setHighestRun(data.highest_run || 1);
        // Always default to highest run (matches VectorViewer behavior)
        setRun(data.highest_run || 1);
      } else {
        setAvailableRuns([1]);
        setHighestRun(1);
      }
    } catch (error) {
      console.error('Error checking available runs:', error);
      setAvailableRuns([1]);
      setHighestRun(1);
    } finally {
      setRunsLoading(false);
    }
  }, [backendUrl, effectiveDir, camera, dataSource, type, run]);

  useEffect(() => {
    checkAvailableRuns();
  }, [effectiveDir, camera, dataSource]);

  // Check available variables when data source changes
  const checkAvailableVariables = useCallback(async () => {
    if (!effectiveDir) return;

    setVariablesLoading(true);
    try {
      const response = await fetch(
        `${backendUrl}/video/available_variables?base_path=${encodeURIComponent(effectiveDir)}&camera=${camera}&data_source=${dataSource}`
      );
      const data = await response.json();

      if (data.success && data.variables) {
        setAvailableVariables(data.variables);

        // Also set grouped variables if available (new API structure)
        if (data.grouped_variables) {
          setGroupedVariables({
            instantaneous: data.grouped_variables.instantaneous || [],
            instantaneous_stats: data.grouped_variables.instantaneous_stats || [],
          });
        }

        // If current type is not in the available variables, reset to first available
        const varNames = data.variables.map((v: VariableInfo) => v.name);
        if (!varNames.includes(type)) {
          setType(data.variables[0]?.name || 'ux');
        }
      }
    } catch (error) {
      console.error('Error checking available variables:', error);
      // Keep default variables on error
    } finally {
      setVariablesLoading(false);
    }
  }, [backendUrl, effectiveDir, camera, dataSource, type]);

  useEffect(() => {
    checkAvailableVariables();
  }, [effectiveDir, camera, dataSource]);

  // Available data source options (only show sources that exist)
  const dataSourceOptions = useMemo(() => {
    if (!dataSources) return [];
    const options: { value: DataSourceType; label: string; frameCount: number }[] = [];
    if (dataSources.calibrated?.exists) {
      options.push({
        value: 'calibrated',
        label: `Calibrated (${dataSources.calibrated.frame_count} frames)`,
        frameCount: dataSources.calibrated.frame_count,
      });
    }
    if (dataSources.uncalibrated?.exists) {
      options.push({
        value: 'uncalibrated',
        label: `Uncalibrated (${dataSources.uncalibrated.frame_count} frames)`,
        frameCount: dataSources.uncalibrated.frame_count,
      });
    }
    if (dataSources.merged?.exists) {
      options.push({
        value: 'merged',
        label: `Merged (${dataSources.merged.frame_count} frames)`,
        frameCount: dataSources.merged.frame_count,
      });
    }
    if (dataSources.stereo?.exists) {
      options.push({
        value: 'stereo',
        label: `Stereo 3D (${dataSources.stereo.frame_count} frames)`,
        frameCount: dataSources.stereo.frame_count,
      });
    }
    return options;
  }, [dataSources]);

  // Check if any data is available
  const hasAnyData = useMemo(() => {
    return dataSourceOptions.length > 0;
  }, [dataSourceOptions]);

  // Check if current data source is stereo
  const isStereoData = useMemo(() => dataSource === 'stereo', [dataSource]);

  // Directory picker
  const handleBrowse = () => {
    dirInputRef.current?.click();
  };
  const onDirPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const anyFile: any = files[0];
    const rel: string = anyFile.webkitRelativePath || '';
    const root = rel.split('/')[0] || '';
    let folderPath = root;
    if (anyFile.path && rel) {
      folderPath = anyFile.path.replace(/\\/g, '/').split('/' + rel)[0] || root;
    }
    setDirectory(folderPath);
    e.currentTarget.value = '';
  };

  // Fetch available videos
  useEffect(() => {
    if (activeTab === 'browse') {
      fetchAvailableVideos();
    }
  }, [activeTab, effectiveDir]);

  const fetchAvailableVideos = async () => {
    if (!effectiveDir) return;
    
    setLoadingVideos(true);
    setAvailableVideos([]);
    setAvailableVideosMeta([]);
    setSelectedVideo('');

    try {
      console.log(`Fetching videos from: ${effectiveDir}`);
      const response = await fetch(`${backendUrl}/video/list_videos?base_path=${encodeURIComponent(effectiveDir)}`);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      console.log(`Found ${data.videos?.length || 0} videos`);

      if (data.videos?.length) {
        setAvailableVideos(data.videos);
        setAvailableVideosMeta(data.videos_meta || []);
        setSelectedVideo(data.videos[0]);
      } else {
        setAvailableVideos([]);
        setAvailableVideosMeta([]);
      }
    } catch (error) {
      console.error('Error fetching videos:', error);
      setAvailableVideos([]);
      setAvailableVideosMeta([]);
    } finally {
      setLoadingVideos(false);
    }
  };

  // Update video config in config.yaml before creating video
  const updateVideoConfig = async (): Promise<boolean> => {
    const configParams = {
      base_path_idx: basePathIdx,
      camera: camera,
      data_source: dataSource,
      variable: type,
      run: run,
      piv_type: 'instantaneous',
      cmap: cmap,
      lower: lower,
      upper: upper,
      fps: fps,
      resolution: resolution,
      crf: qualityToCrf[quality] ?? 15,
    };

    try {
      const response = await fetch(`${backendUrl}/video/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configParams),
      });

      if (!response.ok) {
        console.error('Failed to update video config');
        return false;
      }

      const result = await response.json();
      console.log('Video config updated:', result.updated);
      return true;
    } catch (error) {
      console.error('Error updating video config:', error);
      return false;
    }
  };

  // Handle video creation
  const handleCreateVideo = async (isTest: boolean = false) => {
    setCreating(true);
    setVideoResult(null);
    setVideoStatus(null);

    try {
      // Step 1: Update config.yaml with current settings
      const configUpdated = await updateVideoConfig();
      if (!configUpdated) {
        throw new Error('Failed to update video configuration');
      }

      // Step 2: Start video (backend reads params from config)
      const params: any = { base_path_idx: basePathIdx };
      if (isTest) {
        params.test_mode = true;
        params.test_frames = 50;
      }
      const url = `${backendUrl}/video/start_video`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to start video creation');
      }
      
      // Polling
      const pollStatus = () => {
        fetch(`${backendUrl}/video/video_status`)
          .then(res => res.json())
          .then(status => {
            setVideoStatus(status);
            if (status.processing) {
              setTimeout(pollStatus, 500);
            } else {
              setCreating(false);
              if (status.error) {
                setVideoResult({
                  success: false,
                  message: status.error
                });
              } else {
                setVideoResult({
                  success: true,
                  message: isTest ? 'Test video created successfully!' : 'Video creation completed!',
                  out_path: status.out_path
                });
                // Always refresh video list so browse tab is up-to-date
                fetchAvailableVideos();
              }
            }
          })
          .catch(err => {
            console.error('Polling error', err);
            setCreating(false);
            setVideoResult({
              success: false,
              message: 'Error polling status.'
            });
          });
      };
      pollStatus();
    } catch (error: any) {
      setVideoResult({
        success: false,
        message: `Error: ${error.message}`
      });
      setCreating(false);
    }
  };

  // Handle cancel
  const handleCancelVideo = async () => {
    try {
      const response = await fetch(`${backendUrl}/video/cancel_video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to cancel video');
      }
      setVideoStatus({ processing: false, progress: 0, status: 'canceled' });
      setVideoResult({
        success: false,
        message: 'Video creation canceled.'
      });
      setCreating(false);
    } catch (error: any) {
      console.error('Cancel error', error);
      setVideoResult({
        success: false,
        message: `Error canceling: ${error.message}`
      });
    }
  };

  // Delete a video file
  const handleDeleteVideo = async (videoPath: string) => {
    try {
      const response = await fetch(`${backendUrl}/video/delete_video`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: videoPath }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete video');
      }
      // Refresh the list
      if (selectedVideo === videoPath) {
        setSelectedVideo('');
      }
      fetchAvailableVideos();
    } catch (error: any) {
      console.error('Delete error:', error);
      alert(`Failed to delete video: ${error.message}`);
    }
  };

  // Handle batch video creation (multi-path + multi-camera)
  const handleCreateBatchVideo = async (isTest: boolean = false) => {
    if (selectedCameras.length === 0 && !includeMerged) {
      alert('Please select at least one camera or enable merged data');
      return;
    }

    if (activePaths.length === 0) {
      alert('Please select at least one path');
      return;
    }

    setCreating(true);
    setVideoResult(null);
    setVideoStatus(null);
    setBatchJobStatus(null);

    try {
      const params: any = {
        active_paths: activePaths,
        cameras: selectedCameras,
        include_merged: includeMerged,
        variable: type,
        run: run,
        data_source: dataSource,
        fps: fps,
        cmap: cmap,
        lower: lower,
        upper: upper,
        resolution: resolution,
      };

      if (isTest) {
        params.test_mode = true;
        params.test_frames = 50;
      }

      const response = await fetch(`${backendUrl}/video/start_batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to start batch video creation');
      }

      const parentJobId = result.parent_job_id;
      console.log(`Batch video creation started! Parent job: ${parentJobId}, ${result.processed_targets} targets`);

      // Poll batch status
      const pollBatchStatus = async () => {
        try {
          const statusRes = await fetch(`${backendUrl}/video/batch_status/${parentJobId}`);
          const statusData = await statusRes.json();

          setBatchJobStatus(statusData);
          setVideoStatus({
            processing: statusData.status === 'running',
            progress: statusData.overall_progress || 0,
            status: statusData.status,
            message: `Processing ${statusData.sub_job_statuses?.filter((s: any) => s.status === 'completed').length || 0}/${statusData.sub_job_statuses?.length || 0} videos`,
          });

          if (statusData.status === 'running' || statusData.status === 'starting') {
            setTimeout(pollBatchStatus, 1000);
          } else {
            setCreating(false);
            if (statusData.status === 'completed') {
              const completedCount = statusData.sub_job_statuses?.filter((s: any) => s.status === 'completed').length || 0;
              setVideoResult({
                success: true,
                message: `Batch complete! ${completedCount} video(s) created.`,
              });
              if (activeTab === 'browse') {
                fetchAvailableVideos();
              }
            } else if (statusData.status === 'failed') {
              setVideoResult({
                success: false,
                message: 'Some videos failed to create. Check sub-job statuses.',
              });
            }
          }
        } catch (err) {
          console.error('Batch polling error:', err);
          setCreating(false);
          setVideoResult({
            success: false,
            message: 'Error polling batch status.',
          });
        }
      };

      pollBatchStatus();
    } catch (error: any) {
      console.error('Batch video error:', error);
      setVideoResult({
        success: false,
        message: `Error: ${error.message}`,
      });
      setCreating(false);
    }
  };

  // Helper functions
  const basename = (p: string) => {
    if (!p) return "";
    const parts = p.replace(/\\/g, "/").split("/");
    return parts.filter(Boolean).pop() || p;
  };

  const createVideoUrl = (path: string) => {
    if (!path) return '';
    try {
      const encodedPath = encodeURIComponent(path);
      return `${backendUrl}/video/download?path=${encodedPath}`;
    } catch (error) {
      console.error('Error creating video URL:', error);
      return '';
    }
  };

  // Video ready state management - simple and stable
  useEffect(() => {
    if (videoResult?.out_path) {
      setVideoLoading(true);
      setVideoReady(true);
      setVideoError(false);
    }
  }, [videoResult?.out_path]);

  // Called when video element fires 'canplay' event
  const handleVideoCanPlay = useCallback(() => {
    setVideoLoading(false);
  }, []);

  // Called on video load error
  const handleVideoError = useCallback(() => {
    setVideoLoading(false);
    setVideoError(true);
  }, []);

  // Manual retry - just reload the video element
  const handleRetryVideo = useCallback(() => {
    setVideoError(false);
    setVideoLoading(true);
    // Force video element to reload by briefly toggling ready state
    setVideoReady(false);
    requestAnimationFrame(() => setVideoReady(true));
  }, []);

  // Camera count for CameraSelector
  const cameraCount = cameraOptions.length;

  return {
    // State
    directory,
    setDirectory,
    dirInputRef,
    basePaths,
    basePathIdx,
    setBasePathIdx,
    cameraOptions,
    camera,
    setCamera,
    type,
    setType,
    cmap,
    setCmap,
    run,
    setRun,
    lower,
    setLower,
    upper,
    setUpper,
    merged,
    setMerged,
    resolution,
    setResolution,
    resolutionOptions,
    fps,
    setFps,
    quality,
    setQuality,
    qualityOptions,
    activeTab,
    setActiveTab,
    availableVideos,
    availableVideosMeta,
    selectedVideo,
    setSelectedVideo,
    loadingVideos,
    creating,
    videoResult,
    videoStatus,
    videoReady,
    videoError,
    videoLoading,
    handleVideoCanPlay,
    effectiveDir,
    // Data source state
    dataSources,
    dataSourcesLoading,
    // Runs state
    availableRuns,
    highestRun,
    runsLoading,
    dataSource,
    setDataSource,
    dataSourceOptions,
    hasAnyData,
    isStereoData,
    // Variables state
    availableVariables,
    groupedVariables,
    variablesLoading,
    // Batch state (new)
    paths,
    activePaths,
    setActivePaths,
    selectedCameras,
    setSelectedCameras,
    includeMerged,
    setIncludeMerged,
    batchMode,
    setBatchMode,
    batchJobStatus,
    cameraCount,
    // Functions
    handleBrowse,
    onDirPicked,
    fetchAvailableVideos,
    handleCreateVideo,
    handleCreateBatchVideo,
    handleCancelVideo,
    handleDeleteVideo,
    basename,
    createVideoUrl,
    handleVideoError,
    handleRetryVideo,
    checkDataSources,
    // Constraints
    constraints,
    isEnsembleBlocked: constraints?.ensemble_blocked ?? true,
    ensembleBlockedReason: constraints?.ensemble_reason ?? "Ensemble has no temporal sequence",
  };
}
