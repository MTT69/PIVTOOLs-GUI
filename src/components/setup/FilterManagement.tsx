'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Filter, Plus, Trash, MoveUp, MoveDown, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface FilterManagementProps {
  config: any;
  updateConfig: (path: string[], value: any) => void;
}

export default function FilterManagement({ config, updateConfig }: FilterManagementProps) {
  const [filters, setFilters] = useState(config.filters || [{ type: 'null' }]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newFilter, setNewFilter] = useState({ type: 'null', size: '', parameter: '' });
  const [selectedFilterIndex, setSelectedFilterIndex] = useState<number | null>(null);
  
  // Update filters in config when they change
  const updateFilters = (newFilters: any[]) => {
    setFilters(newFilters);
    updateConfig(['filters'], newFilters);
  };
  
  // Add filter to the list
  const addFilter = () => {
    const filterToAdd: any = { type: newFilter.type };
    
    // Add size if provided and not a POD filter
    if (newFilter.size && newFilter.type !== 'null' && newFilter.type !== 'POD') {
      try {
        // Parse size - could be single number or array
        const sizeStr = newFilter.size.trim();
        if (sizeStr.includes(' ')) {
          // Parse as array of numbers
          filterToAdd.size = sizeStr.split(' ').map(Number);
        } else {
          filterToAdd.size = Number(sizeStr);
        }
      } catch (e) {
        console.error("Error parsing size:", e);
      }
    }
    
    // Add parameter if provided based on filter type
    if (newFilter.parameter && newFilter.type !== 'null' && newFilter.type !== 'POD') {
      const paramValue = Number(newFilter.parameter);
      if (!isNaN(paramValue)) {
        if (newFilter.type === 'gaussian') {
          filterToAdd.sigma = paramValue;
        } else if (newFilter.type === 'norm') {
          filterToAdd.max_gain = paramValue;
        }
      }
    }
    
    // If this is the first real filter, replace the null filter
    if (filters.length === 1 && filters[0].type === 'null') {
      updateFilters([filterToAdd]);
    } else {
      updateFilters([...filters, filterToAdd]);
    }
    
    setDialogOpen(false);
    setNewFilter({ type: 'null', size: '', parameter: '' });
  };
  
  // Remove filter from the list
  const removeFilter = (index: number) => {
    const newFilters = [...filters];
    newFilters.splice(index, 1);
    
    // If all filters are removed, add a null filter
    if (newFilters.length === 0) {
      newFilters.push({ type: 'null' });
    }
    
    updateFilters(newFilters);
    setSelectedFilterIndex(null);
  };
  
  // Move filter up in the list
  const moveFilterUp = (index: number) => {
    if (index <= 0) return;
    const newFilters = [...filters];
    [newFilters[index], newFilters[index - 1]] = [newFilters[index - 1], newFilters[index]];
    updateFilters(newFilters);
    setSelectedFilterIndex(index - 1);
  };
  
  // Move filter down in the list
  const moveFilterDown = (index: number) => {
    if (index >= filters.length - 1) return;
    const newFilters = [...filters];
    [newFilters[index], newFilters[index + 1]] = [newFilters[index + 1], newFilters[index]];
    updateFilters(newFilters);
    setSelectedFilterIndex(index + 1);
  };
  
  // Get display value for filter size
  const getSizeDisplay = (filter: any): string => {
    if (!filter.size) return '-';
    if (Array.isArray(filter.size)) {
      return filter.size.join(' × ');
    }
    return filter.size.toString();
  };
  
  // Get parameter display value based on filter type
  const getParameterDisplay = (filter: any): string => {
    if (filter.type === 'gaussian' && filter.sigma !== undefined) {
      return `σ = ${filter.sigma}`;
    }
    if (filter.type === 'norm' && filter.max_gain !== undefined) {
      return `gain = ${filter.max_gain}`;
    }
    if (filter.type === 'time' && filter.size !== undefined) {
      return `frames = ${filter.size}`;
    }
    return '-';
  };
  
  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-6">
        <Filter className="h-6 w-6 text-soton-blue" />
        <h2 className="text-2xl font-bold text-gray-800">Filter Management</h2>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Image Filters</CardTitle>
          <CardDescription>
            Configure pre-processing filters to apply to images
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-4">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-soton-blue hover:bg-soton-darkblue">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Filter
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Add New Filter</DialogTitle>
                  <DialogDescription>
                    Configure a filter to apply to images during pre-processing
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="filter-type">Filter Type</Label>
                    <Select 
                      value={newFilter.type} 
                      onValueChange={(value) => setNewFilter({ ...newFilter, type: value })}
                    >
                      <SelectTrigger id="filter-type">
                        <SelectValue placeholder="Select filter type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="null">None</SelectItem>
                        <SelectItem value="time">Time</SelectItem>
                        <SelectItem value="POD">POD</SelectItem>
                        <SelectItem value="gaussian">Gaussian</SelectItem>
                        <SelectItem value="ssmin">SS Min</SelectItem>
                        <SelectItem value="norm">Normalization</SelectItem>
                        <SelectItem value="median">Median</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {newFilter.type !== 'null' && newFilter.type !== 'POD' && (
                    <div className="space-y-2">
                      <Label htmlFor="filter-size">
                        {newFilter.type === 'time' ? 'Frames' : 'Filter Size'}
                      </Label>
                      <Input 
                        id="filter-size" 
                        value={newFilter.size} 
                        onChange={(e) => setNewFilter({ ...newFilter, size: e.target.value })}
                        placeholder={newFilter.type === 'time' ? "50" : "3 3"}
                      />
                      <p className="text-sm text-muted-foreground">
                        {newFilter.type === 'time' 
                          ? "Number of frames for temporal filtering" 
                          : "Size of filter kernel (width height)"
                        }
                      </p>
                    </div>
                  )}
                  
                  {(newFilter.type === 'gaussian' || newFilter.type === 'norm') && (
                    <div className="space-y-2">
                      <Label htmlFor="filter-param">
                        {newFilter.type === 'gaussian' ? 'Sigma' : 'Max Gain'}
                      </Label>
                      <Input 
                        id="filter-param" 
                        value={newFilter.parameter} 
                        onChange={(e) => setNewFilter({ ...newFilter, parameter: e.target.value })}
                        placeholder={newFilter.type === 'gaussian' ? "0.5" : "1.0"}
                      />
                      <p className="text-sm text-muted-foreground">
                        {newFilter.type === 'gaussian' 
                          ? "Standard deviation for Gaussian filter" 
                          : "Maximum gain for normalization"
                        }
                      </p>
                    </div>
                  )}
                </div>
                
                <DialogFooter>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setDialogOpen(false);
                      setNewFilter({ type: 'null', size: '', parameter: '' });
                    }}
                  >
                    Cancel
                  </Button>
                  <Button 
                    className="bg-soton-blue hover:bg-soton-darkblue"
                    onClick={addFilter}
                  >
                    Add Filter
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Filter Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Parameters</TableHead>
                <TableHead className="w-[150px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filters.map((filter, index) => (
                <TableRow 
                  key={index}
                  className={selectedFilterIndex === index ? "bg-soton-lightblue" : ""}
                  onClick={() => setSelectedFilterIndex(index)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-soton-blue" />
                      {filter.type.charAt(0).toUpperCase() + filter.type.slice(1)}
                    </div>
                  </TableCell>
                  <TableCell>{getSizeDisplay(filter)}</TableCell>
                  <TableCell>{getParameterDisplay(filter)}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => moveFilterUp(index)}
                        disabled={index === 0}
                      >
                        <MoveUp className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => moveFilterDown(index)}
                        disabled={index === filters.length - 1}
                      >
                        <MoveDown className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => removeFilter(index)}
                        disabled={filters.length === 1 && filters[0].type === 'null'}
                      >
                        <Trash className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          <div className="mt-6">
            <Alert variant="info" className="bg-blue-50 border-blue-200">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              <AlertTitle>Filter Processing Order</AlertTitle>
              <AlertDescription>
                Filters are applied in order from top to bottom. For best results, consider using time-based filters first, 
                followed by spatial filters like Gaussian or Median.
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
