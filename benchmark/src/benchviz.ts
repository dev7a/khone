#!/usr/bin/env node
import fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import {
  DEFAULT_HOLD_DURATION,
  DEFAULT_RAMP_DURATION,
  DEFAULT_STACK_NAME,
  DEFAULT_STAGE_TARGETS,
  RUN_K6_CSV_NAME,
  RUN_MANIFEST_NAME,
  RUN_METRICS_JSON_NAME,
  RUN_REPORT_MD_NAME,
  RUN_SUMMARY_CSV_NAME,
} from './constants.js';
import type {
  BenchmarkMode,
  ChartTheme,
  DeploymentMetadata,
  EndpointSummaryRow,
  Executor,
  K6Settings,
  MetricsBundle,
  RenderedChartPaths,
  RunMetadata,
  RunManifest,
  Stage,
  Target,
} from './types.js';
import {
  defaultRunDirName,
  ensureDir,
  fileExists,
  normalizeEndpointName,
  parseStageTargets,
  readJson,
  shouldAddHold,
  slugify,
  toIsoNow,
  tryGetGitSha,
  tryIsGitDirty,
  tryReadGatewayVersion,
  writeJson,
} from './utils.js';
import { buildTargetsFromOutputs, getStackOutputs } from './aws/stackOutputs.js';
import { collectDeploymentMetadata } from './aws/deploymentMetadata.js';
import { warmupTargets } from './runtime/warmup.js';
import { runK6 } from './runtime/runK6.js';
import { inferEndpointsFromRecords, loadK6Csv } from './metrics/parseCsv.js';
import { deriveMetrics } from './metrics/derive.js';
import { scanEndpointsFromK6Csv } from './metrics/k6CsvStream.js';
import { deriveMetricsFromK6CsvStream } from './metrics/deriveCsvStream.js';
import { renderCharts } from './charts/render.js';
import { writeMetricsJson, writeReportMarkdown, writeSummaryCsv } from './report/writeReport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BENCHMARK_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(BENCHMARK_DIR, '..');
const INVOCATION_CWD = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : process.cwd();
const CHART_THEMES: readonly ChartTheme[] = [
  'light',
  'print',
  'dark',
  'transparent',
  'light-transparent',
  'dark-transparent',
];
const CHART_THEME_LIST = CHART_THEMES.join('|');

function resolveUserPath(pathname: string): string {
  return path.isAbsolute(pathname) ? pathname : path.resolve(INVOCATION_CWD, pathname);
}

interface RunCommandOptions {
  stack: string;
  profile: string;
  region?: string;
  outputDir: string;
  publicOutputDir?: string;
  publicRunName?: string;
  runDir?: string;
  runName?: string;
  csvPath?: string;
  csvDir?: string;
  mode: BenchmarkMode;
  executor: Executor;
  duration: string;
  holdDuration: string;
  stageTargets: string;
  stagesJson?: string;
  maxDelayMs: number;
  keyspaceSize: number;
  warmup: boolean;
  vus: number;
  arrivalTimeUnit: string;
  arrivalPreallocatedVus: number;
  arrivalMaxVus: number;
  arrivalVusMultiplier: number;
  arrivalMaxVusMultiplier: number;
  skipTest: boolean;
  theme?: string;
  themes?: string;
  label?: string;
  endpoint: string[];
  sampleLatency?: number;
  sampleSeed?: number;
}

function normalizeChartTheme(value: string | undefined): ChartTheme {
  const normalized = (value ?? 'light').trim().toLowerCase();
  if (CHART_THEMES.includes(normalized as ChartTheme)) {
    return normalized as ChartTheme;
  }
  throw new Error(`Unknown --theme '${value}'. Use ${CHART_THEME_LIST}.`);
}

