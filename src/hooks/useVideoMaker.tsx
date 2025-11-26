import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Types for ffmpeg and data source checking
interface FfmpegStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
  error: string | null;
  loading: boolean;
}

interface DataSourceInfo {
  exists: boolean;
  frame_count: number;
  path: string | null;
}

interface DataSourcesAvailability {
  calibrated: DataSourceInfo;
  uncalibrated: DataSourceInfo;
  merged: DataSourceInfo;
}

export type DataSourceType = 'calibrated' | 'uncalibrated' | 'merged';

export function useVideoMaker(backendUrl: string = '/backend', config?: any) {
  // Directory / base paths - now from config instead of localStorage
  const [directory, setDirectory] = useState<string>('');
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const basePaths = useMemo(() => config?.paths?.base_paths || [], [config]);
  const [basePathIdx, setBasePathIdx] = useState<number>(0);

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

  // FFmpeg status
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus>({
    installed: false,
    version: null,
    path: null,
    error: null,
    loading: true,
  });

  // Data sources availability
  const [dataSources, setDataSources] = useState<DataSourcesAvailability | null>(null);
  const [dataSourcesLoading, setDataSourcesLoading] = useState<boolean>(false);
  const [dataSource, setDataSource] = useState<DataSourceType>('calibrated');

  // Available runs
  const [availableRuns, setAvailableRuns] = useState<number[]>([1]);
  const [highestRun, setHighestRun] = useState<number>(1);
  const [runsLoading, setRunsLoading] = useState<boolean>(false);

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
    { label: '1080p (1920x1080)', value: '1080p' },
    { label: '4K (3840x2160)', value: '4k' }
  ];
  const [fps, setFps] = useState<number>(30);

  // Video browser state
  const [activeTab, setActiveTab] = useState<string>('create');
  const [availableVideos, setAvailableVideos] = useState<string[]>([]);
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

  // Video ready/error state
  const [videoReady, setVideoReady] = useState<boolean>(false);
  const [videoError, setVideoError] = useState<boolean>(false);

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

  // Check ffmpeg on mount
  const checkFfmpeg = useCallback(async () => {
    setFfmpegStatus(prev => ({ ...prev, loading: true }));
    try {
      const response = await fetch(`${backendUrl}/video/check_ffmpeg`);
      const data = await response.json();
      setFfmpegStatus({
        installed: data.installed || false,
        version: data.version || null,
        path: data.path || null,
        error: data.error || null,
        loading: false,
      });
    } catch (error) {
      console.error('Error checking ffmpeg:', error);
      setFfmpegStatus({
        installed: false,
        version: null,
        path: null,
        error: 'Failed to check ffmpeg status',
        loading: false,
      });
    }
  }, [backendUrl]);

  useEffect(() => {
    checkFfmpeg();
  }, [checkFfmpeg]);

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
        // Auto-set to highest run if current run is not available
        if (!data.runs.includes(run)) {
          setRun(data.highest_run || 1);
        }
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

  // Available data source options (only show sources that exist)
  const dataSourceOptions = useMemo(() => {
    if (!dataSources) return [];
    const options: { value: DataSourceType; label: string; frameCount: number }[] = [];
    if (dataSources.calibrated.exists) {
      options.push({
        value: 'calibrated',
        label: `Calibrated (${dataSources.calibrated.frame_count} frames)`,
        frameCount: dataSources.calibrated.frame_count,
      });
    }
    if (dataSources.uncalibrated.exists) {
      options.push({
        value: 'uncalibrated',
        label: `Uncalibrated (${dataSources.uncalibrated.frame_count} frames)`,
        frameCount: dataSources.uncalibrated.frame_count,
      });
    }
    if (dataSources.merged.exists) {
      options.push({
        value: 'merged',
        label: `Merged (${dataSources.merged.frame_count} frames)`,
        frameCount: dataSources.merged.frame_count,
      });
    }
    return options;
  }, [dataSources]);

  // Check if any data is available
  const hasAnyData = useMemo(() => {
    return dataSourceOptions.length > 0;
  }, [dataSourceOptions]);

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
        setSelectedVideo(data.videos[0]);
      } else {
        setAvailableVideos([]);
      }
    } catch (error) {
      console.error('Error fetching videos:', error);
      setAvailableVideos([]);
    } finally {
      setLoadingVideos(false);
    }
  };

  // Build params
  const buildParams = () => {
    const params: any = {
      base_path: effectiveDir,
      camera: camera,
      var: type,
      run: String(run),
      data_source: dataSource,  // New: use dataSource instead of merged flag
      cmap,
      lower,
      upper,
      num_images: config?.images?.num_images || 0,
      resolution,
      fps: String(fps),
    };
    return params;
  };

  // Handle video creation
  const handleCreateVideo = async (isTest: boolean = false) => {
    setCreating(true);
    setVideoResult(null);
    setVideoStatus(null);
    
    try {
      const params = buildParams();
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
                if (activeTab === 'browse') {
                  fetchAvailableVideos();
                }
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

  // Video ready effect - with auto-retry on error
  const videoRetryCount = useRef(0);
  const maxVideoRetries = 5;
  const videoRetryDelay = 1500; // ms between retries

  useEffect(() => {
    if (videoResult?.out_path) {
      setVideoReady(false);
      setVideoError(false);
      videoRetryCount.current = 0;
      // Initial delay before showing video
      const timer = setTimeout(() => setVideoReady(true), 2500);
      return () => clearTimeout(timer);
    }
  }, [videoResult?.out_path]);

  const handleVideoError = useCallback(() => {
    // Auto-retry silently up to maxVideoRetries times
    if (videoRetryCount.current < maxVideoRetries) {
      videoRetryCount.current += 1;
      console.log(`Video load failed, auto-retrying (${videoRetryCount.current}/${maxVideoRetries})...`);
      setVideoReady(false);
      setTimeout(() => setVideoReady(true), videoRetryDelay);
    } else {
      // Only show error after all retries exhausted
      console.error('Video load failed after all retries');
      setVideoError(true);
    }
  }, []);

  const handleRetryVideo = useCallback(() => {
    videoRetryCount.current = 0;
    setVideoError(false);
    setVideoReady(false);
    setTimeout(() => setVideoReady(true), videoRetryDelay);
  }, []);

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
    activeTab,
    setActiveTab,
    availableVideos,
    selectedVideo,
    setSelectedVideo,
    loadingVideos,
    creating,
    videoResult,
    videoStatus,
    videoReady,
    videoError,
    effectiveDir,
    // New: FFmpeg and data source state
    ffmpegStatus,
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
    // Functions
    handleBrowse,
    onDirPicked,
    fetchAvailableVideos,
    handleCreateVideo,
    handleCancelVideo,
    basename,
    createVideoUrl,
    handleVideoError,
    handleRetryVideo,
    checkFfmpeg,
    checkDataSources,
  };
}
