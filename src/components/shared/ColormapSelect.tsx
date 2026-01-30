"use client";

import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "@/components/ui/select";
import { COLORMAP_CATEGORIES, POPULAR_COLORMAPS } from "@/lib/colormaps";

interface ColormapSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
}

/**
 * A reusable colormap selection dropdown that displays all matplotlib colormaps
 * organized by category with popular options at the top for quick access.
 */
export default function ColormapSelect({
  value,
  onValueChange,
  id = "colormap",
  placeholder = "Select colormap",
  className,
}: ColormapSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-[400px]">
        {/* Popular colormaps at top for quick access */}
        <SelectGroup>
          <SelectLabel className="text-xs text-muted-foreground px-2 font-semibold">
            ⭐ Popular
          </SelectLabel>
          {POPULAR_COLORMAPS.map((cmap) => (
            <SelectItem key={cmap} value={cmap}>
              {cmap}
            </SelectItem>
          ))}
        </SelectGroup>

        <SelectSeparator />

        {/* All colormaps organized by category */}
        {COLORMAP_CATEGORIES.map((category, idx) => (
          <React.Fragment key={category.label}>
            <SelectGroup>
              <SelectLabel className="text-xs text-muted-foreground px-2">
                {category.label}
              </SelectLabel>
              {category.colormaps.map((cmap) => (
                <SelectItem key={cmap} value={cmap}>
                  {cmap}
                </SelectItem>
              ))}
            </SelectGroup>
            {idx < COLORMAP_CATEGORIES.length - 1 && <SelectSeparator />}
          </React.Fragment>
        ))}
      </SelectContent>
    </Select>
  );
}
