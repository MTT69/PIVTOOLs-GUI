"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, X } from "lucide-react";

export type GlobalPick =
  | { kind: "datum" }
  | { kind: "pair"; idx: number; side: "a" | "b" };

export interface OverlapPair {
  camera_a: number;
  camera_b: number;
  pixel_on_a?: [number, number] | null;
  pixel_on_b?: [number, number] | null;
}

export interface GCData {
  datum_camera?: number;
  datum_pixel?: [number, number] | null;
  datum_physical?: [number, number];
  overlap_pairs?: OverlapPair[];
}

const inputCls = "border rounded px-2 py-1 bg-background w-20";
const px = (p?: [number, number] | null) => (p ? `(${p[0].toFixed(0)}, ${p[1].toFixed(0)})` : "—");

interface Props {
  gc: GCData;
  cameras: number[];
  pick: GlobalPick | null;
  busy?: boolean;
  shifts: Record<string, [number, number]> | null;
  onSetDatumCamera: (cam: number) => void;
  onPickDatum: () => void;
  onSetPhysical: (xy: [number, number]) => void;
  onAddPair: () => void;
  onRemovePair: (idx: number) => void;
  onSetPairCam: (idx: number, side: "a" | "b", cam: number) => void;
  onPickPair: (idx: number, side: "a" | "b") => void;
  onCompute: () => void;
}

export const GlobalCoordinatesPanel: React.FC<Props> = ({
  gc, cameras, pick, busy, shifts,
  onSetDatumCamera, onPickDatum, onSetPhysical,
  onAddPair, onRemovePair, onSetPairCam, onPickPair, onCompute,
}) => {
  const pairs = gc.overlap_pairs || [];
  const physical = gc.datum_physical || [0, 0];
  const datumActive = pick?.kind === "datum";
  const sel = (cls = "") => `border rounded px-2 py-1 bg-background ${cls}`;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground text-xs">
        Place every camera in one physical frame. Set a datum (one camera, one point at a known
        physical position), then add overlap pairs — the same physical feature clicked in two
        cameras — to chain the rest. Each camera must already have a mono model.
      </p>

      <div className="space-y-2 border rounded p-3">
        <div className="font-medium">Datum</div>
        <div className="flex items-center gap-2">
          <span>Camera</span>
          <select className={sel()} value={gc.datum_camera ?? cameras[0]}
            onChange={(e) => onSetDatumCamera(parseInt(e.target.value, 10))}>
            {cameras.map((c) => <option key={c} value={c}>Cam {c}</option>)}
          </select>
          <Button size="sm" variant={datumActive ? "default" : "outline"} onClick={onPickDatum}>
            {datumActive ? "Click image…" : "Pick point"}
          </Button>
          <span className="text-muted-foreground tabular-nums">{px(gc.datum_pixel)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>Physical (mm)</span>
          <input className={inputCls} type="number" step="any" value={physical[0]}
            onChange={(e) => onSetPhysical([parseFloat(e.target.value || "0"), physical[1]])} />
          <input className={inputCls} type="number" step="any" value={physical[1]}
            onChange={(e) => onSetPhysical([physical[0], parseFloat(e.target.value || "0")])} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-medium">Overlap pairs</span>
          <Button size="sm" variant="outline" onClick={onAddPair}><Plus className="h-3 w-3 mr-1" />Pair</Button>
        </div>
        {pairs.length === 0 && <p className="text-xs text-muted-foreground">No pairs — needed for &gt;1 camera.</p>}
        {pairs.map((p, i) => {
          const aActive = pick?.kind === "pair" && pick.idx === i && pick.side === "a";
          const bActive = pick?.kind === "pair" && pick.idx === i && pick.side === "b";
          return (
            <div key={i} className="border rounded p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Pair {i + 1}</span>
                <Button size="sm" variant="ghost" onClick={() => onRemovePair(i)}><X className="h-3 w-3" /></Button>
              </div>
              {(["a", "b"] as const).map((side) => {
                const cam = side === "a" ? p.camera_a : p.camera_b;
                const pixel = side === "a" ? p.pixel_on_a : p.pixel_on_b;
                const active = side === "a" ? aActive : bActive;
                return (
                  <div key={side} className="flex items-center gap-2">
                    <select className={sel("w-24")} value={cam}
                      onChange={(e) => onSetPairCam(i, side, parseInt(e.target.value, 10))}>
                      {cameras.map((c) => <option key={c} value={c}>Cam {c}</option>)}
                    </select>
                    <Button size="sm" variant={active ? "default" : "outline"} onClick={() => onPickPair(i, side)}>
                      {active ? "Click image…" : "Pick"}
                    </Button>
                    <span className="text-muted-foreground tabular-nums">{px(pixel)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <Button onClick={onCompute} disabled={busy} variant="secondary">
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Compute shifts
      </Button>

      {shifts && (
        <div className="border rounded p-3 space-y-1">
          <div className="font-medium">Per-camera shift (mm)</div>
          {Object.entries(shifts).map(([cam, s]) => (
            <div key={cam} className="flex justify-between tabular-nums">
              <span className="text-muted-foreground">Cam {cam}</span>
              <span>({s[0].toFixed(3)}, {s[1].toFixed(3)})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
