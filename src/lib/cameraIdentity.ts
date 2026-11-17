/**
 * Camera identity from a LaVision recording's own camera labels. Pure module.
 *
 * The backend's `.set` stream table (`StreamInfo`) carries, per stream, the camera
 * number PIVTOOLs uses and, when the recording labels its cameras, DaVis's label,
 * camera id (which holds the serial) and model. This module folds the streams into
 * one identity per camera number, and names a camera for every camera list.
 */

import type { StreamInfo } from './sourceDiagnosis';

export interface CameraIdentity {
  /** DaVis's own name for the camera, e.g. "Camera 3". */
  label: string;
  /** DaVis's camera id, which carries the serial, e.g. "Camera.ImagerSCMOS5MCLHS: 61008639". */
  camera_id: string;
  model: string;
  /** True for an A/B camera (two streams), false for a single-frame camera. */
  double_frame: boolean;
}

/** Camera number → identity. A camera without labels has no entry. */
export type CameraIdentities = ReadonlyMap<number, CameraIdentity>;

export const NO_IDENTITIES: CameraIdentities = new Map();

/**
 * One identity per labelled camera of one recording's stream table.
 *
 * Throws when the streams of one camera disagree on label, id or model, or when a
 * labelled stream has no camera number: the backend groups streams by label, so
 * either is a contract fault, not something to paper over.
 */
export function identitiesFromStreams(streams: readonly StreamInfo[]): CameraIdentities {
  const byCamera = new Map<number, { id: Omit<CameraIdentity, 'double_frame'>; roles: string[] }>();
  for (const s of streams) {
    if (s.label === null || s.camera_id === null || s.model === null || s.role === null) continue;
    if (s.camera === null) {
      throw new Error(`Stream ${s.index} is labelled "${s.label}" but has no camera number`);
    }
    const id = { label: s.label, camera_id: s.camera_id, model: s.model };
    const seen = byCamera.get(s.camera);
    if (!seen) {
      byCamera.set(s.camera, { id, roles: [s.role] });
      continue;
    }
    if (seen.id.label !== id.label || seen.id.camera_id !== id.camera_id || seen.id.model !== id.model) {
      throw new Error(
        `Camera ${s.camera}: stream ${s.index} is labelled "${id.label}" (${id.camera_id}), ` +
        `another of its streams "${seen.id.label}" (${seen.id.camera_id})`,
      );
    }
    seen.roles.push(s.role);
  }
  const out = new Map<number, CameraIdentity>();
  byCamera.forEach(({ id, roles }, camera) => {
    out.set(camera, { ...id, double_frame: roles.includes('A') && roles.includes('B') });
  });
  return out;
}

/**
 * The identities several recordings agree on. Setup can hold several sources, and
 * camera N of one recording need not be camera N of another: a camera number whose
 * identity differs between recordings (or is labelled in one and not another) gets
 * no identity, so no list names it after the wrong camera.
 */
export function agreedIdentities(perRecording: readonly CameraIdentities[]): CameraIdentities {
  if (perRecording.length === 0) return NO_IDENTITIES;
  const [first, ...rest] = perRecording;
  const out = new Map<number, CameraIdentity>();
  first.forEach((id, camera) => {
    const agreed = rest.every((other) => {
      const o = other.get(camera);
      return o !== undefined && o.label === id.label && o.camera_id === id.camera_id &&
        o.model === id.model && o.double_frame === id.double_frame;
    });
    if (agreed) out.set(camera, id);
  });
  return out;
}

/** `Camera 2`, with DaVis's label beside it when that label is a different name. */
export function cameraShortName(camera: number, ids: CameraIdentities): string {
  const id = ids.get(camera);
  const base = `Camera ${camera}`;
  return id === undefined || id.label === base ? base : `${base} (${id.label})`;
}

/** `Imager sCMOS CLHS · Camera.ImagerSCMOS5MCLHS: 61008639 · single frame`, or null unlabelled. */
export function cameraDetail(camera: number, ids: CameraIdentities): string | null {
  const id = ids.get(camera);
  if (id === undefined) return null;
  return `${id.model} · ${id.camera_id} · ${id.double_frame ? 'double frame (A/B)' : 'single frame'}`;
}

/** One line for a select option: the short name, then the detail when labelled. */
export function cameraTitle(camera: number, ids: CameraIdentities): string {
  const detail = cameraDetail(camera, ids);
  const name = cameraShortName(camera, ids);
  return detail === null ? name : `${name} · ${detail}`;
}
