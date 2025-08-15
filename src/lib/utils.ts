import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Return the last path segment (basename) from a path string.
// Handles POSIX and Windows separators, trims trailing slashes, and
// gracefully handles empty/undefined input.
export function basename(p?: string) {
  if (!p) return "";
  // Normalize backslashes to forward slashes, remove trailing slashes
  const normalized = p.replace(/\\/g, "/").replace(/\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : normalized;
}
