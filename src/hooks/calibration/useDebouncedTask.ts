import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * One debounced write that is FLUSHED, never dropped.
 *
 * `schedule(run)` replaces any pending task and runs it after `delayMs`. `flush()` runs the
 * pending task now. The pending task also runs on unmount, so an edit made just before a tab
 * switch (Radix unmounts the tab) still reaches the backend. `run(followUp)` receives
 * `followUp = false` when flushed on unmount so it can skip work that only matters to a
 * mounted UI (re-validation, state updates).
 */
export function useDebouncedTask(delayMs: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<((followUp: boolean) => Promise<void>) | null>(null);

  const runPending = useCallback((followUp: boolean) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const run = pending.current;
    pending.current = null;
    if (run) void run(followUp);
  }, []);

  const schedule = useCallback((run: (followUp: boolean) => Promise<void>) => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = run;
    timer.current = setTimeout(() => runPending(true), delayMs);
  }, [delayMs, runPending]);

  const flush = useCallback(() => runPending(true), [runPending]);

  useEffect(() => () => runPending(false), [runPending]);

  return useMemo(() => ({ schedule, flush }), [schedule, flush]);
}