function normalizeChartThemes(theme: string | undefined, themes: string | undefined): ChartTheme[] {
  if (!themes || themes.trim() === '') {
    return [normalizeChartTheme(theme)];
  }

  const out: ChartTheme[] = [];
  for (const raw of themes.split(',')) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    if (!CHART_THEMES.includes(normalized as ChartTheme)) {
      throw new Error(`Unknown --themes entry '${raw}'. Use comma-separated ${CHART_THEMES.join(',')}.`);
    }
    const chartTheme = normalized as ChartTheme;
    if (!out.includes(chartTheme)) {
      out.push(chartTheme);
    }
  }
  if (out.length < 1) {
    throw new Error('--themes must include at least one theme');
  }
  return out;
}

function withPublicChartThemes(themes: readonly ChartTheme[], publicOutputDir: string | undefined): ChartTheme[] {
  if (!publicOutputDir) {
    return [...themes];
  }

  const out = [...themes];
  for (const theme of ['light-transparent', 'dark-transparent'] as const) {
    if (!out.includes(theme)) {
      out.push(theme);
    }
  }
  return out;
}

function normalizeEndpointList(endpoints: readonly string[]): string[] {
  return endpoints
    .map((endpoint) => normalizeEndpointName(endpoint.trim()))
    .filter((endpoint) => endpoint.length > 0)
    .filter((endpoint, index, arr) => arr.indexOf(endpoint) === index);
}

function applyRunProfileDefaults(options: RunCommandOptions): void {
  const profile = options.profile.trim().toLowerCase();
  if (profile === 'default' || profile === '') {
    return;
  }

  if (profile !== 'cost-focused') {
    throw new Error(`Unknown --profile '${options.profile}'. Use 'default' or 'cost-focused'.`);
  }

  options.mode = 'per_endpoint';
  options.executor = 'ramping-arrival-rate';
  options.duration = '20s';
  options.holdDuration = '20s';
  options.stageTargets = '20,40,60';
  options.arrivalVusMultiplier = 2;
  options.arrivalMaxVusMultiplier = 4;
  options.warmup = true;
}

function findLatestCsvSync(dir: string): string {
  const files = fsSync
    .readdirSync(dir)
    .filter((name) => name.startsWith('k6') && name.endsWith('.csv'))
    .map((name) => path.join(dir, name));

  if (files.length < 1) {
    throw new Error(`No k6 CSV files found in ${dir}`);
  }

  files.sort((a: string, b: string) => {
    const aM = fsSync.statSync(a).mtimeMs;
    const bM = fsSync.statSync(b).mtimeMs;
    return bM - aM;
  });

  return files[0];
}

function buildStages(stagesJson: string | undefined, stageTargets: string, duration: string, holdDuration: string): Stage[] {
  if (stagesJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stagesJson);
    } catch (error) {
      throw new Error(`Invalid --stages-json: ${(error as Error).message}`);
    }
    if (!Array.isArray(parsed) || parsed.length < 1) {
      throw new Error('--stages-json must be a non-empty JSON array');
    }
    return parsed.map((stage) => {
      if (
        !stage ||
        typeof stage !== 'object' ||
        typeof (stage as Record<string, unknown>).duration !== 'string' ||
        typeof (stage as Record<string, unknown>).target !== 'number'
      ) {
        throw new Error('--stages-json entries must include duration(string) and target(number)');
      }
      return {
        duration: (stage as Record<string, unknown>).duration as string,
        target: (stage as Record<string, unknown>).target as number,
      };
    });
  }

  const targets = parseStageTargets(stageTargets);
  const stages: Stage[] = [];
  const addHold = shouldAddHold(holdDuration);
  for (const target of targets) {
    stages.push({ duration, target });
    if (addHold) {
      stages.push({ duration: holdDuration, target });
    }
  }
  return stages;
}

