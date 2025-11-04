import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useImagePair } from "@/hooks/useImagePair";
import PolygonMaskEditor from "@/components/PolygonMaskEditor";
import { basename } from "@/lib/utils";
import * as Slider from '@radix-ui/react-slider';

const Masking: React.FC<{ config?: any }> = ({ config }) => {
  const sourcePaths = config?.paths?.source_paths || [];
  const [basePathIdx, setBasePathIdx] = useState(0);
  const [camera, setCamera] = useState("Cam1");
	// derive camera options from config if provided
	const cameraOptions: string[] = (() => {
		// Prefer paths.camera_numbers (array with first element number of cameras)
		const nFromPaths = config?.paths?.camera_numbers?.length ? Number(config.paths.camera_numbers[0]) : undefined;
		const nFromIm = config?.imProperties?.cameraCount ? Number(config.imProperties.cameraCount) : undefined;
		const n = (Number.isFinite(nFromPaths as number) && (nFromPaths as number) > 0)
			? (nFromPaths as number)
			: (Number.isFinite(nFromIm as number) && (nFromIm as number) > 0) ? (nFromIm as number) : 1;
		const count = Number.isFinite(n) ? n : 1;
		return Array.from({ length: count }, (_, i) => `Cam${i + 1}`);
	})();

	// ensure camera state reflects available options
	useEffect(() => {
		if (cameraOptions.length === 0) return;
		if (!cameraOptions.includes(camera)) setCamera(cameraOptions[0]);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cameraOptions.length, cameraOptions[0]]);
	const [index, setIndex] = useState(1);
	const [frame, setFrame] = useState<"A" | "B">("A");

	// Add contrast control state
	const [vmin, setVmin] = useState(0);
	const [vmax, setVmax] = useState(255);
	const [autoScale, setAutoScale] = useState(true);
	const [manuallyAdjusted, setManuallyAdjusted] = useState(false);
	const [lastAutoContrastKey, setLastAutoContrastKey] = useState<string>('');

	// Use the centralized hook for fetching images
	const { loading, error, imgA, imgB, imgARaw, imgBRaw, metadata, vmin: autoVmin, vmax: autoVmax, reload } = useImagePair("/backend", basePathIdx, camera, index);
	const currentImg = frame === "A" ? imgA : imgB;
	const currentRaw = frame === "A" ? imgARaw : imgBRaw;
	const maxVal = metadata?.bitDepth ? 2 ** metadata.bitDepth - 1 : 255;

	// Reset manual adjustment flags when auto-scale is re-enabled
	useEffect(() => {
		if (autoScale) {
			setManuallyAdjusted(false);
			setLastAutoContrastKey(''); // Force re-calculation
		}
	}, [autoScale]);

	// Reset manual adjustment flags when image changes
	useEffect(() => {
		setManuallyAdjusted(false);
	}, [basePathIdx, camera, index, frame]);

	// Auto-contrast when image loads or changes
	useEffect(() => {
		const currentKey = `${basePathIdx}-${camera}-${index}-${frame}`;
		
		// Only proceed if we have image data
		if (!currentRaw && !currentImg) {
			return;
		}
		
		if (autoScale && !manuallyAdjusted) {
			// Always apply auto-contrast if key changed or was reset
			if (lastAutoContrastKey !== currentKey || lastAutoContrastKey === '') {
				if (currentRaw) {
					// Use raw data auto-contrast from useImagePair
					if (autoVmin !== undefined && autoVmax !== undefined && (autoVmin !== 0 || autoVmax !== 255)) {
						setVmin(autoVmin);
						setVmax(autoVmax);
						setLastAutoContrastKey(currentKey);
					}
				} else if (currentImg) {
					// Analyze PNG for auto-contrast
					const analyzePngContrast = async () => {
						try {
							const pngDataUrl = `data:image/png;base64,${currentImg}`;
							const img = new Image();
							img.onload = () => {
								try {
									const canvas = document.createElement('canvas');
									const ctx = canvas.getContext('2d');
									if (!ctx) return;
									
									canvas.width = img.width;
									canvas.height = img.height;
									ctx.drawImage(img, 0, 0);
									
									const imageData = ctx.getImageData(0, 0, img.width, img.height);
									const pixels = imageData.data;
									const grayscaleValues = [];
									
									for (let i = 0; i < pixels.length; i += 4) {
										const r = pixels[i];
										const g = pixels[i + 1];
										const b = pixels[i + 2];
										const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
										grayscaleValues.push(gray);
									}
									
									grayscaleValues.sort((a, b) => a - b);
									
									const p1Index = Math.floor(grayscaleValues.length * 0.01);
									const p99Index = Math.floor(grayscaleValues.length * 0.99);
									
									const vminAnalyzed = grayscaleValues[p1Index];
									const vmaxAnalyzed = grayscaleValues[p99Index];
									
									setVmin(vminAnalyzed);
									setVmax(vmaxAnalyzed);
									setLastAutoContrastKey(currentKey);
								} catch (err) {
									console.warn('[Masking] PNG auto-contrast analysis failed:', err);
									setVmin(0);
									setVmax(255);
									setLastAutoContrastKey(currentKey);
								}
							};
							img.src = pngDataUrl;
						} catch (err) {
							console.warn('[Masking] PNG auto-contrast failed:', err);
							setVmin(0);
							setVmax(255);
							setLastAutoContrastKey(currentKey);
						}
					};
					analyzePngContrast();
				}
			}
		}
	}, [currentImg, currentRaw, autoVmin, autoVmax, basePathIdx, camera, index, frame, lastAutoContrastKey, manuallyAdjusted, autoScale]);

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Raw Image Viewer</CardTitle>
					<CardDescription>
						Load and view raw images. Select source path, camera, image index, and frame. Create mask polygons and export.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
						<div>
							<Label htmlFor="basepath">Source Path</Label>
							<Select value={String(basePathIdx)} onValueChange={v => setBasePathIdx(Number(v))}>
								<SelectTrigger id="basepath"><SelectValue placeholder="Pick base path" /></SelectTrigger>
								<SelectContent>
									{sourcePaths.map((p: string, i: number) => (
										<SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label htmlFor="camera">Camera</Label>
							<Select value={camera} onValueChange={v => setCamera(v)}>
								<SelectTrigger id="camera"><SelectValue placeholder="Select camera" /></SelectTrigger>
								<SelectContent>
									{cameraOptions.map((c, i) => (
										<SelectItem key={i} value={c}>{c}</SelectItem>
									))}
								</SelectContent>
							</Select>
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
							<Button
								id="load-image-btn"
								className="bg-soton-blue hover:bg-soton-darkblue"
								onClick={reload}
								disabled={loading}
							>
								{loading ? "Loading..." : "Load Image"}
							</Button>
						</div>
					</div>

					{/* Contrast Controls */}
					{currentImg && (
						<div className="mt-4 space-y-3 p-3 border rounded-md">
							<div className="flex items-center gap-2">
								<Label>Contrast Controls</Label>
								<div className="flex items-center gap-2 ml-auto">
									<Switch id="auto-scale" checked={autoScale} onCheckedChange={setAutoScale} />
									<Label htmlFor="auto-scale" className="text-sm">Auto Scale</Label>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<Input 
									type="number" 
									value={vmin} 
									min={0} 
									max={vmax} 
									onChange={e => {
										setManuallyAdjusted(true);
										setAutoScale(false);
										const val = Math.min(Number(e.target.value), vmax);
										setVmin(val);
										if (val > vmax) setVmax(val);
									}} 
									className="w-20 h-8" 
								/>
								<div className="w-full min-w-0">
									<Slider.Root
										className="relative flex items-center select-none touch-none w-full h-5"
										min={0}
										max={maxVal}
										step={1}
										value={[vmin, vmax]}
										onValueChange={([min, max]) => {
											setManuallyAdjusted(true);
											setAutoScale(false);
											setVmin(min);
											setVmax(max);
										}}
									>
										<Slider.Track className="bg-gray-200 relative grow rounded-full h-[3px]">
											<Slider.Range className="absolute bg-blue-500 rounded-full h-full" />
										</Slider.Track>
										<Slider.Thumb className="block w-5 h-5 bg-white rounded-[10px] border border-gray-300 hover:bg-gray-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50" />
										<Slider.Thumb className="block w-5 h-5 bg-white rounded-[10px] border border-gray-300 hover:bg-gray-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50" />
									</Slider.Root>
								</div>
								<Input 
									type="number" 
									value={vmax} 
									min={vmin} 
									max={maxVal} 
									onChange={e => {
										setManuallyAdjusted(true);
										setAutoScale(false);
										const val = Math.max(Number(e.target.value), vmin);
										setVmax(val);
										if (val < vmin) setVmin(val);
									}} 
									className="w-20 h-8" 
								/>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			<div className="flex flex-col items-center mt-6">
				{currentImg && (
					<PolygonMaskEditor
						key={`${basePathIdx}-${camera}-${index}-${frame}`}
						raw={currentRaw}
						src={currentRaw ? undefined : currentImg}
						vmin={vmin}
						vmax={vmax}
						title="Polygon Mask Editor"
						meta={{ basePathIdx, camera, index, frame }}
						arrayPostUrl="/backend/save_mask_array"
					/>
				)}
				{loading && <div className="text-center text-gray-500">Loading image...</div>}
				{(!currentImg && !loading) && (
					<div className="text-center text-gray-400">No image loaded.</div>
				)}
				{error && <div className="text-red-600 mt-2">{error}</div>}
			</div>
		</div>
	);
};

export default Masking;