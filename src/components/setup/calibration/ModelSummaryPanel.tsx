"use client";

import React from "react";

interface Props {
  model: any | null;             // result from generate_model OR GET /model
  figures: string[];
  figureUrl: (name: string) => string;
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-4">
    <span className="text-muted-foreground">{k}</span>
    <span className="tabular-nums font-medium">{v}</span>
  </div>
);

export const ModelSummaryPanel: React.FC<Props> = ({ model, figures, figureUrl }) => {
  if (!model || model.exists === false) {
    return <p className="text-sm text-muted-foreground">No model yet — generate one to see its summary.</p>;
  }
  const stereo = !!model.stereo;
  const perView: number[] = stereo ? (model.per_view_rms1 || []) : (model.per_view_rms || []);
  const perView2: number[] = stereo ? (model.per_view_rms2 || []) : [];

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        {stereo ? (
          <>
            <Row k="RMS cam1 / cam2 (px)" v={`${(model.rms_cam1 ?? 0).toFixed(4)} / ${(model.rms_cam2 ?? 0).toFixed(4)}`} />
            <Row k="Stereo angle (°)" v={(model.stereo_angle_deg ?? 0).toFixed(2)} />
            <Row k="Baseline (mm)" v={(model.baseline_mm ?? 0).toFixed(1)} />
          </>
        ) : (
          <>
            <Row k="RMS (px)" v={(model.rms ?? 0).toFixed(4)} />
            <Row k="fx (px)" v={(model.fx ?? 0).toFixed(1)} />
            <Row k="Principal point" v={`(${(model.cx ?? 0).toFixed(1)}, ${(model.cy ?? 0).toFixed(1)})`} />
          </>
        )}
        {model.distortion_model && <Row k="Distortion" v={model.distortion_model} />}
        {model.spacing_mm != null && <Row k="Spacing (mm)" v={model.spacing_mm} />}
        {model.image_width && <Row k="Image" v={`${model.image_width}×${model.image_height}`} />}
      </div>

      {perView.length > 0 && (
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Per-view RMS (px)</div>
          <div className="flex flex-wrap gap-1">
            {perView.map((r, i) => (
              <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums"
                title={stereo && perView2[i] != null ? `cam1 ${r.toFixed(3)} · cam2 ${perView2[i].toFixed(3)}` : undefined}>
                {r.toFixed(3)}
              </span>
            ))}
          </div>
        </div>
      )}

      {model.model_path && (
        <p className="text-xs break-all text-muted-foreground">{model.model_path}</p>
      )}

      {figures.length > 0 && (
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Proof figures</div>
          <div className="grid grid-cols-2 gap-2">
            {figures.map((name) => (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={name} href={figureUrl(name)} target="_blank" rel="noreferrer" className="block">
                <img src={figureUrl(name)} alt={name} className="w-full rounded border hover:opacity-80" />
                <span className="block text-[10px] text-muted-foreground truncate">{name}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
