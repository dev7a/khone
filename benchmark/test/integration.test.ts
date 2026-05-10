import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../src/benchviz.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureCsv = path.join(__dirname, 'fixtures', 'sample-k6.csv');

test('run --skip-test --csv-path generates report artifacts', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-it-'));
  const runName = 'integration';
  const runDir = path.join(outputDir, runName);

  await runCommand({
    stack: 'khone-benchmark',
    profile: 'default',
    region: undefined,
    outputDir,
    runDir: undefined,
    runName,
    csvPath: fixtureCsv,
    csvDir: undefined,
    mode: 'per_endpoint',
    executor: 'ramping-arrival-rate',
    duration: '3s',
    holdDuration: '0s',
    stageTargets: '2',
    stagesJson: undefined,
    maxDelayMs: 0,
    keyspaceSize: 10,
    warmup: false,
    vus: 2,
    arrivalTimeUnit: '1s',
    arrivalPreallocatedVus: 0,
    arrivalMaxVus: 0,
    arrivalVusMultiplier: 1,
    arrivalMaxVusMultiplier: 2,
    skipTest: true,
    label: undefined,
    endpoint: [],
    sampleLatency: undefined,
    sampleSeed: undefined,
  });

  const expected = [
    path.join(runDir, 'summary.csv'),
    path.join(runDir, 'report.md'),
    path.join(runDir, 'data', 'metrics.json'),
    path.join(runDir, 'charts', 'latency-distribution.png'),
  ];

  for (const pathname of expected) {
    const stat = await fs.stat(pathname);
    assert.ok(stat.size > 0, `${pathname} should exist`);
  }

  await fs.rm(outputDir, { recursive: true, force: true });
});

test('invalid profile returns a clear error', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-it-bad-profile-'));
  await assert.rejects(
    () =>
      runCommand({
        stack: 'khone-benchmark',
        profile: 'mystery',
        region: undefined,
        outputDir,
        runDir: undefined,
        runName: 'bad-profile',
        csvPath: fixtureCsv,
        csvDir: undefined,
        mode: 'per_endpoint',
        executor: 'ramping-arrival-rate',
        duration: '3s',
        holdDuration: '0s',
        stageTargets: '2',
        stagesJson: undefined,
        maxDelayMs: 0,
        keyspaceSize: 10,
        warmup: false,
        vus: 2,
        arrivalTimeUnit: '1s',
        arrivalPreallocatedVus: 0,
        arrivalMaxVus: 0,
        arrivalVusMultiplier: 1,
        arrivalMaxVusMultiplier: 2,
        skipTest: true,
        label: undefined,
        endpoint: [],
        sampleLatency: undefined,
        sampleSeed: undefined,
      }),
    /Unknown --profile/,
  );
  await fs.rm(outputDir, { recursive: true, force: true });
});

test('invalid theme returns a clear error', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-it-bad-theme-'));
  await assert.rejects(
    () =>
      runCommand({
        stack: 'khone-benchmark',
        profile: 'default',
        region: undefined,
        outputDir,
        runDir: undefined,
        runName: 'bad-theme',
        csvPath: fixtureCsv,
        csvDir: undefined,
        mode: 'per_endpoint',
        executor: 'ramping-arrival-rate',
        duration: '3s',
        holdDuration: '0s',
        stageTargets: '2',
        stagesJson: undefined,
        maxDelayMs: 0,
        keyspaceSize: 10,
        warmup: false,
        vus: 2,
        arrivalTimeUnit: '1s',
        arrivalPreallocatedVus: 0,
        arrivalMaxVus: 0,
        arrivalVusMultiplier: 1,
        arrivalMaxVusMultiplier: 2,
        skipTest: true,
        theme: 'neon-future',
        label: undefined,
        endpoint: [],
        sampleLatency: undefined,
        sampleSeed: undefined,
      }),
    /Unknown --theme/,
  );
  await fs.rm(outputDir, { recursive: true, force: true });
});

test('run --themes generates multiple chart theme variants', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-it-themes-'));
  const runName = 'theme-variants';
  const runDir = path.join(outputDir, runName);

  await runCommand({
    stack: 'khone-benchmark',
    profile: 'default',
    region: undefined,
    outputDir,
    runDir: undefined,
    runName,
    csvPath: fixtureCsv,
    csvDir: undefined,
    mode: 'per_endpoint',
    executor: 'ramping-arrival-rate',
    duration: '3s',
    holdDuration: '0s',
    stageTargets: '2',
    stagesJson: undefined,
    maxDelayMs: 0,
    keyspaceSize: 10,
    warmup: false,
    vus: 2,
    arrivalTimeUnit: '1s',
    arrivalPreallocatedVus: 0,
    arrivalMaxVus: 0,
    arrivalVusMultiplier: 1,
    arrivalMaxVusMultiplier: 2,
    skipTest: true,
    themes: 'light-transparent,dark-transparent',
    label: undefined,
    endpoint: [],
    sampleLatency: undefined,
    sampleSeed: undefined,
  });

  for (const theme of ['light-transparent', 'dark-transparent']) {
    const pathname = path.join(runDir, 'charts', theme, 'latency-distribution.png');
    const stat = await fs.stat(pathname);
    assert.ok(stat.size > 1000, `${pathname} should have visible PNG bytes`);
  }
  const report = await fs.readFile(path.join(runDir, 'report.md'), 'utf-8');
  assert.match(report, /<picture>/);
  assert.match(report, /charts\/light-transparent\/latency-distribution\.png/);
  assert.match(report, /charts\/dark-transparent\/latency-distribution\.png/);

  await fs.rm(outputDir, { recursive: true, force: true });
});