async function chooseRunDir(options: RunCommandOptions): Promise<string> {
  if (options.runDir && options.runName) {
    throw new Error('Pass only one of --run-dir or --run-name');
  }

  const outputDir = resolveUserPath(options.outputDir);
  await ensureDir(outputDir);

  if (options.runDir) {
    const dir = resolveUserPath(options.runDir);
    await ensureDir(dir);
    return dir;
  }

  if (options.runName) {
    const dir = path.join(outputDir, slugify(options.runName));
    await ensureDir(dir);
    return dir;
  }

  const dir = path.join(outputDir, defaultRunDirName(options.label ?? null));
  await ensureDir(dir);
  return dir;
}

async function tryLoadManifest(runDir: string): Promise<RunManifest | null> {
  const pathName = path.join(runDir, RUN_MANIFEST_NAME);
  if (!(await fileExists(pathName))) {
    return null;
  }
  return readJson<RunManifest>(pathName);
}

async function writeRunManifest(
  runDir: string,
  options: {
    stackName: string;
    region: string | null;
    targets: Array<{ name: string; url: string }>;
    stages: Stage[];
    mode: BenchmarkMode;
    executor: Executor;
    maxDelayMs: number;
    label: string | null;
    k6: K6Settings;
    deployment: DeploymentMetadata | null;
  },
): Promise<void> {
  const manifest: RunManifest = {
    v: 1,
    created_at: toIsoNow(),
    stack_name: options.stackName,
    region: options.region,
    targets: options.targets,
    stages: options.stages,
    mode: options.mode,
    executor: options.executor,
    max_delay_ms: options.maxDelayMs,
    report: 'suite',
    label: options.label,
    git: {
      sha: await tryGetGitSha(REPO_ROOT),
      dirty: await tryIsGitDirty(REPO_ROOT),
    },
    gateway_version: await tryReadGatewayVersion(REPO_ROOT),
    k6: options.k6,
    deployment: options.deployment,
  };

  await writeJson(path.join(runDir, RUN_MANIFEST_NAME), manifest);
}

function formatSummaryTable(rows: EndpointSummaryRow[]): string {
  const header = ['endpoint', 'requests', 'errors', 'error_rate', 'p95', 'cost_pct'];
  const lines = [header.join('\t')];
  for (const row of rows) {
    lines.push(
      [
        row.endpoint,
        row.requests,
        row.errors,
        row.error_rate,
        row.p95,
        row.est_cost_pct_of_direct,
      ]
        .map((x) => (x == null ? '' : String(x)))
        .join('\t'),
    );
  }
  return lines.join('\n');
}

function k6SettingsFromOptions(options: RunCommandOptions): K6Settings {
  return {
    vus: options.vus,
    arrival_time_unit: options.arrivalTimeUnit,
    arrival_preallocated_vus: options.arrivalPreallocatedVus,
    arrival_max_vus: options.arrivalMaxVus,
    arrival_vus_multiplier: options.arrivalVusMultiplier,
    arrival_max_vus_multiplier: options.arrivalMaxVusMultiplier,
    keyspace_size: options.keyspaceSize,
    warmup: options.warmup,
  };
}

async function renderChartThemes(
  metrics: MetricsBundle,
  chartsDir: string,
  themes: readonly ChartTheme[],
): Promise<RenderedChartPaths> {
  if (themes.length === 1) {
    const paths = await renderCharts(metrics, chartsDir, themes[0]);
    return {
      ...paths,
      latencyDistributionByTheme: {
        [themes[0]]: paths.latencyDistribution,
      },
    };
  }

  const byTheme: Partial<Record<ChartTheme, string>> = {};
  let primaryPath: string | null = null;
  for (const theme of themes) {
    const paths = await renderCharts(metrics, path.join(chartsDir, theme), theme);
    byTheme[theme] = paths.latencyDistribution;
    if (!primaryPath || theme === 'light' || theme === 'light-transparent') {
      primaryPath = paths.latencyDistribution;
    }
  }

  return {
    latencyDistribution: primaryPath ?? Object.values(byTheme)[0]!,
    latencyDistributionByTheme: byTheme,
  };
}

