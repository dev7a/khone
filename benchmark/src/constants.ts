import path from 'node:path';

export const DEFAULT_STAGE_TARGETS = '50,100,150';
export const DEFAULT_RAMP_DURATION = '3m';
export const DEFAULT_HOLD_DURATION = '0s';
export const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), 'benchmark-results');
export const DEFAULT_STACK_NAME = 'khone-benchmark';

export const OUTPUT_KEYS_BY_ENDPOINT: Record<string, readonly string[]> = {
  steady: ['SteadyUrl'],
  adaptive: ['AdaptiveUrl'],
  'target-aware': ['TargetAwareUrl'],
  standard: ['StandardUrl'],
};

export const DEFAULT_ENDPOINTS = [
  'steady',
  'adaptive',
  'target-aware',
  'standard',
] as const;

export const RUN_MANIFEST_NAME = 'run.json';
export const RUN_K6_CSV_NAME = 'k6.csv';
export const RUN_SUMMARY_CSV_NAME = 'summary.csv';
export const RUN_REPORT_MD_NAME = 'report.md';
export const RUN_METRICS_JSON_NAME = 'metrics.json';

export const RUN_CHART_FILENAMES = {
  latencyDistribution: 'latency-distribution.png',
} as const;

export const K6_EXIT_THRESHOLD_WARN = 99;
