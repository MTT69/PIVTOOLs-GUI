import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * One debounced write that is FLUSHED, never dropped.
 *
 * `schedule(run)` replaces any pending task and runs it after `delayMs`. `flush()` runs the
 * pending task now and returns its promise (resolved at once when nothing is pending), so a
 * caller can wait for it to land. The pending task also runs on unmount, so an edit made just
 * before a tab switch (Radix unmounts the tab) still reaches the backend. `run(followUp)` receives
 * `followUp = false` when flushed on unmount so it can skip work that only matters to a
 * mounted UI (re-validation, state updates).
 */
export function useDebouncedTask(delayMs: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<((followUp: boolean) => Promise<void>) | null>(null);

  const runPending = useCallback((followUp: boolean): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const run = pending.current;
    pending.current = null;
    return run ? run(followUp) : Promise.resolve();
  }, []);

  const schedule = useCallback((run: (followUp: boolean) => Promise<void>) => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = run;
    timer.current = setTimeout(() => { void runPending(true); }, delayMs);
  }, [delayMs, runPending]);

  const flush = useCallback(() => runPending(true), [runPending]);

  useEffect(() => () => { void runPending(false); }, [runPending]);

  return useMemo(() => ({ schedule, flush }), [schedule, flush]);
}