test('run --public-output-dir writes curated public bundle only', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-it-public-raw-'));
  const publicDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-it-public-out-'));
  const runName = 'public-bundle-20260507-040323';
  const publicRunName = 'public-bundle';
  const rawRunDir = path.join(outputDir, runName);
  const publicRunDir = path.join(publicDir, publicRunName);

  await runCommand({
    stack: 'khone-benchmark',
    profile: 'default',
    region: undefined,
    outputDir,
    publicOutputDir: publicDir,
    publicRunName,
    runDir: undefined,
    runName,
    csvPath: fixtureCsv,
    csvDir: undefined,
    mode: 'per_endpoint',
    executor: 'ramping-arrival-rate',
    duration: '3s',
    holdDuration: '0s',
    stageTargets: '2',
    stagesJson: undefined,
    maxDelayMs: 0,
    keyspaceSize: 10,
    warmup: false,
    vus: 2,
    arrivalTimeUnit: '1s',
    arrivalPreallocatedVus: 0,
    arrivalMaxVus: 0,
    arrivalVusMultiplier: 1,
    arrivalMaxVusMultiplier: 2,
    skipTest: true,
    label: undefined,
    endpoint: [],
    sampleLatency: undefined,
    sampleSeed: undefined,
  });

  for (const pathname of [
    path.join(publicRunDir, 'summary.csv'),
    path.join(publicRunDir, 'report.md'),
    path.join(publicRunDir, 'charts', 'light', 'latency-distribution.png'),
    path.join(publicRunDir, 'charts', 'dark', 'latency-distribution.png'),
  ]) {
    const stat = await fs.stat(pathname);
    assert.ok(stat.size > 0, `${pathname} should exist`);
  }

  await assert.rejects(() => fs.stat(path.join(publicRunDir, 'charts', 'transparent', 'latency-distribution.png')));
  await assert.rejects(() => fs.stat(path.join(publicRunDir, 'data', 'metrics.json')));
  await assert.rejects(() => fs.stat(path.join(publicRunDir, 'k6.csv')));
  await assert.rejects(() => fs.stat(path.join(publicRunDir, 'run.json')));
  await fs.stat(path.join(rawRunDir, 'data', 'metrics.json'));
  const report = await fs.readFile(path.join(publicRunDir, 'report.md'), 'utf-8');
  assert.doesNotMatch(report, /^Generated:/m);
  assert.match(report, /<picture>/);
  assert.match(report, /charts\/light\/latency-distribution\.png/);
  assert.match(report, /charts\/dark\/latency-distribution\.png/);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.rm(publicDir, { recursive: true, force: true });
});

test('skip-test normalizes legacy manifest endpoint names', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchviz-it-legacy-manifest-'));
  const runName = 'legacy-manifest';
  const runDir = path.join(outputDir, runName);
  await fs.mkdir(runDir, { recursive: true });

  const legacyCsvPath = path.join(runDir, 'legacy-k6.csv');
  const rawCsv = await fs.readFile(fixtureCsv, 'utf-8');
  const legacyCsv = rawCsv
    .replaceAll('endpoint=standard', 'endpoint=direct-item')
    .replaceAll('endpoint=mux', 'endpoint=mode-a-node-dynamic-item');
  await fs.writeFile(legacyCsvPath, legacyCsv, 'utf-8');

  await fs.writeFile(
    path.join(runDir, 'run.json'),
    `${JSON.stringify(
      {
        v: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        stack_name: 'khone-benchmark',
        region: null,
        targets: [
          { name: 'mode-a-node-dynamic-item', url: 'https://example.com/dynamic' },
          { name: 'direct-item', url: 'https://example.com/direct' },
        ],
        stages: [{ duration: '3s', target: 2 }],
        mode: 'per_endpoint',
        executor: 'ramping-arrival-rate',
        max_delay_ms: 0,
        report: 'suite',
        label: null,
        git: { sha: null, dirty: null },
        gateway_version: null,
        k6: {
          vus: 2,
          arrival_time_unit: '1s',
          arrival_preallocated_vus: 0,
          arrival_max_vus: 0,
          arrival_vus_multiplier: 1,
          arrival_max_vus_multiplier: 2,
        },
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  await runCommand({
    stack: 'khone-benchmark',
    profile: 'default',
    region: undefined,
    outputDir,
    runDir: undefined,
    runName,
    csvPath: legacyCsvPath,
    csvDir: undefined,
    mode: 'per_endpoint',
    executor: 'ramping-arrival-rate',
    duration: '3s',
    holdDuration: '0s',
    stageTargets: '2',
    stagesJson: undefined,
    maxDelayMs: 0,
    keyspaceSize: 10,
    warmup: false,
    vus: 2,
    arrivalTimeUnit: '1s',
    arrivalPreallocatedVus: 0,
    arrivalMaxVus: 0,
    arrivalVusMultiplier: 1,
    arrivalMaxVusMultiplier: 2,
    skipTest: true,
    label: undefined,
    endpoint: [],
  });

  const summary = await fs.readFile(path.join(runDir, 'summary.csv'), 'utf-8');
  assert.match(summary, /^mux,/m);
  assert.match(summary, /^standard,/m);
  assert.doesNotMatch(summary, /^mode-a-node-dynamic-item,/m);
  assert.doesNotMatch(summary, /^direct-item,/m);

  await fs.rm(outputDir, { recursive: true, force: true });
});
