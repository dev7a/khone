import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChartTheme, MetricsBundle, RenderedChartPaths } from '../types.js';
import { parseDurationToSeconds } from '../utils.js';

const REDACTED = 'redacted';
const PUBLIC_STACK_PARAMETER_KEYS = [
  'BenchmarkHandlerMemorySize',
  'BenchmarkBackendBaseDelayMs',
  'BenchmarkBackendJitterMs',
  'BenchmarkBackendPoints',
  'BenchmarkBackendTimeoutMs',
  'KhoneMaxConcurrency',
] as const;

const SUMMARY_COLUMNS = [
  'endpoint',
  'requests',
  'errors',
  'errors_4xx',
  'errors_5xx',
  'errors_429',
  'error_rate',
  'ok_count',
  'avg',
  'min',
  'max',
  'p50',
  'p90',
  'p95',
  'p99',
  'batch_count',
  'batch_avg',
  'batch_min',
  'batch_max',
  'batch_p50',
  'batch_p90',
  'batch_p95',
  'batch_p99',
  'est_lambda_invocations',
  'est_invocations_per_request',
  'est_effective_batch_size',
  'est_cost_pct_of_direct',
] as const;

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function formatCsvValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '';
    }
    return String(value);
  }
  return escapeCsvField(String(value));
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) {
    return 'n/a';
  }
  return value.toFixed(digits);
}

function text(value: string | number | boolean | null | undefined): string {
  if (value == null || value === '') {
    return 'n/a';
  }
  return String(value);
}

function code(value: string | number | boolean | null | undefined): string {
  const rendered = text(value).replaceAll('`', '\\`');
  return `\`${rendered}\``;
}

function nearlyEqual(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) <= epsilon;
}

function quantile(values: number[], q: number): number | null {
  if (values.length < 1) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lo = sorted[base];
  const hi = sorted[base + 1] ?? sorted[base];
  return lo + rest * (hi - lo);
}

interface StageWindow {
  index: number;
  target: number;
  start: number;
  end: number;
}

function buildStageWindows(metrics: MetricsBundle): StageWindow[] {
  const windows: StageWindow[] = [];
  let cursorSeconds = 0;
  for (let i = 0; i < metrics.stages.length; i += 1) {
    const stage = metrics.stages[i];
    let durationSeconds = 0;
    try {
      durationSeconds = parseDurationToSeconds(stage.duration);
    } catch {
      durationSeconds = 0;
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      continue;
    }
    const start = cursorSeconds;
    const end = start + durationSeconds;
    windows.push({
      index: i,
      target: stage.target,
      start,
      end,
    });
    cursorSeconds = end;
  }
  return windows;
}

function durationLabel(metrics: MetricsBundle): string {
  const windows = buildStageWindows(metrics);
  if (windows.length < 1) {
    return 'n/a';
  }
  return `${windows[windows.length - 1].end.toFixed(0)}s`;
}

function targetUnit(metrics: MetricsBundle): string {
  if (metrics.executor === 'ramping-arrival-rate') {
    const unit = metrics.run?.k6.arrival_time_unit ?? '1s';
    return unit === '1s' ? 'rps' : `iterations/${unit}`;
  }
  return 'VUs';
}

function buildStagePlanTable(metrics: MetricsBundle): string {
  const windows = buildStageWindows(metrics);
  if (windows.length < 1) {
    return '_No valid stage windows found._';
  }

  const unit = targetUnit(metrics);
  const lines = [
    `| Stage | Window | Duration | From ${unit} | To ${unit} |`,
    '| ---: | :-- | :-- | ---: | ---: |',
  ];
  let previousTarget = 0;
  for (const window of windows) {
    lines.push(
      `| ${window.index + 1} | ${window.start.toFixed(0)}-${window.end.toFixed(0)}s | ${metrics.stages[window.index]?.duration ?? 'n/a'} | ${fmt(previousTarget, 0)} | ${fmt(window.target, 0)} |`,
    );
    previousTarget = window.target;
  }
  return lines.join('\n');
}

function buildEndpointTable(metrics: MetricsBundle): string {
  const names = metrics.run?.targets.map((target) => target.name) ?? metrics.endpoints;
  if (names.length < 1) {
    return '_No endpoints captured._';
  }

  const lines = ['| Endpoint |', '| :-- |'];
  for (const name of names) {
    lines.push(`| ${name} |`);
  }
  return lines.join('\n');
}

