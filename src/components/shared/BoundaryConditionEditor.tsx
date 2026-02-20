"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus } from "lucide-react";

interface BoundaryCondition {
  y_position: number;
  ux: number;
  uy: number;
  edge: "bottom" | "top";
}

interface BoundaryConditionEditorProps {
  conditions: BoundaryCondition[];
  updateConfigValue: (path: string[], value: any) => void;
}

export default function BoundaryConditionEditor({
  conditions,
  updateConfigValue,
}: BoundaryConditionEditorProps) {
  const bcs = conditions || [];

  const addBC = () => {
    const newBCs = [...bcs, { y_position: 0, ux: 0, uy: 0, edge: "bottom" as const }];
    updateConfigValue(['ensemble_piv', 'predictor_boundary_conditions'], newBCs);
  };

  const removeBC = (index: number) => {
    const newBCs = bcs.filter((_, i) => i !== index);
    updateConfigValue(['ensemble_piv', 'predictor_boundary_conditions'], newBCs);
  };

  const updateBC = (index: number, field: string, value: any) => {
    const newBCs = [...bcs];
    newBCs[index] = { ...newBCs[index], [field]: value };
    updateConfigValue(['ensemble_piv', 'predictor_boundary_conditions'], newBCs);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Boundary Conditions</Label>
        <Button variant="outline" size="sm" onClick={addBC}>
          <Plus className="h-4 w-4 mr-1" /> Add BC
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Wall boundary conditions for the predictor field. Overrides edge-replicated padding near walls with prescribed velocity values (e.g., no-slip: ux=0, uy=0).
      </p>

      {bcs.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">
          No boundary conditions configured. The predictor will use edge-replicated padding.
        </p>
      ) : (
        <div className="space-y-2">
          {bcs.map((bc, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end bg-gray-50 p-3 rounded-md">
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">Y Position (px)</Label>
                <Input
                  type="text"
                  value={bc.y_position}
                  onChange={(e) => {
                    const num = parseInt(e.target.value, 10);
                    updateBC(i, 'y_position', isNaN(num) ? 0 : num);
                  }}
                  className="h-8"
                />
              </div>
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">ux (px/frame)</Label>
                <Input
                  type="text"
                  value={bc.ux}
                  onChange={(e) => {
                    const num = parseFloat(e.target.value);
                    updateBC(i, 'ux', isNaN(num) ? 0 : num);
                  }}
                  className="h-8"
                />
              </div>
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">uy (px/frame)</Label>
                <Input
                  type="text"
                  value={bc.uy}
                  onChange={(e) => {
                    const num = parseFloat(e.target.value);
                    updateBC(i, 'uy', isNaN(num) ? 0 : num);
                  }}
                  className="h-8"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Edge</Label>
                <Select
                  value={bc.edge || "bottom"}
                  onValueChange={(value) => updateBC(i, 'edge', value)}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bottom">Bottom</SelectItem>
                    <SelectItem value="top">Top</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-1 flex justify-end">
                <Button variant="ghost" size="icon" onClick={() => removeBC(i)} className="h-8 w-8">
                  <X className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
