import { useEffect, useMemo, useRef, useState } from 'react';

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
      merged: merged ? '1' : '0',
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

  // Video ready effect
  useEffect(() => {
    if (videoResult?.out_path) {
      setVideoReady(false);
      setVideoError(false);
      const timer = setTimeout(() => setVideoReady(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [videoResult?.out_path]);

  const handleVideoError = () => {
    setVideoError(true);
  };

  const handleRetryVideo = () => {
    setVideoError(false);
    setVideoReady(false);
    setTimeout(() => setVideoReady(true), 1500);
  };

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
  };
}
