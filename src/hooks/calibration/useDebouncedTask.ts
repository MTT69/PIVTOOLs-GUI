import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * One debounced write that is FLUSHED, never dropped.
 *
 * `schedule(run)` replaces any pending task and runs it after `delayMs`. Runs are serialised:
 * each starts only after the previous one settled, so two saves never race. `flush()` runs the
 * pending task now and returns a promise that settles once every run started so far (including
 * one whose timer already fired and is still in flight) has settled, so a caller can wait for
 * them to land. The pending task also runs on unmount, so an edit made just before a tab switch
 * (Radix unmounts the tab) still reaches the backend. `run(followUp)` receives
 * `followUp = false` when flushed on unmount so it can skip work that only matters to a
 * mounted UI (re-validation, state updates).
 *
 * `run` must not reject: it catches its own failures, since a rejection would break the chain
 * every later run waits on.
 */
export function useDebouncedTask(delayMs: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<((followUp: boolean) => Promise<void>) | null>(null);
  // The last run started; every run chains after it.
  const running = useRef<Promise<void>>(Promise.resolve());

  const runPending = useCallback((followUp: boolean): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const run = pending.current;
    pending.current = null;
    if (run) running.current = running.current.then(() => run(followUp));
    return running.current;
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
