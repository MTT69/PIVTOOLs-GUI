import { useRef, useState, useEffect, useCallback, useMemo } from "react";

interface UseVectorViewerProps {
  backendUrl: string;
  config?: any;
}

interface HoverData {
  x: number;
  y: number;
  ux: number | null;
  uy: number | null;
  value: number | null;
  i: number;
  j: number;
  clientX: number;
  clientY: number;
}

interface CornerCoordinates {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
}

// Data source types
export type DataSourceType =
  | "calibrated_instantaneous"
  | "uncalibrated_instantaneous"
  | "calibrated_ensemble"
  | "uncalibrated_ensemble"
  | "merged_instantaneous"
  | "merged_ensemble"
  | "stereo_instantaneous"
  | "stereo_ensemble"
  | "statistics"
  | "merged_statistics"
  | "stereo_statistics";

interface DataSourceAvailability {
  exists: boolean;
  frame_count: number;
  variables: string[];
  camera_pair?: number[] | null;
}

export interface AvailableDataSources {
  uncalibrated_instantaneous: DataSourceAvailability;
  calibrated_instantaneous: DataSourceAvailability;
  uncalibrated_ensemble: DataSourceAvailability;
  calibrated_ensemble: DataSourceAvailability;
  merged_instantaneous: DataSourceAvailability;
  merged_ensemble: DataSourceAvailability;
  stereo_instantaneous: DataSourceAvailability;
  stereo_ensemble: DataSourceAvailability;
  statistics: DataSourceAvailability;
  merged_statistics: DataSourceAvailability;
  stereo_statistics: DataSourceAvailability;
}

// Grouped variables interface
export interface GroupedVariables {
  instantaneous: string[];      // From frame .mat files
  instantaneous_stats: string[]; // From instantaneous_stats folder
  mean_stats: string[];         // From mean_stats.mat
  ensemble: string[];           // From ensemble_result.mat
}

const defaultGroupedVars: GroupedVariables = {
  instantaneous: [],
  instantaneous_stats: [],
  mean_stats: [],
  ensemble: [],
};

// Default empty availability
const defaultAvailability: AvailableDataSources = {
  uncalibrated_instantaneous: { exists: false, frame_count: 0, variables: [] },
  calibrated_instantaneous: { exists: false, frame_count: 0, variables: [] },
  uncalibrated_ensemble: { exists: false, frame_count: 1, variables: [] },
  calibrated_ensemble: { exists: false, frame_count: 1, variables: [] },
  merged_instantaneous: { exists: false, frame_count: 0, variables: [] },
  merged_ensemble: { exists: false, frame_count: 1, variables: [] },
  stereo_instantaneous: { exists: false, frame_count: 0, variables: [], camera_pair: null },
  stereo_ensemble: { exists: false, frame_count: 1, variables: [], camera_pair: null },
  statistics: { exists: false, frame_count: 0, variables: [] },
  merged_statistics: { exists: false, frame_count: 0, variables: [] },
  stereo_statistics: { exists: false, frame_count: 0, variables: [], camera_pair: null },
};

