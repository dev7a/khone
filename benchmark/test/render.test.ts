import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadK6Csv } from '../src/metrics/parseCsv.js';
import { deriveMetrics } from '../src/metrics/derive.js';
import { renderCharts } from '../src/charts/render.js';
import { buildEChartsRenderSpecs } from '../src/charts/echarts/specs.js';
import { RUN_CHART_FILENAMES } from '../src/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureCsv = path.join(__dirname, 'fixtures', 'sample-k6.csv');

test('renderCharts outputs PNG files with content', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-render-'));
  const chartsDir = path.join(tmpRoot, 'charts');

  const records = await loadK6Csv(fixtureCsv);
  const metrics = deriveMetrics({
    records,
    endpointOrder: ['standard', 'adaptive'],
    stages: [{ duration: '3s', target: 2 }],
    executor: 'ramping-arrival-rate',
    mode: 'per_endpoint',
    stackName: 'test-stack',
    maxDelayMs: 0,
  });

  const chartPaths = await renderCharts(metrics, chartsDir);
  const paths = Object.values(chartPaths);
  assert.equal(paths.length, 1);

  for (const pathname of paths) {
    const stat = await fs.stat(pathname);
    assert.ok(stat.size > 1000, `${pathname} should have visible PNG bytes`);
  }

  await fs.rm(tmpRoot, { recursive: true, force: true });
});


test('transparent light and dark themes use alpha background in chart specs', async () => {
  const records = await loadK6Csv(fixtureCsv);
  const metrics = deriveMetrics({
    records,
    endpointOrder: ['standard', 'adaptive'],
    stages: [{ duration: '3s', target: 2 }],
    executor: 'ramping-arrival-rate',
    mode: 'per_endpoint',
    stackName: 'test-stack',
    maxDelayMs: 0,
  });

  for (const theme of ['light-transparent', 'dark-transparent'] as const) {
    const specs = buildEChartsRenderSpecs(metrics, theme);
    for (const spec of specs) {
      assert.equal(spec.backgroundColor, 'transparent');
      const option = spec.option as Record<string, unknown>;
      assert.equal(option.backgroundColor, 'transparent');
    }
  }
});

test('latency distribution stays linear even with high outliers', async () => {
  const records = await loadK6Csv(fixtureCsv);
  let injected = false;
  const withOutlierGap = records.map((record) => {
    if (record.metricName === 'http_req_duration') {
      if (!injected) {
        injected = true;
        return { ...record, status: 200, error: '', metricValue: 3200 };
      }
      return { ...record, status: 200, error: '' };
    }
    return record;
  });

  const metrics = deriveMetrics({
    records: withOutlierGap,
    endpointOrder: ['standard', 'adaptive'],
    stages: [{ duration: '3s', target: 2 }],
    executor: 'ramping-arrival-rate',
    mode: 'per_endpoint',
    stackName: 'test-stack',
    maxDelayMs: 0,
  });

  const specs = buildEChartsRenderSpecs(metrics, 'light');
  const latencySpec = specs.find((spec) => spec.filename === RUN_CHART_FILENAMES.latencyDistribution);
  assert.ok(latencySpec, 'latency distribution chart spec should exist');

  const option = latencySpec.option as Record<string, unknown>;
  const title = option.title as { subtext?: string };
  assert.match(title.subtext ?? '', /dots show latency/i);

  const series = option.series as Array<{ id?: string; data?: Array<{ latency_ms?: number; value?: [number, number] }> }>;
  assert.ok(!series.some((entry) => entry.id === 'latency-split-marker'));
  assert.ok(series.some((entry) => entry.id === 'stage-cost-bars'), 'latency distribution should include stage cost bar overlay');
  const allPoints = series.flatMap((entry) => entry.data ?? []);
  const rawMappedPoint = allPoints.find(
    (point) =>
      typeof point.latency_ms === 'number' &&
      Array.isArray(point.value) &&
      typeof point.value[1] === 'number' &&
      point.latency_ms > 500 &&
      point.value[1] === point.latency_ms,
  );
  assert.ok(rawMappedPoint, 'high-latency points should retain raw y-values');
});

test('latency distribution overlays red error points for non-200 latency samples', async () => {
  const records = await loadK6Csv(fixtureCsv);
  const metrics = deriveMetrics({
    records,
    endpointOrder: ['standard', 'adaptive'],
    stages: [{ duration: '3s', target: 2 }],
    executor: 'ramping-arrival-rate',
    mode: 'per_endpoint',
    stackName: 'test-stack',
    maxDelayMs: 0,
  });

  const specs = buildEChartsRenderSpecs(metrics, 'light');
  const latencySpec = specs.find((spec) => spec.filename === RUN_CHART_FILENAMES.latencyDistribution);
  assert.ok(latencySpec, 'latency distribution chart spec should exist');

  const option = latencySpec.option as Record<string, unknown>;
  const series = option.series as Array<{ id?: string; data?: unknown[] }>;
  const errorSeries = series.find((entry) => entry.id === 'latency-error-points');
  assert.ok(errorSeries, 'latency distribution should include error scatter series');
  assert.ok((errorSeries.data?.length ?? 0) > 0, 'error scatter series should have points');
});

test('latency distribution title includes run configuration context', async () => {
  const records = await loadK6Csv(fixtureCsv);
  const metrics = deriveMetrics({
    records,
    endpointOrder: ['standard', 'adaptive'],
    stages: [{ duration: '3s', target: 2 }],
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
    targets: [],
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
        BenchmarkBackendJitterMs: '40',
        BenchmarkBackendPoints: '48',
        BenchmarkBackendTimeoutMs: '7000',
      },
      functions: [
        {
          logical_id: 'GatewayFunction',
          function_name: 'test-gateway',
          function_arn: null,
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
      ],
      collection_errors: [],
    },
  };

  const specs = buildEChartsRenderSpecs(metrics, 'light');
  const latencySpec = specs.find((spec) => spec.filename === RUN_CHART_FILENAMES.latencyDistribution);
  assert.ok(latencySpec, 'latency distribution chart spec should exist');

  const option = latencySpec.option as Record<string, unknown>;
  const title = option.title as { subtext?: string };
  assert.match(title.subtext ?? '', /Target fn memory: 512 MB/);
  assert.match(title.subtext ?? '', /Backend delay: 80\+40 ms, 48 pts, 7000 ms timeout/);
  assert.match(title.subtext ?? '', /Gateway LMI: 2048 MB gateway, 1-4 envs, 64 conc\/env, 2 GiB\/vCPU/);
});
