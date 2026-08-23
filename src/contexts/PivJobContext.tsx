"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';

const POLL_INTERVAL_MS = 1000;
const IMAGE_INTERVAL_MS = 3000;
const STALE_JOB_HOURS = 24;
// The console panel only ever shows a tail. Requesting one keeps both the server-side
// read and the payload flat instead of growing with the length of the run.
const LOG_TAIL_LINES = 500;

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
  // Path pairs this job was launched with. Snapshotted at start so that ticking a
  // checkbox mid-run cannot change the denominator of a job already in flight.
  activePaths: number[];
  // Dataset-unit progress. datasetNumber/datasetLabel are null once every dataset
  // is complete and the job is finalising.
  datasetNumber: number | null;
  datasetTotal: number;
  datasetLabel: string | null;
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
  // Persisted so a page refresh mid-run can resume polling with the same denominator.
  activePaths: number[];
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
  activePaths: [],
  datasetNumber: null,
  datasetTotal: 0,
  datasetLabel: null,
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
  /**
   * Called once when a run finishes. A completed run can change num_images and the
   * base paths on the backend, and the app-level config was only ever fetched on
   * mount - so the Results tab read stale paths until the user reloaded the browser.
   */
  onJobComplete?: () => void;
}

export function PivJobProvider({ children, config, activeTab, onJobComplete }: PivJobProviderProps) {
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

  // Job-settled notification.
  //
  // The completion condition (`shouldStopPolling`) is computed inside the
  // setInstantaneousJob / setEnsembleJob updaters below. Calling out from there would
  // be a side effect inside a state updater, which React may invoke twice under
  // StrictMode - so watch the isPolling true -> false transition here instead.
  //
  // A cancel also lands here, which is intended: a cancelled run still wrote results,
  // so the config is just as worth refetching as after a clean finish.
  const onJobCompleteRef = useRef(onJobComplete);
  useEffect(() => {
    onJobCompleteRef.current = onJobComplete;
  }, [onJobComplete]);

  const instantaneousWasPollingRef = useRef(false);
  useEffect(() => {
    if (instantaneousWasPollingRef.current && !instantaneousJob.isPolling) {
      onJobCompleteRef.current?.();
    }
    instantaneousWasPollingRef.current = instantaneousJob.isPolling;
  }, [instantaneousJob.isPolling]);

  const ensembleWasPollingRef = useRef(false);
  useEffect(() => {
    if (ensembleWasPollingRef.current && !ensembleJob.isPolling) {
      onJobCompleteRef.current?.();
    }
    ensembleWasPollingRef.current = ensembleJob.isPolling;
  }, [ensembleJob.isPolling]);

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
          // Progress is reported against the path pairs the job was launched with.
          // A record without them (written by an older build) cannot be scored, so
          // drop it rather than resume with a denominator we would have to invent.
          if (!Array.isArray(data.activePaths) || data.activePaths.length === 0) {
            console.warn(`Stored ${mode} job ${data.jobId} has no activePaths; not resuming.`);
            localStorage.removeItem(storageKey);
            return;
          }

          // Job is still running - resume polling
          const setJob = mode === 'instantaneous' ? setInstantaneousJob : setEnsembleJob;
          setJob(prev => ({
            ...prev,
            jobId: data.jobId,
            isPolling: true,
            activePaths: data.activePaths,
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

    const jobId = instantaneousJob.jobId;
    const activePaths = instantaneousJob.activePaths;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Committed on its own rather than behind a barrier with the directory scan:
    // the log fetch is cheap and must not inherit the scan's latency.
    const pollLogs = async () => {
      try {
        const res = await fetch(`/backend/piv_logs?job_id=${jobId}&lines=${LOG_TAIL_LINES}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const newLogs = data.logs || '';
        // Bail out of the re-render (and the auto-scroll effect) when unchanged.
        setInstantaneousJob(prev => (prev.logs === newLogs ? prev : { ...prev, logs: newLogs }));
      } catch (error) {
        console.error('Failed to fetch PIV logs:', error);
      }
    };

    const pollStatus = async () => {
      const settings = instantaneousSettingsRef.current;
      const currentTab = activeTabRef.current;
      const isOnPivTab = currentTab === 'instantaneous' || currentTab === 'ensemble';

      try {
        const params = new URLSearchParams({
          active_paths: activePaths.join(','),
          var: settings.varType,
          is_uncalibrated: '1',
        });
        if (settings.cmap !== 'default') params.set('cmap', settings.cmap);
        params.set('job_id', jobId);

        const [statusRes, jobStatusRes] = await Promise.all([
          fetch(`/backend/get_uncalibrated_count?${params.toString()}`),
          fetch(`/backend/piv_status?job_id=${jobId}`),
        ]);

        // The effect can tear down while these are in flight (cancel, or a new job
        // started straight after this one). Anything below would be this job's
        // result written over a different job's state.
        if (cancelled) return;

        let jobRunning = true;
        if (jobStatusRes.ok) {
          const jobStatus = await jobStatusRes.json();
          jobRunning = jobStatus.running ?? true;
        }

        // null means "this poll told us nothing" — keep the previous value instead
        // of dropping the bar to zero on a transient failure.
        let currentProgress: number | null = null;
        let datasetInfo: { number: number | null; total: number; label: string | null } | null = null;
        let currentDatasetIdx: number | null = null;
        let availableFrames: number[] = [];

        if (statusRes.ok) {
          const data = await statusRes.json();
          currentProgress = Math.round(data.percent ?? 0);
          datasetInfo = {
            number: data.dataset_number ?? null,
            total: data.total ?? 0,
            label: data.current_dataset_label ?? null,
          };
          currentDatasetIdx = data.current_dataset_idx ?? null;

          if (data.files && Array.isArray(data.files)) {
            availableFrames = data.files.map((f: string) => {
              const match = f.match(/(\d+)\.mat$/);
              return match ? parseInt(match[1], 10) : null;
            }).filter((n: number | null) => n !== null) as number[];
            availableFrames.sort((a, b) => a - b);
            instantaneousAvailableFramesRef.current = availableFrames;
          }
        } else {
          console.error(`PIV progress poll failed: ${statusRes.status} ${statusRes.statusText}`);
        }

        // Update status image — only when on PIV tab and interval elapsed
        let newStatusImage: StatusImage | null = null; // null means "keep existing"
        const now = Date.now();
        const timeSinceLastUpdate = now - instantaneousLastImageUpdateRef.current;

        if (isOnPivTab && settings.showStatusImage && availableFrames.length > 0 && currentDatasetIdx !== null) {
          if (instantaneousLastImageUpdateRef.current === 0 || timeSinceLastUpdate >= IMAGE_INTERVAL_MS) {
            // Pick a random frame from the available set
            const randomIdx = Math.floor(Math.random() * availableFrames.length);
            const frameToShow = availableFrames[randomIdx];

            const imageParams = new URLSearchParams(params);
            // The preview follows the dataset being written rather than always
            // showing the first one, which is finished for most of a multi-run.
            imageParams.delete('active_paths');
            imageParams.set('basepath_idx', String(currentDatasetIdx));
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

        // Re-checked: the status-image fetch above is another await point.
        if (cancelled) return;

        setInstantaneousJob(prev => {
          const newProgress = currentProgress ?? prev.progress;
          const shouldStopPolling = newProgress >= 100 && !jobRunning;

          if (shouldStopPolling) {
            localStorage.removeItem(STORAGE_KEY_INSTANTANEOUS);
          }

          return {
            ...prev,
            progress: newProgress,
            ...(datasetInfo
              ? {
                  datasetNumber: datasetInfo.number,
                  datasetTotal: datasetInfo.total,
                  datasetLabel: datasetInfo.label,
                }
              : {}),
            // Only update statusImage if we fetched a new one (newStatusImage !== null)
            statusImage: newStatusImage !== null ? newStatusImage : prev.statusImage,
            isPolling: !shouldStopPolling,
          };
        });
      } catch (error) {
        console.error('PIV status poll failed:', error);
        if (cancelled) return;
        setInstantaneousJob(prev => ({
          ...prev,
          statusImage: { src: null, error: 'Polling failed. Check connection.' },
        }));
      }
    };

    // Self-scheduling: a tick slower than the interval cannot stack on the next one.
    const tick = async () => {
      await Promise.all([pollStatus(), pollLogs()]);
      if (!cancelled) timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [instantaneousJob.isPolling, instantaneousJob.jobId, instantaneousJob.activePaths]);

  // Polling effect for ensemble mode.
  // Ensemble progress comes from log scraping (get_ensemble_progress_from_logs), not
  // from counting files, so its percentage is left as-is here. Only the log handling
  // and the now-required active_paths parameter are shared with instantaneous.
  useEffect(() => {
    if (!ensembleJob.isPolling || !ensembleJob.jobId) return;

    const jobId = ensembleJob.jobId;
    const activePaths = ensembleJob.activePaths;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const pollLogs = async () => {
      try {
        const res = await fetch(`/backend/piv_logs?job_id=${jobId}&lines=${LOG_TAIL_LINES}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const newLogs = data.logs || '';
        setEnsembleJob(prev => (prev.logs === newLogs ? prev : { ...prev, logs: newLogs }));
      } catch (error) {
        console.error('Failed to fetch ensemble logs:', error);
      }
    };

    const pollStatus = async () => {
      const settings = ensembleSettingsRef.current;
      const currentTab = activeTabRef.current;
      const isOnPivTab = currentTab === 'instantaneous' || currentTab === 'ensemble';

      try {
        const params = new URLSearchParams({
          active_paths: activePaths.join(','),
          var: settings.varType,
          is_uncalibrated: '1',
        });
        if (settings.cmap !== 'default') params.set('cmap', settings.cmap);
        params.set('job_id', jobId);

        const [statusRes, jobStatusRes] = await Promise.all([
          fetch(`/backend/get_uncalibrated_count?${params.toString()}`),
          fetch(`/backend/piv_status?job_id=${jobId}`),
        ]);

        // See the instantaneous effect: a late commit would land on another job.
        if (cancelled) return;

        let jobRunning = true;
        if (jobStatusRes.ok) {
          const jobStatus = await jobStatusRes.json();
          jobRunning = jobStatus.running ?? true;
        }

        let currentProgress = 0;
        let currentDatasetIdx: number | null = null;
        let availableFrames: number[] = [];
        if (statusRes.ok) {
          const data = await statusRes.json();
          currentProgress = Math.round(data.percent ?? 0);
          // The ensemble payload comes from log scraping and carries no per-dataset
          // position, so this pins the preview to the FIRST selected dataset for the
          // whole run -- it does not follow the dataset actually being written. That
          // matches the pre-2026-08-02 behaviour (which used sourcePathIdx, always 0)
          // and is not a regression, but it is a known gap: giving ensemble a real
          // per-dataset position needs get_ensemble_progress_from_logs to report one.
          currentDatasetIdx = data.current_dataset_idx ?? activePaths[0] ?? null;

          if (data.files && Array.isArray(data.files)) {
            availableFrames = data.files.map((f: string) => {
              const match = f.match(/(\d+)\.mat$/);
              return match ? parseInt(match[1], 10) : null;
            }).filter((n: number | null) => n !== null) as number[];
            availableFrames.sort((a, b) => a - b);
            ensembleAvailableFramesRef.current = availableFrames;
          }
        } else {
          console.error(`Ensemble progress poll failed: ${statusRes.status} ${statusRes.statusText}`);
        }

        // Update status image — only when on PIV tab and interval elapsed
        let newStatusImage: StatusImage | null = null; // null means "keep existing"
        const now = Date.now();
        const timeSinceLastUpdate = now - ensembleLastImageUpdateRef.current;

        if (isOnPivTab && settings.showStatusImage && availableFrames.length > 0 && currentDatasetIdx !== null) {
          if (ensembleLastImageUpdateRef.current === 0 || timeSinceLastUpdate >= IMAGE_INTERVAL_MS) {
            // Pick a random frame from the available set
            const randomIdx = Math.floor(Math.random() * availableFrames.length);
            const frameToShow = availableFrames[randomIdx];

            const imageParams = new URLSearchParams(params);
            imageParams.delete('active_paths');
            imageParams.set('basepath_idx', String(currentDatasetIdx));
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

        // Re-checked: the status-image fetch above is another await point.
        if (cancelled) return;

        setEnsembleJob(prev => {
          const newProgress = Math.max(prev.progress, currentProgress);
          const shouldStopPolling = newProgress >= 100 && !jobRunning;

          if (shouldStopPolling) {
            localStorage.removeItem(STORAGE_KEY_ENSEMBLE);
          }

          return {
            ...prev,
            progress: newProgress,
            // Only update statusImage if we fetched a new one (newStatusImage !== null)
            statusImage: newStatusImage !== null ? newStatusImage : prev.statusImage,
            isPolling: !shouldStopPolling,
          };
        });
      } catch (error) {
        console.error('Ensemble status poll failed:', error);
        if (cancelled) return;
        setEnsembleJob(prev => ({
          ...prev,
          statusImage: { src: null, error: 'Polling failed. Check connection.' },
        }));
      }
    };

    const tick = async () => {
      await Promise.all([pollStatus(), pollLogs()]);
      if (!cancelled) timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [ensembleJob.isPolling, ensembleJob.jobId, ensembleJob.activePaths]);

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
      datasetNumber: null,
      datasetTotal: 0,
      datasetLabel: null,
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
        activePaths: settings.activePaths,
      };
      localStorage.setItem(storageKey, JSON.stringify(storedData));

      setJob(prev => ({
        ...prev,
        jobId,
        isLoading: false,
        isPolling: true,
        // Snapshot: the job's denominator must not follow later checkbox changes.
        activePaths: settings.activePaths,
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
        datasetNumber: null,
        datasetTotal: 0,
        datasetLabel: null,
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
    setJob({ ...defaultJobState });
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
