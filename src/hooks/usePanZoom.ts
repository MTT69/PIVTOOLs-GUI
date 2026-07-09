import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

// Headless pan / box-zoom interaction shared by the masking views.
//
// This is the same interaction model as the image viewer's ZoomableCanvas
// (drag a rectangle to zoom, drag to pan, Fit to reset) factored out so both
// masking sub-views (PolygonMaskEditor + PixelBorderViewer) stay in sync
// without touching ZoomableCanvas itself.
//
// The consumer supplies a fixed "viewport" element (overflow:hidden) via
// viewportRef, attaches the returned mouse handlers to it, and applies
//   transform: translate(pan.x px, pan.y px) scale(zoom); transform-origin: 0 0
// to an inner wrapper that holds its canvases.

export interface PanZoomRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface UsePanZoomOptions {
	// When provided, a press-release that moved less than clickThreshold pixels
	// (and not during box-zoom) is treated as a click rather than a pan, and
	// fires onClick with the raw viewport-client coordinates. Consumers that
	// have no click interaction (e.g. a read-only preview) omit this and every
	// drag pans.
	onClick?: (clientX: number, clientY: number) => void;
	clickThreshold?: number;
}

export interface UsePanZoom {
	zoom: number;
	pan: { x: number; y: number };
	boxZoomMode: boolean;
	setBoxZoomMode: (v: boolean) => void;
	selectionRect: PanZoomRect | null;
	isDragging: boolean;
	onMouseDown: (e: React.MouseEvent) => void;
	onMouseMove: (e: React.MouseEvent) => void;
	onMouseUp: (e: React.MouseEvent) => void;
	// Reset to a centred "fit" view for content of the given CSS size.
	resetView: (contentW: number, contentH: number) => void;
}

export function usePanZoom(
	viewportRef: React.RefObject<HTMLElement | null>,
	options: UsePanZoomOptions = {}
): UsePanZoom {
	const { onClick, clickThreshold = 5 } = options;

	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [boxZoomMode, setBoxZoomMode] = useState(false);
	const [isSelecting, setIsSelecting] = useState(false);
	const [selectionRect, setSelectionRect] = useState<PanZoomRect | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	const selectionStart = useRef({ x: 0, y: 0 });
	const lastPos = useRef({ x: 0, y: 0 });
	const clickStart = useRef({ x: 0, y: 0 });

	// Clear any in-progress selection whenever box-zoom is switched off.
	useEffect(() => {
		if (!boxZoomMode) {
			setIsSelecting(false);
			setSelectionRect(null);
		}
	}, [boxZoomMode]);

	const onMouseDown = (e: React.MouseEvent) => {
		const rect = viewportRef.current?.getBoundingClientRect();
		if (!rect) return;
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;
		if (boxZoomMode) {
			setIsSelecting(true);
			selectionStart.current = { x: mouseX, y: mouseY };
			setSelectionRect({ x: mouseX, y: mouseY, w: 0, h: 0 });
		} else {
			setIsDragging(true);
			lastPos.current = { x: e.clientX, y: e.clientY };
			clickStart.current = { x: mouseX, y: mouseY };
		}
	};

	const onMouseMove = (e: React.MouseEvent) => {
		const rect = viewportRef.current?.getBoundingClientRect();
		if (!rect) return;
		if (isSelecting) {
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;
			setSelectionRect({
				x: Math.min(selectionStart.current.x, mouseX),
				y: Math.min(selectionStart.current.y, mouseY),
				w: Math.abs(mouseX - selectionStart.current.x),
				h: Math.abs(mouseY - selectionStart.current.y),
			});
			return;
		}
		if (!isDragging) return;
		const dx = e.clientX - lastPos.current.x;
		const dy = e.clientY - lastPos.current.y;
		lastPos.current = { x: e.clientX, y: e.clientY };
		setPan(p => ({ x: p.x + dx, y: p.y + dy }));
	};

	const onMouseUp = (e: React.MouseEvent) => {
		const viewport = viewportRef.current;
		const rect = viewport?.getBoundingClientRect();

		// Click detection: a press-release that barely moved is a click, not a pan.
		if (onClick && isDragging && !boxZoomMode && rect) {
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;
			const dx = mouseX - clickStart.current.x;
			const dy = mouseY - clickStart.current.y;
			if (Math.sqrt(dx * dx + dy * dy) < clickThreshold) {
				onClick(e.clientX, e.clientY);
			}
		}

		// Commit a box zoom (ignore stray clicks / tiny drags via the 10px gate).
		if (isSelecting && selectionRect && selectionRect.w > 10 && selectionRect.h > 10 && viewport) {
			const newScale =
				Math.min(viewport.clientWidth / selectionRect.w, viewport.clientHeight / selectionRect.h) * zoom;

			const selectionCenterX = selectionRect.x + selectionRect.w / 2;
			const selectionCenterY = selectionRect.y + selectionRect.h / 2;

			// screen = content * scale + pan  =>  content = (screen - pan) / scale
			const contentCenterX = (selectionCenterX - pan.x) / zoom;
			const contentCenterY = (selectionCenterY - pan.y) / zoom;

			const viewportCenterX = viewport.clientWidth / 2;
			const viewportCenterY = viewport.clientHeight / 2;

			setZoom(newScale);
			setPan({
				x: viewportCenterX - contentCenterX * newScale,
				y: viewportCenterY - contentCenterY * newScale,
			});
			setBoxZoomMode(false); // auto-exit after one zoom, like the image viewer
		}

		setIsDragging(false);
		setIsSelecting(false);
		setSelectionRect(null);
	};

	const resetView = useCallback((contentW: number, contentH: number) => {
		const viewport = viewportRef.current;
		if (!viewport || !contentW || !contentH) return;
		const s = Math.min(viewport.clientWidth / contentW, viewport.clientHeight / contentH);
		setZoom(s);
		setPan({
			x: (viewport.clientWidth - contentW * s) / 2,
			y: (viewport.clientHeight - contentH * s) / 2,
		});
	}, [viewportRef]);

	return {
		zoom,
		pan,
		boxZoomMode,
		setBoxZoomMode,
		selectionRect,
		isDragging,
		onMouseDown,
		onMouseMove,
		onMouseUp,
		resetView,
	};
}

export default usePanZoom;
