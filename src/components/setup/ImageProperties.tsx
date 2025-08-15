// 'use client';

// import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
// import { Label } from "@/components/ui/label";
// import { Input } from "@/components/ui/input";
// import { Switch } from "@/components/ui/switch";
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
// import { Image, Layers, Clock, Grid, Camera } from "lucide-react";

// interface ImagePropertiesProps {
//   config: any;
//   updateConfig: (path: string[], value: any) => void;
// }

// export default function ImageProperties({ config, updateConfig }: ImagePropertiesProps) {
//   // const imProperties = config.setup.imProperties;
  
//   return (
//     <div className="space-y-6">
//       <div className="flex items-center space-x-2 mb-6">
//         <Image className="h-6 w-6 text-soton-blue" />
//         <h2 className="text-2xl font-bold text-gray-800">Image Properties</h2>
//       </div>
      
//       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
//         <Card>
//           <CardHeader>
//             <CardTitle>Basic Configuration</CardTitle>
//             <CardDescription>
//               Configure fundamental image properties
//             </CardDescription>
//           </CardHeader>
//           <CardContent>
//             <div className="space-y-4">
//               <div className="grid grid-cols-4 items-center">
//                 <Label htmlFor="image-count" className="col-span-2">Image Count</Label>
//                 <TooltipProvider>
//                   <Tooltip>
//                     <TooltipTrigger asChild>
//                       <Input 
//                         id="image-count"
//                         type="number"
//                         className="col-span-2"
//                         value={imProperties.imageCount}
//                         onChange={(e) => updateConfig(['setup', 'imProperties', 'imageCount'], parseInt(e.target.value))}
//                       />
//                     </TooltipTrigger>
//                     <TooltipContent>
//                       <p>Total number of images to process</p>
//                     </TooltipContent>
//                   </Tooltip>
//                 </TooltipProvider>
//               </div>
              
//               <div className="grid grid-cols-4 items-center">
//                 <Label htmlFor="batch-size" className="col-span-2">Batch Size</Label>
//                 <TooltipProvider>
//                   <Tooltip>
//                     <TooltipTrigger asChild>
//                       <Input 
//                         id="batch-size"
//                         type="number"
//                         className="col-span-2"
//                         value={imProperties.batchSize}
//                         onChange={(e) => updateConfig(['setup', 'imProperties', 'batchSize'], parseInt(e.target.value))}
//                       />
//                     </TooltipTrigger>
//                     <TooltipContent>
//                       <p>Number of image pairs processed in a single batch</p>
//                     </TooltipContent>
//                   </Tooltip>
//                 </TooltipProvider>
//               </div>
              
//               {/* Parallel Batch Size and Time Interval removed */}
//             </div>
//           </CardContent>
//         </Card>
        
//         <Card>
//           <CardHeader>
//             <CardTitle>Image Dimensions</CardTitle>
//             <CardDescription>
//               Configure image resolution and format
//             </CardDescription>
//           </CardHeader>
//           <CardContent>
//             <div className="space-y-4">
//               <div className="grid grid-cols-2 gap-4">
//                 <div>
//                   <Label htmlFor="image-width" className="mb-2 block">Width (px)</Label>
//                   <Input 
//                     id="image-width"
//                     type="number"
//                     value={imProperties.imageSize ? imProperties.imageSize[0] : 1024}
//                     onChange={(e) => {
//                       const currentSize = [...(imProperties.imageSize || [1024, 1024])];
//                       currentSize[0] = parseInt(e.target.value);
//                       updateConfig(['setup', 'imProperties', 'imageSize'], currentSize);
//                     }}
//                   />
//                 </div>
//                 <div>
//                   <Label htmlFor="image-height" className="mb-2 block">Height (px)</Label>
//                   <Input 
//                     id="image-height"
//                     type="number"
//                     value={imProperties.imageSize ? imProperties.imageSize[1] : 1024}
//                     onChange={(e) => {
//                       const currentSize = [...(imProperties.imageSize || [1024, 1024])];
//                       currentSize[1] = parseInt(e.target.value);
//                       updateConfig(['setup', 'imProperties', 'imageSize'], currentSize);
//                     }}
//                   />
//                 </div>
//               </div>
              
//               <div>
//                 <Label htmlFor="image-type" className="mb-2 block">Image Format</Label>
//                 <Select
//                   value={imProperties.imageType}
//                   onValueChange={(value) => updateConfig(['setup', 'imProperties', 'imageType'], value)}
//                 >
//                   <SelectTrigger id="image-type">
//                     <SelectValue placeholder="Select image format" />
//                   </SelectTrigger>
//                   <SelectContent>
//                     <SelectItem value="standard">Standard</SelectItem>
//                     <SelectItem value="cine">CINE</SelectItem>
//                     <SelectItem value="im7">IM7</SelectItem>
//                     <SelectItem value="ims">IMS</SelectItem>
//                   </SelectContent>
//                 </Select>
//               </div>
              
//               {/* Image Reader removed */}
//             </div>
//           </CardContent>
//         </Card>
//       </div>
      
//   {/* Camera Setup and Calibration removed */}
//     </div>
//   );
// }
