"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, Loader2 } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { RunImportRequest, importRun, runImportRequest } from "@/lib/runImport";

/**
 * "Import acquisition run": write this workspace's config.yaml for a `.pivraw` run
 * recorded by the PIVTOOLs acquisition app, then reload the config. The backend reads
 * every fact through the strict reader and refuses a run it cannot pair by trigger.
 */
export function RunImport({ reloadConfig }: { reloadConfig: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [runDir, setRunDir] = useState("");
  const [basePath, setBasePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  // The request that answered 409, waiting for the user to confirm force.
  const [conflict, setConflict] = useState<{ request: RunImportRequest; message: string } | null>(null);

  const run = async (request: RunImportRequest) => {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const outcome = await importRun(request);
      if (outcome.kind === "conflict") {
        setConflict({ request, message: outcome.message });
        return;
      }
      setSummary(outcome.summary);
      await reloadConfig();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    try {
      void run(runImportRequest(runDir, basePath, false));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="flex items-center gap-2">
        <Download className="h-4 w-4" /> Import acquisition run
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <p className="text-sm font-semibold">Import acquisition run</p>
        <p className="text-xs text-muted-foreground">
          Replaces this workspace&apos;s config.yaml with one for a run recorded by the PIVTOOLs acquisition app:
          its cameras, pairing and image count, and <code>rig.dt</code> in the project&apos;s calibration settings.
        </p>
      </div>
      <div>
        <Label htmlFor="import_run_dir" className="text-xs">Run folder</Label>
        <Input
          id="import_run_dir"
          className="font-mono mt-1"
          placeholder="/path/to/project/run_001"
          value={runDir}
          onChange={(e) => setRunDir(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="import_base_path" className="text-xs">Results folder (optional)</Label>
        <Input
          id="import_base_path"
          className="font-mono mt-1"
          placeholder="Default: <project>/results/<run name>"
          value={basePath}
          onChange={(e) => setBasePath(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={start} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Close</Button>
      </div>
      {error && <p className="text-xs text-red-600 whitespace-pre-wrap">Import failed: {error}</p>}
      {summary && (
        <pre className="text-xs whitespace-pre-wrap rounded bg-green-50 border border-green-300 p-2 text-green-900">
          {summary}
        </pre>
      )}

      <AlertDialog open={conflict !== null} onOpenChange={(o) => { if (!o) setConflict(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing settings?</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {conflict?.message}
              {"\n\n"}Importing replaces all of the above. The new config.yaml starts from the default
              settings, so PIV, filter and mask settings made in this workspace are not kept. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (conflict) void run({ ...conflict.request, force: true });
                setConflict(null);
              }}
            >
              Replace and import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
