"use client";
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useVectorViewer } from "@/hooks/useVectorViewer";

export default function VectorViewer({ backendUrl = "/backend", config }: { backendUrl?: string; config?: any }) {
  const {
    basePaths,
    basePathIdx,
    setBasePathIdx,
    index,
    setIndex,
    type,
    setType,
    run,
    setRun,
    lower,
    setLower,
    upper,
    setUpper,
    cmap,
    setCmap,
    imageSrc,
    meta,
    loading,
    error,
    cameraOptions,
    camera,
    setCamera,
    merged,
    setMerged,
    playing,
    limitsLoading,
    meanMode,
    statsLoading,
    statsError,
    statVars,
    statVarsLoading,
    frameVars,
    frameVarsLoading,
    datumMode,
    setDatumMode,
    xOffset,
    setXOffset,
    yOffset,
    setYOffset,
    cornerCoordinates,
    showCorners,
    setShowCorners,
    imgRef,
    hoverData,
    magnifierRef,
    magVisible,
    magPos,
    maxFrameCount,
    handlePlayToggle,
    handleRender,
    toggleMeanMode,
    handleImageClick,
    updateOffsets,
    fetchCornerCoordinates,
    onMouseMove,
    onMouseLeave,
    handleMagnifierMove,
    handleMagnifierLeave,
    basename,
    downloadCurrentView,
    copyCurrentView,
    fetchLimits,  // Added: Now available from the hook
    MAG_SIZE,
    dpr,
  } = useVectorViewer({ backendUrl, config });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 mb-4">
            <div className="flex flex-col gap-4 mb-4">
              {/* Base path selection */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Base Path:</label>
                <Select value={String(basePathIdx)} onValueChange={v => setBasePathIdx(Number(v))}>
                  <SelectTrigger id="basepath"><SelectValue placeholder="Pick base path" /></SelectTrigger>
                  <SelectContent>
                    {basePaths.map((p, i) => (
                      <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Camera and merged controls */}
              <div className="flex items-center gap-4">
                <label htmlFor="camera" className="text-sm font-medium">Camera:</label>
                <Select value={camera} onValueChange={v => setCamera(v)}>
                  <SelectTrigger id="camera"><SelectValue placeholder="Select camera" /></SelectTrigger>
                  <SelectContent>
                    {cameraOptions.map((c, i) => (
                      <SelectItem key={i} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Merged Data and Mean Statistics (checkbox) */}
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={merged}
                    onChange={e => setMerged(e.target.checked)}
                    className="accent-soton-blue w-4 h-4 rounded border-gray-300"
                  />
                  Merged Data
                </label>

                {/* Mean statistics checkbox placed beside Merged Data */}
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={meanMode}
                    onChange={() => { void toggleMeanMode(); }}
                    className="accent-soton-blue w-4 h-4 rounded border-gray-300"
                  />
                  Mean Statistics
                  {statVarsLoading && <span className="ml-2 text-xs text-gray-500">Loading vars...</span>}
                  {meanMode && statsLoading && <span className="ml-2 text-xs text-gray-500">Computing...</span>}
                </label>
              </div>

              {/* New: X and Y Offset inputs */}
              <div className="flex items-center gap-4">
                <label htmlFor="x-offset" className="text-sm font-medium">X Offset:</label>
                <Input 
                  id="x-offset" 
                  type="number" 
                  value={xOffset} 
                  onChange={e => setXOffset(e.target.value)} 
                  className="w-24"
                  placeholder="0"
                />
                
                <label htmlFor="y-offset" className="text-sm font-medium">Y Offset:</label>
                <Input 
                  id="y-offset" 
                  type="number" 
                  value={yOffset} 
                  onChange={e => setYOffset(e.target.value)} 
                  className="w-24"
                  placeholder="0"
                />

                {/* Update Offsets Button */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={updateOffsets}
                >
                  Update Offsets
                </Button>
                
                {/* New: Set datum button */}
                <Button
                  size="sm"
                  variant={datumMode ? "default" : "outline"}
                  onClick={() => setDatumMode(!datumMode)}
                  className={`${datumMode ? "bg-yellow-500 hover:bg-yellow-600" : ""}`}
                >
                  {datumMode ? "Cancel Set Datum" : "Set New Datum"}
                </Button>
                
                {/* New: Show corner coordinates button */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fetchCornerCoordinates()}
                >
                  Show Corner Coordinates
                </Button>
              </div>

              {/* Display corner coordinates when available */}
              {showCorners && cornerCoordinates && (
                <div className="p-3 bg-gray-50 border rounded-md">
                  <h4 className="font-medium mb-2">Vector Field Corner Coordinates:</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex gap-1">
                      <span className="font-medium">Top Left:</span>
                      <span>({cornerCoordinates.topLeft.x.toFixed(2)}, {cornerCoordinates.topLeft.y.toFixed(2)})</span>
                    </div>
                    <div className="flex gap-1">
                      <span className="font-medium">Top Right:</span>
                      <span>({cornerCoordinates.topRight.x.toFixed(2)}, {cornerCoordinates.topRight.y.toFixed(2)})</span>
                    </div>
                    <div className="flex gap-1">
                      <span className="font-medium">Bottom Left:</span>
                      <span>({cornerCoordinates.bottomLeft.x.toFixed(2)}, {cornerCoordinates.bottomLeft.y.toFixed(2)})</span>
                    </div>
                    <div className="flex gap-1">
                      <span className="font-medium">Bottom Right:</span>
                      <span>({cornerCoordinates.bottomRight.x.toFixed(2)}, {cornerCoordinates.bottomRight.y.toFixed(2)})</span>
                    </div>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => setShowCorners(false)} 
                    className="mt-2"
                  >
                    Hide
                  </Button>
                </div>
              )}

              <div className={`flex items-center gap-2 transition-opacity duration-200 ${meanMode ? "opacity-40 pointer-events-none" : ""}`}>
                {/* File Index controls - faded/disabled when meanMode is active */}
                <label htmlFor="index" className="text-sm font-medium">File Index:</label>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => setIndex(i => Math.max(1, i - 1))}
                  disabled={index <= 1}
                  className={`transition-opacity ${index <= 1 ? 'opacity-40' : 'opacity-100'}`}
                >
                  -
                </Button>
                <Input id="index" type="number" min={1} value={index} onChange={e => setIndex(Math.max(1, Number(e.target.value)))} className="w-24" />
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => setIndex(i => i + 1)}
                  disabled={index >= maxFrameCount}
                  className={`transition-opacity ${index >= maxFrameCount ? 'opacity-40' : 'opacity-100'}`}
                >
                  +
                </Button>
              </div>

              <div className={`flex items-center gap-4 mb-4 transition-opacity duration-200 ${meanMode ? "opacity-40 pointer-events-none" : ""}`}>
                {/* Frame slider - faded/disabled when meanMode is active */}
                <label htmlFor="frame-slider" className="text-sm font-medium">Frame:</label>
                <input
                  id="frame-slider"
                  type="range"
                  min={1}
                  max={maxFrameCount}
                  value={index}
                  onChange={e => setIndex(Number(e.target.value))}
                  className="w-64"
                />
                <span className="text-xs text-gray-500">{index} / {maxFrameCount}</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={playing ? "default" : "outline"}
                    onClick={() => { handlePlayToggle(); }}
                    className="flex items-center gap-1"
                  >
                    {playing ? <span>&#10073;&#10073; Pause</span> : <span>&#9654; Play</span>}
                  </Button>
                </div>
              </div>
  
              <div className="flex items-center gap-3 flex-wrap">
                <label htmlFor="type" className="text-sm font-medium">Type:</label>
                <Select value={type} onValueChange={v => setType(v)}>
                  <SelectTrigger id="type"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {meanMode ? (
                      statVarsLoading ? (
                        <SelectItem value="loading">Loading...</SelectItem>
                      ) : statVars && statVars.length > 0 ? (
                        statVars.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)
                      ) : (
                        <SelectItem value="none" disabled>No vars</SelectItem>
                      )
                    ) : (
                      frameVarsLoading ? (
                        <SelectItem value="loading">Loading...</SelectItem>
                      ) : frameVars && frameVars.length > 0 ? (
                        frameVars.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)
                      ) : (
                        <>
                          <SelectItem value="ux">ux</SelectItem>
                          <SelectItem value="uy">uy</SelectItem>
                        </>
                      )
                    )}
                  </SelectContent>
                </Select>
                <label htmlFor="cmap" className="text-sm font-medium">Colormap:</label>
                <Select value={cmap} onValueChange={v => setCmap(v)}>
                  <SelectTrigger id="cmap"><SelectValue placeholder="Select colormap" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">default</SelectItem>
                    <SelectItem value="viridis">viridis</SelectItem>
                    <SelectItem value="plasma">plasma</SelectItem>
                    <SelectItem value="inferno">inferno</SelectItem>
                    <SelectItem value="magma">magma</SelectItem>
                    <SelectItem value="cividis">cividis</SelectItem>
                    <SelectItem value="jet">jet</SelectItem>
                    <SelectItem value="gray">gray</SelectItem>
                    <SelectItem value="bone">bone</SelectItem>
                    <SelectItem value="copper">copper</SelectItem>
                    <SelectItem value="pink">pink</SelectItem>
                    <SelectItem value="spring">spring</SelectItem>
                    <SelectItem value="summer">summer</SelectItem>
                    <SelectItem value="autumn">autumn</SelectItem>
                    <SelectItem value="winter">winter</SelectItem>
                    <SelectItem value="hot">hot</SelectItem>
                    <SelectItem value="cool">cool</SelectItem>
                    <SelectItem value="Wistia">Wistia</SelectItem>
                    <SelectItem value="twilight">twilight</SelectItem>
                    <SelectItem value="hsv">hsv</SelectItem>
                  </SelectContent>
                </Select>
                <label htmlFor="run" className="text-sm font-medium">Run:</label>
                <Input id="run" type="number" min={1} value={run} onChange={e => setRun(Math.max(1, Number(e.target.value)))} className="w-24" />
                <label className="text-sm font-medium">Lower:</label>
                <Input type="number" value={lower} onChange={e => setLower(e.target.value)} placeholder="auto" className="w-28" />
                <label className="text-sm font-medium">Upper:</label>
                <Input type="number" value={upper} onChange={e => setUpper(e.target.value)} placeholder="auto" className="w-28" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { void fetchLimits(); }}
                  disabled={limitsLoading || meanMode}
                  className="ml-2"
                >
                  {limitsLoading ? "Getting..." : "Get Limits"}
                </Button>
                
                {/* Render button: uses stats endpoint when meanMode active */}
                <Button
                  className="bg-soton-blue"
                  onClick={() => { void handleRender(); }}
                  disabled={loading || statsLoading || frameVarsLoading}
                >
                  {(loading || statsLoading || frameVarsLoading) ? "Loading..." : "Render"}
                </Button>

                {/* New: Export actions */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={downloadCurrentView}
                  disabled={!imageSrc || loading || statsLoading}
                >
                  Download PNG
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { void copyCurrentView(); }}
                  disabled={!imageSrc || loading || statsLoading}
                >
                  Copy PNG
                </Button>
              </div>

              {statsError && meanMode && (
                <div className="w-full p-3 mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
                  {statsError}
                </div>
              )}
            </div>
          </div>

          {/* Image viewer placeholder, similar to ImagePairViewer */}
          <div className="mt-6">
            {error && (
              <div className="w-full p-3 mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>
            )}
            {datumMode && (
              <div className="w-full p-3 mb-3 rounded border border-yellow-200 bg-yellow-50 text-yellow-700 text-sm">
                <strong>Set Datum Mode Active:</strong> Click on the image to set a new coordinate system origin.
              </div>
            )}
            
            {/* Integrated status bar for coordinate information */}
            {imageSrc && !error && (
              <div className="mb-4 p-3 bg-gradient-to-r from-gray-50 to-gray-100 border rounded-lg shadow-sm"
                   style={{ minHeight: 56, height: 56, display: 'flex', alignItems: 'center' }}>
                <div className="flex items-center justify-between w-full h-full">
                  <div className="flex items-center gap-6 h-full">
                    <div className="text-sm font-medium text-gray-700">
                      Cursor Position:
                    </div>
                    {hoverData ? (
                      isNaN(hoverData.x) || hoverData.i < 0 ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500 h-full">
                          <div className="animate-spin w-3 h-3 border border-gray-400 border-t-soton-blue rounded-full"></div>
                          <span>Loading...</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-6 h-full">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">X:</span>
                            <span className="font-mono text-sm font-semibold text-soton-blue bg-white px-2 py-1 rounded border"
                                  style={{ minWidth: 70, textAlign: 'center', display: 'inline-block' }}>
                              {hoverData.x.toFixed(3)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Y:</span>
                            <span className="font-mono text-sm font-semibold text-soton-blue bg-white px-2 py-1 rounded border"
                                  style={{ minWidth: 70, textAlign: 'center', display: 'inline-block' }}>
                              {hoverData.y.toFixed(3)}
                            </span>
                          </div>
                          {(() => {
                            let varVal: number | null = null;
                            if (type === "ux" && hoverData.ux != null) varVal = hoverData.ux;
                            else if (type === "uy" && hoverData.uy != null) varVal = hoverData.uy;
                            else if (hoverData.value != null) varVal = hoverData.value;
                            return varVal != null ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                                  {type}:
                                </span>
                                <span className="font-mono text-sm font-semibold text-white bg-soton-blue px-2 py-1 rounded border"
                                      style={{ minWidth: 70, textAlign: 'center', display: 'inline-block' }}>
                                  {varVal.toFixed(3)}
                                </span>
                              </div>
                            ) : null;
                          })()}
                        </div>
                      )
                    ) : (
                      <div className="text-sm text-gray-500 italic h-full flex items-center">
                        Hover over the plot area to see coordinates
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {meanMode ? "Mean Statistics Mode" : `Frame ${index}`}
                  </div>
                </div>
              </div>
            )}

            {imageSrc && !error && (
              <div
                className="flex flex-col items-center relative"
                style={{
                  width: '100%',
                  maxWidth: '1100px',
                  margin: '0 auto',
                  cursor: datumMode ? 'crosshair' : magVisible ? 'none' : 'default'
                }}
                onMouseMove={e => { onMouseMove(e); handleMagnifierMove(e); }}
                onMouseLeave={e => { onMouseLeave(); handleMagnifierLeave(); }}
                onClick={e => { if (datumMode) handleImageClick(e); }}
              >
                {/* Remove magnifier toggle button */}
                {/* <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 70 }}>
                  <button ...> ... </button>
                </div> */}
                <img
                  ref={imgRef}
                  src={`data:image/png;base64,${imageSrc}`}
                  alt="Vector Result"
                  className="rounded border w-full max-w-5xl select-none pointer-events-auto"
                  style={{ width: '100%', maxWidth: '1000px', height: 'auto', display: 'block' }}
                  draggable={false}
                />
                {/* Magnifier Canvas */}
                <canvas
                  ref={magnifierRef}
                  style={{
                    display: magVisible ? 'block' : 'none',
                    position: 'absolute',
                    pointerEvents: 'none',
                    zIndex: 61,
                    width: MAG_SIZE,
                    height: MAG_SIZE,
                    left: magPos.left,
                    top: magPos.top,
                    borderRadius: '50%',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                    border: '2px solid #333',
                  }}
                  width={MAG_SIZE * dpr}
                  height={MAG_SIZE * dpr}
                />
                {/* Only show rendering overlay if not playing */}
                {loading && !playing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60">
                    <span className="text-gray-500">Rendering...</span>
                  </div>
                )}
                {meta && (
                  <div className="text-xs text-gray-500 mt-2">
                    Run: {meta.run} • Var: {meta.var}{meta.width && meta.height ? ` • ${meta.width}×${meta.height}` : ""}
                  </div>
                )}
              </div>
            )}
            {(!imageSrc || error) && (
              <div className="w-full h-64 flex items-center justify-center bg-gray-100 border rounded">
                <span className="text-gray-500">No image loaded</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
