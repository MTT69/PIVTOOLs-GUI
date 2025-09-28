import { useState, useEffect } from 'react';
import { RawImage, DType, decodeTypedArray, percentileFromRaw } from '@/lib/imageUtils'; // Assume utils are in a lib file

export function useImagePair(backendUrl: string, sourcePathIdx: number, camera: string, index: number) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgA, setImgA] = useState<string | null>(null);
  const [imgB, setImgB] = useState<string | null>(null);
  const [imgARaw, setImgARaw] = useState<RawImage | null>(null);
  const [imgBRaw, setImgBRaw] = useState<RawImage | null>(null);
  const [metadata, setMetadata] = useState<{ bitDepth?: number, dtype?: DType, dims?: { w: number, h: number } } | null>(null);
  const [vmin, setVmin] = useState(0);
  const [vmax, setVmax] = useState(255);

  const fetchPair = async () => {
    if (!camera) return;
    setLoading(true);
    setError(null);
    setImgA(null); setImgB(null); setImgARaw(null); setImgBRaw(null);
    try {
      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);
      const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${index}&source_path_idx=${sourcePathIdx}`;
      const res = await fetch(url);
      const json = await res.json();
      // Debug: log backend response
      if (typeof window !== 'undefined') {
        // @ts-ignore
          (window as any)._lastImagePairResponse = json;
          console.log('[ImagePairViewer] Backend response:', json);
      }
      if (!res.ok) {
        throw new Error(json.error || `Image pair not found (frame ${index})`);
      }

      // Check for raw image fields and meta
      if (json.meta?.width && (json.A_raw || json.B_raw)) {
        const meta = json.meta;
        setMetadata({ bitDepth: meta.bitDepth, dtype: meta.dtype, dims: { w: meta.width, h: meta.height } });
        let rawA = null, rawB = null;
        if (json.A_raw) {
          try {
            rawA = { ...meta, data: decodeTypedArray(json.A_raw, meta.dtype) };
          } catch (err) {
            const msg = typeof err === 'object' && err !== null && 'message' in err ? (err as any).message : String(err);
            setError('Failed to decode A_raw: ' + msg);
            rawA = null;
          }
        }
        if (json.B_raw) {
          try {
            rawB = { ...meta, data: decodeTypedArray(json.B_raw, meta.dtype) };
          } catch (err) {
            const msg = typeof err === 'object' && err !== null && 'message' in err ? (err as any).message : String(err);
            setError('Failed to decode B_raw: ' + msg);
            rawB = null;
          }
        }
        setImgARaw(rawA);
        setImgBRaw(rawB);
        // Auto-set contrast limits from raw data
        if (rawA && rawA.data) {
          setVmin(Math.floor(percentileFromRaw(rawA.data, 1)));
          setVmax(Math.ceil(percentileFromRaw(rawA.data, 99)));
        }
      } else {
        // Fallback to PNGs
        setMetadata({ bitDepth: 8, dtype: 'uint8' });
        setImgA(json.A);
        setImgB(json.B);
        // Auto-limits from PNG would require canvas logic, best handled in component if needed
        setVmin(0);
        setVmax(255);
        // Debug: warn if raw fields missing
        if (typeof window !== 'undefined') {
          console.warn('[ImagePairViewer] No raw image data or meta in backend response.');
        }
      }

    } catch (e: any) {
      setError(e.message);
      if (typeof window !== 'undefined') {
        console.error('[ImagePairViewer] Error fetching image pair:', e);
      }
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch when parameters change
  useEffect(() => {
    fetchPair();
  }, [backendUrl, sourcePathIdx, camera, index]);

  return { loading, error, imgA, imgB, imgARaw, imgBRaw, metadata, vmin, setVmin, vmax, setVmax, reload: fetchPair };
}