function buildK6SettingsTable(metrics: MetricsBundle): string {
  const k6 = metrics.run?.k6;
  const rows: Array<[string, string]> = [
    ['Executor', code(metrics.executor)],
    ['Mode', code(metrics.mode)],
    ['Profile', code(metrics.run?.profile ?? 'default')],
    ['Total scheduled duration', code(durationLabel(metrics))],
    ['Max delay query value', code(`${metrics.maxDelayMs}ms`)],
    ['Warmup requests', code(k6?.warmup ?? 'unknown')],
    ['Keyspace size', code(k6?.keyspace_size ?? 'unknown')],
    ['Arrival time unit', code(k6?.arrival_time_unit ?? 'n/a')],
    ['Arrival VUs multiplier', code(k6?.arrival_vus_multiplier ?? 'n/a')],
    ['Arrival max VUs multiplier', code(k6?.arrival_max_vus_multiplier ?? 'n/a')],
    ['Ramping VUs setting', code(k6?.vus ?? 'n/a')],
  ];

  return [
    '| Setting | Value |',
    '| :-- | :-- |',
    ...rows.map(([name, value]) => `| ${name} | ${value} |`),
  ].join('\n');
}

function buildStackParameterTable(metrics: MetricsBundle): string {
  const params = metrics.run?.deployment?.parameters;
  if (!params || Object.keys(params).length < 1) {
    return '_No stack parameters captured._';
  }

  const keys = PUBLIC_STACK_PARAMETER_KEYS.filter((key) => key in params);
  if (keys.length < 1) {
    return '_No public stack parameters captured._';
  }

  return [
    '| Parameter | Value |',
    '| :-- | :-- |',
    ...keys.map((key) => `| ${key} | ${code(params[key])} |`),
  ].join('\n');
}

function buildLambdaConfigurationTable(metrics: MetricsBundle): string {
  const functions = metrics.run?.deployment?.functions ?? [];
  if (functions.length < 1) {
    return '_No Lambda configuration captured._';
  }

  const usefulFunctions = functions.filter(
    (fn) =>
      fn.runtime ||
      fn.memory_size_mb != null ||
      fn.timeout_seconds != null ||
      fn.architectures.length > 0 ||
      fn.capacity_provider ||
      fn.scaling,
  );
  if (usefulFunctions.length < 1) {
    return '_Lambda configuration was not captured for this run._';
  }

  const lines = [
    '| Logical ID | Runtime | Memory | Timeout | Architecture | LMI scaling | LMI capacity |',
    '| :-- | :-- | ---: | ---: | :-- | :-- | :-- |',
  ];
  for (const fn of usefulFunctions) {
    const scaling = fn.scaling
      ? `${text(fn.scaling.min_execution_environments)}/${text(fn.scaling.max_execution_environments)} envs`
      : 'n/a';
    const capacity = fn.capacity_provider
      ? [
          `${text(fn.capacity_provider.per_execution_environment_max_concurrency)} conc/env`,
          `${text(fn.capacity_provider.execution_environment_memory_gib_per_vcpu)} GiB/vCPU`,
        ].join('<br>')
      : 'n/a';
    lines.push(
      `| ${fn.logical_id} | ${code(fn.runtime)} | ${text(fn.memory_size_mb)} MB | ${text(fn.timeout_seconds)}s | ${code(fn.architectures.join(', ') || null)} | ${scaling} | ${capacity} |`,
    );
  }
  return lines.join('\n');
}

function buildConfigurationSection(metrics: MetricsBundle): string {
  const run = metrics.run;
  const lines: string[] = [];

  lines.push('## Test Configuration');
  lines.push('');
  lines.push(`Region: ${code(run?.region ?? 'n/a')}`);
  lines.push('');
  lines.push('### Workload Shape');
  lines.push('');
  lines.push(buildStagePlanTable(metrics));
  lines.push('');
  lines.push('### k6 Settings');
  lines.push('');
  lines.push(buildK6SettingsTable(metrics));
  lines.push('');
  lines.push('### Endpoint Labels');
  lines.push('');
  lines.push(buildEndpointTable(metrics));
  lines.push('');
  lines.push('### Stack Parameters');
  lines.push('');
  lines.push(buildStackParameterTable(metrics));
  lines.push('');
  lines.push('### Lambda Configuration');
  lines.push('');
  lines.push(buildLambdaConfigurationTable(metrics));

  return lines.join('\n');
}

