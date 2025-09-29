import { useState, useEffect, useRef } from 'react';

export interface PinholeConfig {
  source_path_idx?: number;
  camera?: number;
  image_index?: number;
  file_pattern?: string;
  pattern_cols?: number;
  pattern_rows?: number;
  dot_spacing_mm?: number;
  enhance_dots?: boolean;
  asymmetric?: boolean;
  dt?: number;
}

export interface PinholeCalibrationState {
  sourcePathIdx: number;
  camera: number;
  imageIndex: string;
  filePattern: string;
  patternCols: string;
  patternRows: string;
  dotSpacingMm: string;
  enhanceDots: boolean;
  asymmetric: boolean;
  dt: string;
}

/**
 * Hook for managing pinhole calibration state and operations.
 * @param config The pinhole section from calibration config.
 * @param updateConfig Function to update the calibration config.
 * @param cameraOptions Array of available camera numbers.
 * @param sourcePaths Array of available source paths.
 * @param imageCount Number of images to process.
 */
export function usePinholeCalibration(
  config: PinholeConfig = {},
  updateConfig: (path: string[], value: any) => void,
  cameraOptions: number[],
  sourcePaths: string[],
  imageCount: number = 1000
) {
  // --- State Initialization ---
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(config.source_path_idx ?? 0);
  const [camera, setCamera] = useState<number>(config.camera ?? 1);
  const [imageIndex, setImageIndex] = useState<string>(config.image_index !== undefined ? String(config.image_index) : "0");
  const [filePattern, setFilePattern] = useState<string>(config.file_pattern ?? "calib%05d.tif");
  const [patternCols, setPatternCols] = useState<string>(config.pattern_cols !== undefined ? String(config.pattern_cols) : "10");
  const [patternRows, setPatternRows] = useState<string>(config.pattern_rows !== undefined ? String(config.pattern_rows) : "10");
  const [dotSpacingMm, setDotSpacingMm] = useState<string>(config.dot_spacing_mm !== undefined ? String(config.dot_spacing_mm) : "28.89");
  const [enhanceDots, setEnhanceDots] = useState<boolean>(config.enhance_dots ?? true);
  const [asymmetric, setAsymmetric] = useState<boolean>(config.asymmetric ?? false);
  const [dt, setDt] = useState<string>(config.dt !== undefined ? String(config.dt) : "1.0");

  // --- Display States ---
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [totalImages, setTotalImages] = useState<number>(0);
  const [gridPoints, setGridPoints] = useState<[number, number][]>([]);
  const [showIndices, setShowIndices] = useState<boolean>(true);
  const [dewarpedB64, setDewarpedB64] = useState<string | null>(null);
  const [cameraModel, setCameraModel] = useState<any>(null);
  const [gridData, setGridData] = useState<any>(null);
  const [nativeSize, setNativeSize] = useState<{ w: number; h: number }>({ w: 1024, h: 1024 });
  const [generating, setGenerating] = useState<boolean>(false);
  const [vectorJobId, setVectorJobId] = useState<string | null>(null);
  const [planarJobId, setPlanarJobId] = useState<string | null>(null);
  const [loadingResults, setLoadingResults] = useState<boolean>(false);

  // --- Refs for Debouncing ---
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Sync UI state with config when config changes ---
  useEffect(() => {
    setSourcePathIdx(config.source_path_idx ?? 0);
    setCamera(config.camera ?? 1);
    setImageIndex(config.image_index !== undefined ? String(config.image_index) : "0");
    setFilePattern(config.file_pattern ?? "calib%05d.tif");
    setPatternCols(config.pattern_cols !== undefined ? String(config.pattern_cols) : "10");
    setPatternRows(config.pattern_rows !== undefined ? String(config.pattern_rows) : "10");
    setDotSpacingMm(config.dot_spacing_mm !== undefined ? String(config.dot_spacing_mm) : "28.89");
    setEnhanceDots(config.enhance_dots ?? true);
    setAsymmetric(config.asymmetric ?? false);
    setDt(config.dt !== undefined ? String(config.dt) : "1.0");
  }, [config]);

  // --- Debounced config update ---
  useEffect(() => {
    const valid = Number.isFinite(sourcePathIdx) &&
      imageIndex !== "" && !isNaN(Number(imageIndex)) &&
      patternCols !== "" && !isNaN(Number(patternCols)) &&
      patternRows !== "" && !isNaN(Number(patternRows)) &&
      dotSpacingMm !== "" && !isNaN(Number(dotSpacingMm)) &&
      dt !== "" && !isNaN(Number(dt));

    if (valid && debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const newConfig = {
        source_path_idx: sourcePathIdx,
        camera,
        image_index: Number(imageIndex),
        file_pattern: filePattern,
        pattern_cols: Number(patternCols),
        pattern_rows: Number(patternRows),
        dot_spacing_mm: Number(dotSpacingMm),
        enhance_dots: enhanceDots,
        asymmetric: asymmetric,
        dt: Number(dt),
      };
      updateConfig(["calibration", "pinhole"], newConfig);
    }, 500);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [sourcePathIdx, camera, imageIndex, filePattern, patternCols, patternRows, dotSpacingMm, enhanceDots, asymmetric, dt, updateConfig]);

  // --- Ensure valid camera selection when cameraOptions change ---
  useEffect(() => {
    if (cameraOptions.length > 0 && !cameraOptions.includes(camera)) {
      setCamera(cameraOptions[0]);
    }
  }, [cameraOptions, camera]);

  // --- Status hooks ---
  const useCalibrationStatus = (sourcePathIdx: number, camera: number) => {
    const [status, setStatus] = useState<string>("not_started");
    const [details, setDetails] = useState<any>(null);

    useEffect(() => {
      let active = true;
      const fetchStatus = async () => {
        try {
          const res = await fetch(`/backend/calibration/status?source_path_idx=${sourcePathIdx}&camera=${camera}`);
          const data = await res.json();
          if (active) {
            setStatus(data.status || "not_started");
            setDetails(data);
          }
        } catch {
          if (active) setStatus("not_started");
        }
      };
      fetchStatus();
      const interval = setInterval(fetchStatus, 2000);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [sourcePathIdx, camera]);
    return { status, details };
  };

  const useVectorCalibrationStatus = (jobId: string | null) => {
    const [status, setStatus] = useState<string>("not_started");
    const [details, setDetails] = useState<any>(null);

    useEffect(() => {
      if (!jobId) return;
      let active = true;
      const fetchStatus = async () => {
        try {
          const res = await fetch(`/backend/calibration/vectors/status/${jobId}`);
          const data = await res.json();
          if (active) {
            setStatus(data.status || "not_started");
            setDetails(data);
          }
        } catch {
          if (active) setStatus("not_started");
        }
      };
      fetchStatus();
      const interval = setInterval(fetchStatus, 2000);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [jobId]);
    return { status, details };
  };

  // --- Get status ---
  const { status: calibrationStatus, details: calibrationDetails } = useCalibrationStatus(sourcePathIdx, camera);
  const { status: vectorStatus, details: vectorDetails } = useVectorCalibrationStatus(vectorJobId);

  // --- Helper function to load results for current image ---
  const loadResultsForCurrentImage = async () => {
    setLoadingResults(true);
    try {
      console.log(`Loading calibration results for image index ${imageIndex}...`);
      const compResponse = await fetch('/backend/calibration/planar/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: camera,
          image_index: imageIndex,
          file_pattern: filePattern,
          pattern_cols: patternCols,
          pattern_rows: patternRows,
          dot_spacing_mm: dotSpacingMm,
          enhance_dots: enhanceDots,
          asymmetric: asymmetric,
          dt: dt
        })
      });

      const compData = await compResponse.json();

      if (compResponse.ok) {
        console.log('Raw response data:', compData);
        if (compData.results?.grid_data) {
          console.log('Setting grid data:', compData.results.grid_data);
          setGridData(compData.results.grid_data);
          setGridPoints(compData.results.grid_data.grid_points || []);

          // Check if grid PNG is available
          if (compData.results.grid_data.grid_png) {
            console.log('Grid PNG found in response');
          } else {
            console.log('No grid PNG in response');
          }
        }
        if (compData.results?.camera_model) {
          console.log('Setting camera model:', compData.results.camera_model);
          setCameraModel(compData.results.camera_model);
        }
        if (compData.results?.dewarped_image) {
          setDewarpedB64(compData.results.dewarped_image);
        }
        console.log('Calibration results loaded successfully');
      } else {
        console.error('Error in response:', compData);
      }
    } catch (e: any) {
      console.error(`Error loading results: ${e.message}`);
    } finally {
      setLoadingResults(false);
    }
  };

  // --- Generate camera model ---
  const generateCameraModel = async () => {
    setGenerating(true);
    setLoadingResults(true); // Show spinner immediately
    try {
      // First load and process the current image to show results
      const imageResponse = await fetch(`/backend/calibration/planar/get_image?source_path_idx=${sourcePathIdx}&camera=${camera}&image_index=${imageIndex}&file_pattern=${encodeURIComponent(filePattern)}`);
      if (imageResponse.status === 404) {
        alert('Calibration image not found. (File or folder does not exist)');
        setGenerating(false);
        return;
      }
      const imageData = await imageResponse.json();
      if (imageResponse.ok) {
        setImageB64(imageData.image);
        setNativeSize({ w: imageData.width, h: imageData.height });
        setTotalImages(imageData.total_images);
        // Start batch processing
        const response = await fetch('/backend/calibration/planar/calibrate_all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_path_idx: sourcePathIdx,
            camera: camera,
            file_pattern: filePattern,
            pattern_cols: patternCols,
            pattern_rows: patternRows,
            dot_spacing_mm: dotSpacingMm,
            enhance_dots: enhanceDots,
            asymmetric: asymmetric,
            dt: dt
          })
        });
        const result = await response.json();
        if (response.ok && result.job_id) {
          setPlanarJobId(result.job_id);
          // Poll job status until completed, then load results
          const pollForCompletion = () => {
            const interval = setInterval(async () => {
              try {
                const statusResponse = await fetch(`/backend/calibration/planar/calibrate_all/status/${result.job_id}`);
                const statusData = await statusResponse.json();
                if (statusData.status === 'completed') {
                  clearInterval(interval);
                  setTimeout(() => {
                    loadResultsForCurrentImage();
                  }, 1000);
                } else if (statusData.status === 'failed' || statusData.status === 'error') {
                  clearInterval(interval);
                  console.error('Calibration failed:', statusData.error);
                }
              } catch (e) {
                console.log('Error polling planar calibration job:', e);
              }
            }, 2000);
          };
          pollForCompletion();
        } else {
          throw new Error(result.error || 'Failed to start camera model generation');
        }
      } else {
        throw new Error(imageData.error || 'Failed to load image');
      }
    } catch (e: any) {
      console.error(`Error starting camera model generation: ${e.message}`);
    } finally {
      setGenerating(false);
      // Do not setLoadingResults(false) here; let loadResultsForCurrentImage handle it
    }
  };

  // --- Calibrate vectors ---
  const calibrateVectors = async () => {
    try {
      const response = await fetch('/backend/calibration/vectors/calibrate_all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path_idx: sourcePathIdx,
          camera: camera,
          model_index: imageIndex,
          dt: dt,
          image_count: imageCount,
          vector_pattern: "%05d.mat",
          type_name: "instantaneous"
        })
      });

      const result = await response.json();

      if (response.ok) {
        console.log(`Vector calibration started using model ${result.model_used}!`);
        setVectorJobId(result.job_id);
      } else {
        throw new Error(result.error || 'Failed to start vector calibration');
      }
    } catch (e: any) {
      console.error(`Error starting vector calibration: ${e.message}`);
    }
  };

  return {
    // State
    sourcePathIdx,
    camera,
    imageIndex,
    filePattern,
    patternCols,
    patternRows,
    dotSpacingMm,
    enhanceDots,
    asymmetric,
    dt,
    imageB64,
    totalImages,
    gridPoints,
    showIndices,
    dewarpedB64,
    cameraModel,
    gridData,
    nativeSize,
    generating,
    vectorJobId,
    planarJobId,
    loadingResults,

    // Setters
    setSourcePathIdx,
    setCamera,
    setImageIndex,
    setFilePattern,
    setPatternCols,
    setPatternRows,
    setDotSpacingMm,
    setEnhanceDots,
    setAsymmetric,
    setDt,
    setImageB64,
    setTotalImages,
    setGridPoints,
    setShowIndices,
    setDewarpedB64,
    setCameraModel,
    setGridData,
    setNativeSize,
    setGenerating,
    setVectorJobId,
    setPlanarJobId,
    setLoadingResults,

    // Computed
    calibrationStatus,
    calibrationDetails,
    vectorStatus,
    vectorDetails,
    cameraOptions,
    sourcePaths,

    // Actions
    generateCameraModel,
    calibrateVectors,
    loadResultsForCurrentImage,
  };
}