"use client";

/**
 * Calibration apply jobs that outlive the tab that started them.
 *
 * Radix `TabsContent` unmounts inactive tabs, so a job id held in a tab hook was lost on every
 * tab switch while the backend job kept running. This provider sits above the tabs (beside
 * `PivJobProvider` in `app/page.tsx`) and owns every calibration apply job:
 *
 *   - one job per *slot* (board + calibration source + cameras + target datasets), keyed by
 *     {@link slotKey}. Slots sharing board, source and cameras form a *family* (one tab's apply
 *     action): applying to dataset b while dataset a runs is a different slot, so both run;
 *   - polled here, so progress continues while the tab is hidden;
 *   - persisted to localStorage, so a page reload resumes polling (same pattern and 24 h
 *     cutoff as `PivJobContext`);
 *   - cancellable through `POST /calibration/apply/cancel/<job_id>`.
 *
 * Starting a job while its slot is running is refused here; the backend's overlap guard in
 * `apply_model` (jobs whose output directories overlap) is the authority, and its refusal is shown
 * as the new slot's failed status.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { ApiError, errorMessage, fetchJson, postJson } from "@/lib/api";
import { ApplyJobStatus, isApplyJobActive, readApplyJobStatus } from "@/lib/applyJob";

const POLL_INTERVAL_MS = 1000;
const STALE_JOB_HOURS = 24;
const STORAGE_KEY = "pivtools_calibration_jobs";

/** Which model a job applies: the board's model for one calibration source and camera set. */
export interface CalibrationJobFamily {
  board: string;
  sourcePathIdx: number;
  /** Stereo pair, or empty for a mono apply (the backend applies every camera of the board). */
  cameras?: number[];
}

/** One apply job: a family's model applied to these datasets. */
export interface CalibrationJobSlot extends CalibrationJobFamily {
  /** Indices into `paths.base_paths`, sorted ascending; sent as the request's `active_paths`. */
  datasets: number[];
}

/** A family member that has run this session: its target datasets and latest state. */
export interface CalibrationFamilyJob {
  datasets: number[];
  status: ApplyJobStatus;
  /** True between the cancel request and the backend reporting the job settled. */
  cancelRequested: boolean;
  /** Why the last cancel request failed. */
  cancelError: string | null;
}

interface SlotState {
  jobId: string | null;
  status: ApplyJobStatus | null;
  /** True between the cancel request and the backend reporting the job settled. */
  cancelRequested: boolean;
  /** Why the last cancel request failed; cleared by the next request or a new job. */
  cancelError: string | null;
}

interface StoredJob {
  jobId: string;
  timestamp: number;
}

interface CalibrationJobContextType {
  /** Every slot of the family that has a status this session, in first-start order. */
  jobsFor: (family: CalibrationJobFamily) => CalibrationFamilyJob[];
  /** POST `/calibration/apply` with `payload` and poll the job under `slot`. */
  startApply: (slot: CalibrationJobSlot, payload: Record<string, unknown>) => Promise<void>;
  /** Ask the backend to stop the slot's running job; polling reports the final state. */
  cancelApply: (slot: CalibrationJobSlot) => Promise<void>;
}

const CalibrationJobContext = createContext<CalibrationJobContextType | null>(null);

/** Stable identity of a family: board, source index and the (ordered as given) cameras. */
function familyKey(family: CalibrationJobFamily): string {
  return `${family.board}|${family.sourcePathIdx}|${(family.cameras ?? []).join(",")}`;
}

/** Stable identity of a slot: its family key, then the target datasets. */
export function slotKey(slot: CalibrationJobSlot): string {
  return `${familyKey(slot)}|${slot.datasets.join(",")}`;
}

function failedStatus(error: string): ApplyJobStatus {
  return { status: "failed", progress: 0, processed_units: 0, total_units: 0, error };
}

function readStored(): Record<string, StoredJob> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StoredJob>) : {};
  } catch (e) {
    console.error("Unreadable stored calibration jobs; discarding:", errorMessage(e));
    localStorage.removeItem(STORAGE_KEY);
    return {};
  }
}

