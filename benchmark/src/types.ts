export type BenchmarkMode = 'per_endpoint' | 'batch';
export type Executor = 'ramping-arrival-rate' | 'ramping-vus';
export type ChartTheme = 'light' | 'print' | 'dark' | 'transparent' | 'light-transparent' | 'dark-transparent';

export interface Target {
  name: string;
  url: string;
}

export interface Stage {
  duration: string;
  target: number;
}

export interface K6Settings {
  vus: number;
  arrival_time_unit: string;
  arrival_preallocated_vus: number;
  arrival_max_vus: number;
  arrival_vus_multiplier: number;
  arrival_max_vus_multiplier: number;
  keyspace_size?: number;
  warmup?: boolean;
}

export interface LambdaCapacityProviderMetadata {
  arn: string | null;
  per_execution_environment_max_concurrency: number | null;
  execution_environment_memory_gib_per_vcpu: number | null;
}

export interface LambdaScalingMetadata {
  min_execution_environments: number | null;
  max_execution_environments: number | null;
}

export interface LambdaFunctionMetadata {
  logical_id: string;
  function_name: string;
  function_arn: string | null;
  runtime: string | null;
  package_type: string | null;
  memory_size_mb: number | null;
  timeout_seconds: number | null;
  architectures: string[];
  capacity_provider: LambdaCapacityProviderMetadata | null;
  scaling: LambdaScalingMetadata | null;
}

export interface DeploymentMetadata {
  collected_at: string;
  parameters: Record<string, string>;
  functions: LambdaFunctionMetadata[];
  collection_errors: string[];
}

export interface RunMetadata {
  stack_name: string;
  region: string | null;
  profile: string;
  label: string | null;
  targets: Target[];
  k6: K6Settings;
  deployment: DeploymentMetadata | null;
}

export interface RunManifest {
  v: number;
  created_at: string;
  stack_name: string;
  region: string | null;
  targets: Target[];
  stages: Stage[];
  mode: BenchmarkMode;
  executor: Executor;
  max_delay_ms: number;
  report: string;
  label: string | null;
  git: {
    sha: string | null;
    dirty: boolean | null;
  };
  gateway_version: string | null;
  k6: K6Settings;
  deployment?: DeploymentMetadata | null;
}

export interface RawK6Record {
  metricName: string;
  timestamp: number;
  metricValue: number;
  status: number | null;
  error: string;
  extraTags: string;
  endpoint: string;
}

export interface LatencySample {
  endpoint: string;
  timestamp: number;
  elapsedSeconds: number;
  latencyMs: number;
  status: number | null;
}

export interface RequestSample {
  endpoint: string;
  timestamp: number;
  elapsedSeconds: number;
  status: number | null;
  error: string;
}

export interface BatchSample {
  endpoint: string;
  timestamp: number;
  elapsedSeconds: number;
  batchSize: number;
}

export interface EndpointSummaryRow {
  endpoint: string;
  requests: number;
  errors: number;
  errors_4xx: number;
  errors_5xx: number;
  errors_429: number;
  error_rate: number;
  ok_count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  batch_count: number;
  batch_avg: number | null;
  batch_min: number | null;
  batch_max: number | null;
  batch_p50: number | null;
  batch_p90: number | null;
  batch_p95: number | null;
  batch_p99: number | null;
  est_lambda_invocations: number | null;
  est_invocations_per_request: number | null;
  est_effective_batch_size: number | null;
  est_cost_pct_of_direct: number | null;
  duration_cost_proxy_ms: number | null;
  duration_cost_pct_of_standard: number | null;
}

export interface StageDurationCostPoint {
  endpoint: string;
  stage_index: number;
  stage_target: number;
  stage_start_seconds: number;
  stage_end_seconds: number;
  duration_cost_proxy_ms: number | null;
  duration_cost_pct_of_standard: number | null;
}

export interface MetricsBundle {
  endpoints: string[];
  stages: Stage[];
  executor: Executor;
  mode: BenchmarkMode;
  stackName: string;
  maxDelayMs: number;
  run: RunMetadata | null;
  latencySamples: LatencySample[];
  requestSamples: RequestSample[];
  batchSamples: BatchSample[];
  summaryRows: EndpointSummaryRow[];
  stageDurationCostSeries: StageDurationCostPoint[];
}

export interface RenderedChartPaths {
  latencyDistribution: string;
  latencyDistributionByTheme?: Partial<Record<ChartTheme, string>>;
}
