import { useCallback, useMemo, useState } from 'react';
import { BoardAdapter } from './calibration/useCalibrationCore';
import { PlanarModelType, usePlanarCalibration } from './calibration/usePlanarCalibration';
import { SidecarSettings, numOrNull } from './calibration/shared';

export type { FrameDetection, WorldFrameClicks } from './calibration/shared';
export type { CameraModel, JobStatus, MultiCameraJobStatus, ValidationResult } from './calibration/usePlanarCalibration';

/** ArUco dictionaries offered for the ChArUco marker set (OpenCV names). */
export const ARUCO_DICTS = [
  "DICT_4X4_50",
  "DICT_4X4_100",
  "DICT_4X4_250",
  "DICT_4X4_1000",
  "DICT_5X5_50",
  "DICT_5X5_100",
  "DICT_5X5_250",
  "DICT_5X5_1000",
  "DICT_6X6_50",
  "DICT_6X6_100",
  "DICT_6X6_250",
  "DICT_6X6_1000",
];

const BOARD = 'charuco';

/**
 * Sidecar/request field -> key in the model's stamped geometry (`record.board_geometry`,
 * which records the square size in metres as `square_size_m`).
 */
const GEOMETRY_FIELDS = [
  { field: 'squares_h', geoKey: 'squares_h', label: 'squares (H)' },
  { field: 'squares_v', geoKey: 'squares_v', label: 'squares (V)' },
  { field: 'square_size', geoKey: 'square_size_m', label: 'square size' },
  { field: 'marker_ratio', geoKey: 'marker_ratio', label: 'marker ratio' },
  { field: 'aruco_dict', geoKey: 'aruco_dict', label: 'ArUco dictionary' },
  { field: 'min_corners', geoKey: 'min_corners', label: 'min corners' },
] as const;

/**
 * ChArUco board state and its sidecar block (`methods.charuco`), shared by the planar and
 * stereo ChArUco tabs. Every field is a string with no frontend default except the
 * dictionary; empty fields are omitted from requests so the backend falls through to the
 * sidecar or fails loudly.
 */
export function useCharucoBoard() {
  const [squaresH, setSquaresH] = useState('');
  const [squaresV, setSquaresV] = useState('');
  const [squareSize, setSquareSize] = useState('');
  const [markerRatio, setMarkerRatio] = useState('');
  const [arucoDict, setArucoDict] = useState('DICT_4X4_1000');
  const [minCorners, setMinCorners] = useState('');

  const readCharuco = useCallback((ch: Record<string, unknown>) => {
    const str = (v: unknown) => (v == null ? '' : String(v));
    setSquaresH(str(ch.squares_h));
    setSquaresV(str(ch.squares_v));
    setSquareSize(str(ch.square_size));
    setMarkerRatio(str(ch.marker_ratio));
    if (typeof ch.aruco_dict === 'string' && ch.aruco_dict) setArucoDict(ch.aruco_dict);
    setMinCorners(str(ch.min_corners));
  }, []);

  const fields = useMemo(() => ({
    squares_h: numOrNull(squaresH),
    squares_v: numOrNull(squaresV),
    square_size: numOrNull(squareSize),
    marker_ratio: numOrNull(markerRatio),
    aruco_dict: arucoDict,
    min_corners: numOrNull(minCorners),
  }), [squaresH, squaresV, squareSize, markerRatio, arucoDict, minCorners]);

  const boardParams = useMemo(
    () => Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null && v !== '')),
    [fields]);

  const geometryDiff = (geo: Record<string, unknown>): string[] =>
    GEOMETRY_FIELDS
      .filter(({ field, geoKey }) => {
        const form = fields[field];
        const stamped = geo[geoKey];
        if (stamped == null || form == null) return false;
        return typeof form === 'number' ? Number(stamped) !== form : String(stamped) !== form;
      })
      .map(({ label }) => label);

  return {
    squaresH, setSquaresH, squaresV, setSquaresV, squareSize, setSquareSize,
    markerRatio, setMarkerRatio, arucoDict, setArucoDict, minCorners, setMinCorners,
    readCharuco, fields, boardParams, geometryDiff,
  };
}

/**
 * Planar ChArUco calibration: the ChArUco board block plus the model type under
 * `methods.charuco`, on the shared core (`useCalibrationCore`).
 */
export function useChArUcoCalibration(cameraOptions: number[], sourcePaths: string[]) {
  const b = useCharucoBoard();
  const [modelType, setModelType] = useState<PlanarModelType>('pinhole');
  const { readCharuco } = b;

  const readSettings = useCallback((s: SidecarSettings) => {
    const ch = (s.methods?.charuco ?? {}) as Record<string, unknown>;
    readCharuco(ch);
    if (ch.model_type === 'pinhole' || ch.model_type === 'polynomial') setModelType(ch.model_type);
  }, [readCharuco]);

  const adapter: BoardAdapter = {
    board: BOARD,
    readSettings,
    methods: useMemo(() => ({ charuco: { ...b.fields, model_type: modelType } }), [b.fields, modelType]),
    boardParams: b.boardParams,
    geometryDiff: (geo) => {
      const diff = b.geometryDiff(geo);
      if (geo.model_type != null && geo.model_type !== modelType) diff.push('model type');
      return diff;
    },
  };

  const p = usePlanarCalibration(adapter, modelType, cameraOptions);
  const c = p.core;
  const { readCharuco: _r, fields: _f, boardParams: _bp, geometryDiff: _g, ...boardState } = b;

  return {
    ...c,
    ...boardState,
    validation: p.validation,
    cameraModel: p.cameraModel, hasModel: p.cameraModel !== null,
    detections: p.detections, detectFrame: p.detectFrame,
    modelLoadError: c.loadError,
    modelType, setModelType,
    jobStatus: p.jobStatus, isCalibrating: p.isCalibrating,
    multiCameraJobStatus: p.multiCameraJobStatus, isMultiCameraCalibrating: p.isMultiCameraCalibrating,
    generateCameraModel: p.generateCameraModel, generateCameraModelAll: p.generateCameraModelAll,
    isVectorCalibrating: c.applyRunning,
    calibrateVectors: c.startApply,
    sourcePaths,
  };
}
