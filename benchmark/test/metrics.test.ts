import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadK6Csv } from '../src/metrics/parseCsv.js';
import { deriveMetrics } from '../src/metrics/derive.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureCsv = path.join(__dirname, 'fixtures', 'sample-k6.csv');

test('deriveMetrics includes transport errors and cost parity baseline', async () => {
  const records = await loadK6Csv(fixtureCsv);
  const metrics = deriveMetrics({
    records,
    endpointOrder: ['standard', 'mux'],
    stages: [{ duration: '3s', target: 2 }],
    executor: 'ramping-arrival-rate',
    mode: 'per_endpoint',
    stackName: 'test-stack',
    maxDelayMs: 0,
  });

  const standard = metrics.summaryRows.find((row) => row.endpoint === 'standard');
  const mux = metrics.summaryRows.find((row) => row.endpoint === 'mux');

  assert.ok(standard);
  assert.ok(mux);

  assert.equal(standard.requests, 3);
  assert.equal(standard.errors, 0);
  assert.equal(standard.est_cost_pct_of_direct, 100);

  assert.equal(mux.requests, 3);
  assert.equal(mux.errors, 2, '500 + transport failure should both count as errors');
  assert.equal(mux.errors_5xx, 1);
  assert.equal(mux.error_rate, 2 / 3);
  assert.equal(mux.est_invocations_per_request, 0.333333);
  assert.equal(mux.est_cost_pct_of_direct, 33.3333);

  assert.equal(metrics.stageDurationCostSeries.length, 2);
  const standardStageCost = metrics.stageDurationCostSeries.find((row) => row.endpoint === 'standard' && row.stage_index === 0);
  const muxStageCost = metrics.stageDurationCostSeries.find((row) => row.endpoint === 'mux' && row.stage_index === 0);
  assert.ok(standardStageCost);
  assert.ok(muxStageCost);
  assert.equal(standardStageCost.duration_cost_pct_of_standard, 100);
  assert.ok((muxStageCost.duration_cost_pct_of_standard ?? 0) > 0);
  assert.ok((muxStageCost.duration_cost_pct_of_standard ?? 0) < 100);
});

test('deriveMetrics prefers router target elapsed for duration cost when present', async () => {
  const records = await loadK6Csv(fixtureCsv);
  const metrics = deriveMetrics({
    records: records.concat([
      {
        metricName: 'khone_target_elapsed_ms',
        timestamp: 1700000001,
        metricValue: 40,
        status: null,
        error: '',
        extraTags: 'endpoint=mux',
        endpoint: 'mux',
      },
      {
        metricName: 'khone_target_elapsed_ms',
        timestamp: 1700000002,
        metricValue: 80,
        status: null,
        error: '',
        extraTags: 'endpoint=mux',
        endpoint: 'mux',
      },
      {
        metricName: 'khone_target_elapsed_ms',
        timestamp: 1700000003,
        metricValue: 20,
        status: null,
        error: '',
        extraTags: 'endpoint=mux',
        endpoint: 'mux',
      },
    ]),
    endpointOrder: ['standard', 'mux'],
    stages: [{ duration: '3s', target: 2 }],
    executor: 'ramping-arrival-rate',
    mode: 'per_endpoint',
    stackName: 'test-stack',
    maxDelayMs: 0,
  });

  const mux = metrics.summaryRows.find((row) => row.endpoint === 'mux');
  assert.ok(mux);
  assert.equal(mux.duration_cost_proxy_ms, 40);
  assert.equal(mux.duration_cost_pct_of_standard, 12.121212);
});

test('deriveMetrics falls back to http duration cost when target elapsed is partial', async () => {
  const records = await loadK6Csv(fixtureCsv);
  const metrics = deriveMetrics({
    records: records.concat([
      {
        metricName: 'khone_target_elapsed_ms',
        timestamp: 1700000001,
        metricValue: 40,
        status: null,
        error: '',
        extraTags: 'endpoint=mux',
        endpoint: 'mux',
      },
    ]),
    endpointOrder: ['standard', 'mux'],
    stages: [{ duration: '3s', target: 2 }],
    executor: 'ramping-arrival-rate',
    mode: 'per_endpoint',
    stackName: 'test-stack',
    maxDelayMs: 0,
  });

  const mux = metrics.summaryRows.find((row) => row.endpoint === 'mux');
  assert.ok(mux);
  assert.equal(mux.duration_cost_proxy_ms, 275);
  assert.equal(mux.duration_cost_pct_of_standard, 83.333333);
});
