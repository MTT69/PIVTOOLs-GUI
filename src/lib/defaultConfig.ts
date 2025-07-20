export const defaultConfig = {
  "setup": {
    "environment": {
      "local": true,
      "numTasks": 6,
      "restartParpool": true,
      "imageLoadCores": 6,
      "maxCores": 6
    },
    "imProperties": {
      "imageCount": 1000,
      "batchSize": 1000,
      "parforbatch": 25,
      "imageSize": [1024, 1024],
      "imageType": "im",
      "reader": "matlab",
      "timeResolved": false,
      "cameraCount": 1,
      "combineRuns": false,
      "caseImages": 1000,
      "scaleFactor": 3.416666667,
      "yOffset": -150,
      "xOffset": 0,
      "dt": 0.0275
    },
    "pipeline": {
      "compile": true,
      "createMask": false,
      "loadMask": false,
      "polygonsToRemove": 4,
      "prefilter": false,
      "instantaneous": false,
      "ensemble": true,
      "storePlanes": true,
      "calculateSumWindow": false,
      "calibrate_inst": false,
      "calibrate_sum": true,
      "calibrate_stereo": false,
      "calibrateType": "basic",
      "merge": false,
      "statistics_correlation": false,
      "statistics_inst": false,
      "statistics_inst_stereo": false,
      "statistics_ensemble": true,
      "statistics_ensemble_stereo": false,
      "statistics_use_merged": false
    },
    "instantaneous": {
      "windowSize": [
        [128, 128],
        [64, 64],
        [32, 32],
        [16, 16],
        [16, 16],
        [16, 16]
      ],
      "overlap": [50, 50, 50, 50, 50, 50],
      "runs": [6]
    },
    "ensemble": {
      "windowSize": [
        [128, 128],
        [64, 64],
        [32, 32],
        [16, 16],
        [12, 12],
        [8, 8],
        [6, 6],
        [4, 4]
      ],
      "overlap": [50, 50, 50, 50, 50, 50, 50, 50],
      "type": ["std", "std", "std", "std", "single", "single", "single", "single"],
      "resumeCase": 5,
      "sumWindow": [48, 48],
      "runs": [4, 5, 6, 7, 8],
      "convergedRun": 3
    },
    "directory": {
      "base": "",
      "source": "",
      "code": ""
    }
  },
  "filters": [
    {
      "type": "null"
    }
  ],
  "paths": {
    "base_dir": ["C:\\Users\\mtt1e23\\OneDrive - University of Southampton\\Documents\\#current_processing\\query_JHTDB\\Planar_Images\\ProcessedPIV"],
    "source": ["C:\\Users\\mtt1e23\\OneDrive - University of Southampton\\Documents\\#current_processing\\query_JHTDB\\Planar_Images"]
  }
};
