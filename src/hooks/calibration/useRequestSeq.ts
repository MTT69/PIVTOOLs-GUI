import { useCallback, useMemo, useRef } from 'react';

/**
 * Latest-request-wins guard for one kind of async read.
 *
 * `next()` issues a token before the request; `isCurrent(token)` after it resolves says whether
 * a newer request has been issued since, in which case the response is stale and must be
 * dropped. `invalidate()` makes every outstanding token stale (e.g. on source change).
 * Same pattern as `useImageFilters` (`requestIdRef`) and `useJointCalibration` (`modelReqRef`).
 */
export function useRequestSeq() {
  const seq = useRef(0);
  const next = useCallback(() => ++seq.current, []);
  const isCurrent = useCallback((token: number) => token === seq.current, []);
  const invalidate = useCallback(() => { seq.current += 1; }, []);
  return useMemo(() => ({ next, isCurrent, invalidate }), [next, isCurrent, invalidate]);
}
