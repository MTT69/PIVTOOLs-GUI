import React, { useState, useEffect, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type DType = "uint8" | "uint16";
type RawImage = {
	data: Uint8Array | Uint16Array;
	width: number;
	height: number;
	bitDepth: number;
	dtype: DType;
};

// Polygon mask editor that supports multiple polygons and native-size bitmap export
function PolygonMaskEditor({
	raw, src, vmin, vmax, title,
	meta,
	arrayPostUrl
}: {
	raw?: RawImage | null;
	src?: string | null;
	vmin: number; vmax: number;
	title: string;
	meta: { basePathIdx: number; camera: string; index: number; frame: "A"|"B" };
	arrayPostUrl: string;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<HTMLCanvasElement | null>(null);
	const overlayRef = useRef<HTMLCanvasElement | null>(null);
	const imgRef = useRef<HTMLImageElement | null>(null);
	// NEW: wrapper to control CSS size and allow centering
	const wrapperRef = useRef<HTMLDivElement | null>(null);

	// Magnifier refs & state
	const magRef = useRef<HTMLCanvasElement | null>(null);
	const [magnifierEnabled, setMagnifierEnabled] = useState<boolean>(false);
	const [magVisible, setMagVisible] = useState<boolean>(false);
	const [magPos, setMagPos] = useState({ left: 0, top: 0 });
	const MAG_SIZE = 180; // px diameter (matches VectorViewer)
	const MAG_FACTOR = 2.5; // zoom factor
	const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

	const [nativeSize, setNativeSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

	// polygons state: array of {points, closed}
	type Pt = { x: number; y: number };
	type Poly = { points: Pt[]; closed: boolean; name: string };
	// start with a single empty polygon named "Polygon 1" and select it
	const [polys, setPolys] = useState<Poly[]>([{ points: [], closed: false, name: "Polygon 1" }]);
	const [active, setActive] = useState<number>(0);

	// NEW: state for mask path and loading status
	const [maskPath, setMaskPath] = useState<string>("");
	const [loadingMask, setLoadingMask] = useState<boolean>(false);

	// Load PNG if provided and detect native size
	useEffect(() => {
		if (!src) { imgRef.current = null; return; }
		const im = new Image();
		im.onload = () => {
			imgRef.current = im;
			setNativeSize({ w: im.naturalWidth, h: im.naturalHeight });
			redraw();
		};
		im.src = `data:image/png;base64,${src}`;
	}, [src]);

	// If RAW, compute native size from raw metadata
	useEffect(() => {
		if (raw?.data) setNativeSize({ w: raw.width, h: raw.height });
	}, [raw]);

	// Build grayscale ImageData from RAW for drawing
	const mappedRaw = useMemo(() => {
		if (!raw?.data) return null;
		const { width, height, data } = raw;
		const out = new Uint8ClampedArray(width * height * 4);
		const rng = Math.max(1e-12, vmax - vmin);
		for (let i = 0; i < width * height; i++) {
			let t = (Number(data[i]) - vmin) / rng;
			if (t < 0) t = 0; if (t > 1) t = 1;
			const v = Math.round(t * 255);
			const j = i * 4;
			out[j] = v; out[j + 1] = v; out[j + 2] = v; out[j + 3] = 255;
		}
		return new ImageData(out, width, height);
	}, [raw, vmin, vmax]);

	// NEW: Process PNG images with contrast adjustment
	const mappedPng = useMemo(() => {
		if (raw?.data || !imgRef.current || !nativeSize.w || !nativeSize.h) return null;
		
		const { w, h } = nativeSize;
		const tmpCanvas = document.createElement('canvas');
		tmpCanvas.width = w;
		tmpCanvas.height = h;
		const tmpCtx = tmpCanvas.getContext('2d');
		if (!tmpCtx) return null;
		
		// Draw original image
		tmpCtx.drawImage(imgRef.current, 0, 0);
		const imageData = tmpCtx.getImageData(0, 0, w, h);
		const pixels = imageData.data;
		
		// Apply contrast adjustment
		const rng = Math.max(1e-12, vmax - vmin);
		for (let i = 0; i < pixels.length; i += 4) {
			// Convert to grayscale
			const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
			
			// Apply contrast stretch
			let t = (gray - vmin) / rng;
			if (t < 0) t = 0;
			if (t > 1) t = 1;
			const v = Math.round(t * 255);
			
			// Set RGB to adjusted value
			pixels[i] = v;
			pixels[i + 1] = v;
			pixels[i + 2] = v;
			// Alpha unchanged
		}
		
		return imageData;
	}, [raw, vmin, vmax, nativeSize]);

	// ResizeObserver to keep canvas sized to container
	useEffect(() => {
		if (!containerRef.current) return;
		const ro = new ResizeObserver(() => redraw());
		ro.observe(containerRef.current);
		return () => ro.disconnect();
	}, []);

	// Redraw on inputs
	useEffect(() => { redraw(); }, [mappedRaw, mappedPng, nativeSize, polys, active]);

	// Ensure magnifier canvas is configured (DPR-aware)
	useEffect(() => {
		if (magRef.current) {
			magRef.current.width = Math.round(MAG_SIZE * dpr);
			magRef.current.height = Math.round(MAG_SIZE * dpr);
			const ctx = magRef.current.getContext("2d");
			if (ctx) ctx.imageSmoothingEnabled = true;
		}
	}, [MAG_SIZE, dpr]);

	// Pointer move handler for magnifier (improved to work in padding areas too)
	function handlePointerMove(e: React.PointerEvent) {
		if (!magnifierEnabled || !magRef.current || !viewRef.current || !wrapperRef.current) return;
		
		const canvas = viewRef.current;
		const wrapper = wrapperRef.current;
		const wrapperRect = wrapper.getBoundingClientRect();
		
		// Check if we're within the wrapper (image + padding area)
		const wrapperX = e.clientX - wrapperRect.left;
		const wrapperY = e.clientY - wrapperRect.top;
		
		// Only show magnifier if we're within the wrapper bounds
		if (wrapperX < 0 || wrapperY < 0 || wrapperX > wrapperRect.width || wrapperY > wrapperRect.height) {
			setMagVisible(false);
			return;
		}
		
		setMagVisible(true);
		
		// Position magnifier centered on cursor using fixed positioning
		const left = e.clientX - (MAG_SIZE / 2);
		const top = e.clientY - (MAG_SIZE / 2);
		setMagPos({ left, top });
		
		const mctx = magRef.current.getContext("2d");
		if (!mctx) return;
		
		// Clear and set up circular clipping
		mctx.clearRect(0, 0, MAG_SIZE * dpr, MAG_SIZE * dpr);
		mctx.save();
		mctx.beginPath();
		mctx.arc((MAG_SIZE * dpr) / 2, (MAG_SIZE * dpr) / 2, (MAG_SIZE * dpr) / 2, 0, Math.PI * 2);
		mctx.clip();
		
		// Calculate source position - clamp to canvas bounds for edge areas
		const rect = canvas.getBoundingClientRect();
		let x = e.clientX - rect.left;
		let y = e.clientY - rect.top;
		
		// Clamp to canvas bounds so we can show edges properly
		x = Math.max(0, Math.min(rect.width, x));
		y = Math.max(0, Math.min(rect.height, y));
		
		const srcCenterX = (x / rect.width) * canvas.width;
		const srcCenterY = (y / rect.height) * canvas.height;
		const srcSize = (MAG_SIZE / MAG_FACTOR);
		const sx = srcCenterX - (srcSize / 2);
		const sy = srcCenterY - (srcSize / 2);
		
		// Draw base image region
		mctx.drawImage(
			canvas,
			sx, sy,
			srcSize, srcSize,
			0, 0,
			MAG_SIZE * dpr, MAG_SIZE * dpr
		);
		
		// Composite overlay (polygons) so they appear in the magnifier
		if (overlayRef.current) {
			mctx.drawImage(
				overlayRef.current,
				sx, sy,
				srcSize, srcSize,
				0, 0,
				MAG_SIZE * dpr, MAG_SIZE * dpr
			);
		}
		
		// Draw crosshair at center
		const cx = (MAG_SIZE * dpr) / 2;
		const cy = (MAG_SIZE * dpr) / 2;
		const lineLen = MAG_SIZE * dpr * 0.3;
		
		// Outer (darker) crosshair for contrast
		mctx.save();
		mctx.beginPath();
		mctx.lineWidth = Math.max(2, dpr * 1.5);
		mctx.strokeStyle = 'rgba(0,0,0,0.8)';
		mctx.moveTo(cx - lineLen, cy);
		mctx.lineTo(cx + lineLen, cy);
		mctx.moveTo(cx, cy - lineLen);
		mctx.lineTo(cx, cy + lineLen);
		mctx.stroke();
		
		// Inner (lighter) crosshair
		mctx.beginPath();
		mctx.lineWidth = Math.max(1, dpr);
		mctx.strokeStyle = 'rgba(255,255,255,0.95)';
		mctx.moveTo(cx - lineLen, cy);
		mctx.lineTo(cx + lineLen, cy);
		mctx.moveTo(cx, cy - lineLen);
		mctx.lineTo(cx, cy + lineLen);
		mctx.stroke();
		mctx.restore();
		
		mctx.restore();
		
		// Outer circle border - use orange color if we're in the padding area (will snap)
		const canvasRect = canvas.getBoundingClientRect();
		const canvasX = e.clientX - canvasRect.left;
		const canvasY = e.clientY - canvasRect.top;
		const isInPadding = canvasX < 0 || canvasY < 0 || canvasX > canvasRect.width || canvasY > canvasRect.height;
		
		mctx.beginPath();
		mctx.arc(cx, cy, (MAG_SIZE * dpr) / 2 - 2 * dpr, 0, Math.PI * 2);
		mctx.lineWidth = 3 * dpr;
		mctx.strokeStyle = isInPadding ? '#ff6b35' : '#005fa3';  // Orange when in snap zone
		mctx.stroke();
	}

	function handlePointerLeave() {
		setMagVisible(false);
	}

	function redraw() {
		const base = viewRef.current, overlay = overlayRef.current, container = containerRef.current;
		if (!base || !overlay || !container) return;
		const { w, h } = nativeSize;
		if (!w || !h) return;

		// Fit to container (width) while respecting a max height
		const containerWidth = container.clientWidth || w;
		const MAX_H = 720;
		const scale = Math.min(containerWidth / w, MAX_H / h);
		const W = Math.max(1, Math.round(w * scale));
		const H = Math.max(1, Math.round(h * scale));

		// Use larger padding for more clickable area
		const PADDING_H = 100;  // horizontal padding
		const PADDING_V = 25;   // reduced vertical padding to 25 pixels
		
		// Size the container to explicitly include padding
		if (containerRef.current) {
			// Make container larger to accommodate the image plus padding
			containerRef.current.style.minHeight = `${H + PADDING_V * 2}px`;
			containerRef.current.style.minWidth = `${W + PADDING_H * 2}px`;
			containerRef.current.style.padding = `${PADDING_V}px ${PADDING_H}px`;
			// ensure container can host absolutely positioned controls (magnifier toggle)
			containerRef.current.style.position = "relative";
		}
		
		// Set up the base image canvas at the original calculated size
		base.width = W;
		base.height = H;
		base.style.width = `${W}px`;
		base.style.height = `${H}px`;
		
		// Size the wrapper to hold just the image (no padding)
		if (wrapperRef.current) {
			wrapperRef.current.style.width = `${W}px`;
			wrapperRef.current.style.height = `${H}px`;
			wrapperRef.current.style.position = "relative";
			// Remove margin since container is now handling the padding
			wrapperRef.current.style.margin = "0";
		}
		
		// Set overlay to the same size as the base image
		overlay.width = W;
		overlay.height = H;
		overlay.style.width = `${W}px`;
		overlay.style.height = `${H}px`;
		overlay.style.position = "absolute";
		overlay.style.left = "0";
		overlay.style.top = "0";

		// Draw base image
		const bctx = base.getContext("2d")!;
		bctx.clearRect(0, 0, W, H);
		// Draw base image with contrast applied
		if (mappedRaw) {
			const tmp = document.createElement("canvas");
			tmp.width = w; tmp.height = h;
			tmp.getContext("2d")!.putImageData(mappedRaw, 0, 0);
			bctx.imageSmoothingEnabled = true;
			bctx.drawImage(tmp, 0, 0, w, h, 0, 0, W, H);
		} else if (mappedPng) {
			const tmp = document.createElement("canvas");
			tmp.width = w; tmp.height = h;
			tmp.getContext("2d")!.putImageData(mappedPng, 0, 0);
			bctx.imageSmoothingEnabled = true;
			bctx.drawImage(tmp, 0, 0, w, h, 0, 0, W, H);
		}

		// Draw a border around the image to help with snapping
		const octx = overlay.getContext("2d")!;
		octx.strokeStyle = "rgba(100, 100, 100, 0.5)";
		octx.lineWidth = 2;
		octx.strokeRect(0, 0, W, H);
		
		// Draw polygons (without the padding offsets since the container handles it)
		for (let i = 0; i < polys.length; i++) {
			const poly = polys[i];
			if (poly.points.length === 0) continue;
			octx.beginPath();
			poly.points.forEach((p, idx) => {
				const vx = (p.x / w) * W;
				const vy = (p.y / h) * H;
				if (idx === 0) octx.moveTo(vx, vy); else octx.lineTo(vx, vy);
			});
			if (poly.closed && poly.points.length >= 3) octx.closePath();
			octx.strokeStyle = i === active ? "#00ff88" : "#ffcc00";
			octx.stroke();

			// vertices
			for (let ptIdx = 0; ptIdx < poly.points.length; ptIdx++) {
				const p = poly.points[ptIdx];
				const vx = (p.x / w) * W;
				const vy = (p.y / h) * H;
				
				// Make the first point larger and use a different color for active, unclosed polygons
				if (ptIdx === 0 && i === active && !poly.closed && poly.points.length >= 3) {
					// Draw a larger, pulsing circle for the starting point
					octx.fillStyle = "#ff3366";
					octx.beginPath(); 
					octx.arc(vx, vy, 6, 0, Math.PI * 2); 
					octx.fill();
					// Add white border
					octx.strokeStyle = "#ffffff";
					octx.lineWidth = 2;
					octx.stroke();
				} else {
					octx.fillStyle = i === active ? "#00ff88" : "#ffcc00";
					octx.beginPath(); 
					octx.arc(vx, vy, 3, 0, Math.PI * 2); 
					octx.fill();
				}
			}
		}
	}

	// Update the toNative function to handle both canvas and div events
	function toNative(e: React.PointerEvent<HTMLElement>) {  // Changed type to more generic HTMLElement
		const wrapper = wrapperRef.current!;
		const rect = wrapper.getBoundingClientRect();
		const { w, h } = nativeSize;
		
		// Get position relative to the image (wrapper)
		const vx = e.clientX - rect.left;
		const vy = e.clientY - rect.top;
		
		// Map to native image coordinates
		let nx = (vx / rect.width) * w;
		let ny = (vy / rect.height) * h;

		// Check if the point is outside the image bounds
		if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
			// Snap to the nearest edge or corner
			if (nx < 0) nx = 0;
			if (nx >= w) nx = w - 1;
			if (ny < 0) ny = 0;
			if (ny >= h) ny = h - 1;

			// Log for debugging
			console.log(`Snapped to corner or edge: (${nx.toFixed(1)}, ${ny.toFixed(1)})`);
		}

		return { x: nx, y: ny };
	}

	// Helper to close a polygon if it has enough points
	const closePoly = (p: Poly): Poly =>
		(!p.closed && p.points.length >= 3 ? { ...p, closed: true } : p);

	// Finish the current active polygon (if open and has >=3 points)
	function finishActiveIfOpen() {
		setPolys(prev => {
			const idx = active;
			if (idx >= 0 && idx < prev.length) {
				const p = prev[idx];
				if (!p.closed && p.points.length >= 3) {
					const next = prev.slice();
					next[idx] = { ...p, closed: true };
					return next;
				}
			}
			return prev;
		});
	}

	// Create a finished copy of all polygons for export and update UI
	function finishAllPolygonsForExport(): Poly[] {
		const closed = polys.map(closePoly);
		setPolys(closed);
		return closed;
	}

	function startNewPolygon() {
		// Auto-finish current polygon before starting a new one
		finishActiveIfOpen();
		setPolys(prev => {
			const idx = prev.length;
			const next = [...prev, { points: [], closed: false, name: `Polygon ${idx + 1}` }];
			setActive(idx);
			return next;
		});
	}

	function addPoint(e: React.PointerEvent<HTMLElement>) {
		e.preventDefault();
		if (nativeSize.w === 0) return;

		setPolys(prev => {
			let list = [...prev];
			let idx = active;

			// If no active polygon or out-of-range, create a new one now and use it
			if (idx < 0 || idx >= list.length) {
				idx = list.length;
				list.push({ points: [], closed: false, name: `Polygon ${idx + 1}` });
				// update active to the newly created polygon
				if (active !== idx) setActive(idx);
			}

			const poly = list[idx];
			if (poly.closed) return list;

			// Get point with edge snapping applied
			const pt = toNative(e);
			
			// Check if we're close to the first point (auto-close polygon)
			if (poly.points.length >= 3) {
				const firstPt = poly.points[0];
				const distance = Math.sqrt(
					Math.pow(pt.x - firstPt.x, 2) + 
					Math.pow(pt.y - firstPt.y, 2)
				);
				
				// If within 4 pixels of the start, close the polygon and start a new one
				if (distance <= 4) {
					// Close current polygon
					list[idx] = { ...poly, closed: true };
					
					// Create a new polygon and make it active
					const newIdx = list.length;
					list.push({ points: [], closed: false, name: `Polygon ${newIdx + 1}` });
					setTimeout(() => setActive(newIdx), 0);
					
					return list;
				}
			}
			
			list[idx] = { ...poly, points: [...poly.points, pt] };
			return list;
		});
	}

	function undoPoint() {
		if (active < 0 || active >= polys.length) return;
		setPolys(prev => {
			const next = prev.slice();
			const poly = { ...next[active] };
			if (poly.closed || poly.points.length === 0) return next;
			poly.points = poly.points.slice(0, -1);
			next[active] = poly;
			return next;
		});
	}

	function deletePolygon() {
		if (active < 0 || active >= polys.length) return;
		setPolys(prev => {
			const filtered = prev.filter((_, i) => i !== active);
			// After filtering, select the last polygon if any remain
			if (filtered.length > 0) {
				setActive(filtered.length - 1);
			} else {
				setActive(-1);
			}
			return filtered;
		});
	}

	function clearAll() {
		setPolys([]);
		setActive(-1);
	}

	function selectPrev() {
		if (polys.length === 0) return;
		// Auto-finish the current polygon before switching
		finishActiveIfOpen();
		setActive(prev => {
			if (prev < 0) return polys.length - 1;
			return (prev - 1 + polys.length) % polys.length;
		});
	}

	function selectNext() {
		if (polys.length === 0) return;
		// Auto-finish the current polygon before switching
		finishActiveIfOpen();
		setActive(prev => {
			if (prev < 0) return 0;
			return (prev + 1) % polys.length;
		});
	}

	// Build mask canvas from a provided list of polygons
	function buildMaskCanvasFrom(list: Poly[]): HTMLCanvasElement | null {
		const { w, h } = nativeSize;
		if (!w || !h) return null;
		const mc = document.createElement("canvas");
		mc.width = w; mc.height = h;
		const mctx = mc.getContext("2d")!;
		mctx.clearRect(0, 0, w, h);
		mctx.fillStyle = "#ffffff";
		for (const poly of list) {
			if (poly.points.length < 3) continue;
			mctx.beginPath();
			mctx.moveTo(poly.points[0].x, poly.points[0].y);
			for (let i = 1; i < poly.points.length; i++) mctx.lineTo(poly.points[i].x, poly.points[i].y);
			mctx.closePath();
			mctx.fill();
		}
		return mc;
	}

	// Save PNG locally (auto-finish all polygons first)
	async function savePng() {
		const closed = finishAllPolygonsForExport();
		const mc = buildMaskCanvasFrom(closed);
		if (!mc) return;
		const blob: Blob = await new Promise(res => mc.toBlob(b => res(b!), "image/png"));
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `mask_${meta.camera}_${meta.index}_${meta.frame}.png`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	// Send mask as array (auto-finish all polygons first)
	async function sendArray() {
		const closed = finishAllPolygonsForExport();
		const mc = buildMaskCanvasFrom(closed);
		if (!mc) return;
		const mctx = mc.getContext("2d")!;
		const { w, h } = nativeSize;
		const id = mctx.getImageData(0, 0, w, h);
		const N = w * h;
		const out = new Uint8Array(N);
		for (let i = 0; i < N; i++) out[i] = id.data[i * 4] > 0 ? 1 : 0;

		// NEW: serialize polygon corner data (native coordinates)
		const polygons = closed
			.filter(p => p.points.length >= 3)
			.map((p, i) => ({
				index: i,
				name: p.name,
				points: p.points.map(pt => [pt.x, pt.y]) // keep as number[][] for compact JSON
			}));

		const payload = {
			meta,
			width: w,
			height: h,
			data: Array.from(out),
			polygons
		};

		await fetch(arrayPostUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
	}

	// NEW: function to load mask data from backend
	async function loadMaskFromPath() {
		if (!maskPath.trim()) return;
		
		setLoadingMask(true);
		try {
			// Query params for the backend
			const params = new URLSearchParams({
				path: maskPath,
				// Include current meta data to help backend locate the right mask
				basepath_idx: String(meta.basePathIdx),
				camera: meta.camera,
				index: String(meta.index),
				frame: meta.frame
			});
			
			const response = await fetch(`http://localhost:3000/backend/load_mask?${params}`);
			if (!response.ok) {
				throw new Error(`Failed to load mask: ${response.statusText}`);
			}
			
			const data = await response.json();
			
			// Check if we received polygon data
			if (data.polygons && Array.isArray(data.polygons)) {
				// Convert the backend format to our Poly format
				const loadedPolys: Poly[] = data.polygons.map((poly: any, idx: number) => {
					// Convert array points [x,y] to {x,y} objects
					const points = Array.isArray(poly.points) 
						? poly.points.map((p: number[]) => ({ x: p[0], y: p[1] }))
						: [];
						
					return {
						points,
						closed: true, // Loaded polygons are always closed
						name: poly.name || `Polygon ${idx + 1}`
					};
				});
				
				// Set the polygons and select the first one if available
				setPolys(loadedPolys);
				setActive(loadedPolys.length > 0 ? 0 : -1);
			}
		} catch (error) {
			console.error("Error loading mask:", error);
			// Could add an error state here to show in the UI
		} finally {
			setLoadingMask(false);
		}
	}
	
	return (
		<div className="w-full">
			<div className="flex items-center justify-between mb-2">
				<span className="text-sm font-medium text-gray-600">{title}</span>
				{/* native size display (toggle moved into image container) */}
				{nativeSize.w > 0 && nativeSize.h > 0 && (
					<span className="text-xs text-gray-500">Native: {nativeSize.w} × {nativeSize.h} px</span>
				)}
			</div>
			{/* NEW: Add mask path input and load button */}
			<div className="flex items-center gap-2 mb-3">
				<Input 
					placeholder="Enter mask path..." 
					value={maskPath} 
					onChange={(e) => setMaskPath(e.target.value)}
					className="flex-grow"
				/>
				<Button 
					size="sm" 
					onClick={loadMaskFromPath} 
					disabled={loadingMask || !maskPath.trim()}
					className="whitespace-nowrap"
				>
					{loadingMask ? "Loading..." : "Load Mask"}
				</Button>
			</div>

			{/* Helpful hint about edge snapping and auto-closing */}
			<div className="mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700">
				<strong>💡 Tips:</strong> Click near image edges to snap to edge pixels (magnifier turns <span className="text-orange-600 font-semibold">orange</span>). 
				Click within 4 pixels of the starting point (shown as a <span className="text-pink-600 font-semibold">larger red circle</span>) to auto-close and start a new polygon.
			</div>

			{/* Controls placed just below the mask path input (outside gray area) */}
			<div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
				<div className="flex items-center gap-2 justify-start">
					<Button size="sm" variant="outline" onClick={startNewPolygon}>New polygon</Button>
					<Button size="sm" variant="outline" onClick={undoPoint} disabled={active < 0}>Undo point</Button>
					<Button size="sm" variant="outline" onClick={deletePolygon} disabled={active < 0}>Delete</Button>
				</div>
				<div className="flex items-center gap-2 justify-center">
					<Button size="sm" onClick={selectPrev} disabled={polys.length === 0}>Prev</Button>
					<select
						className="border rounded px-2 py-1 text-sm"
						value={active}
						onChange={e => setActive(parseInt(e.target.value))}
					>
						<option value={-1}>None</option>
						{polys.map((p, i) => (
							<option key={i} value={i}>{p.name || `Polygon ${i + 1}`}</option>
						))}
					</select>
					<Button size="sm" onClick={selectNext} disabled={polys.length === 0}>Next</Button>
				</div>
				<div className="flex items-center gap-2 justify-end">
					<Button size="sm" variant={magnifierEnabled ? "default" : "outline"} onClick={() => setMagnifierEnabled(v => !v)}>
						{magnifierEnabled ? "🔎 On" : "🔍"}
					</Button>
					<Button size="sm" className="bg-soton-blue text-white" onClick={savePng} disabled={nativeSize.w === 0}>Save PNG</Button>
					<Button size="sm" variant="secondary" onClick={sendArray} disabled={nativeSize.w === 0}>Save Mask</Button>
					<Button size="sm" variant="destructive" onClick={clearAll}>Clear all</Button>
				</div>
			</div>

			<div
				ref={containerRef}
				className="bg-black/80 rounded-md overflow-visible border border-gray-200 flex justify-center items-center cursor-crosshair"
				onPointerDown={(e) => {
					// If the click is directly on the container (not a child element)
					// or if we're in the padding area, add the point
					if (e.currentTarget === e.target) {
						e.preventDefault();
						addPoint(e);
					}
				}}
			>
				{/* NEW: wrapper that gets exact W×H so overlay/base align and can be centered */}
				<div ref={wrapperRef} className="relative cursor-crosshair" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>
 					<canvas ref={viewRef} className="block" />
 					<canvas
 						ref={overlayRef}
 						className="absolute cursor-crosshair"
 						onPointerDown={(e) => {
 						 e.stopPropagation();
 						 addPoint(e);
 						}}
 					/>
 					{/* Magnifier canvas (fixed positioning, centered on cursor) */}
 					<canvas
 						ref={magRef}
 						style={{
 							display: magVisible && magnifierEnabled ? "block" : "none",
 							position: "fixed",
 							pointerEvents: "none",
 							zIndex: 9999,
 							width: MAG_SIZE,
 							height: MAG_SIZE,
 							left: magPos.left,
 							top: magPos.top,
 							borderRadius: "50%",
 							boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
 							border: "2px solid #333",
 						}}
 					/>
 				</div>
 			</div>
 

		</div>
	);
}

export default PolygonMaskEditor;