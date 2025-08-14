import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const RunPIV: React.FC = () => {
  const [sourcePaths, setSourcePaths] = useState<string[]>(() => {
    try {
      return JSON.parse(typeof window !== "undefined" ? localStorage.getItem("piv_source_paths") || "[]" : "[]");
    } catch {
      return [];
    }
  });
  const [sourcePathIdx, setSourcePathIdx] = useState<number>(0);
  const [camera, setCamera] = useState<string>("1");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "piv_source_paths") {
        try {
          setSourcePaths(JSON.parse(e.newValue || "[]"));
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleRunPIV = async () => {
    setLoading(true);
    try {
      const response = await fetch("backend/run_piv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: sourcePaths[sourcePathIdx],
          camera,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to run PIV: ${response.statusText}`);
      }

      const data = await response.json();
      console.log("Run PIV response:", data);
      alert(`Run PIV triggered: ${data.message}`);
    } catch (error) {
      console.error("Error running PIV:", error);
      alert("Error running PIV. Check the console for details.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelRun = async () => {
    setLoading(true);
    try {
      // Placeholder for backend call to cancel PIV processing
      console.log("Cancel Run triggered.");
      alert("Cancel Run triggered (placeholder).");
    } catch (error) {
      console.error("Error canceling PIV run:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Run PIV</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 mb-4">
            {/* Source path selection */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Source Path:</label>
              {sourcePaths.length > 0 ? (
                <select
                  value={String(sourcePathIdx)}
                  onChange={(e) => setSourcePathIdx(Number(e.target.value))}
                  className="border rounded px-2 py-1"
                >
                  {sourcePaths.map((p, i) => {
                    // Show last two segments of the path
                    const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
                    const parts = norm.split("/").filter(Boolean);
                    const lastTwo = parts.length >= 2 ? parts.slice(-2).join("/") : norm;
                    return (
                      <option key={i} value={i}>
                        {`${i}: /${lastTwo}`}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <Input
                  type="text"
                  value="No source paths available"
                  readOnly
                  className="w-full"
                />
              )}
            </div>

            {/* Camera selection */}
            <div className="flex items-center gap-4">
              <label htmlFor="camera" className="text-sm font-medium">
                Camera:
              </label>
              <select
                id="camera"
                value={camera}
                onChange={(e) => setCamera(e.target.value)}
                className="border rounded px-2 py-1"
              >
                <option value="1">Camera 1</option>
                <option value="2">Camera 2</option>
                {/* Add more cameras if needed */}
              </select>
            </div>

            {/* Run and Cancel buttons */}
            <div className="flex items-center gap-4">
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={handleRunPIV}
                disabled={loading}
              >
                {loading ? "Running..." : "Run PIV"}
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700"
                onClick={handleCancelRun}
                disabled={loading}
              >
                {loading ? "Canceling..." : "Cancel Run"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RunPIV;
