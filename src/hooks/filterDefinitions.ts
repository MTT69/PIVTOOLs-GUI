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
  // COMMENTED OUT: Unused filters (clip, invert)
  // {
  //   type: 'clip',
  //   name: 'Clip Filter',
  //   description: 'Clip pixel intensities to threshold or median-based range',
  //   category: 'spatial',
  //   parameters: [
  //     {
  //       name: 'Auto-threshold (std devs)',
  //       key: 'n',
  //       type: 'number',
  //       default: 2.0,
  //       min: 0.5,
  //       max: 5.0,
  //       step: 0.1,
  //       description: 'Number of standard deviations for auto-threshold'
  //     }
  //   ]
  // },
  // {
  //   type: 'invert',
  //   name: 'Invert',
  //   description: 'Invert image intensities',
  //   category: 'spatial',
  //   parameters: [
  //     {
  //       name: 'Offset',
  //       key: 'offset',
  //       type: 'number',
  //       default: 255,
  //       min: 0,
  //       max: 65535,
  //       step: 1,
  //       description: 'Scalar value to subtract pixels from'
  //     }
  //   ]
  // },
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
  // COMMENTED OUT: Unused filters (sbg, levelize)
  // {
  //   type: 'sbg',
  //   name: 'Subtract Background',
  //   description: 'Subtract a background image',
  //   category: 'spatial',
  //   parameters: [
  //     {
  //       name: 'Background Path',
  //       key: 'bg',
  //       type: 'text',
  //       default: null,
  //       description: 'Path to background image (leave empty for none)'
  //     }
  //   ]
  // },
  // {
  //   type: 'levelize',
  //   name: 'Levelize',
  //   description: 'Normalize by dividing by white reference image',
  //   category: 'spatial',
  //   parameters: [
  //     {
  //       name: 'White Reference Path',
  //       key: 'white',
  //       type: 'text',
  //       default: null,
  //       description: 'Path to white reference image'
  //     }
  //   ]
  // }
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
