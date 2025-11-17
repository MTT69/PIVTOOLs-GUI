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

  // Helper function to analyze PNG pixel data for auto-contrast
  const analyzePngContrast = async (pngDataUrl: string): Promise<{ vmin: number, vmax: number }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas context not available');
          
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const pixels = imageData.data;
          const grayscaleValues = [];
          
          // Convert RGBA to grayscale using luminance formula
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            grayscaleValues.push(gray);
          }
          
          // Sort for percentile calculation
          grayscaleValues.sort((a, b) => a - b);
          
          const p1Index = Math.floor(grayscaleValues.length * 0.01);
          const p99Index = Math.floor(grayscaleValues.length * 0.99);
          
          const vmin = grayscaleValues[p1Index];
          const vmax = grayscaleValues[p99Index];
          
          resolve({ vmin, vmax });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Failed to load PNG for analysis'));
      img.src = pngDataUrl;
    });
  };

  const fetchPair = async () => {
    if (!camera) return;

    // Create unique key for this fetch request
    const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);
    const fetchKey = `${sourcePathIdx}-${cameraNumber}-${index}`;

    setLoading(true);
    setError(null);
    setImgA(null); setImgB(null); setImgARaw(null); setImgBRaw(null);

    try {
      const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${index}&source_path_idx=${sourcePathIdx}`;
      const res = await fetch(url);
      const json = await res.json();
      
      // Create a unique key for this image load
      const currentKey = `${sourcePathIdx}-${camera}-${index}`;
      
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
        // Auto-set contrast limits from raw data - always update for new image
        if (rawA && rawA.data) {
          const newVmin = Math.floor(percentileFromRaw(rawA.data, 1));
          const newVmax = Math.ceil(percentileFromRaw(rawA.data, 99));
          
          setVmin(newVmin);
          setVmax(newVmax);
        }
      } else {
        // Fallback to PNGs
        setMetadata({ bitDepth: 8, dtype: 'uint8' });
        setImgA(json.A);
        setImgB(json.B);
        
        // Auto-contrast from PNG pixel analysis - always update for new image
        try {
          if (json.A) {
            const pngDataUrl = `data:image/png;base64,${json.A}`;
            const { vmin: analyzedVmin, vmax: analyzedVmax } = await analyzePngContrast(pngDataUrl);
            setVmin(analyzedVmin);
            setVmax(analyzedVmax);
          } else {
            setVmin(0);
            setVmax(255);
          }
        } catch (err) {
          // Graceful fallback on analysis failure
          if (typeof window !== 'undefined') {
            console.warn('[ImagePairViewer] PNG auto-contrast analysis failed, using default 0-255:', err);
          }
          setVmin(0);
          setVmax(255);
        }
        
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

  // Auto-fetch when parameters change with abort controller for cancellation
  useEffect(() => {
    const abortController = new AbortController();
    let cancelled = false;

    const fetchPairWithCancel = async () => {
      if (!camera) return;

      const cameraNumber = parseInt(camera.replace(/\D/g, ''), 10);
      setLoading(true);
      setError(null);
      setImgA(null); setImgB(null); setImgARaw(null); setImgBRaw(null);

      try {
        const url = `${backendUrl}/get_frame_pair?camera=${cameraNumber}&idx=${index}&source_path_idx=${sourcePathIdx}`;
        const res = await fetch(url, { signal: abortController.signal });

        if (cancelled) return; // Don't update state if cancelled

        const json = await res.json();

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
            const newVmin = Math.floor(percentileFromRaw(rawA.data, 1));
            const newVmax = Math.ceil(percentileFromRaw(rawA.data, 99));
            setVmin(newVmin);
            setVmax(newVmax);
          }
        } else {
          // Fallback to PNGs
          setMetadata({ bitDepth: 8, dtype: 'uint8' });
          setImgA(json.A);
          setImgB(json.B);

          // Auto-contrast from PNG pixel analysis
          try {
            if (json.A) {
              const pngDataUrl = `data:image/png;base64,${json.A}`;
              const { vmin: analyzedVmin, vmax: analyzedVmax } = await analyzePngContrast(pngDataUrl);
              setVmin(analyzedVmin);
              setVmax(analyzedVmax);
            } else {
              setVmin(0);
              setVmax(255);
            }
          } catch (err) {
            if (typeof window !== 'undefined') {
              console.warn('[ImagePairViewer] PNG auto-contrast analysis failed, using default 0-255:', err);
            }
            setVmin(0);
            setVmax(255);
          }
        }
      } catch (e: any) {
        if (e.name === 'AbortError') {
          // Request was cancelled, ignore
          return;
        }
        setError(e.message);
        if (typeof window !== 'undefined') {
          console.error('[ImagePairViewer] Error fetching image pair:', e);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchPairWithCancel();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [backendUrl, sourcePathIdx, camera, index]);

  return { loading, error, imgA, imgB, imgARaw, imgBRaw, metadata, vmin, setVmin, vmax, setVmax, reload: fetchPair };
}