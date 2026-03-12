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
    description: 'Contrast Limited Adaptive Histogram Equalization. Enhances local contrast for shadowgraph and BOS images.',
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
    description: 'Gaussian smoothing filter',
    category: 'spatial',
    parameters: [
      {
        name: 'Sigma',
        key: 'sigma',
        type: 'number',
        default: 1.0,
        min: 0.1,
        max: 10.0,
        step: 0.1,
        description: 'Standard deviation for Gaussian kernel'
      }
    ]
  },
  {
    type: 'median',
    name: 'Median Filter',
    description: 'Median filtering for noise reduction',
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
    description: 'Morphological dilation using local maximum',
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
    name: 'Max-Norm',
    description: 'Normalize by local max-min contrast with smoothing',
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
        description: 'Maximum normalization gain'
      }
    ]
  },
  {
    type: 'norm',
    name: 'Normalization',
    description: 'Normalize by subtracting local min and dividing by range',
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
        description: 'Maximum normalization gain'
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
