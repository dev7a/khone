import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadK6Csv } from '../src/metrics/parseCsv.js';
import { deriveMetrics } from '../src/metrics/derive.js';
import { writeMetricsJson, writeReportMarkdown } from '../src/report/writeReport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureCsv = path.join(__dirname, 'fixtures', 'sample-k6-tie.csv');

test('report highlights call out tied cost instead of single winner', async () => {
  const records = await loadK6Csv(fixtureCsv);
  const metrics = deriveMetrics({
    records,
    endpointOrder: ['standard', 'adaptive'],
    stages: [{ duration: '2s', target: 2 }],
    executor: 'ramping-arrival-rate',
    mode: 'per_endpoint',
    stackName: 'test-stack',
    maxDelayMs: 0,
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-report-'));
  const output = path.join(tmpDir, 'report.md');

  await writeReportMarkdown(
    metrics,
    {
      latencyDistribution: path.join(tmpDir, 'charts', 'd.png'),
    },
    tmpDir,
    output,
  );

  const text = await fs.readFile(output, 'utf-8');
  assert.match(text, /Estimated cost is tied across endpoints/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('report includes workload and deployed Lambda configuration', async () => {
  const records = await loadK6Csv(fixtureCsv);
  const metrics = deriveMetrics({
    records,
    endpointOrder: ['standard', 'adaptive'],
    stages: [
      { duration: '1s', target: 1 },
      { duration: '5m', target: 10 },
    ],
    executor: 'ramping-arrival-rate',
    mode: 'per_endpoint',
    stackName: 'test-stack',
    maxDelayMs: 0,
  });
  metrics.run = {
    stack_name: 'test-stack',
    region: 'us-east-1',
    profile: 'default',
    label: null,
    targets: [
      { name: 'adaptive', url: 'https://example.com/adaptive' },
      { name: 'standard', url: 'https://example.com/std' },
    ],
    k6: {
      vus: 50,
      arrival_time_unit: '1s',
      arrival_preallocated_vus: 0,
      arrival_max_vus: 0,
      arrival_vus_multiplier: 1,
      arrival_max_vus_multiplier: 2,
      keyspace_size: 1000,
      warmup: true,
    },
    deployment: {
      collected_at: '2026-01-01T00:00:00.000Z',
      parameters: {
        BenchmarkHandlerMemorySize: '512',
        BenchmarkBackendBaseDelayMs: '80',
        BenchmarkBackendJitterMs: '80',
        BenchmarkBackendPoints: '48',
        BenchmarkBackendTimeoutMs: '7000',
        KhoneMaxConcurrency: '16',
      },
      functions: [
        {
          logical_id: 'GatewayService',
          function_name: 'test-gateway',
          function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-gateway',
          runtime: 'provided.al2023',
          package_type: 'Zip',
          memory_size_mb: 2048,
          timeout_seconds: 90,
          architectures: ['arm64'],
          capacity_provider: {
            arn: 'arn:aws:lambda:us-east-1:123456789012:capacity-provider:test',
            per_execution_environment_max_concurrency: 64,
            execution_environment_memory_gib_per_vcpu: 2,
          },
          scaling: {
            min_execution_environments: 1,
            max_execution_environments: 4,
          },
        },
        {
          logical_id: 'AdaptiveFunction',
          function_name: 'test-adaptive',
          function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-adaptive',
          runtime: 'nodejs24.x',
          package_type: 'Zip',
          memory_size_mb: 512,
          timeout_seconds: 90,
          architectures: ['arm64'],
          capacity_provider: null,
          scaling: null,
        },
      ],
      collection_errors: [],
    },
  };

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-report-config-'));
  const output = path.join(tmpDir, 'report.md');

  await writeReportMarkdown(
    metrics,
    {
      latencyDistribution: path.join(tmpDir, 'charts', 'd.png'),
    },
    tmpDir,
    output,
  );

  const text = await fs.readFile(output, 'utf-8');
  assert.match(text, /## Test Configuration/);
  assert.match(text, /From rps/);
  assert.match(text, /BenchmarkHandlerMemorySize/);
  assert.match(text, /512/);
  assert.match(text, /GatewayService/);
  assert.match(text, /2048 MB/);
  assert.match(text, /1\/4 envs/);
  assert.match(text, /64 conc\/env/);
  assert.match(text, /2 GiB\/vCPU/);
  assert.match(text, /Benchmark Scenario Notes/);
  assert.match(text, /backend Lambda URL/);
  assert.match(text, /I\/O-bound handler/);
  assert.match(text, /CPU-bound handlers are less likely to benefit/);
  assert.match(text, /80.*ms base plus.*80.*ms item-key-seeded jitter/);
  assert.match(text, /48.*generated points per item/);
  assert.match(text, /7000.*ms timeout/);
  assert.doesNotMatch(text, /https:\/\/example\.com/);
  assert.doesNotMatch(text, /arn:aws/);
  assert.doesNotMatch(text, /123456789012/);
  assert.doesNotMatch(text, /test-gateway/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('public report omits exact generation timestamp', async () => {
  const records = await loadK6Csv(fixtureCsv);
  const metrics = deriveMetrics({
    records,
    endpointOrder: ['standard', 'adaptive'],
    stages: [{ duration: '2s', target: 2 }],
    executor: 'ramping-arrival-rate',
    mode: 'per_endpoint',
    stackName: 'test-stack',
    maxDelayMs: 0,
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-public-report-'));
  const output = path.join(tmpDir, 'report.md');
  await writeReportMarkdown(
    metrics,
    {
      latencyDistribution: path.join(tmpDir, 'charts', 'd.png'),
    },
    tmpDir,
    output,
    { publicReport: true },
  );

  const text = await fs.readFile(output, 'utf-8');
  assert.doesNotMatch(text, /^Generated:/m);
  assert.match(text, /^Executor:/m);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('metrics json redacts infrastructure identifiers from public report data', async () => {
  const records = await loadK6Csv(fixtureCsv);
  const metrics = deriveMetrics({
    records,
    endpointOrder: ['standard', 'adaptive'],
    stages: [{ duration: '2s', target: 2 }],
    executor: 'ramping-arrival-rate',
    mode: 'per_endpoint',
    stackName: 'test-stack',
    maxDelayMs: 0,
  });
  metrics.run = {
    stack_name: 'test-stack',
    region: 'us-east-1',
    profile: 'default',
    label: null,
    targets: [{ name: 'adaptive', url: 'https://example.com/adaptive' }],
    k6: {
      vus: 50,
      arrival_time_unit: '1s',
      arrival_preallocated_vus: 0,
      arrival_max_vus: 0,
      arrival_vus_multiplier: 1,
      arrival_max_vus_multiplier: 2,
    },
    deployment: {
      collected_at: '2026-01-01T00:00:00.000Z',
      parameters: {
        BenchmarkHandlerMemorySize: '512',
        GatewayCapacityProviderArn: 'arn:aws:lambda:us-east-1:123456789012:capacity-provider:test',
        KhoneLayerArm64Arn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1',
      },
      functions: [
        {
          logical_id: 'GatewayService',
          function_name: 'test-gateway',
          function_arn: 'arn:aws:lambda:us-east-1:123456789012:function:test-gateway',
          runtime: 'provided.al2023',
          package_type: 'Zip',
          memory_size_mb: 2048,
          timeout_seconds: 90,
          architectures: ['arm64'],
          capacity_provider: {
            arn: 'arn:aws:lambda:us-east-1:123456789012:capacity-provider:test',
            per_execution_environment_max_concurrency: 64,
            execution_environment_memory_gib_per_vcpu: 2,
          },
          scaling: null,
        },
      ],
      collection_errors: [
        'User: arn:aws:sts::123456789012:assumed-role/TestRole/i-123 is not authorized',
      ],
    },
  };

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-metrics-json-'));
  const output = path.join(tmpDir, 'metrics.json');
  await writeMetricsJson(metrics, output);

  const text = await fs.readFile(output, 'utf-8');
  assert.match(text, /"stack_name": "redacted"/);
  assert.match(text, /"BenchmarkHandlerMemorySize": "512"/);
  assert.doesNotMatch(text, /https:\/\/example\.com/);
  assert.doesNotMatch(text, /arn:aws/);
  assert.doesNotMatch(text, /123456789012/);
  assert.doesNotMatch(text, /test-gateway/);
  assert.doesNotMatch(text, /not authorized/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
