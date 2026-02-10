"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';

const POLL_INTERVAL_MS = 1000;
const IMAGE_INTERVAL_MS = 3000;
const STALE_JOB_HOURS = 24;

// Storage keys for localStorage persistence
const STORAGE_KEY_INSTANTANEOUS = 'pivtools_instantaneous_job';
const STORAGE_KEY_ENSEMBLE = 'pivtools_ensemble_job';

interface StatusImage {
  src: string | null;
  error: string | null;
}

interface PivJobState {
  jobId: string | null;
  isPolling: boolean;
  isLoading: boolean;
  progress: number;
  logs: string;
  statusImage: StatusImage;
}

interface PivJobSettings {
  sourcePathIdx: number;
  varType: string;
  cmap: string;
  lowerLimit: string;
  upperLimit: string;
  showStatusImage: boolean;
  activePaths: number[];
}

interface StoredJobData {
  jobId: string;
  timestamp: number;
  mode: 'instantaneous' | 'ensemble';
}

interface PivJobContextType {
  instantaneousJob: PivJobState;
  ensembleJob: PivJobState;
  startJob: (mode: 'instantaneous' | 'ensemble', settings: PivJobSettings) => Promise<void>;
  cancelJob: (mode: 'instantaneous' | 'ensemble') => Promise<void>;
  resetJob: (mode: 'instantaneous' | 'ensemble') => void;
  updateSettings: (mode: 'instantaneous' | 'ensemble', settings: Partial<PivJobSettings>) => void;
  instantaneousSettings: PivJobSettings;
  ensembleSettings: PivJobSettings;
}

const defaultJobState: PivJobState = {
  jobId: null,
  isPolling: false,
  isLoading: false,
  progress: 0,
  logs: '',
  statusImage: { src: null, error: null },
};

const defaultSettings: PivJobSettings = {
  sourcePathIdx: 0,
  varType: 'ux',
  cmap: 'default',
  lowerLimit: '',
  upperLimit: '',
  showStatusImage: true,
  activePaths: [],
};

const PivJobContext = createContext<PivJobContextType | null>(null);

export function usePivJobContext() {
  const context = useContext(PivJobContext);
  if (!context) {
    throw new Error('usePivJobContext must be used within a PivJobProvider');
  }
  return context;
}

interface PivJobProviderProps {
  children: ReactNode;
  config?: any;
  activeTab?: string;
}

