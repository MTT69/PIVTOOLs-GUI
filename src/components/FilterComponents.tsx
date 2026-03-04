import React, { useState, useRef, useEffect } from 'react';
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

/** Local-buffered number input for filter parameters. Allows clearing + retyping. */
function FilterNumberInput({ param, value, index, onUpdate }: {
  param: any;
  value: number | undefined;
  index: number;
  onUpdate: (index: number, updates: Partial<ImageFilter>) => void;
}) {
  const [localVal, setLocalVal] = useState(String(value ?? param.default ?? ''));
  const isEditingRef = useRef(false);

  useEffect(() => {
    if (isEditingRef.current) return;
    setLocalVal(String(value ?? param.default ?? ''));
  }, [value, param.default]);

  return (
    <div className="space-y-1">
      <Label className="text-xs">{param.name}</Label>
      <Input
        type="text"
        inputMode="numeric"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onFocus={() => { isEditingRef.current = true; }}
        onBlur={() => {
          isEditingRef.current = false;
          const parsed = parseFloat(localVal);
          if (!isNaN(parsed)) {
            setLocalVal(String(parsed));
            onUpdate(index, { [param.key]: parsed });
          } else {
            const fallback = param.default ?? 0;
            setLocalVal(String(fallback));
            onUpdate(index, { [param.key]: fallback });
          }
        }}
        className="h-8 text-xs"
      />
      <p className="text-xs text-muted-foreground">{param.description}</p>
    </div>
  );
}

/** Local-buffered tuple input for filter parameters. */
function FilterTupleInput({ param, value, index, onUpdate }: {
  param: any;
  value: [number, number] | undefined;
  index: number;
  onUpdate: (index: number, updates: Partial<ImageFilter>) => void;
}) {
  const defaults = (param.default as [number, number]) ?? [0, 0];
  const [localA, setLocalA] = useState(String(value?.[0] ?? defaults[0]));
  const [localB, setLocalB] = useState(String(value?.[1] ?? defaults[1]));
  const isEditingARef = useRef(false);
  const isEditingBRef = useRef(false);

  useEffect(() => {
    if (!isEditingARef.current) setLocalA(String(value?.[0] ?? defaults[0]));
    if (!isEditingBRef.current) setLocalB(String(value?.[1] ?? defaults[1]));
  }, [value?.[0], value?.[1], defaults[0], defaults[1]]);

  return (
    <div className="space-y-1">
      <Label className="text-xs">{param.name}</Label>
      <div className="flex gap-2">
        <Input
          type="text"
          inputMode="numeric"
          value={localA}
          onChange={(e) => setLocalA(e.target.value)}
          onFocus={() => { isEditingARef.current = true; }}
          onBlur={() => {
            isEditingARef.current = false;
            const parsed = parseInt(localA);
            const currentB = value?.[1] ?? defaults[1];
            if (!isNaN(parsed)) {
              setLocalA(String(parsed));
              onUpdate(index, { [param.key]: [parsed, currentB] });
            } else {
              setLocalA(String(defaults[0]));
              onUpdate(index, { [param.key]: [defaults[0], currentB] });
            }
          }}
          className="h-8 text-xs"
          placeholder="H"
        />
        <Input
          type="text"
          inputMode="numeric"
          value={localB}
          onChange={(e) => setLocalB(e.target.value)}
          onFocus={() => { isEditingBRef.current = true; }}
          onBlur={() => {
            isEditingBRef.current = false;
            const parsed = parseInt(localB);
            const currentA = value?.[0] ?? defaults[0];
            if (!isNaN(parsed)) {
              setLocalB(String(parsed));
              onUpdate(index, { [param.key]: [currentA, parsed] });
            } else {
              setLocalB(String(defaults[1]));
              onUpdate(index, { [param.key]: [currentA, defaults[1]] });
            }
          }}
          className="h-8 text-xs"
          placeholder="W"
        />
      </div>
      <p className="text-xs text-muted-foreground">{param.description}</p>
    </div>
  );
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
          <FilterNumberInput
            key={param.key as string}
            param={param}
            value={value as number | undefined}
            index={index}
            onUpdate={onUpdate}
          />
        );

      case 'tuple':
        return (
          <FilterTupleInput
            key={param.key as string}
            param={param}
            value={value as [number, number] | undefined}
            index={index}
            onUpdate={onUpdate}
          />
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
