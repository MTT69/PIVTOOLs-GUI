"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVideoMaker } from "@/hooks/useVideoMaker";
import ColormapSelect from "@/components/shared/ColormapSelect";

// Variable label formatting helper (matches VectorViewer formatting)
const formatVarLabel = (varName: string, group: 'piv' | 'stats'): string => {
  const specialLabels: Record<string, string> = {
    // Legacy fluctuations
    u_prime: "u'",
    v_prime: "v'",
    w_prime: "w'",
    // Instantaneous stress tensor components
    uu_inst: "u'u'",
    vv_inst: "v'v'",
    ww_inst: "w'w'",
    uv_inst: "u'v'",
    uw_inst: "u'w'",
    vw_inst: "v'w'",
    // Other computed stats
    gamma1: "γ₁",
    gamma2: "γ₂",
    vorticity: "ω (Vorticity)",
    divergence: "∇·u (Divergence)",
    // PIV base
    mag: "Velocity Magnitude",
    b_mask: "Mask",
  };

  if (specialLabels[varName]) {
    return specialLabels[varName];
  }
  return varName;
};

export default function VideoMaker({ backendUrl = '/backend', config }: { backendUrl?: string; config?: any }) {
  const {
    directory,
    setDirectory,
    dirInputRef,
    basePaths,
    basePathIdx,
    setBasePathIdx,
    cameraOptions,
    camera,
    setCamera,
    type,
    setType,
    cmap,
    setCmap,
    run,
    setRun,
    lower,
    setLower,
    upper,
    setUpper,
    resolution,
    setResolution,
    resolutionOptions,
    fps,
    setFps,
    activeTab,
    setActiveTab,
    availableVideos,
    selectedVideo,
    setSelectedVideo,
    loadingVideos,
    creating,
    videoResult,
    videoStatus,
    videoReady,
    videoError,
    videoLoading,
    handleVideoCanPlay,
    effectiveDir,
    // Data source state
    dataSourcesLoading,
    dataSource,
    setDataSource,
    dataSourceOptions,
    hasAnyData,
    isStereoData,
    // Runs state
    availableRuns,
    highestRun,
    runsLoading,
    // Variables state
    availableVariables,
    groupedVariables,
    variablesLoading,
    // Functions
    handleBrowse,
    onDirPicked,
    fetchAvailableVideos,
    handleCreateVideo,
    handleCancelVideo,
    basename,
    createVideoUrl,
    handleVideoError,
    handleRetryVideo,
  } = useVideoMaker(backendUrl, config);

  // Determine if video creation is disabled
  const videoCreationDisabled = !hasAnyData || creating || videoStatus?.processing;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Video Creation & Browsing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 mb-4">
            {/* Base path selection */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Base Path:</label>
              {basePaths.length > 0 ? (
                <Select value={String(basePathIdx)} onValueChange={v => setBasePathIdx(Number(v))}>
                  <SelectTrigger id="basepath"><SelectValue placeholder="Pick base path" /></SelectTrigger>
                  <SelectContent>
                    {basePaths.map((p: string, i: number) => (
                      <SelectItem key={i} value={String(i)}>{basename(p)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <>
                  <Input
                    type="text"
                    value={directory}
                    onChange={(e) => setDirectory(e.target.value)}
                    placeholder="Select directory"
                    className="w-full"
                  />
                  <input
                    ref={dirInputRef}
                    type="file"
                    style={{ display: 'none' }}
                    onChange={onDirPicked}
                  />
                  <Button variant="outline" onClick={handleBrowse}>
                    Browse
                  </Button>
                </>
              )}
            </div>
            
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="create" className="flex-1">Create Video</TabsTrigger>
                <TabsTrigger value="browse" className="flex-1">Browse Videos</TabsTrigger>
              </TabsList>
              
              <TabsContent value="create" className="pt-4">
                {/* No data warning */}
                {!dataSourcesLoading && !hasAnyData && effectiveDir && (
                  <div className="p-3 mb-4 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
                    <div className="font-medium mb-1">No PIV Data Found</div>
                    <p>No calibrated, uncalibrated, or merged data found for Camera {camera}.</p>
                    <p className="mt-1 text-xs">Please run PIV processing first or select a different camera/base path.</p>
                  </div>
                )}

                {/* Camera and Data Source selection */}
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label htmlFor="camera" className="text-sm font-medium">
                      {isStereoData ? "Source:" : "Camera:"}
                    </label>
                    {isStereoData ? (
                      <div className="px-3 py-2 bg-muted rounded-md text-sm w-28">
                        Stereo (3D)
                      </div>
                    ) : (
                      <Select value={String(camera)} onValueChange={v => setCamera(Number(v))}>
                        <SelectTrigger id="camera" className="w-28"><SelectValue placeholder="Select camera" /></SelectTrigger>
                        <SelectContent>
                          {cameraOptions.map((c, i) => {
                            const camNum = c.replace('Cam', '');
                            return (
                              <SelectItem key={i} value={camNum}>{c}</SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* Data Source selection */}
                  <div className="flex items-center gap-2">
                    <label htmlFor="dataSource" className="text-sm font-medium">Data Source:</label>
                    {dataSourcesLoading ? (
                      <span className="text-sm text-gray-500">Loading...</span>
                    ) : dataSourceOptions.length > 0 ? (
                      <Select value={dataSource} onValueChange={v => setDataSource(v as any)}>
                        <SelectTrigger id="dataSource" className="w-52"><SelectValue placeholder="Select data source" /></SelectTrigger>
                        <SelectContent>
                          {dataSourceOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm text-red-500">No data available</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Variable</label>
                    {variablesLoading ? (
                      <span className="text-sm text-gray-500">Loading...</span>
                    ) : (
                      <Select value={type} onValueChange={v => setType(v)}>
                        <SelectTrigger id="type"><SelectValue placeholder="Select variable" /></SelectTrigger>
                        <SelectContent>
                          {/* Instantaneous Variables (from PIV frame files) */}
                          {groupedVariables.instantaneous.length > 0 && (
                            <>
                              <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50">Instantaneous</div>
                              {groupedVariables.instantaneous.map(varName => (
                                <SelectItem key={varName} value={varName}>{formatVarLabel(varName, 'piv')}</SelectItem>
                              ))}
                              {/* Add mag (velocity magnitude) if not in list */}
                              {!groupedVariables.instantaneous.includes('mag') && (
                                <SelectItem key="mag" value="mag">{formatVarLabel('mag', 'piv')}</SelectItem>
                              )}
                            </>
                          )}
                          {/* Calculated Per-Frame Statistics */}
                          {groupedVariables.instantaneous_stats.length > 0 && (
                            <>
                              <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 mt-1">Calculated (Per-Frame)</div>
                              {groupedVariables.instantaneous_stats.map(varName => (
                                <SelectItem key={varName} value={varName}>{formatVarLabel(varName, 'stats')}</SelectItem>
                              ))}
                            </>
                          )}
                          {/* Fallback to flat list if grouped is empty */}
                          {groupedVariables.instantaneous.length === 0 && groupedVariables.instantaneous_stats.length === 0 && (
                            <>
                              {availableVariables.filter(v => v.group === 'piv').length > 0 && (
                                <>
                                  <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50">PIV Data</div>
                                  {availableVariables.filter(v => v.group === 'piv').map(v => (
                                    <SelectItem key={v.name} value={v.name}>{v.label}</SelectItem>
                                  ))}
                                </>
                              )}
                              {availableVariables.filter(v => v.group === 'stats').length > 0 && (
                                <>
                                  <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 mt-1">Computed Statistics</div>
                                  {availableVariables.filter(v => v.group === 'stats').map(v => (
                                    <SelectItem key={v.name} value={v.name}>{formatVarLabel(v.name, 'stats')}</SelectItem>
                                  ))}
                                </>
                              )}
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Colormap</label>
                    <ColormapSelect
                      id="cmap"
                      value={cmap}
                      onValueChange={setCmap}
                      placeholder="Select colormap"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Run</label>
                    {runsLoading ? (
                      <span className="text-sm text-gray-500">Loading...</span>
                    ) : availableRuns.length > 1 ? (
                      <Select value={String(run)} onValueChange={v => setRun(Number(v))}>
                        <SelectTrigger id="run"><SelectValue placeholder="Select run" /></SelectTrigger>
                        <SelectContent>
                          {availableRuns.map((r) => (
                            <SelectItem key={r} value={String(r)}>
                              Run {r}{r === highestRun ? ' (latest)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type="number"
                        min={1}
                        value={run}
                        onChange={(e) => setRun(Number(e.target.value || 1))}
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Lower limit</label>
                    <Input 
                      value={lower} 
                      onChange={(e) => setLower(e.target.value)} 
                      placeholder="auto" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Upper limit</label>
                    <Input 
                      value={upper} 
                      onChange={(e) => setUpper(e.target.value)} 
                      placeholder="auto" 
                    />
                  </div>
                </div>

                {/* Resolution and FPS settings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Resolution</label>
                    <Select value={resolution} onValueChange={setResolution}>
                      <SelectTrigger id="resolution">
                        <SelectValue placeholder="Select resolution" />
                      </SelectTrigger>
                      <SelectContent>
                        {resolutionOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">FPS</label>
                    <Input
                      type="number"
                      min={1}
                      value={fps}
                      onChange={(e) => setFps(Number(e.target.value || 30))}
                    />
                  </div>
                </div>

                {/* Display result message */}
                {videoResult && (
                  <div className={`w-full p-3 mt-4 rounded border ${
                    videoResult.success 
                      ? 'border-green-200 bg-green-50 text-green-700' 
                      : 'border-red-200 bg-red-50 text-red-700'
                  } text-sm`}>
                    {videoResult.message}
                    
                    {/* Display computed limits if available */}
                    {videoStatus?.computed_limits && (
                      <div className="mt-2 p-2 bg-white bg-opacity-50 rounded text-xs">
                        <div className="font-medium mb-1">Video Limits:</div>
                        <div>Lower: {videoStatus.computed_limits.lower.toFixed(3)} | Upper: {videoStatus.computed_limits.upper.toFixed(3)}</div>
                        <div>Data range: {videoStatus.computed_limits.actual_min.toFixed(3)} to {videoStatus.computed_limits.actual_max.toFixed(3)}</div>
                        {videoStatus.computed_limits.percentile_based && (
                          <div className="text-gray-600 italic">Limits auto-computed from 5th-95th percentiles</div>
                        )}
                      </div>
                    )}
                    
                    {videoResult.out_path && videoReady && (
                      <div className="mt-2 relative">
                        {/* Loading overlay - sits on top of video */}
                        {videoLoading && !videoError && (
                          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded border z-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <span className="ml-2 text-sm text-gray-600">Loading video...</span>
                          </div>
                        )}
                        {/* Video element - always mounted, loading overlay covers it until ready */}
                        <video
                          controls
                          className="w-full rounded border"
                          style={{ maxHeight: 512 }}
                          src={createVideoUrl(videoResult.out_path)}
                          onCanPlay={handleVideoCanPlay}
                          onError={handleVideoError}
                        >
                          Your browser does not support the video tag.
                        </video>
                        {videoError && (
                          <div className="p-2 bg-red-50 text-red-600 text-sm mt-1 rounded flex items-center gap-2">
                            Error loading video.
                            <Button variant="outline" size="sm" onClick={handleRetryVideo}>
                              Retry
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Progress bar and status */}
                {videoStatus && videoStatus.processing && (
                  <div className="w-full space-y-2 mt-4">
                    <div className="flex items-center justify-between text-sm">
                      <span>Processing video...</span>
                      <span>{videoStatus.progress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-soton-blue h-2 rounded-full transition-all duration-300"
                        style={{ width: `${videoStatus.progress}%` }}
                      />
                    </div>
                    {videoStatus.message && (
                      <div className="text-xs text-gray-600">{videoStatus.message}</div>
                    )}
                  </div>
                )}

                <div className="pt-4 flex flex-col gap-2">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={handleCancelVideo}
                      disabled={!videoStatus?.processing}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleCreateVideo(true)}
                      disabled={videoCreationDisabled}
                      title={!hasAnyData ? "No data available" : undefined}
                    >
                      Test Video (50 frames)
                    </Button>
                    <Button
                      className="bg-soton-blue"
                      onClick={() => handleCreateVideo(false)}
                      disabled={videoCreationDisabled}
                      title={!hasAnyData ? "No data available" : undefined}
                    >
                      {creating ? "Starting..." : videoStatus?.processing ? "Processing..." : "Create Full Video"}
                    </Button>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="browse" className="pt-4">
                {loadingVideos ? (
                  <div className="text-center p-4">Loading available videos...</div>
                ) : availableVideos.length > 0 ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Select Video</label>
                      <Select value={selectedVideo} onValueChange={setSelectedVideo}>
                        <SelectTrigger id="videoSelect">
                          <SelectValue placeholder="Select a video" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableVideos.map((video, i) => (
                            <SelectItem key={i} value={video}>
                              {basename(video)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {selectedVideo && (
                      <div className="mt-4">
                        <div className="mb-2 text-xs text-gray-500 break-all">
                          Path: {selectedVideo}
                        </div>
                        <video
                          controls
                          className="w-full rounded border"
                          style={{ maxHeight: 512 }}
                          src={createVideoUrl(selectedVideo)}
                          onError={(e) => {
                            console.error('Video playback error:', e);
                            // Show error message when video fails to load
                            const target = e.target as HTMLVideoElement;
                            target.insertAdjacentHTML('afterend', 
                              `<div class="p-2 bg-red-50 text-red-600 text-sm mt-1 rounded">
                                Error loading video. Please check the file path.
                              </div>`
                            );
                          }}
                        >
                          Your browser does not support the video tag.
                        </video>
                      </div>
                    )}
                    
                    <div className="flex justify-end">
                      <Button 
                        variant="outline" 
                        onClick={fetchAvailableVideos}
                        className="mt-2"
                      >
                        Refresh Videos
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center p-4">
                    No videos found. Create a video first or select a different base path.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}