function writeStored(jobs: Record<string, StoredJob>): void {
  if (Object.keys(jobs).length === 0) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

function storeJob(key: string, jobId: string): void {
  writeStored({ ...readStored(), [key]: { jobId, timestamp: Date.now() } });
}

function forgetJob(key: string): void {
  const jobs = readStored();
  delete jobs[key];
  writeStored(jobs);
}

export function useCalibrationJobs(): CalibrationJobContextType {
  const ctx = useContext(CalibrationJobContext);
  if (!ctx) throw new Error("useCalibrationJobs must be used within a CalibrationJobProvider");
  return ctx;
}

export function CalibrationJobProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Record<string, SlotState>>({});
  // Mirror for the poll loop and the start guard, which must not read a stale closure.
  const slotsRef = useRef(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  const setSlot = useCallback((key: string, patch: Partial<SlotState>) => {
    setSlots(prev => {
      const base: SlotState = prev[key] ?? { jobId: null, status: null, cancelRequested: false, cancelError: null };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  }, []);

  // One status read for a slot. Settled jobs are dropped from storage; an unknown job id
  // (backend restarted, in-memory registry gone) is shown as failed, never silently cleared.
  const pollOnce = useCallback(async (key: string, jobId: string) => {
    try {
      const data = await fetchJson(`/backend/calibration/apply/status/${jobId}`);
      if (slotsRef.current[key]?.jobId !== jobId) return; // superseded by a newer job
      const status = readApplyJobStatus(data);
      const settled = !isApplyJobActive(status);
      setSlot(key, { status, ...(settled ? { cancelRequested: false } : {}) });
      if (settled) forgetJob(key);
    } catch (e) {
      if (slotsRef.current[key]?.jobId !== jobId) return;
      const msg = e instanceof ApiError && e.status === 404
        ? `Apply job ${jobId} is no longer known to the backend (was it restarted?). Check the output before re-running.`
        : `Lost contact with apply job ${jobId}: ${errorMessage(e)}`;
      setSlot(key, { status: failedStatus(msg), cancelRequested: false });
      forgetJob(key);
    }
  }, [setSlot]);

  // Single poll loop over every active slot.
  const hasActive = Object.values(slots).some(s => s.jobId && s.status && isApplyJobActive(s.status));
  useEffect(() => {
    if (!hasActive) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const active = Object.entries(slotsRef.current).filter(
        ([, s]) => s.jobId && s.status && isApplyJobActive(s.status),
      );
      await Promise.all(active.map(([key, s]) => pollOnce(key, s.jobId as string)));
      if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasActive, pollOnce]);

  // Resume jobs persisted by an earlier page load.
  useEffect(() => {
    const stored = readStored();
    const fresh: Record<string, StoredJob> = {};
    for (const [key, job] of Object.entries(stored)) {
      const hours = (Date.now() - job.timestamp) / (1000 * 60 * 60);
      if (hours <= STALE_JOB_HOURS) fresh[key] = job;
    }
    writeStored(fresh);
    for (const [key, job] of Object.entries(fresh)) {
      // 'starting' marks the slot active so the poll loop picks it up and reads the real state.
      setSlot(key, {
        jobId: job.jobId,
        status: { status: "starting", progress: 0, processed_units: 0, total_units: 0 },
        cancelRequested: false,
        cancelError: null,
      });
    }
  }, [setSlot]);

  const jobsFor = useCallback((family: CalibrationJobFamily): CalibrationFamilyJob[] => {
    const prefix = `${familyKey(family)}|`;
    const out: CalibrationFamilyJob[] = [];
    for (const [key, s] of Object.entries(slots)) {
      if (!key.startsWith(prefix) || !s.status) continue;
      out.push({
        datasets: key.slice(prefix.length).split(",").map(Number),
        status: s.status,
        cancelRequested: s.cancelRequested,
        cancelError: s.cancelError,
      });
    }
    return out;
  }, [slots]);

  const startApply = useCallback(async (slot: CalibrationJobSlot, payload: Record<string, unknown>) => {
    const key = slotKey(slot);
    const current = slotsRef.current[key]?.status;
    if (current && isApplyJobActive(current)) return; // one job per slot; button is disabled too
    setSlot(key, {
      jobId: null,
      status: { status: "starting", progress: 0, processed_units: 0, total_units: 0 },
      cancelRequested: false,
      cancelError: null,
    });
    try {
      const data = await postJson("/backend/calibration/apply", payload);
      if (!data.job_id) {
        setSlot(key, { status: failedStatus(data.error || "Apply did not start (no job id returned)") });
        return;
      }
      storeJob(key, data.job_id);
      setSlot(key, { jobId: data.job_id });
    } catch (e) {
      setSlot(key, { status: failedStatus(errorMessage(e)) });
    }
  }, [setSlot]);

  const cancelApply = useCallback(async (slot: CalibrationJobSlot) => {
    const key = slotKey(slot);
    const jobId = slotsRef.current[key]?.jobId;
    if (!jobId) return;
    setSlot(key, { cancelRequested: true, cancelError: null });
    try {
      await postJson(`/backend/calibration/apply/cancel/${jobId}`, {});
    } catch (e) {
      setSlot(key, { cancelRequested: false, cancelError: `Cancel failed: ${errorMessage(e)}` });
    }
  }, [setSlot]);

  return (
    <CalibrationJobContext.Provider value={{ jobsFor, startApply, cancelApply }}>
      {children}
    </CalibrationJobContext.Provider>
  );
}
