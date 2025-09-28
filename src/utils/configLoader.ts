import yaml';

export interface Config {
  paths: {
    base_paths: string[];
    source_paths: string[];
    camera_numbers: number[];
  };
  images: {
    num_images: number;
    image_format: string[];
    vector_format: string[];
    shape: number[];
    time_resolved: boolean;
  };
  batches: {
    size: number;
  };
  processing: {
    instantaneous: boolean;
    ensemble: boolean;
    stereo: boolean;
  };
  post_processing: Array<{
    type: string;
    settings: Record<string, any>;
  }>;
  plots: {
    save_extension: string;
    save_pickle: boolean;
    fontsize: number;
    title_fontsize: number;
  };
  videos: Array<{
    endpoint: string;
    type: string;
    use_merged: boolean;
    variable: string;
    video_length: number;
  }>;
  statistics_extraction: any;
  instantaneous_piv: {
    window_size: number[][];
    overlap: number[];
    runs: number[];
    time_resolved: boolean;
  };
  ensemble_piv: {
    runs: number[];
    filters: Array<{ type: string; batch_size: number }>;
  };
  calibration_format: {
    image_format: string;
  };
  calibration: {
    active: string;
    scale_factor: {
      dt: number;
      px_per_mm: number;
      x_offset: number[];
      y_offset: number[];
    };
    pinhole: Record<string, any>;
    stereo: Record<string, any>;
    image_format: string;
  };
  filters: Array<{ batch_size: number; type: string }>;
}

export function parseConfig(yamlText: string): Config {
  return yaml.load(yamlText) as Config;
}