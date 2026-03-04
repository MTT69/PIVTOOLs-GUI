"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
// ...no direct button usage; kept minimal imports
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import ColormapSelect from "@/components/shared/ColormapSelect";
// useRef is imported above with React

interface PODProps {
  config?: any;
  updateConfig?: (path: string[], value: any) => void;
}

export default function POD({ config, updateConfig }: PODProps) {
  const [basePaths, setBasePaths] = useState<string[]>(() => {
    try { return JSON.parse(typeof window !== "undefined" ? localStorage.getItem("piv_base_paths") || "[]" : "[]"); } catch { return []; }
  });
  const [basePathIdx, setBasePathIdx] = useState<number>(0);
  
  // Derive camera options robustly from config.paths.camera_numbers or imProperties.cameraCount
  const cameraOptions = useMemo(() => {
    const camNums = config?.paths?.camera_numbers;
    const imCount = config?.imProperties?.cameraCount;
    let count = 1;
    if (Array.isArray(camNums)) {
      if (camNums.length === 1) {
        const maybe = Number(camNums[0]);
        if (!Number.isNaN(maybe) && maybe > 0) count = maybe;
      } else if (camNums.length > 1) {
        count = camNums.length;
      }
    } else if (typeof imCount === 'number' && Number.isFinite(imCount) && imCount > 0) {
      count = imCount;
    }
    return Array.from({ length: Math.max(1, Math.floor(count)) }, (_, i) => String(i + 1));
  }, [config]);

  const [camera, setCamera] = useState<string>(() => (cameraOptions && cameraOptions.length > 0 ? cameraOptions[0] : "1"));
  
  // Ensure camera state reflects available options when config changes
  useEffect(() => {
    if (cameraOptions.length === 0) return;
    if (!cameraOptions.includes(camera)) setCamera(cameraOptions[0] || "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOptions.join(',')]);

  // merged data toggle (next to camera)
  const [merged, setMerged] = useState<boolean>(false);
  const [randomised, setRandomised] = useState<boolean>(false);
  const [normalise, setNormalise] = useState<boolean>(false);
  const [stackUy, setStackUy] = useState<boolean>(false);
  const [kModes, setKModes] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const [progress, setProgress] = useState<number>(0);
  const [processing, setProcessing] = useState<boolean>(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartTimeRef = useRef<number>(0);
  const MAX_POLL_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

  // Visualization-specific state (shown after progress reaches 100)
  const [modeIndex, setModeIndex] = useState<number>(1); // mode number / "frame" for plot endpoints
  const [maxMode, setMaxMode] = useState<number>(Math.max(1, Number(kModes) || 100));
  const [playing, setPlaying] = useState<boolean>(false);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // pending mode during dragging to avoid firing requests on every tick
  const [pendingMode, setPendingMode] = useState<number>(modeIndex);
  const [pointerDownMode, setPointerDownMode] = useState<boolean>(false);
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [type, setType] = useState<string>("ux");
  const [cmap, setCmap] = useState<string>("default");
  const [hasCheckedVars, setHasCheckedVars] = useState<boolean>(false);
  const [runVis, setRunVis] = useState<number>(1);
  const [lower, setLower] = useState<string>("");
  const [upper, setUpper] = useState<string>("");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [frameVars, setFrameVars] = useState<string[] | null>(null);
  const [frameVarsLoading, setFrameVarsLoading] = useState(false);
  const [frameVarsError, setFrameVarsError] = useState<string | null>(null);
  const POLL_INTERVAL_MS = 20000; // 20s as in RunPIV

  // --- Run selection state ---
  const [availableRuns, setAvailableRuns] = useState<number[]>([]);
  const [selectedRun, setSelectedRun] = useState<number>(1);
  const [runHasVars, setRunHasVars] = useState<Record<number, boolean>>({});

  // --- Calibrated data check for selected run ---
  const [runHasCalibratedData, setRunHasCalibratedData] = useState<boolean>(true);
  const [runCheckLoading, setRunCheckLoading] = useState(false);
  const [runCheckError, setRunCheckError] = useState<string | null>(null);

  // --- Available POD runs for current selection (for energy plot after POD) ---
  const [availablePodRuns, setAvailablePodRuns] = useState<number[] | null>(null);
  const [podRunsLoading, setPodRunsLoading] = useState(false);
  const [podRunsError, setPodRunsError] = useState<string | null>(null);
  const [runWarning, setRunWarning] = useState<string | null>(null);

  // --- Energy plot state ---
  const [energyLoading, setEnergyLoading] = useState(false);
  const [energyError, setEnergyError] = useState<string | null>(null);
  const [energyData, setEnergyData] = useState<any>(null);

  // Load existing POD settings from the passed `config` prop (stay in sync when it changes)
  useEffect(() => {
    try {
      const json = config || {};
      const pp = json.post_processing || [];
      const pod = pp.find((e: any) => String(e.type || "").toLowerCase() === "pod");
      const settings = pod?.settings || {};
      if (typeof settings.randomised === "boolean") setRandomised(settings.randomised);
      if (typeof settings.normalise === "boolean") setNormalise(settings.normalise);
      const stackVal =
        typeof settings.stack_u_y === "boolean" ? settings.stack_u_y :
        typeof settings.stack_U_y === "boolean" ? settings.stack_U_y :
        typeof settings.stackUy === "boolean" ? settings.stackUy : undefined;
      if (typeof stackVal === "boolean") setStackUy(stackVal);
      if (typeof settings.k_modes === "number") setKModes(settings.k_modes);
      // also try to initialize basePath/camera from config if present
      if (typeof settings.basepath_idx === "number") setBasePathIdx(settings.basepath_idx);
      if (pod && typeof pod.use_merged === "boolean") setMerged(Boolean(pod.use_merged));
      else if (typeof settings.use_merged === "boolean") setMerged(Boolean(settings.use_merged));
      if (settings.camera) setCamera(String(settings.camera));
    } catch (e) {
      // ignore
    }
  }, [config]);

  // Save one or more fields to backend immediately
  const saveChange = async (payload: any) => {
    setLoading(true);
    try {
      const wrapped = {
        post_processing: [
          {
            type: "POD",
            settings: payload,
          },
        ],
      };
      const res = await fetch("/backend/update_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wrapped),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update POD settings");
      // reflect changes in parent config if provided (update_config returns { updated: ... })
      const updated = json.updated || {};
      if (updateConfig) {
        // prefer backend-echoed post_processing, otherwise mirror our wrapped payload
        updateConfig(["post_processing"], updated.post_processing || wrapped.post_processing);
      }
    } catch (e: any) {
      toast({ title: "Failed to save POD", description: e?.message ?? "Unknown error" });
    } finally {
      setLoading(false);
    }
  };

  const pollOnce = async () => {
    try {
      // Safety timeout: stop polling if exceeded max duration
      if (Date.now() - pollStartTimeRef.current > MAX_POLL_DURATION_MS) {
        stopPolling();
        setProcessing(false);
        return;
      }
      const res = await fetch("/backend/pod_status", { method: "GET", cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const raw = Number(json.status ?? json.progress ?? 0);
      const newProgress = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 100) : 0;
      setProgress((prev) => (newProgress > prev ? newProgress : prev));
      setProcessing(Boolean(json.processing));
      if (!json.processing) stopPolling();
    } catch (e) {
      // silent
    }
  };

  const startPolling = () => {
    stopPolling({ resetProgress: false });
    pollStartTimeRef.current = Date.now();
    pollOnce();
    pollingRef.current = setInterval(pollOnce, POLL_INTERVAL_MS);
  };

  const stopPolling = (options?: { resetProgress?: boolean }) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setProcessing(false);
    if (options?.resetProgress) setProgress(0);
  };

  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current); }, []);

  // --- Check for calibrated data (ux/uy) for selected run ---
  useEffect(() => {
    const checkCalibratedData = async () => {
      setRunCheckLoading(true);
      setRunCheckError(null);
      setRunHasCalibratedData(false);
      try {
        const basePath = getSelectedBasePath();
        if (!basePath) throw new Error("No base path selected");
        const params = new URLSearchParams();
        params.set("base_path", basePath);
        params.set("camera", camera);
        params.set("frame", String(selectedRun));
        params.set("merged", merged ? "1" : "0");
        // Use check_vars to see if ux/uy are present for this run
  const url = `/backend/plot/check_vars?${params.toString()}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed to check data");
  const vars = Array.isArray(json.vars) ? json.vars.map(String) : [];
  const hasUxUy = vars.includes("ux") && vars.includes("uy");
  setRunHasCalibratedData(hasUxUy);
  setRunHasVars(prev => ({ ...prev, [selectedRun]: hasUxUy }));
  if (!hasUxUy) setRunCheckError("No calibrated ux/uy data found for this run.");
      } catch (e: any) {
        setRunHasCalibratedData(false);
        setRunCheckError(e?.message ?? "Unknown error");
      } finally {
        setRunCheckLoading(false);
      }
    };
    checkCalibratedData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRun, basePathIdx, camera, merged, config]);

  // --- Query available POD runs for the selected base/camera/merged (for energy plot) ---
  const getStatsBase = async () => {
    try {
      const basePath = getSelectedBasePath();
      if (!basePath) return null;
      const cfg = config || {};
      let endpoint = "";
      let source_type = "instantaneous";
      try {
        for (const entry of (cfg.post_processing || [])) {
          if (entry.type === "POD") {
            const s = entry.settings || {};
            endpoint = entry.endpoint || s.endpoint || "";
            source_type = entry.source_type || s.source_type || "instantaneous";
            break;
          }
        }
      } catch {}
      return {
        stats_base: `${basePath}/statistics/${cfg.num_images || 1000}/Cam${camera}/${source_type}${endpoint ? "/" + endpoint : ""}`,
      };
    } catch {
      return null;
    }
  };

  // Query available POD runs by checking which run_xx folders exist
  const fetchAvailablePodRuns = async () => {
    setPodRunsLoading(true);
    setPodRunsError(null);
    try {
      const statsInfo = await getStatsBase();
      if (!statsInfo) throw new Error("Could not resolve stats directory");
      const podDirs = [
        `${statsInfo.stats_base}/pod_randomised`,
        `${statsInfo.stats_base}/POD`,
      ];
      let foundRuns: Set<number> = new Set();
      for (const dir of podDirs) {
        for (let i = 1; i <= 10; ++i) {
          const params = new URLSearchParams();
          params.set("base_path", getSelectedBasePath() || "");
          params.set("camera", camera);
          params.set("run", String(i));
          params.set("merged", merged ? "1" : "0");
          const url = `/backend/pod_energy_modes?${params.toString()}`;
          try {
            const res = await fetch(url, { method: "HEAD" });
            if (res.ok) foundRuns.add(i);
          } catch {}
        }
      }
      setAvailablePodRuns(Array.from(foundRuns).sort((a, b) => a - b));
    } catch (e: any) {
      setPodRunsError(e?.message ?? "Failed to list POD runs");
      setAvailablePodRuns(null);
    } finally {
      setPodRunsLoading(false);
    }
  };

  // Fetch available POD runs when base/camera/merged changes or after POD completes
  useEffect(() => {
    void fetchAvailablePodRuns();
  }, [basePathIdx, camera, merged, config]);

  // Populate a sensible list of runs for the run selector (prefer config.instantaneous_runs)
  useEffect(() => {
    // Build the candidate run list from config (same as before), then check each run for calibrated ux/uy data
    let cancelled = false;
    const populateRuns = async () => {
      try {
        const cfg = config || {};
        let candidateRuns: number[] = [];
        if (Array.isArray(cfg.instantaneous_runs) && cfg.instantaneous_runs.length > 0) {
          candidateRuns = cfg.instantaneous_runs.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0);
        } else if (Number.isFinite(Number(cfg.num_images))) {
          const approx = Math.max(1, Math.min(50, Math.floor(Number(cfg.num_images) / 10)));
          candidateRuns = Array.from({ length: approx }, (_, i) => i + 1);
        } else {
          candidateRuns = Array.from({ length: 10 }, (_, i) => i + 1);
        }

        // Optimistically set candidate runs while we check availability
        setAvailableRuns(candidateRuns);

        const basePath = getSelectedBasePath();
        if (!basePath) {
          // no base path -> keep candidate list and reset mapping
          setRunHasVars(prev => {
            const map = { ...prev };
            candidateRuns.forEach(r => { map[r] = false; });
            return map;
          });
          if (!candidateRuns.includes(selectedRun)) setSelectedRun(candidateRuns[0] || 1);
          return;
        }

        const okRuns: number[] = [];
        const hasMap: Record<number, boolean> = {};
        await Promise.all(candidateRuns.map(async (r) => {
          if (cancelled) return;
          try {
            const params = new URLSearchParams();
            params.set("base_path", basePath);
            params.set("camera", camera);
            params.set("frame", String(r));
            params.set("merged", merged ? "1" : "0");
            const url = `/backend/plot/check_vars?${params.toString()}`;
            const res = await fetch(url);
            const json = await res.json();
            const vars = Array.isArray(json.vars) ? json.vars.map(String) : [];
            const hasUxUy = vars.includes("ux") && vars.includes("uy");
            hasMap[r] = hasUxUy;
            if (hasUxUy) okRuns.push(r);
          } catch {
            hasMap[r] = false;
          }
        }));

        if (cancelled) return;
        // update mapping and availableRuns to only those with calibrated data (or fall back to candidateRuns if none)
        setRunHasVars(prev => ({ ...prev, ...hasMap }));
        if (okRuns.length > 0) {
          okRuns.sort((a, b) => a - b);
          setAvailableRuns(okRuns);
          // default to highest available run if current isn't available
          setSelectedRun(prev => okRuns.includes(prev) ? prev : okRuns[okRuns.length - 1]);
        } else {
          // No runs with calibrated ux/uy found; keep candidateRuns so user can still pick but mark as no-data via runHasVars
          setAvailableRuns(candidateRuns);
          if (!candidateRuns.includes(selectedRun)) setSelectedRun(candidateRuns[0] || 1);
        }
      } catch {
        // on error fallback to a single run
        setAvailableRuns([1]);
        setSelectedRun(1);
      }
    };
    void populateRuns();
    return () => { cancelled = true; };
  // also re-run when basePaths change so availability is checked once localStorage paths are loaded/updated
  }, [config, basePaths, basePathIdx, camera, merged]);

  // Warn if selected run is not available
  useEffect(() => {
    if (!availablePodRuns) {
      setRunWarning(null);
      return;
    }
    if (!availablePodRuns.includes(selectedRun)) {
      setRunWarning(`Warning: Run ${selectedRun} has no POD data. Please select a run with data.`);
    } else {
      setRunWarning(null);
    }
  }, [availablePodRuns, selectedRun]);

  // --- Update handleStartPOD to use selectedRun and block if not available ---
  const handleStartPOD = async () => {
    if (!runHasCalibratedData) return;
    setLoading(true);
    setProgress(0);
    try {
      const selectedBasePath = (Array.isArray(basePaths) && basePaths.length > 0 && basePathIdx >= 0 && basePathIdx < basePaths.length)
        ? basePaths[basePathIdx]
        : null;
      const payload: any = {
        basepath_idx: basePathIdx,
        base_path: selectedBasePath,
        camera,
        instantaneous_runs: [selectedRun],
      };
      const res = await fetch("/backend/start_pod", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`Failed to start POD: ${res.statusText}`);
      await res.json().catch(() => ({}));
      setProcessing(true);
      startPolling();
    } catch (e: any) {
      toast({ title: "Failed to start POD", description: e?.message ?? "Unknown error" });
    } finally { setLoading(false); }
  };

  const handleCancelPOD = async () => {
    setLoading(true);
    try {
      const res = await fetch("/backend/cancel_pod", { method: "POST" });
      if (!res.ok) throw new Error(`Failed to cancel POD: ${res.statusText}`);
      await res.json().catch(() => ({}));
      stopPolling({ resetProgress: true });
      setProcessing(false);
    } catch (e: any) {
      toast({ title: "Failed to cancel POD", description: e?.message ?? "Unknown error" });
    } finally { setLoading(false); }
  };

  // Keep maxMode in sync with kModes when available
  useEffect(() => {
    if (typeof kModes === "number" && kModes > 0) {
      setMaxMode(kModes);
      if (modeIndex > kModes) setModeIndex(kModes);
    }
  }, [kModes]);

  // Helper to get selected base path
  const getSelectedBasePath = () => {
    return (Array.isArray(basePaths) && basePaths.length > 0 && basePathIdx >= 0 && basePathIdx < basePaths.length)
      ? basePaths[basePathIdx]
      : null;
  };

  // Fetch variables available for a given mode/frame (plot/check_vars)
  const fetchFrameVars = async (mode = modeIndex) => {
    setFrameVarsLoading(true);
    setFrameVarsError(null);
    try {
      const basePath = getSelectedBasePath();
      if (!basePath) throw new Error("Please select a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", String(mode));
      params.set("camera", camera);
      params.set("merged", merged ? "1" : "0");
      const url = `/backend/plot/check_vars?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch vars (${res.status})`);
      const vars = Array.isArray(json.vars) ? json.vars.map(String) : [];
      setFrameVars(vars);
      if (vars.length > 0) setType(prev => (vars.includes(prev) ? prev : vars[0]));
      // mark that we've checked vars at least once successfully
      setHasCheckedVars(true);
    } catch (e: any) {
      setFrameVarsError(e?.message ?? "Unknown error");
      setFrameVars(null);
    } finally {
      setFrameVarsLoading(false);
    }
  };

  // Fetch visualization image via plot/plot_vector
  const fetchImage = async (mode = modeIndex) => {
    setLoadingImage(true);
    try {
      const basePath = getSelectedBasePath();
      if (!basePath) throw new Error("Please select a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("frame", String(mode)); // using mode as 'frame' for plot endpoint
      params.set("var", type);
      params.set("cmap", cmap);
      if (runVis && runVis > 0) params.set("run", String(runVis));
      if (lower.trim() !== "") params.set("lower_limit", String(Number(lower)));
      if (upper.trim() !== "") params.set("upper_limit", String(Number(upper)));
      params.set("camera", camera);
      params.set("merged", merged ? "1" : "0");
      const url = `/backend/plot/plot_vector?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed to fetch plot (${res.status})`);
      setImageSrc(json.image ?? null);
      setMeta(json.meta ?? null);
    } catch (e: any) {
      toast({ title: "Visualization error", description: e?.message ?? "Unknown error" });
      setImageSrc(null);
      setMeta(null);
    } finally {
      setLoadingImage(false);
    }
  };

  // auto-fetch vars when modeIndex or base selection changes (only once POD completed)
  useEffect(() => {
    if (progress < 100) return;
    const basePath = getSelectedBasePath();
    if (!basePath) return;
    // only call check_vars automatically if we haven't done so yet
    if (!hasCheckedVars) void fetchFrameVars(modeIndex);
  }, [modeIndex, basePathIdx, camera, merged, progress, hasCheckedVars]);

  // Auto-render whenever mode, type, or colormap change (after POD finished).
  useEffect(() => {
    if (progress < 100) return;
    const basePath = getSelectedBasePath();
    if (!basePath) return;
    let cancelled = false;
    const doAutoRender = async () => {
      try {
        // Call check_vars only if we haven't done it yet; afterwards just fetch image
        if (!hasCheckedVars) {
          await fetchFrameVars(modeIndex);
          if (cancelled) return;
        }
        await fetchImage(modeIndex);
      } catch {
        // silent - fetchFrameVars/fetchImage already surface errors via toast/state
      }
    };
    void doAutoRender();
    return () => { cancelled = true; };
  // include modeIndex, type and cmap so changes auto-render
  }, [modeIndex, type, cmap, basePathIdx, camera, merged, progress, hasCheckedVars]);

  // Play/pause handling for modes
  useEffect(() => {
    if (playing) {
      playIntervalRef.current = setInterval(() => {
        setModeIndex(i => {
          if (i < maxMode) return i + 1;
          // stop if at end
          setPlaying(false);
          return i;
        });
      }, 400);
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
  }, [playing, maxMode]);

  // keep pendingMode in sync when modeIndex is changed programmatically
  useEffect(() => {
    setPendingMode(modeIndex);
  }, [modeIndex]);
  
  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (commitTimeoutRef.current) {
        clearTimeout(commitTimeoutRef.current);
        commitTimeoutRef.current = null;
      }
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, []);

  // Energy plot component selection state
  const [energyComponent, setEnergyComponent] = useState<string>("ux");

  // Fetch cumulative energy breakdown after POD completes, for selected run
  const fetchEnergyData = async () => {
    setEnergyLoading(true);
    setEnergyError(null);
    try {
      const basePath = getSelectedBasePath();
      if (!basePath) throw new Error("Please select a base path");
      const params = new URLSearchParams();
      params.set("base_path", basePath);
      params.set("camera", camera);
      params.set("run", String(runVis));
      params.set("merged", merged ? "1" : "0");
      const url = `/backend/pod_energy_modes?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to fetch POD energy");
      setEnergyData(json);
      // Set maxMode from energy data if available
      if (json.stacked && Array.isArray(json.energy_fraction)) {
        setMaxMode(json.energy_fraction.length);
      } else if (!json.stacked && Array.isArray(json.energy_fraction_ux)) {
        setMaxMode(Math.max(json.energy_fraction_ux.length, json.energy_fraction_uy?.length || 0));
      }
    } catch (e: any) {
      setEnergyError(e?.message ?? "Unknown error");
      setEnergyData(null);
    } finally {
      setEnergyLoading(false);
    }
  };

  // Fetch energy data after POD completes and processing is false, and only for selected run
  useEffect(() => {
    if (progress < 100 || processing) return;
    if (!selectedRun) return;
    void fetchEnergyData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, processing, basePathIdx, camera, merged, selectedRun]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="items-start">
          <CardTitle className="text-left">Proper Orthogonal Decomposition (POD)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-white rounded-xl shadow p-4 mb-4">
            <div className="space-y-4">
              {/* Base path selection */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Base Path:</label>
                {basePaths.length > 0 ? (
                  <select
                    value={String(basePathIdx)}
                    onChange={e => {
                      const idx = Number(e.target.value);
                      setBasePathIdx(idx);
                      // persist selection to backend so it can be remembered
                      saveChange({ basepath_idx: idx });
                    }}
                    className="border rounded px-2 py-1"
                  >
                    {basePaths.map((p, i) => {
                      const norm = p.replace(/\\/g, "/").replace(/\/+$|\\$/g, "");
                      const parts = norm.split("/").filter(Boolean);
                      const lastTwo = parts.length >= 2 ? parts.slice(-2).join("/") : norm;
                      return <option key={i} value={i}>{`${i}: /${lastTwo}`}</option>;
                    })}
                  </select>
                ) : (
                  <Input type="text" value="No base paths" readOnly className="w-full" />
                )}
              </div>

              {/* Camera selection - updated to use dynamic options */}
              <div className="flex items-center gap-4">
                <label htmlFor="camera" className="text-sm font-medium">Camera:</label>
                <select
                  id="camera"
                  value={camera}
                  onChange={e => {
                    const val = e.target.value;
                    setCamera(val);
                    // persist preferred camera for POD settings
                    const num = Number(val);
                    if (Number.isFinite(num)) saveChange({ camera: num });
                  }}
                  className="border rounded px-2 py-1"
                >
                  {cameraOptions.map((cam: string) => (
                    <option key={cam} value={cam}>Camera {cam}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm font-medium ml-2">
                  <input
                    type="checkbox"
                    checked={merged}
                    onChange={e => {
                      const v = e.target.checked;
                      setMerged(v);
                      // persist as part of POD settings; backend supports either entry-level or settings
                      saveChange({ use_merged: v });
                    }}
                    className="accent-soton-blue w-4 h-4 rounded border-gray-300"
                  />
                  Merged Data
                </label>
                {/* Run selection */}
                <label className="text-sm font-medium ml-4">Run:</label>
                <select
                  value={selectedRun}
                  onChange={e => setSelectedRun(Number(e.target.value))}
                  className="border rounded px-2 py-1"
                  disabled={runCheckLoading}
                >
                  {availableRuns.map(r => (
                    <option key={r} value={r} disabled={runHasVars[r] === false}>
                      {r}{runHasVars[r] === false ? ' (no ux/uy)' : ''}
                    </option>
                  ))}
                </select>
                {runCheckLoading && <span className="text-xs text-gray-500 ml-2">Checking data...</span>}
                {runCheckError && (
                  <span className="text-xs text-red-600 ml-2">{runCheckError}</span>
                )}
              </div>

              <div className="flex items-center gap-4">
                <div className="w-2/3 flex flex-col justify-center">
                  <label className="text-sm font-medium">Number of modes (k_modes)</label>
                  <div className="text-xs text-gray-500">Minimum 1</div>
                </div>
                <div className="w-1/3 text-right">
                  <Input
                    type="text" inputMode="numeric"
                    min={1}
                    max={99999}
                    // visually limit to ~5 digits
                    className="w-20 inline-block"
                    value={kModes}
                    onChange={e => {
                      const raw = e.target.value;
                      if (raw === "") {
                        setKModes("");
                        // don't save empty to avoid forcing zero modes
                        return;
                      }
                      let nm = Number(raw);
                      if (!Number.isFinite(nm)) nm = 1;
                      nm = Math.max(1, Math.floor(nm));
                      setKModes(nm);
                      saveChange({ k_modes: nm });
                    }}
                  />
                </div>
              </div>

              {/* Always-visible switches that update backend config */}
              <div className="flex items-center gap-4">
                <div className="w-2/3">
                  <div className="text-sm font-medium">Randomised</div>
                  <div className="text-xs text-gray-500">Randomise snapshot order before decomposition</div>
                </div>
                <div className="w-1/3 text-right">
                  <Switch
                    checked={randomised}
                    onCheckedChange={(v: any) => {
                      setRandomised(Boolean(v));
                      saveChange({ randomised: Boolean(v) });
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-2/3">
                  <div className="text-sm font-medium">Normalise</div>
                  <div className="text-xs text-gray-500">Normalise snapshots prior to decomposition</div>
                </div>
                <div className="w-1/3 text-right">
                  <Switch
                    checked={normalise}
                    onCheckedChange={(v: any) => {
                      setNormalise(Boolean(v));
                      saveChange({ normalise: Boolean(v) });
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-2/3">
                  <div className="text-sm font-medium">Stack U/Y</div>
                  <div className="text-xs text-gray-500">Stack U and Y components instead of separate decompositions</div>
                </div>
                <div className="w-1/3 text-right">
                  <Switch
                    checked={stackUy}
                    onCheckedChange={(v: any) => {
                      setStackUy(Boolean(v));
                      saveChange({ stack_u_y: Boolean(v) });
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 mb-4">
            <div className="flex flex-col gap-2">
              <Progress value={progress} className="w-full" />
            </div>

            <div className="flex items-center justify-center gap-4 mt-4">
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={handleStartPOD}
                disabled={loading || processing || !runHasCalibratedData}
              >
                {loading ? "Starting..." : (processing ? "Running..." : "Start POD")}
              </Button>
              <Button className="bg-red-600 hover:bg-red-700" onClick={handleCancelPOD} disabled={loading || !processing}>
                {loading ? "Canceling..." : "Cancel POD"}
              </Button>
            </div>
          </div>

          {/* Visualization controls appear only after POD progress completes - moved below buttons */}
          {progress >= 100 && (
            <div className="bg-white rounded-xl shadow p-4 mb-4">
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium">Mode:</label>
                  <select
                    value={String(modeIndex)}
                    onChange={e => setModeIndex(Math.max(1, Number(e.target.value)))}
                    className="border rounded px-2 py-1"
                  >
                    {Array.from({ length: Math.max(1, maxMode) }, (_, i) => i + 1).map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <input
                    type="range"
                    min={1}
                    max={Math.max(1, maxMode)}
                    value={pendingMode}
                    onChange={e => {
                      const v = Math.max(1, Number(e.target.value));
                      setPendingMode(v);
                      // if not dragging, commit (covers clicks); debounce small to coalesce events
                      if (!pointerDownMode) {
                        if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
                        commitTimeoutRef.current = setTimeout(() => {
                          setModeIndex(v);
                          commitTimeoutRef.current = null;
                        }, 80);
                      }
                    }}
                    onPointerDown={() => {
                      setPointerDownMode(true);
                      if (commitTimeoutRef.current) { clearTimeout(commitTimeoutRef.current); commitTimeoutRef.current = null; }
                    }}
                    onPointerUp={() => {
                      setPointerDownMode(false);
                      if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
                      commitTimeoutRef.current = setTimeout(() => {
                        setModeIndex(pendingMode);
                        commitTimeoutRef.current = null;
                      }, 20);
                    }}
                    className="w-48"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPlaying(p => !p)}
                      className="px-3 py-1 rounded border bg-white hover:bg-gray-50"
                      aria-pressed={playing}
                    >
                      {playing ? <span>&#10073;&#10073; Pause</span> : <span>&#9654; Play</span>}
                    </button>
                    <span className="text-xs text-gray-500">{modeIndex}/{Math.max(1, maxMode)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-sm font-medium">Type:</label>
                  <select value={type} onChange={e => setType(e.target.value)} className="border rounded px-2 py-1">
                    {frameVarsLoading ? (
                      <option>Loading...</option>
                    ) : frameVars && frameVars.length > 0 ? (
                      frameVars.map(v => <option key={v} value={v}>{v}</option>)
                    ) : (
                      <>
                        <option value="ux">ux</option>
                        <option value="uy">uy</option>
                      </>
                    )}
                  </select>

                  <label className="text-sm font-medium">Colormap:</label>
                  <ColormapSelect
                    value={cmap}
                    onValueChange={setCmap}
                    className="w-32"
                  />

                  <label className="text-sm font-medium">Run:</label>
                  <Input type="text" inputMode="numeric" min={1} value={runVis} onChange={e => setRunVis(Math.max(1, Number(e.target.value)))} className="w-24" />
                  <label className="text-sm font-medium">Lower:</label>
                  <Input type="text" inputMode="numeric" value={lower} onChange={e => setLower(e.target.value)} placeholder="auto" className="w-28" />
                  <label className="text-sm font-medium">Upper:</label>
                  <Input type="text" inputMode="numeric" value={upper} onChange={e => setUpper(e.target.value)} placeholder="auto" className="w-28" />

                  <Button
                    className="bg-soton-blue"
                    onClick={async () => {
                      // ensure check_vars is run at least once; skip on subsequent renders
                      if (!hasCheckedVars) await fetchFrameVars(modeIndex);
                      await fetchImage(modeIndex);
                    }}
                    disabled={loadingImage || frameVarsLoading}
                  >
                    {(loadingImage || frameVarsLoading) ? "Loading..." : "Render"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* After POD, show available runs and warning if needed */}
          {progress >= 100 && (
            <div className="mb-4">
              {podRunsLoading && <div className="text-xs text-gray-500">Checking available POD runs...</div>}
              {podRunsError && <div className="text-xs text-red-500">{podRunsError}</div>}
              {availablePodRuns && (
                <div className="flex items-center gap-4 mb-2">
                  <label className="text-sm font-medium">Available POD Runs:</label>
                  <select
                    value={runVis}
                    onChange={e => setRunVis(Number(e.target.value))}
                    className="border rounded px-2 py-1"
                  >
                    {availablePodRuns.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  {runWarning && (
                    <span className="text-xs text-red-600">{runWarning}</span>
                  )}
                </div>
              )}
              {runWarning && !availablePodRuns && (
                <div className="text-xs text-red-600">{runWarning}</div>
              )}
            </div>
          )}

          {/* Energy plot after POD completion, only if energyData exists and not processing */}
          {progress >= 100 && !processing && energyData && (
            <div className="bg-white rounded-xl shadow p-4 mb-4">
              {energyLoading && <div className="text-xs text-gray-500">Loading energy breakdown...</div>}
              {energyError && <div className="text-xs text-red-500">{energyError}</div>}
              <EnergyPlot
                data={energyData}
                component={energyComponent}
                onComponentChange={setEnergyComponent}
                downloadUrl={`/backend/pod_energy_png?base_path=${encodeURIComponent(getSelectedBasePath() || '')}&camera=${encodeURIComponent(String(camera))}&run=${encodeURIComponent(String(runVis))}&merged=${encodeURIComponent(merged ? '1' : '0')}`}
              />
            </div>
          )}

          {/* Visualization image area (shown when an image is available and POD finished) */}
          {progress >= 100 && (
            <div className="mt-4">
              {imageSrc ? (
                <div className="flex flex-col items-center relative">
                  <img src={`data:image/png;base64,${imageSrc}`} alt="POD Vector" className="rounded border w-full max-w-3xl" />
                  {loadingImage && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60">
                      <span className="text-gray-500">Rendering...</span>
                    </div>
                  )}
                  {meta && <div className="text-xs text-gray-500 mt-2">Run: {meta.run} • Var: {meta.var}</div>}
                </div>
              ) : (
                <div className="w-full h-48 flex items-center justify-center bg-gray-100 border rounded">
                  <span className="text-gray-500">No visualization loaded</span>
                </div>
              )}
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}

// Minimal EnergyPlot placeholder
function EnergyPlot({
  data,
  component,
  onComponentChange,
  downloadUrl,
}: {
  data: any;
  component: string;
  onComponentChange: (c: string) => void;
  downloadUrl?: string;
}) {
  // Example: show available modes and cumulative energy if present
  if (!data) return null;
  let ef: number[] = [];
  let ec: number[] = [];
  if (data.stacked) {
    ef = data.energy_fraction || [];
    ec = data.energy_cumulative || [];
  } else if (component === "ux") {
    ef = data.energy_fraction_ux || [];
    ec = data.energy_cumulative_ux || [];
  } else {
    ef = data.energy_fraction_uy || [];
    ec = data.energy_cumulative_uy || [];
  }
  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <span className="font-medium text-sm">Cumulative Energy Breakdown</span>
        {!data.stacked && (
          <select
            value={component}
            onChange={e => onComponentChange(e.target.value)}
            className="border rounded px-2 py-1 text-xs"
          >
            <option value="ux">ux</option>
            <option value="uy">uy</option>
          </select>
        )}
      </div>
      <div className="text-xs text-gray-500 mb-2">
        {ef.length > 0 && (
          <span>
            Mode 1: {(ef[0] * 100).toFixed(1)}% | Mode {ef.length}: {(ec[ef.length - 1] * 100).toFixed(1)}% total
          </span>
        )}
      </div>
      {/* Inline SVG cumulative plot */}
      {ec.length > 0 && (
        <div className="w-full max-w-md">
          <svg viewBox={`0 0 300 120`} width="100%" height="120" className="border rounded">
            <rect x="0" y="0" width="300" height="120" fill="#fff" />
            {/* grid lines */}
            {[0, .25, .5, .75, 1].map((g, i) => (
              <line key={i} x1={40} x2={280} y1={10 + (1 - g) * 90} y2={10 + (1 - g) * 90} stroke="#eee" />
            ))}
            {/* axes */}
            <line x1={40} y1={10} x2={40} y2={100} stroke="#333" />
            <line x1={40} y1={100} x2={280} y2={100} stroke="#333" />
            {/* polyline */}
            {(() => {
              const points = ec.map((v, i) => {
                const x = 40 + (i / Math.max(1, ec.length - 1)) * 240;
                const y = 10 + (1 - Math.min(1, Math.max(0, v))) * 90;
                return `${x},${y}`;
              }).join(" ");
              return <polyline points={points} fill="none" stroke="#1f77b4" strokeWidth={2} />;
            })()}
          </svg>
          {downloadUrl && (
            <div className="mt-2 text-xs">
              <a className="text-soton-blue underline" href={downloadUrl} target="_blank" rel="noreferrer">Download cumulative energy PNG</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}