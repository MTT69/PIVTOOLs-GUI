const QUOTES = ['"', "'"];

/**
 * Mirror of the backend `normalise_source_path`: trim, drop ONE surrounding pair
 * of matching quotes, trim again. An unmatched quote is part of the name and kept.
 */
export function sanitizePath(raw: string): string {
  let path = raw.trim();
  if (path.length >= 2 && path[0] === path[path.length - 1] && QUOTES.includes(path[0])) {
    path = path.slice(1, -1);
  }
  return path.trim();
}

/** Copy of `list` padded with "" up to `idx`, with `[idx] = value`. Never sparse. */
export function withSourceAt(list: readonly string[], idx: number, value: string): string[] {
  const out = [...list];
  while (out.length <= idx) out.push('');
  out[idx] = value;
  return out;
}
