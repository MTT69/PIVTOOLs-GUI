import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useImagePair } from "@/hooks/useImagePair";
import PolygonMaskEditor from "@/components/PolygonMaskEditor";

const basename = (p: string) => {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.filter(Boolean).pop() || p;
};

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

	// Use the centralized hook for fetching images
	const { loading, error, imgA, imgB, reload } = useImagePair("/backend", basePathIdx, camera, index);
	const currentImg = frame === "A" ? imgA : imgB;

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
				</CardContent>
			</Card>

			<div className="flex flex-col items-center mt-6">
				{currentImg && (
					<PolygonMaskEditor
						raw={null}
						src={currentImg}
						vmin={0}
						vmax={255}
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