async function writePublicBenchmarkBundle(
  metrics: MetricsBundle,
  chartPaths: RenderedChartPaths,
  rawRunDir: string,
  publicOutputDir: string,
  publicRunName: string | undefined,
): Promise<string> {
  const publicRoot = resolveUserPath(publicOutputDir);
  const publicDirName = publicRunName ? slugify(publicRunName) : path.basename(rawRunDir);
  if (!publicDirName) {
    throw new Error('--public-run-name must contain at least one path-safe character');
  }
  const publicRunDir = path.join(publicRoot, publicDirName);
  if (path.resolve(publicRunDir) === path.resolve(rawRunDir)) {
    throw new Error('--public-output-dir must not resolve to the raw run directory');
  }

  await fs.rm(publicRunDir, { recursive: true, force: true });
  await ensureDir(publicRunDir);
  await writeSummaryCsv(metrics, path.join(publicRunDir, RUN_SUMMARY_CSV_NAME));

  const publicChartPaths: RenderedChartPaths = {
    latencyDistribution: '',
    latencyDistributionByTheme: {},
  };
  const publicThemes = [
    ['light', 'light-transparent'],
    ['dark', 'dark-transparent'],
  ] as const;
  for (const [publicTheme, sourceTheme] of publicThemes) {
    const source = chartPaths.latencyDistributionByTheme?.[sourceTheme];
    if (!source) {
      throw new Error(`Cannot write public bundle: missing ${sourceTheme} latency distribution chart`);
    }
    const dest = path.join(publicRunDir, 'charts', publicTheme, 'latency-distribution.png');
    await ensureDir(path.dirname(dest));
    await fs.copyFile(source, dest);
    publicChartPaths.latencyDistributionByTheme![publicTheme] = dest;
    if (publicTheme === 'light') {
      publicChartPaths.latencyDistribution = dest;
    }
  }

  await writeReportMarkdown(
    metrics,
    publicChartPaths,
    publicRunDir,
    path.join(publicRunDir, RUN_REPORT_MD_NAME),
    { publicReport: true },
  );

  return publicRunDir;
}

async function safeCollectDeploymentMetadata(
  stackName: string,
  region: string | null,
): Promise<DeploymentMetadata> {
  try {
    return await collectDeploymentMetadata(stackName, region);
  } catch (error) {
    return {
      collected_at: new Date().toISOString(),
      parameters: {},
      functions: [],
      collection_errors: [`failed to collect deployment metadata: ${(error as Error).message}`],
    };
  }
}

