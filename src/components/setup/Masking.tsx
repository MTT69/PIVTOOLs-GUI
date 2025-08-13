import React, { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type DType = "uint8" | "uint16";
type RawImage = {
	data: Uint8Array | Uint16Array;
	width: number;
	height: number;
	bitDepth: number;
	dtype: DType;
};

function base64ToArrayBuffer(base64: string) {
	const binary_string = typeof window !== 'undefined' ? window.atob(base64) : Buffer.from(base64, 'base64').toString('binary');
	const len = binary_string.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) bytes[i] = binary_string.charCodeAt(i);
	return bytes.buffer;
}

function decodeTypedArray(base64: string, dtype: DType) {
	const buf = base64ToArrayBuffer(base64);
	if (dtype === "uint16") return new Uint16Array(buf);
	return new Uint8Array(buf);
}

function percentileFromRaw(arr: Uint8Array | Uint16Array, p: number) {
	const n = arr.length;
	const sampleSize = Math.min(n, 200_000);
	if (sampleSize === n) {
		const copy = Array.from(arr as any as number[]);
		copy.sort((a, b) => a - b);
		const idx = Math.min(copy.length - 1, Math.max(0, Math.floor((p / 100) * copy.length)));
		return copy[idx];
	}
	const step = Math.max(1, Math.floor(n / sampleSize));
	const sample: number[] = [];
	for (let i = 0; i < n && sample.length < sampleSize; i += step) sample.push(Number(arr[i]));
	sample.sort((a, b) => a - b);
	const idx = Math.min(sample.length - 1, Math.max(0, Math.floor((p / 100) * sample.length)));
	return sample[idx];
}

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

	const [nativeSize, setNativeSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

	// polygons state: array of {points, closed}
	type Pt = { x: number; y: number };
	type Poly = { points: Pt[]; closed: boolean; name: string };
	const [polys, setPolys] = useState<Poly[]>([]);
	const [active, setActive] = useState<number>(-1);

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

	// ResizeObserver to keep canvas sized to container
	useEffect(() => {
		if (!containerRef.current) return;
		const ro = new ResizeObserver(() => redraw());
		ro.observe(containerRef.current);
		return () => ro.disconnect();
	}, []);

	// Redraw on inputs
	useEffect(() => { redraw(); }, [mappedRaw, nativeSize, polys, active]);

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

		// Ensure canvas buffers AND CSS sizes match
		base.width = W; base.height = H;
		overlay.width = W; overlay.height = H;
		base.style.width = `${W}px`; base.style.height = `${H}px`;
		overlay.style.width = `${W}px`; overlay.style.height = `${H}px`;

		// NEW: size the wrapper so we can center it
		if (wrapperRef.current) {
			wrapperRef.current.style.width = `${W}px`;
			wrapperRef.current.style.height = `${H}px`;
		}

		const bctx = base.getContext("2d")!;
		bctx.clearRect(0, 0, W, H);
		// Draw base image
		if (mappedRaw) {
			const tmp = document.createElement("canvas");
			tmp.width = w; tmp.height = h;
			tmp.getContext("2d")!.putImageData(mappedRaw, 0, 0);
			bctx.imageSmoothingEnabled = true;
			bctx.drawImage(tmp, 0, 0, w, h, 0, 0, W, H);
		} else if (imgRef.current) {
			bctx.drawImage(imgRef.current, 0, 0, w, h, 0, 0, W, H);
		}

		// Draw polygons overlay
		const octx = overlay.getContext("2d")!;
		octx.clearRect(0, 0, W, H);
		octx.lineWidth = 2;
		for (let i = 0; i < polys.length; i++) {
			const poly = polys[i];
			if (poly.points.length === 0) continue;
			octx.beginPath();
			poly.points.forEach((p, idx) => {
				const vx = (p.x / w) * W, vy = (p.y / h) * H;
				if (idx === 0) octx.moveTo(vx, vy); else octx.lineTo(vx, vy);
			});
			if (poly.closed && poly.points.length >= 3) octx.closePath();
			octx.strokeStyle = i === active ? "#00ff88" : "#ffcc00";
			octx.stroke();

			// vertices
			for (const p of poly.points) {
				const vx = (p.x / w) * W, vy = (p.y / h) * H;
				octx.fillStyle = i === active ? "#00ff88" : "#ffcc00";
				octx.beginPath(); octx.arc(vx, vy, 3, 0, Math.PI * 2); octx.fill();
			}
		}
	}

	// Map pointer to native coordinates
	function toNative(e: React.PointerEvent<HTMLCanvasElement>) {
		const overlay = overlayRef.current!;
		const rect = overlay.getBoundingClientRect();
		const { w, h } = nativeSize;

		// Use CSS size (rect) to avoid devicePixelRatio/canvas pixel mismatch
		const vx = e.clientX - rect.left;
		const vy = e.clientY - rect.top;
		const nx = (vx / rect.width) * w;
		const ny = (vy / rect.height) * h;
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
			const next = [...prev, { points: [], closed: false, name: `Poly ${idx + 1}` }];
			setActive(idx);
			return next;
		});
	}

	function addPoint(e: React.PointerEvent<HTMLCanvasElement>) {
		e.preventDefault();
		if (nativeSize.w === 0) return;

		setPolys(prev => {
			let list = [...prev];
			let idx = active;

			// If no active polygon or out-of-range, create a new one now and use it
			if (idx < 0 || idx >= list.length) {
				idx = list.length;
				list.push({ points: [], closed: false, name: `Poly ${idx + 1}` });
				// update active to the newly created polygon
				if (active !== idx) setActive(idx);
			}

			const poly = list[idx];
			if (poly.closed) return list;

			const pt = toNative(e);
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
		setPolys(prev => prev.filter((_, i) => i !== active));
		setActive(-1);
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
						name: poly.name || `Poly ${idx + 1}`
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
				{/* NEW: native size display */}
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
			<div
				ref={containerRef}
				// NEW: center the wrapper horizontally
				className="w-full bg-black/80 rounded-md overflow-hidden border border-gray-200 relative flex justify-center"
			>
				{/* NEW: wrapper that gets exact W×H so overlay/base align and can be centered */}
				<div ref={wrapperRef} className="relative">
					<canvas ref={viewRef} className="block" />
					<canvas
						ref={overlayRef}
						className="absolute left-0 top-0 cursor-crosshair"
						onPointerDown={addPoint}
					/>
				</div>
			</div>

			{/* controls */}
			<div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
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
					<Button size="sm" className="bg-soton-blue text-white" onClick={savePng} disabled={nativeSize.w === 0}>Save PNG</Button>
					<Button size="sm" variant="secondary" onClick={sendArray} disabled={nativeSize.w === 0}>Save .mat</Button>
					<Button size="sm" variant="destructive" onClick={clearAll}>Clear all</Button>
				</div>
			</div>
		</div>
	);
}

const Masking: React.FC = () => {
	const [basePathIdx, setBasePathIdx] = useState(0);
	const [camera, setCamera] = useState("Cam1");
	const [index, setIndex] = useState(1);
	const [frame, setFrame] = useState<"A" | "B">("A");
	const [loading, setLoading] = useState(false);
	const [rawImage, setRawImage] = useState<RawImage | null>(null);
	const [pngImage, setPngImage] = useState<string | null>(null);
	const [pendingRawImage, setPendingRawImage] = useState<RawImage | null>(null);
	const [pendingPngImage, setPendingPngImage] = useState<string | null>(null);
	const [bitDepth, setBitDepth] = useState<number | null>(null);
	const [dtype, setDtype] = useState<DType | null>(null);
	const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
	const [vmin, setVmin] = useState(0);
	const [vmax, setVmax] = useState(255);
	const [error, setError] = useState<string | null>(null);

	const maxVal = useMemo(() => {
		if (bitDepth) return Math.pow(2, bitDepth) - 1;
		return 255;
	}, [bitDepth]);

	async function fetchMaskingImage() {
		setLoading(true);
		setError(null);
		setPendingRawImage(null);
		setPendingPngImage(null);
		try {
			const url = `http://localhost:3000/backend/get_raw_image?basepath_idx=${basePathIdx}&camera=${encodeURIComponent(camera)}&index=${index}&frame=${frame}`;
			const res = await fetch(url);
			const data = await res.json();
			console.log("Backend response:", data);
			if (!res.ok) throw new Error(data.error || "Failed to fetch image");
			if (data.meta && data.raw) {
				const meta = data.meta as { width: number; height: number; bitDepth: number; dtype: DType };
				setBitDepth(meta.bitDepth);
				setDtype(meta.dtype);
				setDimensions({ width: meta.width, height: meta.height });
				const arr = decodeTypedArray(data.raw, meta.dtype);
				setPendingRawImage({ data: arr, width: meta.width, height: meta.height, bitDepth: meta.bitDepth, dtype: meta.dtype });
				setPendingPngImage(null);
				// Auto-limits
				const p1 = percentileFromRaw(arr, 1);
				const p99 = percentileFromRaw(arr, 99);
				setVmin(Math.floor(p1));
				setVmax(Math.ceil(p99));
			} else if (data.image) {
				setPendingRawImage(null);
				setPendingPngImage(data.image);
				setBitDepth(data.bitDepth ?? null);
				setDtype((data.dtype as DType) ?? null);
				setDimensions(null);
				setVmin(0);
				setVmax(255);
			} else {
				setPendingRawImage(null);
				setPendingPngImage(null);
				setError("No image data returned from backend.");
				return;
			}
		} catch (e: any) {
			setPendingRawImage(null);
			setPendingPngImage(null);
			setError(e.message || "Error fetching image");
		} finally {
			setLoading(false);
			// Only update displayed image after loading completes
			if (error) return;
			if (pendingRawImage || pendingPngImage) {
				setRawImage(pendingRawImage);
				setPngImage(pendingPngImage);
			}
		}
	}

	function autoLimitsRaw() {
		if (!rawImage?.data) return;
		const p1 = percentileFromRaw(rawImage.data, 1);
		const p99 = percentileFromRaw(rawImage.data, 99);
		setVmin(Math.floor(p1));
		setVmax(Math.ceil(p99));
	}

	useEffect(() => {
		fetchMaskingImage();
		// eslint-disable-next-line
	}, [basePathIdx, camera, index, frame]);

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Raw Image Viewer</CardTitle>
					<CardDescription>
						Load and view raw images. Select base path, camera, image index, and frame. Create mask polygons and export.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
						<div>
							<Label htmlFor="basepath">Base Path Index</Label>
							<Input id="basepath" type="number" value={basePathIdx} min={0} onChange={e => setBasePathIdx(Number(e.target.value))} />
						</div>
						<div>
							<Label htmlFor="camera">Camera</Label>
							<Input id="camera" placeholder="e.g. Cam1" value={camera} onChange={e => setCamera(e.target.value)} />
						</div>
						<div>
							<Label htmlFor="index">Image Index</Label>
							<Input id="index" type="number" value={index} min={1} onChange={e => setIndex(Math.max(1, Number(e.target.value)))} />
						</div>
						<div>
							<Label>Frame</Label>
							<div className="flex gap-2">
								<Button size="sm" variant={frame === "A" ? "default" : "outline"} onClick={() => setFrame("A")}>A</Button>
								<Button size="sm" variant={frame === "B" ? "default" : "outline"} onClick={() => setFrame("B")}>B</Button>
							</div>
						</div>
						<div className="md:col-span-2 flex items-center gap-3">
							<Button className="bg-soton-blue hover:bg-soton-darkblue" onClick={fetchMaskingImage} disabled={loading}>
								{loading ? "Loading..." : "Load Image"}
							</Button>
						</div>
					</div>
					<div className="flex items-center gap-2 mt-4">
						<Label htmlFor="vmin">Min</Label>
						<Input
							id="vmin"
							type="number"
							value={vmin}
							onChange={e => {
								const val = Number.isNaN(parseInt(e.target.value)) ? 0 : parseInt(e.target.value);
								const newMin = Math.max(0, Math.min(maxVal, val));
								setVmin(newMin);
								if (newMin > vmax) setVmax(newMin);
							}}
							className="w-20"
						/>
						<Label htmlFor="vmax">Max</Label>
						<Input
							id="vmax"
							type="number"
							value={vmax}
							onChange={e => {
								const val = Number.isNaN(parseInt(e.target.value)) ? 0 : parseInt(e.target.value);
								const newMax = Math.max(0, Math.min(maxVal, val));
								setVmax(newMax);
								if (newMax < vmin) setVmin(newMax);
							}}
							className="w-20"
						/>
						<Button size="sm" variant="secondary" onClick={autoLimitsRaw} disabled={!rawImage}>Auto</Button>
					</div>
				</CardContent>
			</Card>

			<div className="flex flex-col items-center mt-6">
				{(rawImage || pngImage) && (
					<PolygonMaskEditor
						raw={rawImage}
						src={pngImage}
						vmin={vmin}
						vmax={vmax}
						title="Polygon Mask Editor"
						meta={{ basePathIdx, camera, index, frame }}
						arrayPostUrl="http://localhost:3000/backend/save_mask_array"
					/>
				)}
				{loading && <div className="text-center text-gray-500">Loading image...</div>}
				{(!rawImage && !pngImage && !loading) && (
					<div className="text-center text-gray-400">No image loaded.</div>
				)}
				{error && <div className="text-red-600 mt-2">{error}</div>}
			</div>
		</div>
	);
};

export default Masking;
