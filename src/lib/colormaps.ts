/**
 * Matplotlib colormap definitions organized by category.
 * These colormaps are passed to the backend for rendering.
 */

export interface ColormapCategory {
  label: string;
  colormaps: string[];
}

export const COLORMAP_CATEGORIES: ColormapCategory[] = [
  {
    // Best for velocity components, vorticity, divergence - shows +/- with clear midpoint
    label: "Diverging (Recommended)",
    colormaps: [
      "coolwarm", "bwr", "seismic", "RdBu", "RdYlBu",
      "RdYlGn", "Spectral", "PiYG", "PRGn", "BrBG", "PuOr", "RdGy",
      "berlin", "managua", "vanimo",
    ],
  },
  {
    // Best for magnitude fields (velocity magnitude, TKE, stresses)
    label: "Perceptually Uniform",
    colormaps: ["viridis", "plasma", "inferno", "magma", "cividis"],
  },
  {
    // Classic flow viz colormaps - familiar but less perceptually uniform
    label: "Classic Flow Viz",
    colormaps: [
      "jet", "hot", "afmhot", "gist_heat", "copper",
      "cool", "spring", "summer", "autumn", "winter", "Wistia",
    ],
  },
  {
    // Good for scalar fields with natural progression
    label: "Sequential (Multi-Hue)",
    colormaps: [
      "YlOrBr", "YlOrRd", "OrRd", "PuRd", "RdPu", "BuPu",
      "GnBu", "PuBu", "YlGnBu", "PuBuGn", "BuGn", "YlGn",
    ],
  },
  {
    // Simple gradients for basic visualization
    label: "Sequential (Single Hue)",
    colormaps: ["Greys", "Purples", "Blues", "Greens", "Oranges", "Reds"],
  },
  {
    // Useful for phase/angle data (flow direction, swirl)
    label: "Cyclic",
    colormaps: ["twilight", "twilight_shifted", "hsv"],
  },
  {
    // Grayscale variants
    label: "Grayscale",
    colormaps: ["gray", "binary", "gist_yarg", "gist_gray", "bone", "pink"],
  },
  {
    // Categorical data, less common for flow viz
    label: "Qualitative",
    colormaps: [
      "Pastel1", "Pastel2", "Paired", "Accent", "Dark2",
      "Set1", "Set2", "Set3",
      "tab10", "tab20", "tab20b", "tab20c",
    ],
  },
  {
    label: "Miscellaneous",
    colormaps: [
      "terrain", "ocean", "gist_earth", "gist_stern",
      "gnuplot", "gnuplot2", "CMRmap", "cubehelix",
      "brg", "nipy_spectral", "flag", "prism",
    ],
  },
];

// Flat list of all colormaps for validation
export const ALL_COLORMAPS: string[] = COLORMAP_CATEGORIES.flatMap(cat => cat.colormaps);

// Default colormap
export const DEFAULT_COLORMAP = "default";

// Popular colormaps for quick access (shown at top) - optimized for flow viz
export const POPULAR_COLORMAPS: string[] = [
  "default", "coolwarm", "viridis", "jet", "RdBu", "plasma", "hot", "gray"
];
