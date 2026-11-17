import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import {
  DiagnosisEntry,
  MergedSuggestion,
  StreamInfo,
  StreamRole,
  SuggestionApply,
  foundLines,
  formatSize,
  mergeSuggestions,
  warningLines,
} from "@/lib/sourceDiagnosis";
import { AlertTriangle } from "lucide-react";

type OnApply = (apply: SuggestionApply) => Promise<void>;

/**
 * Shared apply state: one in-flight flag (all buttons of a group disable together)
 * and the last failure, cleared by the next apply or when `resetKey` changes.
 */
function useApply(onApply: OnApply, resetKey: unknown) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [resetKey]);

  const run = async (apply: SuggestionApply) => {
    setApplying(true);
    setError(null);
    try {
      await onApply(apply);
    } catch (e) {
      setError(`Could not apply: ${errorMessage(e)}`);
    } finally {
      setApplying(false);
    }
  };

  return { applying, error, run };
}

function ApplyButton({
  suggestion,
  applying,
  run,
}: {
  suggestion: MergedSuggestion;
  applying: boolean;
  run: (apply: SuggestionApply) => Promise<void>;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={applying}
      onClick={() => run(suggestion.apply)}
      className="text-blue-600 border-blue-300 hover:bg-blue-50"
    >
      {suggestion.label}
    </Button>
  );
}

function SuggestionRow({
  suggestion,
  applying,
  run,
}: {
  suggestion: MergedSuggestion;
  applying: boolean;
  run: (apply: SuggestionApply) => Promise<void>;
}) {
  const prefix = suggestion.partial ? `${suggestion.labels.join(", ")}: ` : "";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span>{prefix}{suggestion.message}</span>
      <ApplyButton suggestion={suggestion} applying={applying} run={run} />
    </div>
  );
}

const ROLE_TEXT: Record<StreamRole, string> = { A: "A", B: "B", "": "single" };

/**
 * A `.set` recording's streams. With the recording's own camera labels, each row also
 * names DaVis's camera, its model and its id (which carries the serial), and whether
 * the stream is frame A, frame B or a single-frame camera's one stream.
 */
function StreamTable({ streams }: { streams: StreamInfo[] }) {
  const labelled = streams.some((s) => s.label !== null);
  const headers = ["Stream", "Prefix", "Size", "Encoding", "Camera",
    ...(labelled ? ["DaVis label", "Model", "Camera id (serial)", "Frame"] : [])];
  return (
    <table className="text-xs text-muted-foreground">
      <thead>
        <tr className="text-left">
          {headers.map((h) => (
            <th key={h} className="pr-4 font-medium">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {streams.map((s) => (
          <tr key={s.index}>
            <td className="pr-4">{s.index}</td>
            <td className="pr-4">{s.prefix}</td>
            <td className="pr-4">{formatSize(s)}</td>
            <td className="pr-4">{s.decoder}</td>
            <td className="pr-4">{s.camera === null ? "—" : s.camera}</td>
            {labelled && (
              <>
                <td className="pr-4">{s.label ?? "—"}</td>
                <td className="pr-4">{s.model ?? "—"}</td>
                <td className="pr-4">{s.camera_id ?? "—"}</td>
                <td className="pr-4">{s.role === null ? "—" : ROLE_TEXT[s.role]}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SourceDiagnosis({
  entries,
  onApply,
  busy,
}: {
  entries: DiagnosisEntry[];
  onApply: OnApply;
  busy: boolean;
}) {
  const { applying, error, run } = useApply(onApply, entries);
  const [expanded, setExpanded] = useState(false);

  if (busy || entries.length === 0 ||
      entries.every((e) => e.found === null && e.warnings.length === 0)) return null;

  const lines = foundLines(entries);
  const warnings = warningLines(entries);
  const streams = entries.find((e) => e.streams !== null)?.streams ?? null;
  const [top, ...rest] = mergeSuggestions(entries);

  return (
    <div className="space-y-1">
      {lines.map((line, i) => (
        <p key={i} className="text-xs text-muted-foreground">{line}</p>
      ))}
      {warnings.map((w, i) => (
        <p
          key={`w${i}`}
          role="alert"
          className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900"
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
          <span>{w}</span>
        </p>
      ))}
      {streams && <StreamTable streams={streams} />}
      {top && <SuggestionRow suggestion={top} applying={applying} run={run} />}
      {rest.length > 0 && (
        <>
          <button
            type="button"
            className="mt-2 block text-xs text-blue-600 hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            Other options ({rest.length})
          </button>
          {expanded &&
            rest.map((s, i) => (
              <SuggestionRow key={i} suggestion={s} applying={applying} run={run} />
            ))}
        </>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function InlineSuggestion({
  suggestion,
  onApply,
}: {
  suggestion: MergedSuggestion;
  onApply: OnApply;
}) {
  const { applying, error, run } = useApply(onApply, suggestion);
  return (
    <div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-muted-foreground">Did you mean:</span>
        <ApplyButton suggestion={suggestion} applying={applying} run={run} />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
