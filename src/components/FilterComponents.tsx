import React from 'react';
import { ImageFilter } from '@/hooks/useImageFilters';
import { FILTER_DEFINITIONS, getFilterDefinition } from '@/hooks/filterDefinitions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { ChevronUp, ChevronDown, X } from 'lucide-react';

interface FilterEditorProps {
  filter: ImageFilter;
  index: number;
  onUpdate: (index: number, updates: Partial<ImageFilter>) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  isFirst: boolean;
  isLast: boolean;
}

export function FilterEditor({ 
  filter, 
  index, 
  onUpdate, 
  onRemove, 
  onMoveUp, 
  onMoveDown,
  isFirst,
  isLast 
}: FilterEditorProps) {
  const definition = getFilterDefinition(filter.type);
  
  if (!definition) return null;

  const renderParameter = (param: typeof definition.parameters[0]) => {
    const value = filter[param.key];
    
    switch (param.type) {
      case 'number':
        return (
          <div key={param.key as string} className="space-y-1">
            <Label className="text-xs">{param.name}</Label>
            <Input
              type="number"
              value={value ?? param.default}
              onChange={(e) => {
                const parsed = parseFloat(e.target.value);
                // Only update if we have a valid number (ignore empty/invalid input)
                if (!isNaN(parsed)) {
                  onUpdate(index, { [param.key]: parsed });
                }
              }}
              min={param.min}
              max={param.max}
              step={param.step}
              className="h-8 text-xs"
            />
            <p className="text-xs text-muted-foreground">{param.description}</p>
          </div>
        );
      
      case 'tuple':
        const tupleValue = (value as [number, number]) ?? param.default;
        return (
          <div key={param.key as string} className="space-y-1">
            <Label className="text-xs">{param.name}</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={tupleValue[0]}
                onChange={(e) => {
                  const newVal = parseInt(e.target.value);
                  // Only update if we have a valid number (ignore empty/invalid input)
                  if (!isNaN(newVal)) {
                    onUpdate(index, { [param.key]: [newVal, tupleValue[1]] });
                  }
                }}
                min={param.min}
                max={param.max}
                step={param.step}
                className="h-8 text-xs"
                placeholder="H"
              />
              <Input
                type="number"
                value={tupleValue[1]}
                onChange={(e) => {
                  const newVal = parseInt(e.target.value);
                  // Only update if we have a valid number (ignore empty/invalid input)
                  if (!isNaN(newVal)) {
                    onUpdate(index, { [param.key]: [tupleValue[0], newVal] });
                  }
                }}
                min={param.min}
                max={param.max}
                step={param.step}
                className="h-8 text-xs"
                placeholder="W"
              />
            </div>
            <p className="text-xs text-muted-foreground">{param.description}</p>
          </div>
        );
      
      case 'text':
        return (
          <div key={param.key as string} className="space-y-1">
            <Label className="text-xs">{param.name}</Label>
            <Input
              type="text"
              value={String(value ?? '')}
              onChange={(e) => onUpdate(index, { [param.key]: e.target.value || null })}
              className="h-8 text-xs"
              placeholder={param.description}
            />
            <p className="text-xs text-muted-foreground">{param.description}</p>
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{index + 1}. {definition.name}</span>
          <span className="text-xs px-2 py-0.5 rounded bg-muted">
            {definition.category}
          </span>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onMoveUp(index)}
            disabled={isFirst}
            className="h-7 w-7 p-0"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onMoveDown(index)}
            disabled={isLast}
            className="h-7 w-7 p-0"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRemove(index)}
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      <p className="text-xs text-muted-foreground">{definition.description}</p>
      
      {definition.parameters.length > 0 && (
        <div className="space-y-2 pt-2 border-t">
          {definition.parameters.map(renderParameter)}
        </div>
      )}
    </Card>
  );
}

interface FilterSelectorProps {
  onAddFilter: (type: ImageFilter['type'], params?: Partial<ImageFilter>) => void;
}

export function FilterSelector({ onAddFilter }: FilterSelectorProps) {
  const [selectedType, setSelectedType] = React.useState<ImageFilter['type']>('gaussian');
  
  const handleAdd = () => {
    onAddFilter(selectedType);
  };
  
  return (
    <div className="flex gap-2">
      <Select value={selectedType} onValueChange={(v) => setSelectedType(v as ImageFilter['type'])}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">Batch Filters</div>
          {FILTER_DEFINITIONS.filter(f => f.category === 'batch').map(def => (
            <SelectItem key={def.type} value={def.type}>
              {def.name}
            </SelectItem>
          ))}
          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground border-t mt-1">Spatial Filters</div>
          {FILTER_DEFINITIONS.filter(f => f.category === 'spatial').map(def => (
            <SelectItem key={def.type} value={def.type}>
              {def.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={handleAdd} size="sm">
        Add Filter
      </Button>
    </div>
  );
}