export const useVectorViewer = ({ backendUrl, config }: UseVectorViewerProps) => {
  // State variables
  const [basePaths, setBasePaths] = useState<string[]>(() => config?.paths?.base_paths || []);
  const [basePathIdx, setBasePathIdx] = useState<number>(0);
  const [index, setIndex] = useState<number>(1);
  const [type, setType] = useState<string>("inst:ux");
  const [run, setRun] = useState<number>(1);
  const [lower, setLower] = useState<string>("");
  const [upper, setUpper] = useState<string>("");
  const [cmap, setCmap] = useState<string>("default");
  // New: axis limits and custom title
  const [xlimMin, setXlimMin] = useState<string>("");
  const [xlimMax, setXlimMax] = useState<string>("");
  const [ylimMin, setYlimMin] = useState<string>("");
  const [ylimMax, setYlimMax] = useState<string>("");
  const [plotTitle, setPlotTitle] = useState<string>("");
  // Refs to access latest values without triggering re-renders
  const xlimMinRef = useRef(xlimMin);
  const xlimMaxRef = useRef(xlimMax);
  const ylimMinRef = useRef(ylimMin);
  const ylimMaxRef = useRef(ylimMax);
  const plotTitleRef = useRef(plotTitle);
  // Keep refs in sync with state
  xlimMinRef.current = xlimMin;
  xlimMaxRef.current = xlimMax;
  ylimMinRef.current = ylimMin;
  ylimMaxRef.current = ylimMax;
  plotTitleRef.current = plotTitle;
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ run: number; var: string; width?: number; height?: number; axes_bbox?: { left: number; top: number; width: number; height: number; png_width: number; png_height: number; xlim?: [number, number]; ylim?: [number, number] } } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRendered, setHasRendered] = useState<boolean>(false);
  const cameraOptions: number[] = useMemo(() => {
    return config?.paths?.camera_numbers || [];
  }, [config]);
  const [camera, setCamera] = useState<number>(() => cameraOptions.length > 0 ? cameraOptions[0] : 1);
  useEffect(() => {
    if (cameraOptions.length === 0) return;
    if (!cameraOptions.includes(camera)) setCamera(cameraOptions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOptions.length, cameraOptions[0]]);

  // New unified data source state
  const [dataSource, setDataSource] = useState<DataSourceType>("calibrated_instantaneous");
  const [availableDataSources, setAvailableDataSources] = useState<AvailableDataSources>(defaultAvailability);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  // File-based stereo detection: true if stereo_calibrated folder has data
  const [hasStereoData, setHasStereoData] = useState(false);

  // Derived state from dataSource
  const isUncalibrated = useMemo(() =>
    dataSource === "uncalibrated_instantaneous" || dataSource === "uncalibrated_ensemble",
    [dataSource]
  );
  const isEnsemble = useMemo(() =>
    dataSource === "calibrated_ensemble" || dataSource === "uncalibrated_ensemble" || dataSource === "merged_ensemble",
    [dataSource]
  );
  const isMerged = useMemo(() =>
    dataSource === "merged_instantaneous" || dataSource === "merged_ensemble" || dataSource === "merged_statistics",
    [dataSource]
  );
  const isStatistics = useMemo(() =>
    dataSource === "statistics" || dataSource === "merged_statistics" || dataSource === "stereo_statistics",
    [dataSource]
  );
  const isStereoData = useMemo(() =>
    dataSource === "stereo_instantaneous" || dataSource === "stereo_ensemble" || dataSource === "stereo_statistics",
    [dataSource]
  );

  // Stereo detection: check if active calibration method is stereo
  const isStereo = useMemo(() => {
    const activeCalib = config?.calibration?.active;
    return activeCalib === "stereo_dotboard" || activeCalib === "stereo_charuco";
  }, [config?.calibration?.active]);

  // Feature availability based on data source
  const canTransform = useMemo(() => !isUncalibrated, [isUncalibrated]);
  const canEditCoordinates = useMemo(() => !isUncalibrated, [isUncalibrated]);
  // Merging is NOT allowed for stereo (already 3D combined data)
  const canMerge = useMemo(() => !isUncalibrated && !isEnsemble && !isStereoData && !isStereo, [isUncalibrated, isEnsemble, isStereoData, isStereo]);
  const canViewMerged = useMemo(() => !isUncalibrated && !isStereoData && !isStereo, [isUncalibrated, isStereoData, isStereo]);
  const canCalculateStatistics = useMemo(() => !isUncalibrated && !isEnsemble && !isStatistics, [isUncalibrated, isEnsemble, isStatistics]);
  const canViewStatistics = useMemo(() => !isUncalibrated && !isEnsemble, [isUncalibrated, isEnsemble]);
  // For unified dropdown: check if current variable is from mean_stats
  const isMeanVar = useMemo(() => type.startsWith('mean:'), [type]);
  // hasFrameNavigation: hide frame controls for ensemble, statistics, AND mean variables
  const hasFrameNavigation = useMemo(() => !isEnsemble && !isStatistics && !isMeanVar, [isEnsemble, isStatistics, isMeanVar]);

  // Track previous dataSource to detect actual data source changes (vs just type changes)
  const prevDataSourceRef = useRef<DataSourceType>(dataSource);

  // Legacy compatibility - derived from dataSource
  const merged = isMerged;
  const setMerged = useCallback((val: boolean) => {
    if (val) {
      setDataSource("merged_instantaneous");
    } else {
      setDataSource("calibrated_instantaneous");
    }
  }, []);

  const setIsUncalibrated = useCallback((val: boolean) => {
    if (val) {
      setDataSource("uncalibrated_instantaneous");
    } else {
      setDataSource("calibrated_instantaneous");
    }
  }, []);

  const [playing, setPlaying] = useState(false);
  const [pendingIndex, setPendingIndex] = useState<number>(index);
  const [pointerDown, setPointerDown] = useState<boolean>(false);
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [meanMode, setMeanMode] = useState<boolean>(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statVars, setStatVars] = useState<string[] | null>(null);
  const [statVarsLoading, setStatVarsLoading] = useState(false);
  const [statVarsError, setStatVarsError] = useState<string | null>(null);
  const [frameVars, setFrameVars] = useState<string[] | null>(null);
  const [frameVarsLoading, setFrameVarsLoading] = useState(false);
  const [frameVarsError, setFrameVarsError] = useState<string | null>(null);
  // Grouped variables for unified dropdown
  const [allVars, setAllVars] = useState<GroupedVariables>(defaultGroupedVars);
  const [allVarsLoading, setAllVarsLoading] = useState(false);
  const [datumMode, setDatumMode] = useState<boolean>(false);
  const [xOffset, setXOffset] = useState<string>("0");
  const [yOffset, setYOffset] = useState<string>("0");
  const [cornerCoordinates, setCornerCoordinates] = useState<CornerCoordinates | null>(null);
  const [showCorners, setShowCorners] = useState<boolean>(false);
  const effectiveDir = useMemo(() => {
    if (basePaths.length > 0 && basePathIdx >= 0 && basePathIdx < basePaths.length) {
      return basePaths[basePathIdx];
    }
    return "";
  }, [basePaths, basePathIdx]);
  const matFile = useMemo(() => `${effectiveDir}/${String(index).padStart(5, "0")}.mat`, [effectiveDir, index]);
  const coordsFile = useMemo(() => `${effectiveDir}/coordinates.mat`, [effectiveDir]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [hoverData, setHoverData] = useState<HoverData | null>(null);
  const hoverDebounceRef = useRef<number | null>(null);
  const lastQueryRef = useRef<{ px: number; py: number; frame: number; varName: string; mean: boolean } | null>(null);
  const pendingFetchRef = useRef<boolean>(false);
  const magnifierRef = useRef<HTMLCanvasElement | null>(null);
  const [magVisible, setMagVisible] = useState(false);
  const [magPos, setMagPos] = useState({ left: 0, top: 0 });
  const MAG_SIZE = 180;
  const MAG_FACTOR = 2.5;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const [maxFrameCount, setMaxFrameCount] = useState<number>(9999);
  const [appliedTransforms, setAppliedTransforms] = useState<string[]>([]);

  // Prefetch buffer for smooth playback
  const prefetchBufferRef = useRef<Map<string, { image: string; meta: any }>>(new Map());
  const prefetchInProgressRef = useRef<Set<string>>(new Set());

  // Helper to parse type value into source and variable name
  // Format: "source:varname" or just "varname" (defaults to "inst")
  const parseVarType = useCallback((typeVal: string): { varSource: string; varName: string } => {
    if (typeVal.includes(':')) {
      const [src, ...rest] = typeVal.split(':');
      return { varSource: src, varName: rest.join(':') };
    }
    return { varSource: 'inst', varName: typeVal };
  }, []);

  // Helper to derive type_name from dataSource
  const getTypeNameFromDataSource = useCallback((ds: DataSourceType): string => {
    if (ds.includes('ensemble')) {
      return 'ensemble';
    }
    return 'instantaneous';
  }, []);

  // Auto-select appropriate variable when data source changes
  // IMPORTANT: Only auto-correct type when dataSource actually changes, NOT when user manually selects a variable
  useEffect(() => {
    // Check if dataSource actually changed
    const dataSourceChanged = prevDataSourceRef.current !== dataSource;
    prevDataSourceRef.current = dataSource;

    // Only run auto-correction logic if the data source actually changed
    // This prevents overwriting user's manual variable selection
    if (!dataSourceChanged) {
      return;
    }

    const isEnsembleSource = dataSource.includes('ensemble');
    const isStatisticsSource = dataSource.includes('statistics');
    const isUncalibratedSource = dataSource.includes('uncalibrated');

    // Parse current variable
    const { varSource, varName } = parseVarType(type);

    if (isEnsembleSource) {
      // Switching TO ensemble - need ensemble variable
      if (varSource !== 'ens') {
        // Try to find equivalent in ensemble vars, or default to first, or fallback to ens:ux
        if (allVars.ensemble.includes(varName)) {
          setType(`ens:${varName}`);
        } else if (allVars.ensemble.length > 0) {
          setType(`ens:${allVars.ensemble[0]}`);
        } else {
          // Fallback to ens:ux if ensemble vars haven't loaded yet
          setType('ens:ux');
        }
      }
      // Note: fetchAvailableRuns effect will handle setting the correct run value
    } else if (isStatisticsSource) {
      // Switching TO statistics - need mean variable
      if (varSource !== 'mean') {
        if (allVars.mean_stats.includes(varName)) {
          setType(`mean:${varName}`);
        } else if (allVars.mean_stats.length > 0) {
          setType(`mean:${allVars.mean_stats[0]}`);
        }
      }
    } else {
      // Switching TO instantaneous (calibrated or uncalibrated)

      // Handle inst_stat variables - not available for uncalibrated data
      if (varSource === 'inst_stat') {
        const hasInstStats = !isUncalibratedSource && allVars.instantaneous_stats.length > 0;
        if (!hasInstStats) {
          // Fall back to basic instantaneous variable
          if (allVars.instantaneous.includes('ux')) {
            setType('inst:ux');
          } else if (allVars.instantaneous.length > 0) {
            setType(`inst:${allVars.instantaneous[0]}`);
          }
        }
      } else if (varSource === 'ens') {
        // Coming from ensemble - switch to instantaneous equivalent
        // Note: Don't auto-correct 'mean' vars when on instantaneous source
        // because mean stats are intentionally shown in the dropdown for instantaneous mode
        if (allVars.instantaneous.includes(varName)) {
          setType(`inst:${varName}`);
        } else if (allVars.instantaneous.length > 0) {
          setType(`inst:${allVars.instantaneous[0]}`);
        } else {
          // Fallback to default if no instantaneous variables available
          setType('inst:ux');
        }
      }
    }
  }, [dataSource, allVars, parseVarType, type]);

  // Sync type_name and source_endpoint to config.yaml when dataSource changes
  // This ensures merging, transforms, and statistics use the correct data type and source
  useEffect(() => {
    const typeName = getTypeNameFromDataSource(dataSource);
    // Determine source_endpoint based on whether merged is selected
    const sourceEndpoint = isStereoData ? "stereo" : (isMerged ? "merged" : "regular");

    const syncTypeNames = async () => {
      try {
        await fetch(`${backendUrl}/update_config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merging: { type_name: typeName },
            transforms: { type_name: typeName, source_endpoint: sourceEndpoint },
            statistics: { type_name: typeName, source_endpoint: sourceEndpoint },
            video: { piv_type: typeName, source_endpoint: sourceEndpoint },
          }),
        });
      } catch (err) {
        console.error('Failed to sync type_name to config:', err);
      }
    };

    syncTypeNames();
  }, [dataSource, backendUrl, getTypeNameFromDataSource, isMerged, isStereoData]);

  // Clear pending transforms, axis limits, AND meta when data source changes
  // This ensures matplotlib auto-scales to the full data extent for each data source
  // (prevents stereo data appearing zoomed in due to stale axis limits or meta from previous data source)
  useEffect(() => {
    setAppliedTransforms([]);
    // Clear axis limits to allow matplotlib auto-scaling for new data source
    setXlimMin("");
    setXlimMax("");
    setYlimMin("");
    setYlimMax("");
    // Also clear refs IMMEDIATELY to avoid race condition with auto-fetch effect
    // (refs are normally synced during render, but effects run after render)
    xlimMinRef.current = "";
    xlimMaxRef.current = "";
    ylimMinRef.current = "";
    ylimMaxRef.current = "";
    // Clear meta to prevent stale axes_bbox.xlim/ylim being used for hover coordinate mapping
    setMeta(null);
  }, [dataSource]);

  // Functions
  const fetchImage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");

      // Parse the type to get source and variable name
      const { varSource, varName } = parseVarType(type);

      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", String(index));
      params.set("var", varName);
      params.set("var_source", varSource);
      params.set("cmap", cmap);
      if (run && run > 0) params.set("run", String(run));
      if (lower.trim() !== "") params.set("lower_limit", String(Number(lower)));
      if (upper.trim() !== "") params.set("upper_limit", String(Number(upper)));
      params.set("camera", String(camera));
      params.set("merged", merged ? "1" : "0");
      params.set("is_uncalibrated", isUncalibrated ? "1" : "0");
      // Add stereo params when viewing stereo data
      if (isStereoData) {
        params.set("is_stereo", "1");
        const cameraPair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
        params.set("camera_pair", cameraPair.join(","));
      }
      if (xOffset.trim() !== "") params.set("x_offset", xOffset);
      if (yOffset.trim() !== "") params.set("y_offset", yOffset);
      // Axis limits - only send if both min and max are provided (use refs for latest values)
      if (xlimMinRef.current.trim() !== "" && xlimMaxRef.current.trim() !== "") {
        params.set("xlim_min", String(Number(xlimMinRef.current)));
        params.set("xlim_max", String(Number(xlimMaxRef.current)));
      }
      if (ylimMinRef.current.trim() !== "" && ylimMaxRef.current.trim() !== "") {
        params.set("ylim_min", String(Number(ylimMinRef.current)));
        params.set("ylim_max", String(Number(ylimMaxRef.current)));
      }
      // Custom title (use ref for latest value)
      if (plotTitleRef.current.trim() !== "") params.set("title", plotTitleRef.current);

      const url = `${backendUrl}/plot/plot_vector?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to fetch vector plot");
      setImageSrc(json.image ?? null);
      setMeta(json.meta ?? null);
      // Only update run if it's actually different to avoid re-render loops
      if (json.meta && json.meta.run != null) {
        const parsed = Number(json.meta.run);
        if (Number.isFinite(parsed) && parsed > 0 && parsed !== run) {
          setRun(parsed);
        }
      }
      // Don't override type from meta when using prefixed types
      return true;
    } catch (e: any) {
      setError(e.message || "Unknown error");
      return false;
    } finally {
      setLoading(false);
    }
  }, [effectiveDir, index, type, run, lower, upper, cmap, backendUrl, camera, merged, isUncalibrated, xOffset, yOffset, parseVarType, isStereoData, availableDataSources]);

  // Prefetch a single frame for smooth playback
  const prefetchFrame = useCallback(async (frameIdx: number) => {
    const cacheKey = `${effectiveDir}-${camera}-${frameIdx}-${type}-${run}`;

    // Skip if already in buffer or being fetched
    if (prefetchBufferRef.current.has(cacheKey) || prefetchInProgressRef.current.has(cacheKey)) {
      return;
    }

    prefetchInProgressRef.current.add(cacheKey);

    try {
      const basePath = effectiveDir;
      if (!basePath) return;

      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", String(frameIdx));
      params.set("var", type);
      params.set("cmap", cmap);
      if (run && run > 0) params.set("run", String(run));
      if (lower.trim() !== "") params.set("lower_limit", String(Number(lower)));
      if (upper.trim() !== "") params.set("upper_limit", String(Number(upper)));
      params.set("camera", String(camera));
      params.set("merged", merged ? "1" : "0");
      params.set("is_uncalibrated", isUncalibrated ? "1" : "0");
      // Add stereo params when viewing stereo data
      if (isStereoData) {
        params.set("is_stereo", "1");
        const cameraPair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
        params.set("camera_pair", cameraPair.join(","));
      }
      if (xOffset.trim() !== "") params.set("x_offset", xOffset);
      if (yOffset.trim() !== "") params.set("y_offset", yOffset);
      // Axis limits - only send if both min and max are provided (use refs for latest values)
      if (xlimMinRef.current.trim() !== "" && xlimMaxRef.current.trim() !== "") {
        params.set("xlim_min", String(Number(xlimMinRef.current)));
        params.set("xlim_max", String(Number(xlimMaxRef.current)));
      }
      if (ylimMinRef.current.trim() !== "" && ylimMaxRef.current.trim() !== "") {
        params.set("ylim_min", String(Number(ylimMinRef.current)));
        params.set("ylim_max", String(Number(ylimMaxRef.current)));
      }
      // Custom title (use ref for latest value)
      if (plotTitleRef.current.trim() !== "") params.set("title", plotTitleRef.current);

      const url = `${backendUrl}/plot/plot_vector?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();

      if (res.ok && json.image) {
        prefetchBufferRef.current.set(cacheKey, {
          image: json.image,
          meta: json.meta
        });

        // Limit buffer size
        if (prefetchBufferRef.current.size > 15) {
          const keys = Array.from(prefetchBufferRef.current.keys());
          for (let i = 0; i < keys.length - 10; i++) {
            prefetchBufferRef.current.delete(keys[i]);
          }
        }
      }
    } catch (e) {
      // Silent fail for prefetch
    } finally {
      prefetchInProgressRef.current.delete(cacheKey);
    }
  }, [effectiveDir, type, run, lower, upper, cmap, backendUrl, camera, merged, isUncalibrated, xOffset, yOffset, isStereoData, availableDataSources]);

  // Prefetch surrounding frames for smooth playback
  const prefetchSurrounding = useCallback((currentIdx: number, count: number = 5) => {
    for (let i = 1; i <= count; i++) {
      prefetchFrame(currentIdx + i);
    }
    for (let i = 1; i <= 2; i++) {
      if (currentIdx - i > 0) {
        prefetchFrame(currentIdx - i);
      }
    }
  }, [prefetchFrame]);

  // Track last fetched path/camera to avoid redundant fetches
  const lastFetchedAvailabilityRef = useRef<string | null>(null);

  // Fetch available data sources for the current base path and camera
  // Only fetches once per base path + camera combination
  const fetchAvailableDataSources = useCallback(async (force: boolean = false) => {
    const fetchKey = `${effectiveDir}|${camera}`;

    // Skip if we already fetched for this path/camera (unless forced)
    if (!force && lastFetchedAvailabilityRef.current === fetchKey) {
      console.log("fetchAvailableDataSources: skipping (already fetched for", fetchKey, ")");
      return;
    }

    console.log("fetchAvailableDataSources: fetching for", fetchKey);
    setAvailabilityLoading(true);
    try {
      const basePath = effectiveDir;
      if (!basePath) return;

      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("camera", String(camera));

      const url = `${backendUrl}/plot/check_available_data?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();

      if (res.ok && json.available) {
        // Mark as fetched for this path/camera
        lastFetchedAvailabilityRef.current = fetchKey;

        console.log("fetchAvailableDataSources: received", json.available);
        setAvailableDataSources(json.available);

        // Track file-based stereo data detection
        if (json.has_stereo_data !== undefined) {
          setHasStereoData(json.has_stereo_data);
        }

        // Auto-select first available data source if current is not available
        // Use functional update to get current dataSource value
        setDataSource(currentDataSource => {
          const current = json.available[currentDataSource as keyof AvailableDataSources];
          console.log(`fetchAvailableDataSources: current=${currentDataSource}, exists=${current?.exists}`);
          if (!current?.exists) {
            // Priority order for auto-selection - prefer stereo (for stereo setups), then calibrated over uncalibrated
            const priorityOrder: DataSourceType[] = [
              "stereo_instantaneous",
              "stereo_ensemble",
              "calibrated_instantaneous",
              "calibrated_ensemble",
              "uncalibrated_instantaneous",
              "uncalibrated_ensemble",
              "merged_instantaneous",
              "merged_ensemble",
              "statistics",
              "stereo_statistics",
            ];
            for (const source of priorityOrder) {
              if (json.available[source]?.exists) {
                console.log(`fetchAvailableDataSources: auto-selecting ${source}`);
                return source;
              }
            }
          }
          return currentDataSource;
        });
      }
    } catch (e) {
      console.error("Error fetching available data sources:", e);
    } finally {
      setAvailabilityLoading(false);
    }
  }, [effectiveDir, camera, backendUrl]);

  // Fetch ensemble data
  const fetchEnsembleImage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");

      // Parse the type to get source and variable name (consistent with fetchImage)
      const { varSource, varName } = parseVarType(type);

      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("var", varName);  // Send only the raw var name
      params.set("var_source", varSource);
      params.set("cmap", cmap);
      if (run && run > 0) params.set("run", String(run));
      if (lower.trim() !== "") params.set("lower_limit", String(Number(lower)));
      if (upper.trim() !== "") params.set("upper_limit", String(Number(upper)));
      params.set("camera", String(camera));
      params.set("merged", isMerged ? "1" : "0");
      params.set("is_uncalibrated", isUncalibrated ? "1" : "0");
      // Add stereo params when viewing stereo ensemble data
      if (isStereoData) {
        params.set("is_stereo", "1");
        const cameraPair = availableDataSources.stereo_ensemble?.camera_pair || [1, 2];
        params.set("camera_pair", cameraPair.join(","));
      }
      // Axis limits - only send if both min and max are provided (use refs for latest values)
      if (xlimMinRef.current.trim() !== "" && xlimMaxRef.current.trim() !== "") {
        params.set("xlim_min", String(Number(xlimMinRef.current)));
        params.set("xlim_max", String(Number(xlimMaxRef.current)));
      }
      if (ylimMinRef.current.trim() !== "" && ylimMaxRef.current.trim() !== "") {
        params.set("ylim_min", String(Number(ylimMinRef.current)));
        params.set("ylim_max", String(Number(ylimMaxRef.current)));
      }
      // Custom title (use ref for latest value)
      if (plotTitleRef.current.trim() !== "") params.set("title", plotTitleRef.current);

      const url = `${backendUrl}/plot/plot_ensemble?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();

      if (!res.ok) throw new Error(json.error || "Failed to fetch ensemble plot");

      setImageSrc(json.image ?? null);
      setMeta(json.meta ?? null);
      // Only update run if it's actually different to avoid re-render loops
      if (json.meta?.run != null) {
        const parsed = Number(json.meta.run);
        if (Number.isFinite(parsed) && parsed > 0 && parsed !== run) {
          setRun(parsed);
        }
      }
      // Backend returns raw var name (e.g., "ux"), frontend uses prefixed (e.g., "ens:ux")
      // Compare raw names to avoid re-render loop
      // Strip any prefix from response var in case backend echoes it back
      if (json.meta?.var != null && typeof json.meta.var === "string") {
        const currentRawVar = type.includes(':') ? type.split(':')[1] : type;
        const responseRawVar = json.meta.var.includes(':') ? json.meta.var.split(':')[1] : json.meta.var;
        // Only update if the raw variable name is actually different
        if (responseRawVar !== currentRawVar) {
          // Keep the current prefix when updating
          const prefix = type.includes(':') ? type.split(':')[0] + ':' : '';
          setType(prefix + responseRawVar);
        }
      }
      return true;
    } catch (e: any) {
      setError(e.message || "Unknown error");
      return false;
    } finally {
      setLoading(false);
    }
  }, [effectiveDir, type, run, lower, upper, cmap, backendUrl, camera, isMerged, isUncalibrated, isStereoData, availableDataSources, parseVarType]);

  // Unified fetch function that chooses the right endpoint based on data source
  const fetchCurrentView = useCallback(async () => {
    if (isStatistics) {
      // Statistics mode - use existing stats endpoint
      return;
    } else if (isEnsemble) {
      return fetchEnsembleImage();
    } else {
      return fetchImage();
    }
  }, [isStatistics, isEnsemble, fetchEnsembleImage, fetchImage]);

  const fetchStatVars = useCallback(async () => {
    setStatVarsLoading(true);
    setStatVarsError(null);
    try {
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("camera", String(camera));
      params.set("merged", merged ? "1" : "0");
      // Add stereo params when viewing stereo data
      if (isStereoData) {
        params.set("is_stereo", "1");
        const cameraPair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
        params.set("camera_pair", cameraPair.join(","));
      }
      const url = `${backendUrl}/plot/check_stat_vars?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch stat vars (${res.status})`);
      const vars = Array.isArray(json.vars) ? json.vars.map(String) : [];
      setStatVars(vars);
      // Note: Don't auto-select here - unified dropdown handles variable selection
    } catch (e: any) {
      setStatVarsError(e?.message ?? "Unknown error");
      setStatVars(null);
    } finally {
      setStatVarsLoading(false);
    }
  }, [effectiveDir, camera, merged, backendUrl, isStereoData, availableDataSources]);

  const fetchFrameVars = useCallback(async () => {
    setFrameVarsLoading(true);
    setFrameVarsError(null);
    try {
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", String(index));
      params.set("camera", String(camera));
      params.set("merged", merged ? "1" : "0");
      params.set("is_uncalibrated", isUncalibrated ? "1" : "0");
      // Add stereo params when viewing stereo data
      if (isStereoData) {
        params.set("is_stereo", "1");
        const cameraPair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
        params.set("camera_pair", cameraPair.join(","));
      }
      const url = `${backendUrl}/plot/check_vars?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch frame vars (${res.status})`);
      const vars = Array.isArray(json.vars) ? json.vars.map(String) : [];
      setFrameVars(vars);
      // Note: Don't auto-select here - unified dropdown handles variable selection
    } catch (e: any) {
      setFrameVarsError(e?.message ?? "Unknown error");
      setFrameVars(null);
    } finally {
      setFrameVarsLoading(false);
    }
  }, [effectiveDir, camera, merged, isUncalibrated, backendUrl, isStereoData, availableDataSources]); // Note: removed index - vars are same across frames

  // Fetch all variables grouped by source (instantaneous, instantaneous_stats, mean_stats)
  const fetchAllVars = useCallback(async () => {
    setAllVarsLoading(true);
    try {
      const basePath = effectiveDir;
      if (!basePath) return;
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", "1"); // Just check frame 1 - vars are same across all frames
      params.set("camera", String(camera));
      params.set("merged", merged ? "1" : "0");
      params.set("is_uncalibrated", isUncalibrated ? "1" : "0");
      // Add stereo params when viewing stereo data
      if (isStereoData) {
        params.set("is_stereo", "1");
        const cameraPair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
        params.set("camera_pair", cameraPair.join(","));
      }
      const url = `${backendUrl}/plot/check_all_vars?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) {
        console.error("Failed to fetch all vars:", json.error);
        return;
      }
      const grouped: GroupedVariables = {
        instantaneous: Array.isArray(json.instantaneous) ? json.instantaneous : [],
        instantaneous_stats: Array.isArray(json.instantaneous_stats) ? json.instantaneous_stats : [],
        mean_stats: Array.isArray(json.mean_stats) ? json.mean_stats : [],
        ensemble: Array.isArray(json.ensemble) ? json.ensemble : [],
      };
      setAllVars(grouped);
    } catch (e: any) {
      console.error("Error fetching all vars:", e?.message);
    } finally {
      setAllVarsLoading(false);
    }
  }, [effectiveDir, camera, merged, isUncalibrated, backendUrl, isStereoData, availableDataSources]); // Note: removed index - vars are same across frames

  const fetchLimits = useCallback(async () => {
    setLimitsLoading(true);
    try {
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("camera", String(camera));
      params.set("merged", merged ? "1" : "0");
      params.set("var", type);
      // Add stereo params when viewing stereo data
      if (isStereoData) {
        params.set("is_stereo", "1");
        const cameraPair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
        params.set("camera_pair", cameraPair.join(","));
      }
      const url = `${backendUrl}/plot/check_limits?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch limits (${res.status})`);
      if (typeof json.min === "number" && typeof json.max === "number") {
        setLower(String(json.min));
        setUpper(String(json.max));
      } else {
        console.warn("check_limits returned unexpected payload", json);
      }
    } catch (err) {
      console.error("Error fetching limits:", err);
    } finally {
      setLimitsLoading(false);
    }
  }, [effectiveDir, camera, merged, type, backendUrl, setLower, setUpper, isStereoData, availableDataSources]);

  const fetchAvailableRuns = useCallback(async () => {
    try {
      const basePath = effectiveDir;
      if (!basePath) return [];
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("camera", String(camera));
      params.set("merged", merged ? "1" : "0");
      params.set("is_uncalibrated", isUncalibrated ? "1" : "0");
      // Pass type_name so backend checks correct data source (ensemble vs instantaneous)
      params.set("type_name", isEnsemble ? "ensemble" : "instantaneous");
      // Add stereo params when viewing stereo data
      if (isStereoData) {
        params.set("is_stereo", "1");
        const cameraPair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
        params.set("camera_pair", cameraPair.join(","));
      }
      const url = `${backendUrl}/plot/check_runs?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) return [];
      const runs = Array.isArray(json.runs) ? json.runs.map(Number).filter((n: number) => Number.isFinite(n) && n > 0) : [];
      return runs;
    } catch (e) {
      return [];
    }
  }, [effectiveDir, camera, merged, isEnsemble, isUncalibrated, backendUrl, isStereoData, availableDataSources]);

  const handlePlayToggle = () => {
    setPlaying(p => !p);
  };

  const fetchStatsImage = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");

      // Parse the type to get source and variable name (consistent with fetchImage)
      const { varSource, varName } = parseVarType(type);

      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", String(index));
      params.set("var", varName);  // Send only the raw var name, not the prefixed type
      params.set("var_source", varSource);
      params.set("cmap", cmap);
      if (run && run > 0) params.set("run", String(run));
      if (lower.trim() !== "") params.set("lower_limit", String(Number(lower)));
      if (upper.trim() !== "") params.set("upper_limit", String(Number(upper)));
      params.set("camera", String(camera));
      params.set("merged", merged ? "1" : "0");
      // Add stereo params when viewing stereo data
      if (isStereoData) {
        params.set("is_stereo", "1");
        const cameraPair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
        params.set("camera_pair", cameraPair.join(","));
      }
      // Axis limits - only send if both min and max are provided (use refs for latest values)
      if (xlimMinRef.current.trim() !== "" && xlimMaxRef.current.trim() !== "") {
        params.set("xlim_min", String(Number(xlimMinRef.current)));
        params.set("xlim_max", String(Number(xlimMaxRef.current)));
      }
      if (ylimMinRef.current.trim() !== "" && ylimMaxRef.current.trim() !== "") {
        params.set("ylim_min", String(Number(ylimMinRef.current)));
        params.set("ylim_max", String(Number(ylimMaxRef.current)));
      }
      // Custom title (use ref for latest value)
      if (plotTitleRef.current.trim() !== "") params.set("title", plotTitleRef.current);
      
      const url = `${backendUrl}/plot/plot_stats?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch stats plot (${res.status})`);
      setImageSrc(json.image ?? null);
      setMeta(json.meta ?? null);
      // Only update run if it's actually different to avoid re-render loops
      if (json.meta && json.meta.run != null) {
        const parsed = Number(json.meta.run);
        if (Number.isFinite(parsed) && parsed > 0 && parsed !== run) {
          setRun(parsed);
        }
      }
      // Compare raw var names to avoid re-render loop
      // Strip any prefix from response var in case backend echoes it back
      if (json.meta && json.meta.var != null && typeof json.meta.var === "string") {
        const currentRawVar = type.includes(':') ? type.split(':')[1] : type;
        // Strip prefix from response var if present (e.g., "mean:ux" -> "ux")
        const responseRawVar = json.meta.var.includes(':') ? json.meta.var.split(':')[1] : json.meta.var;
        if (responseRawVar !== currentRawVar) {
          const prefix = type.includes(':') ? type.split(':')[0] + ':' : '';
          setType(prefix + responseRawVar);
        }
      }
      setHasRendered(true);
    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";
      // Filter out "Internal Server Error" if it's just a generic 500
      if (msg.includes("Internal Server Error")) {
        setStatsError("Statistics not found for this configuration.");
      } else {
        setStatsError(msg);
      }
    } finally {
      setStatsLoading(false);
    }
  }, [effectiveDir, index, type, run, lower, upper, cmap, backendUrl, camera, merged, isStereoData, availableDataSources, parseVarType]);

  // Auto-fetch stat vars when configuration changes in mean mode
  useEffect(() => {
    if (meanMode && effectiveDir) {
      void fetchStatVars();
    }
  }, [meanMode, effectiveDir, camera, merged, fetchStatVars]);

  // Auto-fetch frame vars when configuration changes (not in mean mode)
  // Note: removed index from deps - vars are same across all frames
  useEffect(() => {
    if (!meanMode && effectiveDir && !isEnsemble) {
      void fetchFrameVars();
    }
  }, [meanMode, effectiveDir, camera, merged, isEnsemble, isUncalibrated, fetchFrameVars]);

  // Auto-fetch all grouped vars when configuration changes
  useEffect(() => {
    if (effectiveDir) {
      void fetchAllVars();
    }
  }, [effectiveDir, camera, merged, isUncalibrated, fetchAllVars]);

  // Auto-render when we have a valid configuration
  useEffect(() => {
    if (effectiveDir && !hasRendered) {
      setHasRendered(true);
    }
  }, [effectiveDir, hasRendered]);

  const handleRender = useCallback(async () => {
    setHasRendered(true);
    if (meanMode) {
      await fetchStatsImage();
      return;
    }
    // For ensemble data, use the ensemble endpoint
    if (isEnsemble) {
      await fetchEnsembleImage();
      return;
    }
    await fetchFrameVars();
    await fetchImage();
  }, [meanMode, isEnsemble, fetchFrameVars, fetchImage, fetchStatsImage, fetchEnsembleImage]);

  const toggleMeanMode = async () => {
    const newVal = !meanMode;
    setMeanMode(newVal);
    if (newVal) {
      setLower("");
      setUpper("");
      setStatsError(null);
      await fetchStatVars();
      await fetchStatsImage();
    } else {
      setStatsError(null);
      setStatVars(null);
      setStatVarsError(null);
    }
  };

  const handleImageClick = async (e: React.MouseEvent) => {
    if (!datumMode || !meta?.axes_bbox || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const dispX = e.clientX - rect.left;
    const dispY = e.clientY - rect.top;
    const bbox = meta.axes_bbox;
    const scaleX = bbox.png_width / rect.width;
    const scaleY = bbox.png_height / rect.height;
    const px = dispX * scaleX;
    const py = dispY * scaleY;
    if (px < bbox.left || px > bbox.left + bbox.width ||
        py < bbox.top || py > bbox.top + bbox.height) {
      return;
    }
    const xPercent = (px - bbox.left) / bbox.width;
    const yPercent = (py - bbox.top) / bbox.height;
    try {
      const { varSource, varName } = parseVarType(type);
      const params = new URLSearchParams();
      params.set("base_path", effectiveDir);
      params.set("camera", String(camera));
      params.set("frame", String(index));
      params.set("var", varName);
      params.set("var_source", varSource);
      params.set("run", String(run));
      params.set("merged", merged ? "1" : "0");
      params.set("x_percent", xPercent.toString());
      params.set("y_percent", yPercent.toString());
      // Add stereo params when viewing stereo data
      if (isStereoData) {
        params.set("is_stereo", "1");
        const cameraPair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
        params.set("camera_pair", cameraPair.join(","));
      }
      const url = `${backendUrl}/plot/get_vector_at_position?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Failed to get vector value");
      alert(`New datum set at physical position: x=${json.x?.toFixed(4)}, y=${json.y?.toFixed(4)}`);
      await sendDatumToBackend(json.x, json.y);
      void fetchCurrentView();
    } catch (e: any) {
      setError(`Failed to set datum: ${e.message}`);
    }
    setDatumMode(false);
  };

  const updateOffsets = async () => {
    try {
      const body: Record<string, any> = {
        base_path_idx: basePathIdx,
        camera: camera,
        run: run,
        type_name: getTypeNameFromDataSource(dataSource),
        x_offset: Number(xOffset) || 0,
        y_offset: Number(yOffset) || 0,
        merged: merged ? 1 : 0,
      };
      // Add stereo params when viewing stereo data
      if (isStereoData) {
        body.use_stereo = true;
        body.camera_pair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
      }
      const url = `${backendUrl}/calibration/set_datum`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update offsets");
      void fetchCurrentView();
    } catch (e: any) {
      setError(`Failed to update offsets: ${e.message}`);
    }
  };

  const sendDatumToBackend = async (x: number, y: number) => {
    try {
      const body: Record<string, any> = {
        base_path_idx: basePathIdx,
        camera: camera,
        run: run,
        type_name: getTypeNameFromDataSource(dataSource),
        x: x,
        y: y,
        x_offset: Number(xOffset) || 0,
        y_offset: Number(yOffset) || 0,
        merged: merged ? 1 : 0,
      };
      // Add stereo params when viewing stereo data
      if (isStereoData) {
        body.use_stereo = true;
        body.camera_pair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
      }
      const url = `${backendUrl}/calibration/set_datum`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to set datum");
    } catch (e: any) {
      setError(`Failed to set datum: ${e.message}`);
    }
  };

  const fetchCornerCoordinates = async () => {
    setShowCorners(false);
    setCornerCoordinates(null);
    setError(null);
    try {
      const basePath = effectiveDir;
      if (!basePath) throw new Error("Please provide a base path");
      const { varSource, varName } = parseVarType(type);
      const fetchCorner = async (xPercent: number, yPercent: number) => {
        const params = new URLSearchParams();
        params.set("base_path", basePath);
        params.set("camera", String(camera));
        params.set("frame", String(index));
        params.set("var", varName);
        params.set("var_source", varSource);
        params.set("run", String(run));
        params.set("merged", merged ? "1" : "0");
        params.set("x_percent", xPercent.toString());
        params.set("y_percent", yPercent.toString());
        // Add stereo params when viewing stereo data
        if (isStereoData) {
          params.set("is_stereo", "1");
          const cameraPair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
          params.set("camera_pair", cameraPair.join(","));
        }
        const url = `${backendUrl}/plot/get_vector_at_position?${params.toString()}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || "Failed to get corner coordinate");
        return { x: json.x, y: json.y };
      };
      const [topLeft, topRight, bottomLeft, bottomRight] = await Promise.all([
        fetchCorner(0, 0),
        fetchCorner(1, 0),
        fetchCorner(0, 1),
        fetchCorner(1, 1),
      ]);
      setCornerCoordinates({ topLeft, topRight, bottomLeft, bottomRight });
      setShowCorners(true);
    } catch (e: any) {
      setError(`Failed to get corner coordinates: ${e.message}`);
    }
  };

  const clearHover = useCallback(() => {
    if (hoverDebounceRef.current) {
      window.clearTimeout(hoverDebounceRef.current);
      hoverDebounceRef.current = null;
    }
    pendingFetchRef.current = false;
    setHoverData(null);
  }, []);

  useEffect(() => { clearHover(); }, [imageSrc, meta, type, index, meanMode, camera, merged, clearHover]);

  const fetchValueAt = useCallback((xPercent: number, yPercent: number) => {
    // Note: Backend handles uncalibrated data by returning pixel coordinates (i, j indices)

    if (pendingFetchRef.current) return;
    pendingFetchRef.current = true;
    // Use get_vector_at_position for all sources - it handles var_source parameter
    const { varSource, varName } = parseVarType(type);
    const params = new URLSearchParams();
    params.set("base_path", effectiveDir);
    params.set("camera", String(camera));
    params.set("frame", String(index));
    params.set("var", varName);
    params.set("var_source", varSource);
    params.set("run", String(run));
    params.set("merged", merged ? "1" : "0");
    params.set("is_uncalibrated", isUncalibrated ? "1" : "0");
    params.set("x_percent", xPercent.toString());
    params.set("y_percent", yPercent.toString());
    // Add stereo params when viewing stereo data
    if (isStereoData) {
      params.set("is_stereo", "1");
      const cameraPair = availableDataSources.stereo_instantaneous?.camera_pair || [1, 2];
      params.set("camera_pair", cameraPair.join(","));
    }
    // Pass axis limits so backend can correctly map percentage to visible region
    // Prefer limits from plot metadata (actual rendered limits) over user-provided strings
    if (meta?.axes_bbox?.xlim) {
      params.set("xlim_min", String(meta.axes_bbox.xlim[0]));
      params.set("xlim_max", String(meta.axes_bbox.xlim[1]));
    } else if (xlimMin.trim() !== "" && xlimMax.trim() !== "") {
      params.set("xlim_min", String(Number(xlimMin)));
      params.set("xlim_max", String(Number(xlimMax)));
    }
    if (meta?.axes_bbox?.ylim) {
      params.set("ylim_min", String(meta.axes_bbox.ylim[0]));
      params.set("ylim_max", String(meta.axes_bbox.ylim[1]));
    } else if (ylimMin.trim() !== "" && ylimMax.trim() !== "") {
      params.set("ylim_min", String(Number(ylimMin)));
      params.set("ylim_max", String(Number(ylimMax)));
    }

    const url = `${backendUrl}/plot/get_vector_at_position?${params.toString()}`;
    fetch(url)
      .then(r => r.json().then(j => ({ ok: r.ok, json: j })))
      .then(({ ok, json }) => {
        pendingFetchRef.current = false;
        if (!ok || json.error) return;
        setHoverData(h => h ? { ...h, ...json } : null);
      })
      .catch(() => { pendingFetchRef.current = false; });
  }, [backendUrl, effectiveDir, camera, index, type, run, merged, isUncalibrated, xlimMin, xlimMax, ylimMin, ylimMax, meta, parseVarType, isStereoData, availableDataSources]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const bbox = meta?.axes_bbox;
    const imgEl = imgRef.current;
    if (!imgEl || !bbox) return;
    const rect = imgEl.getBoundingClientRect();
    const dispX = e.clientX - rect.left;
    const dispY = e.clientY - rect.top;
    if (dispX < 0 || dispY < 0 || dispX > rect.width || dispY > rect.height) {
      clearHover();
      return;
    }
    const scaleX = bbox.png_width / rect.width;
    const scaleY = bbox.png_height / rect.height;
    const px = dispX * scaleX;
    const py = dispY * scaleY;
    if (px < bbox.left || px > bbox.left + bbox.width || py < bbox.top || py > bbox.top + bbox.height) {
      clearHover();
      return;
    }
    const xPercent = (px - bbox.left) / bbox.width;
    const yPercent = (py - bbox.top) / bbox.height;
    setHoverData({
      x: NaN, y: NaN, ux: null, uy: null, value: null,
      i: -1, j: -1, clientX: e.clientX, clientY: e.clientY
    });
    const last = lastQueryRef.current;
    const keyChanged = !last ||
      last.px !== Math.round(px) ||
      last.py !== Math.round(py) ||
      last.frame !== index ||
      last.varName !== type ||
      last.mean !== meanMode;
    if (!keyChanged) return;
    lastQueryRef.current = { px: Math.round(px), py: Math.round(py), frame: index, varName: type, mean: meanMode };
    if (hoverDebounceRef.current) window.clearTimeout(hoverDebounceRef.current);
    hoverDebounceRef.current = window.setTimeout(() => {
      fetchValueAt(xPercent, yPercent);
    }, 120);
  }, [meta, fetchValueAt, index, type, meanMode, clearHover]);

  const onMouseLeave = useCallback(() => { clearHover(); }, [clearHover]);

  const handleMagnifierMove = (e: React.MouseEvent) => {
    const img = imgRef.current;
    const mag = magnifierRef.current;
    if (!img || !mag) {
      setMagVisible(false);
      return;
    }
    const rect = img.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      setMagVisible(false);
      return;
    }

    // Check if cursor is within the vector field plot area (not just the image)
    const bbox = meta?.axes_bbox;
    if (bbox) {
      const scaleX = bbox.png_width / rect.width;
      const scaleY = bbox.png_height / rect.height;
      const px = x * scaleX;
      const py = y * scaleY;

      // Hide magnifier if outside plot area (in title, colorbar, axis labels)
      if (px < bbox.left || px > bbox.left + bbox.width ||
          py < bbox.top || py > bbox.top + bbox.height) {
        setMagVisible(false);
        return;
      }
    }

    setMagVisible(true);
    // Position magnifier so its center is exactly at the cursor position (using clientX/Y for fixed positioning)
    const left = e.clientX - (MAG_SIZE / 2);
    const top = e.clientY - (MAG_SIZE / 2);
    setMagPos({ left, top });
    const ctx = mag.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, MAG_SIZE * dpr, MAG_SIZE * dpr);
    ctx.save();
    ctx.beginPath();
    ctx.arc((MAG_SIZE * dpr) / 2, (MAG_SIZE * dpr) / 2, (MAG_SIZE * dpr) / 2, 0, Math.PI * 2);
    ctx.clip();
    // Calculate source position - sample from the exact pixel under cursor
    const srcCenterX = (x / rect.width) * img.naturalWidth;
    const srcCenterY = (y / rect.height) * img.naturalHeight;
    const srcSize = MAG_SIZE / MAG_FACTOR;
    const sx = srcCenterX - (srcSize / 2);
    const sy = srcCenterY - (srcSize / 2);
    ctx.drawImage(
      img,
      sx, sy,
      srcSize, srcSize,
      0, 0,
      MAG_SIZE * dpr, MAG_SIZE * dpr
    );
    const cx = (MAG_SIZE * dpr) / 2;
    const cy = (MAG_SIZE * dpr) / 2;
    const lineLen = MAG_SIZE * dpr * 0.3;
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, dpr * 1.5);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.moveTo(cx - lineLen, cy);
    ctx.lineTo(cx + lineLen, cy);
    ctx.moveTo(cx, cy - lineLen);
    ctx.lineTo(cx, cy + lineLen);
    ctx.stroke();
    ctx.beginPath();
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.moveTo(cx - lineLen, cy);
    ctx.lineTo(cx + lineLen, cy);
    ctx.moveTo(cx, cy - lineLen);
    ctx.lineTo(cx, cy + lineLen);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, (MAG_SIZE * dpr) / 2 - 2 * dpr, 0, Math.PI * 2);
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = '#005fa3';
    ctx.stroke();
  };

  const handleMagnifierLeave = () => {
    setMagVisible(false);
  };

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch(`${backendUrl}/config`);
        if (!res.ok) return;
        const json = await res.json();
        const backendNumFramePairs = json.images?.num_frame_pairs;
        if (Number.isFinite(backendNumFramePairs) && backendNumFramePairs > 0) {
          setMaxFrameCount(backendNumFramePairs);
          // Clamp index if it exceeds the new maxFrameCount
          setIndex(prev => Math.min(prev, backendNumFramePairs));
        }
      } catch (err) {
        console.error("Error fetching config for frame count:", err);
      }
    }
    fetchConfig();
  }, [backendUrl]);

  // Fetch available data sources when base path or camera changes
  useEffect(() => {
    if (effectiveDir) {
      void fetchAvailableDataSources();
    }
  }, [effectiveDir, camera, fetchAvailableDataSources]);

  useEffect(() => {
    if (!effectiveDir || meanMode) return;
    fetchAvailableRuns().then(runs => {
      if (runs.length > 0) {
        const maxRun = Math.max(...runs);
        setRun(maxRun);
        setHasRendered(true);
      }
    }).catch(() => {});
  }, [effectiveDir, meanMode, fetchAvailableRuns]);

  useEffect(() => {
    if (!hasRendered || !(effectiveDir || basePaths.length > 0)) return;

    // Guard: ensure type is compatible with dataSource before rendering
    // This prevents race conditions where dataSource changed but type hasn't updated yet
    const varSource = type.includes(':') ? type.split(':')[0] : 'inst';
    const isEnsembleSource = dataSource.includes('ensemble');
    const isUncalibratedSource = dataSource.includes('uncalibrated');
    const isStatisticsSource = dataSource.includes('statistics');

    if (isEnsembleSource && varSource !== 'ens') {
      // Wait for type to be updated to ens: prefix
      return;
    }
    if (isStatisticsSource && varSource !== 'mean') {
      // Wait for type to be updated to mean: prefix
      return;
    }
    if (isUncalibratedSource && varSource === 'inst_stat') {
      // inst_stat not available for uncalibrated - wait for fallback
      return;
    }

    if (meanMode) {
      void fetchStatsImage();
    } else if (isEnsemble) {
      void fetchEnsembleImage();
    } else {
      void fetchImage();
    }
  }, [
    hasRendered,
    effectiveDir,
    index,
    type,
    run,
    lower,
    upper,
    cmap,
    camera,
    merged,
    isUncalibrated,
    isEnsemble,
    dataSource,
    basePathIdx,
    meanMode,
    fetchImage,
    fetchStatsImage,
    fetchEnsembleImage,
  ]);

  useEffect(() => {
    if (playing) {
      playIntervalRef.current = setInterval(() => {
        setIndex(i => i >= maxFrameCount ? 1 : i + 1);
      }, 300);
    } else if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [playing, maxFrameCount]);

  useEffect(() => {
    if (error && playing) {
      setPlaying(false);
    }
  }, [error, playing]);

  const basename = (p: string) => {
    if (!p) return "";
    const parts = p.replace(/\\/g, "/").split("/");
    return parts.filter(Boolean).pop() || p;
  };

  const base64ToBlob = useCallback((base64: string, mime = "image/png") => {
    const byteChars = atob(base64);
    const byteArrays: BlobPart[] = [];
    for (let offset = 0; offset < byteChars.length; offset += 512) {
      const slice = byteChars.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
      byteArrays.push(new Uint8Array(byteNumbers));
    }
    return new Blob(byteArrays, { type: mime });
  }, []);

  const downloadCurrentView = useCallback(() => {
    if (!imageSrc) return;
    const fileName = `vector_${meanMode ? "mean" : `frame_${index}`}_${type}.png`;
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${imageSrc}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [imageSrc, meanMode, index, type]);

  const copyCurrentView = useCallback(async () => {
    if (!imageSrc) return;
    try {
      const blob = base64ToBlob(imageSrc, "image/png");
      const ClipboardItemCtor: any = (window as any).ClipboardItem;
      if (navigator.clipboard && "write" in navigator.clipboard && ClipboardItemCtor) {
        await navigator.clipboard.write([new ClipboardItemCtor({ "image/png": blob })]);
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e: any) {
      setError(`Failed to copy image: ${e?.message ?? "Unknown error"}`);
    }
  }, [imageSrc, base64ToBlob]);

  const applyTransformation = useCallback(async (transformation: string) => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${backendUrl}/plot/transform_frame`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          base_path: effectiveDir,
          camera: camera,
          frame: index,
          transformation,
          merged: merged,
        }),
      });
      const result = await response.json();
      if (result.success) {
        // Use the backend's simplified transformation list
        setAppliedTransforms(result.pending_transformations || []);
        // Reload the image
        await handleRender();
      } else {
        setError(result.error || "Transformation failed");
      }
    } catch (e: any) {
      setError(`Transformation failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, effectiveDir, camera, index, merged, handleRender]);

  const clearTransforms = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${backendUrl}/plot/clear_transform`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          base_path: effectiveDir,
          camera: camera,
          frame: index,
          merged: merged,
        }),
      });
      const result = await response.json();
      if (result.success) {
        setAppliedTransforms([]);
        // Reload the image
        await handleRender();
      } else {
        // Handle "No original backup" gracefully - this happens after batch apply
        const errorMsg = result.error || "Clear transforms failed";
        if (errorMsg.includes("No original backup") || errorMsg.includes("nothing to undo")) {
          // Just clear the UI list silently - the data is already permanently transformed
          setAppliedTransforms([]);
          // Still reload the image to ensure display is current
          await handleRender();
        } else {
          setError(errorMsg);
        }
      }
    } catch (e: any) {
      setError(`Clear transforms failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, effectiveDir, camera, index, merged, handleRender]);

  // Clear the operations list without calling backend (just UI state)
  const clearOperationsList = useCallback(() => {
    setAppliedTransforms([]);
  }, []);

  const [transformationJob, setTransformationJob] = useState<{
    job_id: string;
    status: string;
    progress: number;
    processed_frames: number;
    total_frames: number;
    elapsed_time?: number;
    estimated_remaining?: number;
    error?: string;
  } | null>(null);

  const applyTransformationToAllFrames = useCallback(async (transformations: string[]) => {
    try {
      setLoading(true);
      setError(null);
      setTransformationJob(null);

      const response = await fetch(`${backendUrl}/plot/transform_all_frames`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          base_path: effectiveDir,
          camera: camera,
          transformations,
          merged: merged,
          image_count: maxFrameCount,
        }),
      });
      const result = await response.json();
      if (result.job_id) {
        setTransformationJob({
          job_id: result.job_id,
          status: result.status,
          progress: 0,
          processed_frames: 0,
          total_frames: result.total_frames,
        });
        // Start polling for status
        pollTransformationStatus(result.job_id);
      } else {
        setError(result.error || "Failed to start transformation job");
      }
    } catch (e: any) {
      setError(`Failed to start transformation: ${e?.message ?? "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, effectiveDir, camera, merged, maxFrameCount]);

  const pollTransformationStatus = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`${backendUrl}/plot/transform_all_frames/status/${jobId}`);
      const status = await response.json();

      setTransformationJob(status);

      if (status.status === "running" || status.status === "starting") {
        // Continue polling
        setTimeout(() => pollTransformationStatus(jobId), 1000);
      } else if (status.status === "completed") {
        // Clear the operations list from UI state
        setAppliedTransforms([]);

        // Clear the operations from config.yaml
        try {
          await fetch(`${backendUrl}/update_config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transforms: {
                cameras: {
                  [camera]: { operations: [] }
                }
              }
            }),
          });
        } catch (err) {
          console.error('Failed to clear transform operations from config:', err);
        }

        // Reload current frame to show changes
        await handleRender();
      }
    } catch (e: any) {
      setError(`Failed to check transformation status: ${e?.message ?? "Unknown error"}`);
    }
  }, [backendUrl, handleRender, camera]);

  return {
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
    cameraOptions,
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
    // Grouped variables for unified dropdown
    allVars,
    allVarsLoading,
    fetchAllVars,
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
    MAG_SIZE,
    dpr,
    handlePlayToggle,
    handleRender,
    toggleMeanMode,
    handleImageClick,
    updateOffsets,
    fetchCornerCoordinates,
    fetchLimits,
    onMouseMove,
    onMouseLeave,
    handleMagnifierMove,
    handleMagnifierLeave,
    basename,
    downloadCurrentView,
    copyCurrentView,
    applyTransformation,
    applyTransformationToAllFrames,
    transformationJob,
    appliedTransforms,
    setAppliedTransforms,
    clearTransforms,
    clearOperationsList,
    effectiveDir,
    prefetchSurrounding,
    // New data source management
    dataSource,
    setDataSource,
    availableDataSources,
    availabilityLoading,
    fetchAvailableDataSources,
    fetchStatVars,
    fetchFrameVars,
    // Derived feature flags
    isEnsemble,
    isMerged,
    isStatistics,
    isStereo,
    hasStereoData,
    isStereoData,
    canTransform,
    canEditCoordinates,
    canMerge,
    canViewMerged,
    canCalculateStatistics,
    canViewStatistics,
    hasFrameNavigation,
    // Unified variable dropdown support
    isMeanVar,
    parseVarType,
    // Ensemble specific
    fetchEnsembleImage,
    fetchCurrentView,
  };
};