export function PivJobProvider({ children, config, activeTab }: PivJobProviderProps) {
  // Job state for both modes
  const [instantaneousJob, setInstantaneousJob] = useState<PivJobState>(defaultJobState);
  const [ensembleJob, setEnsembleJob] = useState<PivJobState>(defaultJobState);

  // Settings for both modes
  const [instantaneousSettings, setInstantaneousSettings] = useState<PivJobSettings>(defaultSettings);
  const [ensembleSettings, setEnsembleSettings] = useState<PivJobSettings>(defaultSettings);

  // Refs for polling to avoid stale closures
  const instantaneousSettingsRef = useRef(instantaneousSettings);
  const ensembleSettingsRef = useRef(ensembleSettings);
  const instantaneousLastImageUpdateRef = useRef<number>(0);
  const ensembleLastImageUpdateRef = useRef<number>(0);
  const instantaneousAvailableFramesRef = useRef<number[]>([]);
  const ensembleAvailableFramesRef = useRef<number[]>([]);
  const activeTabRef = useRef(activeTab);

  // Track previous settings to detect changes and trigger immediate re-render
  const instantaneousPrevSettingsRef = useRef<string>('');
  const ensemblePrevSettingsRef = useRef<string>('');

  // Keep refs updated
  useEffect(() => {
    instantaneousSettingsRef.current = instantaneousSettings;
    // Detect settings change → reset throttle timer for immediate image update
    const key = `${instantaneousSettings.varType}|${instantaneousSettings.cmap}|${instantaneousSettings.lowerLimit}|${instantaneousSettings.upperLimit}`;
    if (instantaneousPrevSettingsRef.current && instantaneousPrevSettingsRef.current !== key) {
      instantaneousLastImageUpdateRef.current = 0;
    }
    instantaneousPrevSettingsRef.current = key;
  }, [instantaneousSettings]);

  useEffect(() => {
    ensembleSettingsRef.current = ensembleSettings;
    const key = `${ensembleSettings.varType}|${ensembleSettings.cmap}|${ensembleSettings.lowerLimit}|${ensembleSettings.upperLimit}`;
    if (ensemblePrevSettingsRef.current && ensemblePrevSettingsRef.current !== key) {
      ensembleLastImageUpdateRef.current = 0;
    }
    ensemblePrevSettingsRef.current = key;
  }, [ensembleSettings]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Initialize active paths from config
  useEffect(() => {
    const sourcePaths = config?.paths?.source_paths || [];
    if (sourcePaths.length > 0) {
      const allPaths = sourcePaths.map((_: any, i: number) => i);
      setInstantaneousSettings(prev => ({ ...prev, activePaths: allPaths }));
      setEnsembleSettings(prev => ({ ...prev, activePaths: allPaths }));
    }
  }, [config?.paths?.source_paths]);

  // Check localStorage for persisted jobs on mount
  useEffect(() => {
    const checkStoredJob = async (storageKey: string, mode: 'instantaneous' | 'ensemble') => {
      try {
        const stored = localStorage.getItem(storageKey);
        if (!stored) return;

        const data: StoredJobData = JSON.parse(stored);

        // Check if job is stale (older than 24 hours)
        const hoursSinceStart = (Date.now() - data.timestamp) / (1000 * 60 * 60);
        if (hoursSinceStart > STALE_JOB_HOURS) {
          localStorage.removeItem(storageKey);
          return;
        }

        // Query backend to check if job is still running
        const response = await fetch(`/backend/piv_status?job_id=${data.jobId}`);
        if (!response.ok) {
          localStorage.removeItem(storageKey);
          return;
        }

        const status = await response.json();
        if (status.running) {
          // Job is still running - resume polling
          const setJob = mode === 'instantaneous' ? setInstantaneousJob : setEnsembleJob;
          setJob(prev => ({
            ...prev,
            jobId: data.jobId,
            isPolling: true,
          }));
        } else {
          // Job completed - clean up storage
          localStorage.removeItem(storageKey);
        }
      } catch (e) {
        console.error(`Failed to check stored ${mode} job:`, e);
        localStorage.removeItem(storageKey);
      }
    };

    checkStoredJob(STORAGE_KEY_INSTANTANEOUS, 'instantaneous');
    checkStoredJob(STORAGE_KEY_ENSEMBLE, 'ensemble');
  }, []);

  // Polling effect for instantaneous mode
  useEffect(() => {
    if (!instantaneousJob.isPolling || !instantaneousJob.jobId) return;

    const pollStatus = async () => {
      const settings = instantaneousSettingsRef.current;
      const jobId = instantaneousJob.jobId;
      const currentTab = activeTabRef.current;
      const isOnPivTab = currentTab === 'instantaneous' || currentTab === 'ensemble';

      try {
        const params = new URLSearchParams({
          basepath_idx: String(settings.sourcePathIdx),
          var: settings.varType,
          is_uncalibrated: '1',
        });
        if (settings.cmap !== 'default') params.set('cmap', settings.cmap);
        if (jobId) params.set('job_id', jobId);

        // Always poll lightweight status endpoints; skip image fetch when off-tab
        const [statusRes, logsRes, jobStatusRes] = await Promise.all([
          fetch(`/backend/get_uncalibrated_count?${params.toString()}`),
          jobId ? fetch(`/backend/piv_logs?job_id=${jobId}`) : Promise.resolve(null),
          jobId ? fetch(`/backend/piv_status?job_id=${jobId}`) : Promise.resolve(null),
        ]);

        let jobRunning = true;
        if (jobStatusRes && jobStatusRes.ok) {
          const jobStatus = await jobStatusRes.json();
          jobRunning = jobStatus.running ?? true;
        }

        let currentProgress = 0;
        let availableFrames: number[] = [];
        if (statusRes.ok) {
          const data = await statusRes.json();
          currentProgress = Math.round(data.percent ?? 0);

          if (data.files && Array.isArray(data.files)) {
            availableFrames = data.files.map((f: string) => {
              const match = f.match(/(\d+)\.mat$/);
              return match ? parseInt(match[1], 10) : null;
            }).filter((n: number | null) => n !== null) as number[];
            availableFrames.sort((a, b) => a - b);
            instantaneousAvailableFramesRef.current = availableFrames;
          }
        }

        let newLogs = '';
        if (logsRes && logsRes.ok) {
          const logsData = await logsRes.json();
          newLogs = logsData.logs || '';
        }

        // Update status image — only when on PIV tab and interval elapsed
        let newStatusImage: StatusImage | null = null; // null means "keep existing"
        const now = Date.now();
        const timeSinceLastUpdate = now - instantaneousLastImageUpdateRef.current;

        if (isOnPivTab && settings.showStatusImage && availableFrames.length > 0) {
          if (instantaneousLastImageUpdateRef.current === 0 || timeSinceLastUpdate >= IMAGE_INTERVAL_MS) {
            // Pick a random frame from the available set
            const randomIdx = Math.floor(Math.random() * availableFrames.length);
            const frameToShow = availableFrames[randomIdx];

            const imageParams = new URLSearchParams(params);
            imageParams.set('index', String(frameToShow));
            const imageRes = await fetch(`/backend/plot/get_uncalibrated_image?${imageParams.toString()}`);

            if (imageRes.ok) {
              const data = await imageRes.json();
              if (data.image) {
                newStatusImage = { src: data.image, error: null };
                instantaneousLastImageUpdateRef.current = now;
              }
            } else if (imageRes.status !== 404) {
              newStatusImage = { src: null, error: `Image Error: ${imageRes.statusText}` };
            }
          }
        }

        setInstantaneousJob(prev => {
          const newProgress = Math.max(prev.progress, currentProgress);
          const shouldStopPolling = newProgress >= 100 && !jobRunning;

          if (shouldStopPolling) {
            localStorage.removeItem(STORAGE_KEY_INSTANTANEOUS);
          }

          return {
            ...prev,
            progress: newProgress,
            logs: newLogs,
            // Only update statusImage if we fetched a new one (newStatusImage !== null)
            statusImage: newStatusImage !== null ? newStatusImage : prev.statusImage,
            isPolling: !shouldStopPolling,
          };
        });
      } catch (error) {
        setInstantaneousJob(prev => ({
          ...prev,
          statusImage: { src: null, error: 'Polling failed. Check connection.' },
        }));
      }
    };

    pollStatus();
    const intervalId = setInterval(pollStatus, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [instantaneousJob.isPolling, instantaneousJob.jobId]);

  // Polling effect for ensemble mode
  useEffect(() => {
    if (!ensembleJob.isPolling || !ensembleJob.jobId) return;

    const pollStatus = async () => {
      const settings = ensembleSettingsRef.current;
      const jobId = ensembleJob.jobId;
      const currentTab = activeTabRef.current;
      const isOnPivTab = currentTab === 'instantaneous' || currentTab === 'ensemble';

      try {
        const params = new URLSearchParams({
          basepath_idx: String(settings.sourcePathIdx),
          var: settings.varType,
          is_uncalibrated: '1',
        });
        if (settings.cmap !== 'default') params.set('cmap', settings.cmap);
        if (jobId) params.set('job_id', jobId);

        const [statusRes, logsRes, jobStatusRes] = await Promise.all([
          fetch(`/backend/get_uncalibrated_count?${params.toString()}`),
          jobId ? fetch(`/backend/piv_logs?job_id=${jobId}`) : Promise.resolve(null),
          jobId ? fetch(`/backend/piv_status?job_id=${jobId}`) : Promise.resolve(null),
        ]);

        let jobRunning = true;
        if (jobStatusRes && jobStatusRes.ok) {
          const jobStatus = await jobStatusRes.json();
          jobRunning = jobStatus.running ?? true;
        }

        let currentProgress = 0;
        let availableFrames: number[] = [];
        if (statusRes.ok) {
          const data = await statusRes.json();
          currentProgress = Math.round(data.percent ?? 0);

          if (data.files && Array.isArray(data.files)) {
            availableFrames = data.files.map((f: string) => {
              const match = f.match(/(\d+)\.mat$/);
              return match ? parseInt(match[1], 10) : null;
            }).filter((n: number | null) => n !== null) as number[];
            availableFrames.sort((a, b) => a - b);
            ensembleAvailableFramesRef.current = availableFrames;
          }
        }

        let newLogs = '';
        if (logsRes && logsRes.ok) {
          const logsData = await logsRes.json();
          newLogs = logsData.logs || '';
        }

        // Update status image — only when on PIV tab and interval elapsed
        let newStatusImage: StatusImage | null = null; // null means "keep existing"
        const now = Date.now();
        const timeSinceLastUpdate = now - ensembleLastImageUpdateRef.current;

        if (isOnPivTab && settings.showStatusImage && availableFrames.length > 0) {
          if (ensembleLastImageUpdateRef.current === 0 || timeSinceLastUpdate >= IMAGE_INTERVAL_MS) {
            // Pick a random frame from the available set
            const randomIdx = Math.floor(Math.random() * availableFrames.length);
            const frameToShow = availableFrames[randomIdx];

            const imageParams = new URLSearchParams(params);
            imageParams.set('index', String(frameToShow));
            const imageRes = await fetch(`/backend/plot/get_uncalibrated_image?${imageParams.toString()}`);

            if (imageRes.ok) {
              const data = await imageRes.json();
              if (data.image) {
                newStatusImage = { src: data.image, error: null };
                ensembleLastImageUpdateRef.current = now;
              }
            } else if (imageRes.status !== 404) {
              newStatusImage = { src: null, error: `Image Error: ${imageRes.statusText}` };
            }
          }
        }

        setEnsembleJob(prev => {
          const newProgress = Math.max(prev.progress, currentProgress);
          const shouldStopPolling = newProgress >= 100 && !jobRunning;

          if (shouldStopPolling) {
            localStorage.removeItem(STORAGE_KEY_ENSEMBLE);
          }

          return {
            ...prev,
            progress: newProgress,
            logs: newLogs,
            // Only update statusImage if we fetched a new one (newStatusImage !== null)
            statusImage: newStatusImage !== null ? newStatusImage : prev.statusImage,
            isPolling: !shouldStopPolling,
          };
        });
      } catch (error) {
        setEnsembleJob(prev => ({
          ...prev,
          statusImage: { src: null, error: 'Polling failed. Check connection.' },
        }));
      }
    };

    pollStatus();
    const intervalId = setInterval(pollStatus, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [ensembleJob.isPolling, ensembleJob.jobId]);

  const startJob = useCallback(async (mode: 'instantaneous' | 'ensemble', settings: PivJobSettings) => {
    const setJob = mode === 'instantaneous' ? setInstantaneousJob : setEnsembleJob;
    const storageKey = mode === 'instantaneous' ? STORAGE_KEY_INSTANTANEOUS : STORAGE_KEY_ENSEMBLE;
    const lastImageUpdateRef = mode === 'instantaneous' ? instantaneousLastImageUpdateRef : ensembleLastImageUpdateRef;
    const availableFramesRef = mode === 'instantaneous' ? instantaneousAvailableFramesRef : ensembleAvailableFramesRef;

    setJob(prev => ({
      ...prev,
      isLoading: true,
      statusImage: { src: null, error: null },
      progress: 0,
      logs: '',
    }));

    // Reset refs
    lastImageUpdateRef.current = 0;
    availableFramesRef.current = [];

    try {
      const response = await fetch('/backend/run_piv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePathIdx: settings.sourcePathIdx,
          active_paths: settings.activePaths,
          mode: mode,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to start PIV: ${response.statusText}`);
      }

      const data = await response.json();
      const jobId = data.job_id;

      // Store job ID in localStorage for persistence across page refresh
      const storedData: StoredJobData = {
        jobId,
        timestamp: Date.now(),
        mode,
      };
      localStorage.setItem(storageKey, JSON.stringify(storedData));

      setJob(prev => ({
        ...prev,
        jobId,
        isLoading: false,
        isPolling: true,
      }));
    } catch (error: any) {
      setJob(prev => ({
        ...prev,
        isLoading: false,
        statusImage: { src: null, error: error.message || 'Error starting PIV' },
      }));
      throw error;
    }
  }, []);

  const cancelJob = useCallback(async (mode: 'instantaneous' | 'ensemble') => {
    const job = mode === 'instantaneous' ? instantaneousJob : ensembleJob;
    const setJob = mode === 'instantaneous' ? setInstantaneousJob : setEnsembleJob;
    const storageKey = mode === 'instantaneous' ? STORAGE_KEY_INSTANTANEOUS : STORAGE_KEY_ENSEMBLE;

    if (!job.jobId) return;

    setJob(prev => ({ ...prev, isLoading: true }));

    try {
      const response = await fetch('/backend/cancel_run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.jobId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to cancel PIV: ${response.statusText}`);
      }

      localStorage.removeItem(storageKey);

      setJob(prev => ({
        ...prev,
        isPolling: false,
        isLoading: false,
        progress: 0,
        jobId: null,
      }));
    } catch (error: any) {
      setJob(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  }, [instantaneousJob.jobId, ensembleJob.jobId]);

  const updateSettings = useCallback((mode: 'instantaneous' | 'ensemble', newSettings: Partial<PivJobSettings>) => {
    const setSettings = mode === 'instantaneous' ? setInstantaneousSettings : setEnsembleSettings;
    setSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  const resetJob = useCallback((mode: 'instantaneous' | 'ensemble') => {
    const setJob = mode === 'instantaneous' ? setInstantaneousJob : setEnsembleJob;
    const lastImageUpdateRef = mode === 'instantaneous' ? instantaneousLastImageUpdateRef : ensembleLastImageUpdateRef;
    const availableFramesRef = mode === 'instantaneous' ? instantaneousAvailableFramesRef : ensembleAvailableFramesRef;

    // Reset refs
    lastImageUpdateRef.current = 0;
    availableFramesRef.current = [];

    // Reset job state to default (but keep jobId null since we're just clearing the display)
    setJob({
      jobId: null,
      isPolling: false,
      isLoading: false,
      progress: 0,
      logs: '',
      statusImage: { src: null, error: null },
    });
  }, []);

  const value: PivJobContextType = {
    instantaneousJob,
    ensembleJob,
    startJob,
    cancelJob,
    resetJob,
    updateSettings,
    instantaneousSettings,
    ensembleSettings,
  };

  return (
    <PivJobContext.Provider value={value}>
      {children}
    </PivJobContext.Provider>
  );
}
