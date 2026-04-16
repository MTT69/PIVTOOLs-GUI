import { FilterType, ImageFilter } from './useImageFilters';

export interface FilterDefinition {
  type: FilterType;
  name: string;
  description: string;
  category: 'batch' | 'spatial';
  parameters: {
    name: string;
    key: keyof ImageFilter;
    type: 'number' | 'tuple' | 'text' | 'select';
    default: any;
    min?: number;
    max?: number;
    step?: number;
    options?: { value: any; label: string }[];
    description: string;
  }[];
}

export const FILTER_DEFINITIONS: FilterDefinition[] = [
  // Batch Filters
  {
    type: 'time',
    name: 'Time Filter',
    description: 'Subtract local minimum across time for each pixel. Uses global batch size (set in Performance settings).',
    category: 'batch',
    parameters: []
  },
  {
    type: 'pod',
    name: 'POD Filter',
    description: 'Proper Orthogonal Decomposition - removes coherent structures. Uses global batch size (set in Performance settings).',
    category: 'batch',
    parameters: []
  },

  // Spatial Filters
  {
    type: 'invert',
    name: 'Invert',
    description: 'Invert image intensity (max - pixel). For shadowgraph PIV where particles are dark on a bright background.',
    category: 'spatial',
    parameters: []
  },
  {
    type: 'clahe',
    name: 'CLAHE',
    description: 'Contrast Limited Adaptive Histogram Equalization. Enhances local contrast, useful for uneven illumination or low-contrast regions.',
    category: 'spatial',
    parameters: [
      {
        name: 'Clip Limit',
        key: 'clip_limit',
        type: 'number',
        default: 2.0,
        min: 0.1,
        max: 40.0,
        step: 0.1,
        description: 'Contrast limit threshold'
      },
      {
        name: 'Tile Grid Size',
        key: 'tile_grid_size',
        type: 'tuple',
        default: [8, 8],
        min: 2,
        max: 64,
        step: 1,
        description: 'Grid size for local histogram regions'
      }
    ]
  },
  {
    type: 'gaussian',
    name: 'Gaussian Blur',
    description: 'Gaussian low-pass smoothing. Reduces high-frequency noise while preserving large-scale intensity.',
    category: 'spatial',
    parameters: [
      {
        name: 'Kernel Size',
        key: 'size',
        type: 'tuple',
        default: [7, 7],
        min: 3,
        max: 21,
        step: 2,
        description: 'Kernel size [height, width] (odd numbers only)'
      },
      {
        name: 'Sigma',
        key: 'sigma',
        type: 'number',
        default: 1.0,
        min: 0.1,
        max: 10.0,
        step: 0.1,
        description: 'Standard deviation of the Gaussian (pixels)'
      }
    ]
  },
  {
    type: 'median',
    name: 'Median',
    description: 'Replaces each pixel with the median of its neighbourhood. Removes salt-and-pepper noise and hot pixels without blurring edges.',
    category: 'spatial',
    parameters: [
      {
        name: 'Kernel Size',
        key: 'size',
        type: 'tuple',
        default: [5, 5],
        min: 3,
        max: 21,
        step: 2,
        description: 'Kernel size [height, width] (odd numbers only)'
      }
    ]
  },
  {
    type: 'lmax',
    name: 'Local Maximum',
    description: 'Replaces each pixel with the maximum in its neighbourhood (morphological dilation). Expands bright features — useful for detecting particle locations.',
    category: 'spatial',
    parameters: [
      {
        name: 'Kernel Size',
        key: 'size',
        type: 'tuple',
        default: [7, 7],
        min: 3,
        max: 21,
        step: 2,
        description: 'Kernel size [height, width]'
      }
    ]
  },
  {
    type: 'maxnorm',
    name: 'Background Normalize',
    description: 'Divides by the smoothed local background (sliding minimum). Equalizes illumination gradients across the image while preserving particle contrast. Max gain limits amplification in dark regions.',
    category: 'spatial',
    parameters: [
      {
        name: 'Kernel Size',
        key: 'size',
        type: 'tuple',
        default: [7, 7],
        min: 3,
        max: 21,
        step: 2,
        description: 'Kernel size [height, width]'
      },
      {
        name: 'Max Gain',
        key: 'max_gain',
        type: 'number',
        default: 1.0,
        min: 0.1,
        max: 10.0,
        step: 0.1,
        description: 'Maximum amplification allowed (caps gain in dark regions)'
      }
    ]
  },
  {
    type: 'norm',
    name: 'Range Normalize',
    description: 'Subtracts the local minimum then divides by the local range (max − min). Maps each pixel to [0, 1] relative to its neighbourhood. Good general-purpose contrast equalization.',
    category: 'spatial',
    parameters: [
      {
        name: 'Kernel Size',
        key: 'size',
        type: 'tuple',
        default: [7, 7],
        min: 3,
        max: 21,
        step: 2,
        description: 'Kernel size [height, width]'
      },
      {
        name: 'Max Gain',
        key: 'max_gain',
        type: 'number',
        default: 1.0,
        min: 0.1,
        max: 10.0,
        step: 0.1,
        description: 'Maximum amplification allowed (caps gain in low-contrast regions)'
      }
    ]
  },
  {
    type: 'norm2',
    name: 'Smoothed Range Normalize',
    description: 'Like Range Normalize, but smooths the min and max envelopes before normalizing. More robust to single-pixel noise spikes. Use when standard Range Normalize produces noisy results.',
    category: 'spatial',
    parameters: [
      {
        name: 'Kernel Size',
        key: 'size',
        type: 'tuple',
        default: [7, 7],
        min: 3,
        max: 21,
        step: 2,
        description: 'Kernel size [height, width]'
      },
      {
        name: 'Max Gain',
        key: 'max_gain',
        type: 'number',
        default: 1.0,
        min: 0.1,
        max: 10.0,
        step: 0.1,
        description: 'Maximum amplification allowed'
      }
    ]
  },
  {
    type: 'ssmin',
    name: 'SSMin',
    description: 'Sliding minimum background subtraction. Median-smooths, extracts the local minimum (background envelope), box-smooths it, and subtracts. Removes slowly-varying background (laser sheet profile, reflections). Output clipped to ≥ 0.',
    category: 'spatial',
    parameters: [
      {
        name: 'Kernel Size',
        key: 'size',
        type: 'tuple',
        default: [7, 7],
        min: 3,
        max: 21,
        step: 2,
        description: 'Kernel size [height, width]'
      }
    ]
  },
];

export function getFilterDefinition(type: FilterType): FilterDefinition | undefined {
  return FILTER_DEFINITIONS.find(f => f.type === type);
}

export function getBatchFilters(): FilterDefinition[] {
  return FILTER_DEFINITIONS.filter(f => f.category === 'batch');
}

export function getSpatialFilters(): FilterDefinition[] {
  return FILTER_DEFINITIONS.filter(f => f.category === 'spatial');
}