export async function runCommand(options: RunCommandOptions): Promise<void> {
  applyRunProfileDefaults(options);
  const chartThemes = withPublicChartThemes(
    normalizeChartThemes(options.theme, options.themes),
    options.publicOutputDir,
  );
  const runDir = await chooseRunDir(options);
  const region = options.region ?? null;

  const skipTest = options.skipTest || Boolean(options.csvPath) || Boolean(options.csvDir);
  let stages = buildStages(options.stagesJson, options.stageTargets, options.duration, options.holdDuration);
  if (options.maxDelayMs < 0) {
    throw new Error('--max-delay-ms must be >= 0');
  }
  if (options.sampleLatency != null) {
    if (!Number.isFinite(options.sampleLatency) || options.sampleLatency <= 0) {
      throw new Error('--sample-latency must be a positive integer');
    }
  }
  if (options.sampleSeed != null) {
    if (!Number.isFinite(options.sampleSeed)) {
      throw new Error('--sample-seed must be a number');
    }
  }
  const manifest = skipTest ? await tryLoadManifest(runDir) : null;
  let stackName = options.stack;
  let mode = options.mode;
  let executor = options.executor;
  let maxDelayMs = options.maxDelayMs;
  let effectiveRegion = region;
  let runTargets: Target[] = manifest?.targets ?? [];
  let deploymentMetadata: DeploymentMetadata | null = manifest?.deployment ?? null;
  if (manifest) {
    if (manifest.stages.length > 0) stages = manifest.stages;
    if (manifest.mode) mode = manifest.mode;
    if (manifest.executor) executor = manifest.executor;
    if (typeof manifest.max_delay_ms === 'number') maxDelayMs = manifest.max_delay_ms;
    if (manifest.stack_name) stackName = manifest.stack_name;
    if (manifest.region) effectiveRegion = manifest.region;
  }

  const requestedEndpoints = normalizeEndpointList(options.endpoint);
  const manifestTargets =
    manifest && manifest.targets.length > 0 ? normalizeEndpointList(manifest.targets.map((target) => target.name)) : [];
  let endpointOrder: string[] = [];

  if (!skipTest) {
    const outputs = await getStackOutputs(stackName, effectiveRegion);
    const targets = buildTargetsFromOutputs(outputs, requestedEndpoints);
    runTargets = targets;
    endpointOrder = targets.map((t) => t.name);
    deploymentMetadata = await safeCollectDeploymentMetadata(stackName, effectiveRegion);

    if (options.warmup) {
      await warmupTargets(targets);
    }

    const k6CsvPath = path.join(runDir, RUN_K6_CSV_NAME);
    if (await fileExists(k6CsvPath)) {
      await fs.unlink(k6CsvPath);
    }

    await runK6({
      targets,
      csvPath: k6CsvPath,
      stages,
      mode,
      executor,
      maxDelayMs,
      keyspaceSize: options.keyspaceSize,
      rampDuration: options.duration,
      vus: options.vus,
      arrivalTimeUnit: options.arrivalTimeUnit,
      arrivalPreallocatedVus: options.arrivalPreallocatedVus,
      arrivalMaxVus: options.arrivalMaxVus,
      arrivalVusMultiplier: options.arrivalVusMultiplier,
      arrivalMaxVusMultiplier: options.arrivalMaxVusMultiplier,
      benchmarkDir: BENCHMARK_DIR,
    });

    await writeRunManifest(runDir, {
      stackName,
      region: effectiveRegion,
      targets,
      stages,
      mode,
      executor,
      maxDelayMs,
      label: options.label ?? null,
      k6: k6SettingsFromOptions(options),
      deployment: deploymentMetadata,
    });
  }

  if (skipTest) {
    if (manifestTargets.length > 0) {
      endpointOrder = manifestTargets;
    } else if (requestedEndpoints.length > 0) {
      endpointOrder = requestedEndpoints;
    } else {
      try {
        const outputs = await getStackOutputs(stackName, effectiveRegion);
        const targets = buildTargetsFromOutputs(outputs, []);
        runTargets = targets;
        endpointOrder = targets.map((t) => t.name);
      } catch {
        // Fall back to CSV discovery when stack outputs are unavailable.
      }
    }
  }

  if (!deploymentMetadata && !skipTest && stackName) {
    deploymentMetadata = await safeCollectDeploymentMetadata(stackName, effectiveRegion);
  }

  let csvPath = options.csvPath ? resolveUserPath(options.csvPath) : '';
  if (!csvPath) {
    if (options.csvDir) {
      csvPath = findLatestCsvSync(resolveUserPath(options.csvDir));
    } else {
      const candidate = path.join(runDir, RUN_K6_CSV_NAME);
      if (await fileExists(candidate)) {
        csvPath = candidate;
      } else {
        csvPath = findLatestCsvSync(runDir);
      }
    }
  }

  if (!(await fileExists(csvPath))) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  console.log(`Using CSV: ${csvPath}`);

  const csvStat = await fs.stat(csvPath);
  const csvSizeBytes = csvStat.size;
  const stopWhenHas = requestedEndpoints.length > 0 ? requestedEndpoints : endpointOrder;
  const endpointScanOptions: { stopWhenHas: readonly string[]; maxRows?: number } = { stopWhenHas };
  if (stopWhenHas.length > 0) {
    endpointScanOptions.maxRows = Number.MAX_SAFE_INTEGER;
  }
  const endpointsInCsv = await scanEndpointsFromK6Csv(csvPath, endpointScanOptions);
  if (endpointsInCsv.length < 1) {
    throw new Error('No endpoints found in CSV (missing endpoint tags?)');
  }

  if (skipTest) {
    if (requestedEndpoints.length > 0) {
      const unknown = requestedEndpoints.filter((e) => !endpointsInCsv.includes(e));
      if (unknown.length > 0) {
        throw new Error(
          `CSV does not contain endpoint(s): ${unknown.join(', ')}. Endpoints in CSV: ${endpointsInCsv.join(', ')}`,
        );
      }
      endpointOrder = requestedEndpoints;
    } else if (endpointOrder.length > 0) {
      const filtered = endpointOrder.filter((e) => endpointsInCsv.includes(e));
      endpointOrder = filtered.length > 0 ? filtered : endpointsInCsv;
    } else {
      endpointOrder = endpointsInCsv;
    }
  }

  const STREAMING_THRESHOLD_BYTES = 64 * 1024 * 1024;
  const useStreaming = csvSizeBytes >= STREAMING_THRESHOLD_BYTES;

  const metrics = useStreaming
    ? (
        await deriveMetricsFromK6CsvStream({
          csvPath,
          endpointOrder,
          stages,
          executor,
          mode,
          stackName,
          maxDelayMs,
          sampleLimits: { latency: options.sampleLatency ?? 2000 },
          sampleSeed: options.sampleSeed,
        })
      ).metrics
    : deriveMetrics({
        records: await loadK6Csv(csvPath),
        endpointOrder,
        stages,
        executor,
        mode,
        stackName,
        maxDelayMs,
      });

  const runMetadata: RunMetadata = {
    stack_name: stackName,
    region: effectiveRegion,
    profile: options.profile,
    label: options.label ?? manifest?.label ?? null,
    targets: runTargets,
    k6: manifest?.k6 ?? k6SettingsFromOptions(options),
    deployment: deploymentMetadata,
  };
  metrics.run = runMetadata;

  if (metrics.latencySamples.length < 1) {
    throw new Error('No latency data found in CSV');
  }

  const chartsDir = path.join(runDir, 'charts');
  const dataDir = path.join(runDir, 'data');
  await ensureDir(chartsDir);
  await ensureDir(dataDir);

  await writeSummaryCsv(metrics, path.join(runDir, RUN_SUMMARY_CSV_NAME));
  await writeMetricsJson(metrics, path.join(dataDir, RUN_METRICS_JSON_NAME));
  const chartPaths = await renderChartThemes(metrics, chartsDir, chartThemes);
  await writeReportMarkdown(metrics, chartPaths, runDir, path.join(runDir, RUN_REPORT_MD_NAME));
  const publicRunDir = options.publicOutputDir
    ? await writePublicBenchmarkBundle(
        metrics,
        chartPaths,
        runDir,
        options.publicOutputDir,
        options.publicRunName,
      )
    : null;

  console.log('\nSummary:');
  console.log(formatSummaryTable(metrics.summaryRows));
  console.log(`\nWrote CSV: ${csvPath}`);
  console.log(`Wrote summary: ${path.join(runDir, RUN_SUMMARY_CSV_NAME)}`);
  console.log(`Wrote metrics: ${path.join(dataDir, RUN_METRICS_JSON_NAME)}`);
  console.log(`Wrote report: ${path.join(runDir, RUN_REPORT_MD_NAME)}`);
  console.log(`Wrote charts under: ${chartsDir}`);
  if (publicRunDir) {
    console.log(`Wrote public bundle: ${publicRunDir}`);
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('benchviz')
    .description('Run benchmark load tests and generate static documentation-quality chart reports.')
    .showHelpAfterError();

  program
    .command('run')
    .description('Run k6 (or consume existing CSV) and generate report artifacts.')
    .option('--stack <name>', 'CloudFormation stack name', DEFAULT_STACK_NAME)
    .option('--profile <profile>', "Run profile: default|cost-focused", 'default')
    .option('--region <region>', 'AWS region (defaults to AWS config)')
    .option('--output-dir <dir>', 'Directory for benchmark run outputs', path.join(REPO_ROOT, 'benchmark-results'))
    .option('--public-output-dir <dir>', 'Write curated public artifacts under this output directory')
    .option('--public-run-name <name>', 'Stable sanitized run directory name under --public-output-dir')
    .option('--run-dir <dir>', 'Run directory (created if missing)')
    .option('--run-name <name>', 'Stable run directory name under --output-dir')
    .option('--csv-path <path>', 'Path to an existing k6 CSV (implies --skip-test)')
    .option('--csv-dir <dir>', 'Directory containing k6 CSV files (uses newest, implies --skip-test)')
    .option('--mode <mode>', 'Load mode: per_endpoint|batch', 'per_endpoint')
    .option('--executor <executor>', 'Executor: ramping-arrival-rate|ramping-vus', 'ramping-arrival-rate')
    .option('--duration <duration>', 'Per-stage ramp duration', DEFAULT_RAMP_DURATION)
    .option('--hold-duration <duration>', 'Optional hold duration after each stage', DEFAULT_HOLD_DURATION)
    .option('--stage-targets <targets>', 'Comma-separated stage targets', DEFAULT_STAGE_TARGETS)
    .option('--stages-json <json>', 'Override with full JSON stages array')
    .option('--max-delay-ms <ms>', 'max-delay query value', (v) => Number.parseInt(v, 10), 0)
    .option('--keyspace-size <n>', 'Keyspace size for random item IDs appended by k6', (v) => Number.parseInt(v, 10), 1000)
    .option('--warmup', 'Send warmup request to each endpoint', true)
    .option('--no-warmup', 'Disable endpoint warmup requests')
    .option('--vus <n>', 'VUs for ramping-vus mode', (v) => Number.parseInt(v, 10), 50)
    .option('--arrival-time-unit <unit>', 'Time unit for ramping-arrival-rate', '1s')
    .option('--arrival-preallocated-vus <n>', 'Override pre-allocated VUs', (v) => Number.parseInt(v, 10), 0)
    .option('--arrival-max-vus <n>', 'Override max VUs', (v) => Number.parseInt(v, 10), 0)
    .option('--arrival-vus-multiplier <n>', 'Pre-allocated VUs multiplier', (v) => Number.parseFloat(v), 1)
    .option('--arrival-max-vus-multiplier <n>', 'Max VUs multiplier', (v) => Number.parseFloat(v), 2)
    .option('--skip-test', 'Skip k6 run and render from existing CSV', false)
    .option('--theme <theme>', `Chart theme: ${CHART_THEME_LIST}`, 'light')
    .option('--themes <themes>', `Comma-separated chart themes to render: ${CHART_THEMES.join(',')}`)
    .option('--label <label>', 'Optional label for timestamped run directories')
    .option('--sample-latency <n>', 'Max latency samples per endpoint in streaming mode', (v) => Number.parseInt(v, 10), 2000)
    .option('--sample-seed <n>', 'Seed for streaming sampler', (v) => Number.parseInt(v, 10))
    .option('--endpoint <name>', 'Limit to endpoint(s), repeatable', (value, prev: string[]) => {
      prev.push(value);
      return prev;
    }, [])
    .action(async (opts: RunCommandOptions) => {
      await runCommand(opts);
    });

  if (process.argv.length <= 2) {
    process.argv.push('run');
  }

  await program.parseAsync(process.argv);
}

const directInvocation =
  process.argv[1] != null && path.resolve(process.argv[1]) === __filename;

if (directInvocation) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