function buildPerEndpointStageLatencyTables(metrics: MetricsBundle): string {
  const windows = buildStageWindows(metrics);
  if (windows.length < 1) {
    return '_No valid stage windows found._';
  }

  const lines: string[] = [];
  for (const endpoint of metrics.endpoints) {
    lines.push(`### ${endpoint}`);
    lines.push('');
    lines.push('| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |');
    lines.push('| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (let i = 0; i < windows.length; i += 1) {
      const stage = windows[i];
      const isLast = i === windows.length - 1;
      const values = metrics.latencySamples
        .filter((sample) => {
          if (sample.endpoint !== endpoint || sample.status !== 200) {
            return false;
          }
          if (sample.elapsedSeconds < stage.start) {
            return false;
          }
          return isLast ? sample.elapsedSeconds <= stage.end : sample.elapsedSeconds < stage.end;
        })
        .map((sample) => sample.latencyMs);

      const sampleCount = values.length;
      const avg = sampleCount > 0 ? values.reduce((sum, value) => sum + value, 0) / sampleCount : null;
      const max = sampleCount > 0 ? Math.max(...values) : null;
      const p50 = quantile(values, 0.5);
      const p95 = quantile(values, 0.95);
      const p99 = quantile(values, 0.99);
      lines.push(
        `| ${stage.index + 1} | ${Math.round(stage.target)} | ${stage.start.toFixed(0)}-${stage.end.toFixed(0)} | ${sampleCount} | ${fmt(avg)} | ${fmt(p50)} | ${fmt(p95)} | ${fmt(p99)} | ${fmt(max)} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildRankingTable(metrics: MetricsBundle): string {
  const ranked = [...metrics.summaryRows].sort((a, b) => {
    const aP95 = a.p95 ?? Number.POSITIVE_INFINITY;
    const bP95 = b.p95 ?? Number.POSITIVE_INFINITY;
    if (aP95 !== bP95) return aP95 - bP95;
    const aErr = a.error_rate;
    const bErr = b.error_rate;
    if (aErr !== bErr) return aErr - bErr;
    const aCost = a.est_cost_pct_of_direct ?? Number.POSITIVE_INFINITY;
    const bCost = b.est_cost_pct_of_direct ?? Number.POSITIVE_INFINITY;
    return aCost - bCost;
  });

  const lines = [
    '| Rank | Endpoint | p95 (ms) | Error rate | Cost (% of standard) | Effective batch | Requests |',
    '| ---: | :-- | ---: | ---: | ---: | ---: | ---: |',
  ];

  ranked.forEach((row, i) => {
    lines.push(
      `| ${i + 1} | ${row.endpoint} | ${fmt(row.p95)} | ${fmt(row.error_rate * 100, 3)}% | ${fmt(row.est_cost_pct_of_direct)} | ${fmt(row.est_effective_batch_size)} | ${row.requests} |`,
    );
  });

  return lines.join('\n');
}

function buildHighlights(metrics: MetricsBundle): string[] {
  const rows = [...metrics.summaryRows];
  if (rows.length === 0) {
    return ['No summary rows were generated from the selected CSV records.'];
  }

  const validP95 = rows.filter((row) => row.p95 != null);
  const validCost = rows.filter((row) => row.est_cost_pct_of_direct != null);

  const out: string[] = [];
  if (validP95.length > 0) {
    const bestP95 = Math.min(...validP95.map((row) => row.p95 as number));
    const p95Winners = validP95.filter((row) => nearlyEqual(row.p95 as number, bestP95));
    if (p95Winners.length === 1) {
      out.push(`Fastest p95 endpoint: **${p95Winners[0].endpoint}** at **${fmt(bestP95)} ms**.`);
    } else {
      out.push(
        `Fastest p95 is a tie at **${fmt(bestP95)} ms** across: **${p95Winners.map((row) => row.endpoint).join(', ')}**.`,
      );
    }
  }

  if (validCost.length > 0) {
    const costValues = validCost.map((row) => row.est_cost_pct_of_direct as number);
    const minCost = Math.min(...costValues);
    const maxCost = Math.max(...costValues);
    if (nearlyEqual(minCost, maxCost, 1e-6)) {
      out.push(
        `Estimated cost is tied across endpoints at **${fmt(minCost)}%** of standard baseline for this run.`,
      );
    } else {
      const costWinners = validCost.filter((row) => nearlyEqual(row.est_cost_pct_of_direct as number, minCost, 1e-6));
      if (costWinners.length === 1) {
        out.push(
          `Most cost-efficient endpoint (estimate): **${costWinners[0].endpoint}** at **${fmt(minCost)}%** of standard baseline.`,
        );
      } else {
        out.push(
          `Most cost-efficient endpoints (tie): **${costWinners.map((row) => row.endpoint).join(', ')}** at **${fmt(minCost)}%** of standard baseline.`,
        );
      }
    }
  }

  const minError = Math.min(...rows.map((row) => row.error_rate));
  const errorWinners = rows.filter((row) => nearlyEqual(row.error_rate, minError, 1e-9));
  if (errorWinners.length === 1) {
    out.push(`Lowest observed error rate: **${errorWinners[0].endpoint}** at **${fmt(minError * 100, 3)}%**.`);
  } else {
    out.push(
      `Lowest observed error rate is a tie at **${fmt(minError * 100, 3)}%** across: **${errorWinners.map((row) => row.endpoint).join(', ')}**.`,
    );
  }
  return out;
}

export async function writeSummaryCsv(metrics: MetricsBundle, outputPath: string): Promise<void> {
  const lines = [SUMMARY_COLUMNS.join(',')];
  for (const row of metrics.summaryRows) {
    lines.push(SUMMARY_COLUMNS.map((column) => formatCsvValue(row[column])).join(','));
  }
  await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf-8');
}

export async function writeMetricsJson(metrics: MetricsBundle, outputPath: string): Promise<void> {
  const sanitizedRun = metrics.run
    ? {
        ...metrics.run,
        stack_name: REDACTED,
        targets: metrics.run.targets.map((target) => ({ name: target.name, url: REDACTED })),
        deployment: metrics.run.deployment
          ? {
              ...metrics.run.deployment,
              parameters: Object.fromEntries(
                PUBLIC_STACK_PARAMETER_KEYS
                  .filter((key) => key in metrics.run!.deployment!.parameters)
                  .map((key) => [key, metrics.run!.deployment!.parameters[key]]),
              ),
              functions: metrics.run.deployment.functions.map((fn) => ({
                ...fn,
                function_name: fn.logical_id,
                function_arn: null,
                capacity_provider: fn.capacity_provider
                  ? {
                      ...fn.capacity_provider,
                      arn: null,
                    }
                  : null,
              })),
              collection_errors: [],
            }
          : null,
      }
    : null;
  const payload = {
    generated_at: new Date().toISOString(),
    stack_name: REDACTED,
    executor: metrics.executor,
    mode: metrics.mode,
    max_delay_ms: metrics.maxDelayMs,
    run: sanitizedRun,
    stages: metrics.stages,
    endpoints: metrics.endpoints,
    summary: metrics.summaryRows,
    series: {
      stage_duration_cost: metrics.stageDurationCostSeries,
    },
    samples: {
      latency: metrics.latencySamples,
      requests: metrics.requestSamples,
      batch: metrics.batchSamples,
    },
  };
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function chartList(runDir: string, chartPaths: RenderedChartPaths): string {
  const label = 'Latency distribution';
  const variants = chartPaths.latencyDistributionByTheme;
  const darkPath = variants?.dark ?? variants?.['dark-transparent'];
  const lightPath = variants?.light ?? variants?.['light-transparent'];
  const fallbackPath = lightPath ?? variants?.transparent ?? chartPaths.latencyDistribution;
  if (darkPath && lightPath && fallbackPath) {
    const darkRel = path.relative(runDir, darkPath).replaceAll('\\', '/');
    const lightRel = path.relative(runDir, lightPath).replaceAll('\\', '/');
    const fallbackRel = path.relative(runDir, fallbackPath).replaceAll('\\', '/');
    const lines = [
      `### ${label}`,
      '',
      '<picture>',
      `  <source media="(prefers-color-scheme: dark)" srcset="${darkRel}">`,
      `  <source media="(prefers-color-scheme: light)" srcset="${lightRel}">`,
      `  <img alt="${label}" src="${fallbackRel}">`,
      '</picture>',
    ];
    return lines.join('\n');
  }

  const rel = path.relative(runDir, chartPaths.latencyDistribution).replaceAll('\\', '/');
  return `### ${label}\n\n![${label}](${rel})\n`;
}

export async function writeReportMarkdown(
  metrics: MetricsBundle,
  chartPaths: RenderedChartPaths,
  runDir: string,
  outputPath: string,
  options: { publicReport?: boolean } = {},
): Promise<void> {
  const highlights = buildHighlights(metrics);
  const ranking = buildRankingTable(metrics);

  const lines: string[] = [];
  lines.push('# Benchmark Report');
  lines.push('');
  if (!options.publicReport) {
    lines.push(`Generated: ${new Date().toISOString()}`);
  }
  lines.push(`Executor: ${metrics.executor}`);
  lines.push(`Mode: ${metrics.mode}`);
  lines.push(`Max delay: ${metrics.maxDelayMs}ms`);
  lines.push(`Endpoints: ${metrics.endpoints.join(', ')}`);
  lines.push('');
  lines.push(buildConfigurationSection(metrics));
  lines.push('');
  lines.push('## Key Findings');
  lines.push('');
  for (const item of highlights) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('## Endpoint Ranking');
  lines.push('');
  lines.push(ranking);
  lines.push('');
  lines.push('## Stage Latency Stats (per endpoint)');
  lines.push('');
  lines.push(
    'Computed from sampled `http_req_duration` points with status `200`, grouped by configured stage windows.',
  );
  lines.push('');
  lines.push(buildPerEndpointStageLatencyTables(metrics));
  lines.push('');
  lines.push('## Charts');
  lines.push('');
  lines.push(chartList(runDir, chartPaths));

  await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf-8');
}
