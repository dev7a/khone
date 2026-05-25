import { RUN_CHART_FILENAMES } from '../../constants.js';
import type { ChartTheme, MetricsBundle } from '../../types.js';
import { parseDurationToSeconds } from '../../utils.js';

export interface EChartsRenderSpec {
  filename: string;
  width: number;
  height: number;
  option: Record<string, unknown>;
  backgroundColor?: string;
}

const FONT_FAMILY = 'Avenir Next, Inter, Segoe UI, Helvetica Neue, Arial, sans-serif';
const FONT_FAMILY_PUBLICATION = 'Source Sans 3, Avenir Next, Inter, Segoe UI, Helvetica Neue, Arial, sans-serif';
const FONT_FAMILY_DARK = 'Avenir Next, Inter, Segoe UI, Helvetica Neue, Arial, sans-serif';
const DEFAULT_CANVAS_WIDTH = 1500;
const TITLE_LEFT = 16;
const TITLE_TOP = 10;
const TITLE_FONT_SIZE = 36;
const TITLE_WEIGHT = 700;
const SUBTITLE_FONT_SIZE = 20;
const SUBTITLE_LINE_HEIGHT = 30;
const LEGEND_FONT_SIZE = 16;
const AXIS_LABEL_FONT_SIZE = 14;
const AXIS_NAME_FONT_SIZE = 18;
const ENDPOINT_COLORS = ['#2563eb', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#14b8a6'];

interface ThemeTokens {
  background: string;
  text: string;
  mutedText: string;
  subtitleText: string;
  grid: string;
  baseline: string;
  note: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  endpointColors: string[];
  fontFamily: string;
}

function standardTitle(text: string, subtext: string): Record<string, unknown> {
  return {
    text,
    subtext,
    left: TITLE_LEFT,
    top: TITLE_TOP,
    textStyle: { fontSize: TITLE_FONT_SIZE, fontWeight: TITLE_WEIGHT, color: '#0f172a' },
    subtextStyle: { fontSize: SUBTITLE_FONT_SIZE, color: '#475569', lineHeight: SUBTITLE_LINE_HEIGHT },
  };
}

function getThemeTokens(theme: ChartTheme): ThemeTokens {
  if (theme === 'light-transparent') {
    return {
      background: 'transparent',
      text: '#0f172a',
      mutedText: '#334155',
      subtitleText: '#475569',
      grid: '#dbeafe',
      baseline: '#94a3b8',
      note: '#64748b',
      tooltipBg: 'rgba(15, 23, 42, 0.93)',
      tooltipBorder: '#1e293b',
      tooltipText: '#f8fafc',
      endpointColors: ENDPOINT_COLORS,
      fontFamily: FONT_FAMILY,
    };
  }

  if (theme === 'dark-transparent') {
    return {
      background: 'transparent',
      text: '#e2e8f0',
      mutedText: '#cbd5e1',
      subtitleText: '#94a3b8',
      grid: '#334155',
      baseline: '#64748b',
      note: '#94a3b8',
      tooltipBg: 'rgba(2, 6, 23, 0.96)',
      tooltipBorder: '#475569',
      tooltipText: '#e2e8f0',
      endpointColors: ['#60a5fa', '#fbbf24', '#22d3ee', '#fb7185', '#c084fc', '#34d399'],
      fontFamily: FONT_FAMILY_DARK,
    };
  }

  if (theme === 'transparent') {
    return {
      background: 'transparent',
      text: '#64748b',
      mutedText: '#6b7280',
      subtitleText: '#64748b',
      grid: 'rgba(100, 116, 139, 0.28)',
      baseline: 'rgba(100, 116, 139, 0.72)',
      note: '#64748b',
      tooltipBg: 'rgba(15, 23, 42, 0.94)',
      tooltipBorder: '#334155',
      tooltipText: '#f8fafc',
      endpointColors: ENDPOINT_COLORS,
      fontFamily: FONT_FAMILY,
    };
  }

  if (theme === 'print') {
    return {
      background: '#ffffff',
      text: '#0f172a',
      mutedText: '#334155',
      subtitleText: '#475569',
      grid: '#e2e8f0',
      baseline: '#94a3b8',
      note: '#64748b',
      tooltipBg: 'rgba(15, 23, 42, 0.94)',
      tooltipBorder: '#1e293b',
      tooltipText: '#f8fafc',
      endpointColors: ['#1d4ed8', '#b45309', '#0f766e', '#b91c1c', '#7e22ce', '#0f766e'],
      fontFamily: FONT_FAMILY_PUBLICATION,
    };
  }

  if (theme === 'dark') {
    return {
      background: '#0b1220',
      text: '#e2e8f0',
      mutedText: '#cbd5e1',
      subtitleText: '#94a3b8',
      grid: '#334155',
      baseline: '#64748b',
      note: '#94a3b8',
      tooltipBg: 'rgba(2, 6, 23, 0.96)',
      tooltipBorder: '#475569',
      tooltipText: '#e2e8f0',
      endpointColors: ['#60a5fa', '#fbbf24', '#22d3ee', '#fb7185', '#c084fc', '#34d399'],
      fontFamily: FONT_FAMILY_DARK,
    };
  }

  return {
    background: '#f8fafc',
    text: '#0f172a',
    mutedText: '#334155',
    subtitleText: '#475569',
    grid: '#dbeafe',
    baseline: '#94a3b8',
    note: '#64748b',
    tooltipBg: 'rgba(15, 23, 42, 0.93)',
    tooltipBorder: '#1e293b',
    tooltipText: '#f8fafc',
    endpointColors: ENDPOINT_COLORS,
    fontFamily: FONT_FAMILY,
  };
}

function replaceThemeColors(value: unknown, replacements: Readonly<Record<string, string>>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      replaceThemeColors(item, replacements);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const [key, current] of Object.entries(obj)) {
    if (typeof current === 'string') {
      if (key === 'fontFamily') {
        const fontReplacement = replacements['__fontFamily__'];
        if (fontReplacement) {
          obj[key] = fontReplacement;
        }
      }
      const mapped = replacements[current];
      if (mapped) {
        obj[key] = mapped;
      } else if (key === 'font' && replacements['__fontFamily__']) {
        obj[key] = current.replace(FONT_FAMILY, replacements['__fontFamily__']);
      }
      continue;
    }
    replaceThemeColors(current, replacements);
  }
}

function applyThemeSpec(spec: EChartsRenderSpec, theme: ChartTheme): EChartsRenderSpec {
  if (theme === 'light') {
    return spec;
  }

  const tokens = getThemeTokens(theme);
  const replacements: Record<string, string> = {
    '#f8fafc': tokens.background,
    '#ffffff': tokens.background,
    '#0f172a': tokens.text,
    '#334155': tokens.mutedText,
    '#475569': tokens.subtitleText,
    '#dbeafe': tokens.grid,
    '#94a3b8': tokens.baseline,
    '#64748b': tokens.note,
    'rgba(15, 23, 42, 0.93)': tokens.tooltipBg,
    'rgba(15, 23, 42, 0.94)': tokens.tooltipBg,
    'rgba(2, 6, 23, 0.96)': tokens.tooltipBg,
    '#1e293b': tokens.tooltipBorder,
    '__fontFamily__': tokens.fontFamily,
  };

  for (let i = 0; i < ENDPOINT_COLORS.length; i += 1) {
    replacements[ENDPOINT_COLORS[i]] = tokens.endpointColors[i % tokens.endpointColors.length];
  }
  replaceThemeColors(spec.option, replacements);
  spec.backgroundColor = tokens.background;
  (spec.option as Record<string, unknown>).backgroundColor = tokens.background;
  if (theme === 'dark' || theme === 'dark-transparent') {
    (spec.option as Record<string, unknown>).darkMode = true;
  }
  return spec;
}

function endpointColor(metrics: MetricsBundle, endpoint: string, theme: ChartTheme): string {
  const palette = getThemeTokens(theme).endpointColors;
  const idx = metrics.endpoints.indexOf(endpoint);
  return palette[idx >= 0 ? idx % palette.length : 0];
}

function endpointLegendData(
  metrics: MetricsBundle,
  theme: ChartTheme,
  icon: 'roundRect' | 'circle' = 'roundRect',
): Array<{ name: string; icon: 'roundRect' | 'circle'; itemStyle: { color: string } }> {
  return metrics.endpoints.map((endpoint) => ({
    name: endpoint,
    icon,
    itemStyle: { color: endpointColor(metrics, endpoint, theme) },
  }));
}

function endpointShortLabel(endpoint: string): string {
  if (endpoint.length <= 26) {
    return endpoint;
  }
  return `${endpoint.slice(0, 23)}...`;
}

function blendHexColors(primary: string, secondary: string, primaryWeight = 0.5): string {
  const matchPrimary = /^#([0-9a-f]{6})$/i.exec(primary);
  const matchSecondary = /^#([0-9a-f]{6})$/i.exec(secondary);
  if (!matchPrimary || !matchSecondary) {
    return primary;
  }
  const weight = Math.max(0, Math.min(1, primaryWeight));
  const blendChannel = (offset: number): number => {
    const first = Number.parseInt(matchPrimary[1].slice(offset, offset + 2), 16);
    const second = Number.parseInt(matchSecondary[1].slice(offset, offset + 2), 16);
    return Math.round(first * weight + second * (1 - weight));
  };
  const toHex = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${toHex(blendChannel(0))}${toHex(blendChannel(2))}${toHex(blendChannel(4))}`;
}

function formatLatencyStat(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }
  return Math.round(value).toLocaleString('en-US');
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sorted[base];
  const b = sorted[base + 1] ?? sorted[base];
  return a + rest * (b - a);
}

function uniqueSorted(numbers: number[]): number[] {
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function stackParam(metrics: MetricsBundle, key: string): string | null {
  const value = metrics.run?.deployment?.parameters[key];
  return value == null || value === '' ? null : value;
}

function functionMetadata(metrics: MetricsBundle, logicalIds: readonly string[]) {
  const wanted = new Set(logicalIds);
  return (metrics.run?.deployment?.functions ?? []).find((fn) => wanted.has(fn.logical_id)) ?? null;
}

function targetFunctionMemoryLabel(metrics: MetricsBundle): string | null {
  const parameterValue = stackParam(metrics, 'BenchmarkHandlerMemorySize');
  if (parameterValue) {
    return `${parameterValue} MB`;
  }

  const targetFunctions = (metrics.run?.deployment?.functions ?? []).filter((fn) =>
    ['MUXFunction', 'PCTFunction', 'STDFunction'].includes(fn.logical_id),
  );
  const uniqueMemoryValues = uniqueSorted(
    targetFunctions
      .map((fn) => fn.memory_size_mb)
      .filter((value): value is number => value != null && Number.isFinite(value)),
  );
  if (uniqueMemoryValues.length === 1) {
    return `${uniqueMemoryValues[0]} MB`;
  }
  if (uniqueMemoryValues.length > 1) {
    return targetFunctions
      .filter((fn) => fn.memory_size_mb != null)
      .map((fn) => `${fn.logical_id.replace(/Function$/, '')} ${fn.memory_size_mb} MB`)
      .join(', ');
  }
  return null;
}

function backendDelayLabel(metrics: MetricsBundle): string | null {
  const baseDelay = stackParam(metrics, 'BenchmarkBackendBaseDelayMs');
  const jitter = stackParam(metrics, 'BenchmarkBackendJitterMs');
  const points = stackParam(metrics, 'BenchmarkBackendPoints');
  const timeout = stackParam(metrics, 'BenchmarkBackendTimeoutMs');
  const parts: string[] = [];
  if (baseDelay || jitter) {
    parts.push(`${baseDelay ?? 'n/a'}+${jitter ?? 'n/a'} ms`);
  }
  if (points) {
    parts.push(`${points} pts`);
  }
  if (timeout) {
    parts.push(`${timeout} ms timeout`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function gatewayLmiLabel(metrics: MetricsBundle): string | null {
  const gateway = functionMetadata(metrics, ['GatewayService']);
  if (!gateway) {
    return null;
  }
  const parts: string[] = [];
  if (gateway.memory_size_mb != null) {
    parts.push(`${gateway.memory_size_mb} MB gateway`);
  }
  if (gateway.scaling) {
    const min = gateway.scaling.min_execution_environments ?? 'n/a';
    const max = gateway.scaling.max_execution_environments ?? 'n/a';
    parts.push(`${min}-${max} envs`);
  }
  if (gateway.capacity_provider?.per_execution_environment_max_concurrency != null) {
    parts.push(`${gateway.capacity_provider.per_execution_environment_max_concurrency} conc/env`);
  }
  if (gateway.capacity_provider?.execution_environment_memory_gib_per_vcpu != null) {
    parts.push(`${gateway.capacity_provider.execution_environment_memory_gib_per_vcpu} GiB/vCPU`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function chartContextLine(metrics: MetricsBundle): string {
  const parts: string[] = [];
  const targetMemory = targetFunctionMemoryLabel(metrics);
  if (targetMemory) {
    parts.push(`Target fn memory: ${targetMemory}`);
  }
  const backendDelay = backendDelayLabel(metrics);
  if (backendDelay) {
    parts.push(`Backend delay: ${backendDelay}`);
  }
  const gatewayLmi = gatewayLmiLabel(metrics);
  if (gatewayLmi) {
    parts.push(`Gateway LMI: ${gatewayLmi}`);
  }
  return parts.length > 0 ? parts.join(' | ') : 'Run config metadata unavailable';
}

function niceStep(roughStep: number): number {
  if (!Number.isFinite(roughStep) || roughStep <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const residual = roughStep / magnitude;
  if (residual <= 1) return magnitude;
  if (residual <= 2) return 2 * magnitude;
  if (residual <= 2.5) return 2.5 * magnitude;
  if (residual <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function niceBounds(min: number, max: number, ticks = 6): { min: number; max: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }
  if (max <= min) {
    return { min: Math.floor(min), max: Math.ceil(min) + 1 };
  }
  const step = niceStep((max - min) / Math.max(2, ticks));
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  return { min: Number(niceMin.toFixed(6)), max: Number(niceMax.toFixed(6)) };
}

function buildLatencyDistribution(
  metrics: MetricsBundle,
  theme: ChartTheme,
): EChartsRenderSpec {
  const ENDPOINT_BAND_HALF_WIDTH = 0.43;
  const GRID_LEFT = 90;
  const GRID_RIGHT = 130;
  const GRID_TOP = 150;
  const PLOT_HEIGHT = 510;
  const isDarkLike = theme === 'transparent' || theme === 'dark' || theme === 'dark-transparent';
  const stageLabelColor = isDarkLike ? 'rgb(241, 245, 249)' : '#475569';
  const stageLabelBackground = isDarkLike ? 'rgba(15, 23, 42, 0.78)' : 'rgba(255, 255, 255, 0.7)';
  const heatmapLabelColor = isDarkLike ? 'rgb(226, 232, 240)' : '#64748b';
  const heatmapMetricLabelColor = isDarkLike ? 'rgb(241, 245, 249)' : '#475569';

  interface EndpointLatencySample {
    latencyMs: number;
    elapsedSeconds: number;
  }

  interface EndpointErrorSample {
    latencyMs: number;
    elapsedSeconds: number;
    status: number | null;
  }

  const samplesByEndpoint = new Map<string, EndpointLatencySample[]>();
  const errorSamplesByEndpoint = new Map<string, EndpointErrorSample[]>();
  let globalElapsedMax = 0;
  for (const sample of metrics.latencySamples) {
    if (sample.status === 200) {
      const arr = samplesByEndpoint.get(sample.endpoint) ?? [];
      arr.push({
        latencyMs: sample.latencyMs,
        elapsedSeconds: sample.elapsedSeconds,
      });
      samplesByEndpoint.set(sample.endpoint, arr);
    } else {
      const arr = errorSamplesByEndpoint.get(sample.endpoint) ?? [];
      arr.push({
        latencyMs: sample.latencyMs,
        elapsedSeconds: sample.elapsedSeconds,
        status: sample.status,
      });
      errorSamplesByEndpoint.set(sample.endpoint, arr);
    }
    if (sample.elapsedSeconds > globalElapsedMax) {
      globalElapsedMax = sample.elapsedSeconds;
    }
  }

  const endpointIndexByName = new Map(metrics.endpoints.map((name, index) => [name, index]));
  const chartXMin = -0.5;
  const chartXMax = Math.max(0.5, metrics.endpoints.length - 0.5);
  const elapsedDenominator = Math.max(1, globalElapsedMax);

  const endpointScatterData = new Map<
    string,
    Array<{
      endpoint: string;
      elapsed_seconds: number;
      latency_ms: number;
      value: [number, number];
    }>
  >();
  const errorScatterData: Array<{
    endpoint: string;
    elapsed_seconds: number;
    latency_ms: number;
    error_status: number | null;
    value: [number, number];
  }> = [];
  interface StagePhaseSpan {
    target: number;
    start: number;
    end: number;
    stageIndexes: number[];
  }
  const phaseSpans: StagePhaseSpan[] = [];
  let stageCursorSeconds = 0;
  for (let stageIndex = 0; stageIndex < metrics.stages.length; stageIndex += 1) {
    const stage = metrics.stages[stageIndex];
    let durationSeconds = 0;
    try {
      durationSeconds = parseDurationToSeconds(stage.duration);
    } catch {
      durationSeconds = 0;
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      continue;
    }
    const start = stageCursorSeconds;
    const end = start + durationSeconds;
    const prev = phaseSpans[phaseSpans.length - 1];
    if (prev && prev.target === stage.target) {
      prev.end = end;
      prev.stageIndexes.push(stageIndex);
    } else {
      phaseSpans.push({ target: stage.target, start, end, stageIndexes: [stageIndex] });
    }
    stageCursorSeconds = end;
  }

  const effectiveStageDuration = Math.max(1, stageCursorSeconds, elapsedDenominator);
  const normalizedPhases = phaseSpans
    .map((phase) => ({
      target: phase.target,
      start: Math.max(0, Math.min(1, phase.start / effectiveStageDuration)),
      end: Math.max(0, Math.min(1, phase.end / effectiveStageDuration)),
      stageIndexes: phase.stageIndexes,
    }))
    .filter((phase) => phase.end - phase.start >= 0.03);
  const stageBoundaryPositions = normalizedPhases.slice(1).map((phase) => phase.start);
  const tablePhases = phaseSpans.length > 0 ? phaseSpans : [{ target: 0, start: 0, end: elapsedDenominator, stageIndexes: [] }];

  interface StageLatencyStatsRow {
    stageLabel: string;
    avg: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    max: number | null;
  }
  const stageStatsByEndpoint = new Map<string, StageLatencyStatsRow[]>();
  for (const endpoint of metrics.endpoints) {
    const rows: StageLatencyStatsRow[] = [];
    for (let phaseIndex = 0; phaseIndex < tablePhases.length; phaseIndex += 1) {
      const phase = tablePhases[phaseIndex];
      const isLast = phaseIndex === tablePhases.length - 1;
      const values = metrics.latencySamples
        .filter((sample) => {
          if (sample.endpoint !== endpoint || sample.status !== 200) {
            return false;
          }
          if (sample.elapsedSeconds < phase.start) {
            return false;
          }
          return isLast ? sample.elapsedSeconds <= phase.end : sample.elapsedSeconds < phase.end;
        })
        .map((sample) => sample.latencyMs);
      const avg = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      rows.push({
        stageLabel: `${Math.round(phase.target)} rps`,
        avg,
        p50: quantile(values, 0.5),
        p95: quantile(values, 0.95),
        p99: quantile(values, 0.99),
        max: values.length > 0 ? Math.max(...values) : null,
      });
    }
    stageStatsByEndpoint.set(endpoint, rows);
  }

  for (const endpoint of metrics.endpoints) {
    const endpointIndex = endpointIndexByName.get(endpoint) ?? 0;
    const values = [...(samplesByEndpoint.get(endpoint) ?? [])].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
    if (values.length < 1) {
      endpointScatterData.set(endpoint, []);
      continue;
    }

    const maxElapsed = Math.max(1, ...values.map((sample) => sample.elapsedSeconds));
    const data = values.map((sample) => {
      const t = Math.max(0, Math.min(1, sample.elapsedSeconds / Math.max(elapsedDenominator, maxElapsed)));
      const xPosition = endpointIndex - ENDPOINT_BAND_HALF_WIDTH + t * (ENDPOINT_BAND_HALF_WIDTH * 2);
      const value: [number, number] = [Number(xPosition.toFixed(6)), sample.latencyMs];
      return {
        endpoint,
        elapsed_seconds: sample.elapsedSeconds,
        latency_ms: sample.latencyMs,
        value,
      };
    });
    endpointScatterData.set(endpoint, data);

    const errorValues = [...(errorSamplesByEndpoint.get(endpoint) ?? [])].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
    if (errorValues.length > 0) {
      for (const sample of errorValues) {
        const t = Math.max(0, Math.min(1, sample.elapsedSeconds / Math.max(elapsedDenominator, maxElapsed)));
        const xPosition = endpointIndex - ENDPOINT_BAND_HALF_WIDTH + t * (ENDPOINT_BAND_HALF_WIDTH * 2);
        errorScatterData.push({
          endpoint,
          elapsed_seconds: sample.elapsedSeconds,
          latency_ms: sample.latencyMs,
          error_status: sample.status,
          value: [Number(xPosition.toFixed(6)), sample.latencyMs],
        });
      }
    }

  }

  const baseSeriesStyle = {
    symbolSize: 4,
    itemStyle: {
      opacity: 0.32,
    },
    emphasis: {
      scale: 1.08,
      itemStyle: {
        opacity: 0.6,
      },
    },
    largeThreshold: 1500,
  } as const;

  const plotWidth = DEFAULT_CANVAS_WIDTH - GRID_LEFT - GRID_RIGHT;
  const plotHeight = PLOT_HEIGHT;
  const legendTop = GRID_TOP + plotHeight + 72;
  const HEATMAP_METRICS = [
    { key: 'avg', label: 'avg' },
    { key: 'p50', label: 'p50' },
    { key: 'p95', label: 'p95' },
    { key: 'p99', label: 'p99' },
    { key: 'max', label: 'max' },
  ] as const;
  const heatmapMetricKeys = HEATMAP_METRICS.map((metric) => metric.key);
  const heatmapStageCount = Math.max(1, ...metrics.endpoints.map((endpoint) => stageStatsByEndpoint.get(endpoint)?.length ?? 0));
  const heatmapTop = legendTop + 44;
  const heatmapTitleHeight = 22;
  const heatmapHeaderHeight = 18;
  const heatmapCellHeight = 21;
  const heatmapCellGap = 4;
  const heatmapPaddingX = 10;
  const heatmapPaddingY = 8;
  const heatmapLabelColWidth = 40;
  const heatmapHeight =
    heatmapPaddingY * 2 +
    heatmapTitleHeight +
    heatmapHeaderHeight +
    HEATMAP_METRICS.length * heatmapCellHeight +
    Math.max(0, HEATMAP_METRICS.length - 1) * heatmapCellGap;
  const chartHeight = heatmapTop + heatmapHeight + 28;
  const gridBottom = chartHeight - (GRID_TOP + plotHeight);
  const xRange = Math.max(1e-9, chartXMax - chartXMin);
  const toPixelX = (xValue: number) => GRID_LEFT + ((xValue - chartXMin) / xRange) * plotWidth;
  const stageLabelGraphics: Array<Record<string, unknown>> = [];
  const stageTickGraphics: Array<Record<string, unknown>> = [];
  const endpointDividerGraphics: Array<Record<string, unknown>> = [];
  const axisBaselineY = GRID_TOP + plotHeight;
  const stageCostByEndpointStage = new Map(metrics.stageDurationCostSeries.map((row) => [`${row.endpoint}|${row.stage_index}`, row] as const));
  const stageBaselineCostByIndex = new Map<number, number>();
  for (const row of metrics.stageDurationCostSeries) {
    if (row.duration_cost_proxy_ms == null) {
      continue;
    }
    if (row.endpoint === 'standard') {
      stageBaselineCostByIndex.set(row.stage_index, row.duration_cost_proxy_ms);
    }
  }
  if (stageBaselineCostByIndex.size < normalizedPhases.length) {
    for (const row of metrics.stageDurationCostSeries) {
      if (row.duration_cost_proxy_ms == null) {
        continue;
      }
      if (row.endpoint.startsWith('direct-') && !stageBaselineCostByIndex.has(row.stage_index)) {
        stageBaselineCostByIndex.set(row.stage_index, row.duration_cost_proxy_ms);
      }
    }
  }
  const stageCostBarData: Array<{
    endpoint: string;
    stage_target: number;
    stage_window: string;
    duration_cost_proxy_ms: number;
    duration_cost_pct_of_standard: number;
    value: [number, number];
  }> = [];
  for (const endpoint of metrics.endpoints) {
    const endpointIndex = endpointIndexByName.get(endpoint) ?? 0;
    const bandStart = endpointIndex - ENDPOINT_BAND_HALF_WIDTH;
    const bandWidth = ENDPOINT_BAND_HALF_WIDTH * 2;
    if (endpointIndex > 0) {
      const dividerX = endpointIndex - 0.5;
      endpointDividerGraphics.push({
        type: 'line',
        left: Number(toPixelX(dividerX).toFixed(2)),
        top: GRID_TOP,
        shape: { x1: 0, y1: 0, x2: 0, y2: plotHeight },
        z: 85,
        style: {
          stroke: '#94a3b8',
          lineWidth: 1.4,
          lineDash: [4, 4],
          opacity: 0.55,
        },
      });
    }
    for (const phase of normalizedPhases) {
      const centerX = bandStart + ((phase.start + phase.end) / 2) * bandWidth;
      stageLabelGraphics.push({
        type: 'text',
        left: Number(toPixelX(centerX).toFixed(2)),
        top: GRID_TOP + plotHeight + 10,
        z: 130,
        style: {
          text: `${Math.round(phase.target)} rps`,
          fill: stageLabelColor,
          font: `600 13px ${FONT_FAMILY}`,
          align: 'center',
          verticalAlign: 'top',
          backgroundColor: stageLabelBackground,
          padding: [1, 2, 1, 2],
        },
      });

      let phaseDurationCostMs = 0;
      let hasPhaseCost = false;
      let phaseBaselineCostMs = 0;
      let hasPhaseBaseline = false;
      for (const stageIndex of phase.stageIndexes) {
        const stageRow = stageCostByEndpointStage.get(`${endpoint}|${stageIndex}`);
        if (stageRow?.duration_cost_proxy_ms != null) {
          phaseDurationCostMs += stageRow.duration_cost_proxy_ms;
          hasPhaseCost = true;
        }
        const baselineCost = stageBaselineCostByIndex.get(stageIndex);
        if (baselineCost != null) {
          phaseBaselineCostMs += baselineCost;
          hasPhaseBaseline = true;
        }
      }
      if (hasPhaseCost && hasPhaseBaseline && phaseBaselineCostMs > 0) {
        const phasePct = (100 * phaseDurationCostMs) / phaseBaselineCostMs;
        stageCostBarData.push({
          endpoint,
          stage_target: phase.target,
          stage_window: `${Math.round(phase.target)} rps`,
          duration_cost_proxy_ms: phaseDurationCostMs,
          duration_cost_pct_of_standard: phasePct,
          value: [Number(centerX.toFixed(6)), Number(phasePct.toFixed(6))],
        });
      }
    }
    for (const boundary of stageBoundaryPositions) {
      const tickX = bandStart + boundary * bandWidth;
      stageTickGraphics.push({
        type: 'line',
        left: Number(toPixelX(tickX).toFixed(2)),
        top: axisBaselineY - 6,
        z: 130,
        style: {
          stroke: '#94a3b8',
          lineWidth: 1,
          lineDash: [3, 3],
          opacity: 0.7,
        },
        shape: { x1: 0, y1: 0, x2: 0, y2: 12 },
      });
    }
  }

  const series: Array<Record<string, unknown>> = [];
  for (const endpoint of metrics.endpoints) {
    const data = endpointScatterData.get(endpoint) ?? [];
    const color = endpointColor(metrics, endpoint, theme);
    series.push({
      id: `${endpoint}-latency-points`,
      name: endpoint,
      type: 'scatter',
      data,
      symbolSize: baseSeriesStyle.symbolSize,
      itemStyle: {
        color,
        opacity: baseSeriesStyle.itemStyle.opacity,
      },
      emphasis: baseSeriesStyle.emphasis,
      large: false,
      progressive: 0,
      progressiveThreshold: 0,
    });
  }

  const stageCostValues = stageCostBarData.map((point) => point.duration_cost_pct_of_standard).filter((value) => Number.isFinite(value));
  const stageCostRawMax = stageCostValues.length > 0 ? Math.max(100, ...stageCostValues) : 100;
  const stageCostAxisMax = Math.max(120, niceBounds(0, stageCostRawMax * 1.08, 6).max);
  const minPhaseSpan = normalizedPhases.length > 0 ? Math.min(...normalizedPhases.map((phase) => phase.end - phase.start)) : 1;
  const stageBarWidth = Math.max(10, Math.min(52, (plotWidth / xRange) * (ENDPOINT_BAND_HALF_WIDTH * 2) * minPhaseSpan * 0.7));
  const legendItemGap = 12;
  const legendMarkerWidth = 16;
  const legendMarkerTextGap = 6;
  const legendLabelCharWidth = LEGEND_FONT_SIZE * 0.56;
  const legendLabels = metrics.endpoints.map((endpoint) => endpointShortLabel(endpoint));
  const legendRowWidth =
    legendLabels.reduce(
      (sum, label) => sum + legendMarkerWidth + legendMarkerTextGap + label.length * legendLabelCharWidth,
      0,
    ) +
    Math.max(0, legendLabels.length - 1) * legendItemGap;
  const legendPrefixText = 'Endpoint:';
  const legendPrefixWidth = legendPrefixText.length * LEGEND_FONT_SIZE * 0.56;
  const legendPrefixLeft = Number((DEFAULT_CANVAS_WIDTH / 2 - legendRowWidth / 2 - legendPrefixWidth - 10).toFixed(2));
  const heatmapGraphics: Array<Record<string, unknown>> = [];
  const heatmapGap = 14;
  const heatmapPanelCount = Math.max(1, metrics.endpoints.length);
  const heatmapPanelWidth = (plotWidth - heatmapGap * (heatmapPanelCount - 1)) / heatmapPanelCount;
  const heatmapValues: number[] = [];
  for (const endpoint of metrics.endpoints) {
    const rows = stageStatsByEndpoint.get(endpoint) ?? [];
    for (const row of rows) {
      for (const metricKey of heatmapMetricKeys) {
        const value = row[metricKey];
        if (value != null && Number.isFinite(value)) {
          heatmapValues.push(value);
        }
      }
    }
  }
  const heatmapMin = heatmapValues.length > 0 ? Math.min(...heatmapValues) : 0;
  const heatmapMax = heatmapValues.length > 0 ? Math.max(...heatmapValues) : 1;
  const heatmapRange = Math.max(1e-9, heatmapMax - heatmapMin);
  const heatmapGamma = 0.35;
  const heatmapDividerTopOffset = -3;
  const heatmapLegendWidth = 122;
  const heatmapLegendHeight = 10;
  const heatmapLegendLeft = GRID_LEFT + plotWidth - heatmapLegendWidth - 4;
  const heatmapLegendTop = heatmapTop - 25;
  const heatmapMonoCharWidth = 6.7;
  const heatmapCellTextYOffset = -2;
  const heatmapTextColorForCell = (hexColor: string): string => {
    const match = /^#?([0-9a-f]{6})$/i.exec(hexColor);
    if (!match) {
      return isDarkLike ? 'rgb(248, 250, 252)' : 'rgb(15, 23, 42)';
    }
    const r = Number.parseInt(match[1].slice(0, 2), 16) / 255;
    const g = Number.parseInt(match[1].slice(2, 4), 16) / 255;
    const b = Number.parseInt(match[1].slice(4, 6), 16) / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.6 ? 'rgb(15, 23, 42)' : 'rgb(248, 250, 252)';
  };

  heatmapGraphics.push({
    type: 'text',
    left: Number((heatmapLegendLeft - 90).toFixed(2)),
    top: Number((heatmapLegendTop - 1).toFixed(2)),
    z: 166,
    style: {
      text: 'Heatmap:',
      fill: heatmapLabelColor,
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: 600,
      align: 'left',
      verticalAlign: 'top',
    },
  });
  heatmapGraphics.push({
    type: 'rect',
    left: Number(heatmapLegendLeft.toFixed(2)),
    top: Number(heatmapLegendTop.toFixed(2)),
    z: 164,
    shape: { x: 0, y: 0, width: heatmapLegendWidth, height: heatmapLegendHeight },
    style: {
      fill: {
        type: 'linear',
        x: 0,
        y: 0,
        x2: 1,
        y2: 0,
        colorStops: [
          { offset: 0, color: '#e2e8f0' },
          { offset: 1, color: '#475569' },
        ],
      },
      stroke: '#cbd5e1',
      lineWidth: 1,
    },
  });
  heatmapGraphics.push({
    type: 'text',
    left: Number(heatmapLegendLeft.toFixed(2)),
    top: Number((heatmapLegendTop + heatmapLegendHeight + 2).toFixed(2)),
    z: 166,
    style: {
      text: 'low',
      fill: heatmapLabelColor,
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: 500,
      align: 'left',
      verticalAlign: 'top',
    },
  });
  heatmapGraphics.push({
    type: 'text',
    left: Number((heatmapLegendLeft + heatmapLegendWidth).toFixed(2)),
    top: Number((heatmapLegendTop + heatmapLegendHeight + 2).toFixed(2)),
    z: 166,
    style: {
      text: 'high',
      fill: heatmapLabelColor,
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: 500,
      align: 'right',
      verticalAlign: 'top',
    },
  });

  for (let endpointIndex = 0; endpointIndex < metrics.endpoints.length; endpointIndex += 1) {
    const endpoint = metrics.endpoints[endpointIndex];
    const endpointRows = stageStatsByEndpoint.get(endpoint) ?? [];
    const panelLeft = GRID_LEFT + endpointIndex * (heatmapPanelWidth + heatmapGap);
    const panelTop = heatmapTop;
    const endpointBaseColor = endpointColor(metrics, endpoint, theme);
    const innerTop = panelTop + heatmapPaddingY + heatmapTitleHeight + heatmapHeaderHeight;
    const cellWidth = Math.max(
      32,
      (heatmapPanelWidth - heatmapPaddingX * 2 - heatmapLabelColWidth - Math.max(0, heatmapStageCount - 1) * heatmapCellGap) /
        heatmapStageCount,
    );

    heatmapGraphics.push({
      type: 'rect',
      left: Number(panelLeft.toFixed(2)),
      top: Number(panelTop.toFixed(2)),
      z: 162,
      shape: { x: 0, y: 0, width: Number(heatmapPanelWidth.toFixed(2)), height: heatmapHeight },
      style: {
        fill: 'rgba(255, 255, 255, 0.44)',
        stroke: '#cbd5e1',
        lineWidth: 1,
      },
    });
    heatmapGraphics.push({
      type: 'text',
      left: Number((panelLeft + heatmapPanelWidth / 2).toFixed(2)),
      top: Number((panelTop + 7).toFixed(2)),
      z: 166,
      style: {
        text: endpointShortLabel(endpoint),
        fill: endpointBaseColor,
        fontFamily: FONT_FAMILY,
        fontSize: 13,
        fontWeight: 700,
        align: 'center',
        verticalAlign: 'top',
      },
    });
    heatmapGraphics.push({
      type: 'line',
      left: Number(panelLeft.toFixed(2)),
      top: Number((panelTop + heatmapPaddingY + heatmapTitleHeight + heatmapDividerTopOffset).toFixed(2)),
      z: 165,
      shape: { x1: 0, y1: 0, x2: Number(heatmapPanelWidth.toFixed(2)), y2: 0 },
      style: { stroke: '#dbeafe', lineWidth: 1 },
    });

    for (let stageIndex = 0; stageIndex < heatmapStageCount; stageIndex += 1) {
      const stageLabel = endpointRows[stageIndex]?.stageLabel ?? `S${stageIndex + 1}`;
      const headerCellLeft = panelLeft + heatmapPaddingX + heatmapLabelColWidth + stageIndex * (cellWidth + heatmapCellGap);
      heatmapGraphics.push({
        type: 'text',
        left: Number(headerCellLeft.toFixed(2)),
        top: Number((panelTop + heatmapPaddingY + heatmapTitleHeight + 2).toFixed(2)),
        z: 166,
        style: {
          x: Number((cellWidth - 4).toFixed(2)),
          y: 0,
          text: stageLabel.replace(/\s*rps$/i, ''),
          fill: heatmapLabelColor,
          fontFamily: FONT_FAMILY,
          fontSize: 10,
          fontWeight: 600,
          align: 'right',
          verticalAlign: 'top',
        },
      });
    }

    for (let metricIndex = 0; metricIndex < HEATMAP_METRICS.length; metricIndex += 1) {
      const metric = HEATMAP_METRICS[metricIndex];
      const rowY = innerTop + metricIndex * (heatmapCellHeight + heatmapCellGap);
      heatmapGraphics.push({
        type: 'text',
        left: Number((panelLeft + heatmapPaddingX).toFixed(2)),
        top: Number((rowY + heatmapCellHeight / 2).toFixed(2)),
        z: 166,
        style: {
          text: metric.label,
          fill: heatmapMetricLabelColor,
          fontFamily: FONT_FAMILY,
          fontSize: 11,
          fontWeight: 600,
          align: 'left',
          verticalAlign: 'middle',
        },
      });

      for (let stageIndex = 0; stageIndex < heatmapStageCount; stageIndex += 1) {
        const statsRow = endpointRows[stageIndex];
        const rawValue = statsRow ? statsRow[metric.key] : null;
        const displayValue = formatLatencyStat(rawValue);
        const normalized =
          rawValue == null || !Number.isFinite(rawValue)
            ? 0
            : Math.pow(Math.max(0, Math.min(1, (rawValue - heatmapMin) / heatmapRange)), heatmapGamma);
        const cellLeft = panelLeft + heatmapPaddingX + heatmapLabelColWidth + stageIndex * (cellWidth + heatmapCellGap);
        const colorWeight = rawValue == null ? 0.04 : 0.06 + 0.82 * Math.max(0, Math.min(1, normalized));
        const cellBaseColor = rawValue == null ? '#f1f5f9' : blendHexColors(endpointBaseColor, '#e2e8f0', colorWeight);
        const cellColor = rawValue == null ? 'rgba(241, 245, 249, 0.8)' : `${cellBaseColor}d4`;
        const cellTextColor = heatmapTextColorForCell(cellBaseColor);
        heatmapGraphics.push({
          type: 'rect',
          left: Number(cellLeft.toFixed(2)),
          top: Number(rowY.toFixed(2)),
          z: 163,
          shape: {
            x: 0,
            y: 0,
            width: Number(cellWidth.toFixed(2)),
            height: heatmapCellHeight,
          },
          style: {
            fill: cellColor,
            stroke: '#ffffff',
            lineWidth: 1,
            opacity: 1,
          },
        });
        heatmapGraphics.push({
          type: 'text',
          left: Number((cellLeft + Math.max(2, cellWidth - 4 - displayValue.length * heatmapMonoCharWidth)).toFixed(2)),
          top: Number((rowY + heatmapCellHeight / 2 + heatmapCellTextYOffset).toFixed(2)),
          z: 166,
          style: {
            text: displayValue,
            fill: cellTextColor,
            fontFamily: 'Menlo, Monaco, Consolas, monospace',
            fontSize: 11,
            fontWeight: 600,
            align: 'left',
            verticalAlign: 'middle',
          },
        });
      }
    }
  }

  if (stageCostBarData.length > 0) {
    series.push({
      id: 'stage-cost-bars',
      name: 'stage-cost',
      type: 'bar',
      xAxisIndex: 0,
      yAxisIndex: 1,
      data: stageCostBarData,
      barWidth: Number(stageBarWidth.toFixed(2)),
      barMinHeight: 3,
      z: 55,
      itemStyle: {
        opacity: 0.55,
        borderWidth: 1.8,
        borderColor: '#ffffff',
        borderRadius: [4, 4, 0, 0],
        color: (params: { data?: { endpoint?: string } }) => {
          const color = endpointColor(metrics, String(params.data?.endpoint ?? ''), theme);
          return blendHexColors(color, '#e5e7eb', 0.22);
        },
      },
      label: {
        show: true,
        position: 'top',
        distance: 8,
        fontSize: 13,
        fontWeight: 700,
        color: '#0f172a',
        formatter: (params: { data?: { duration_cost_pct_of_standard?: number } }) => {
          const value = Number(params.data?.duration_cost_pct_of_standard ?? NaN);
          if (!Number.isFinite(value) || value <= 0) {
            return '';
          }
          return `${Math.round(value)}%`;
        },
      },
    });
  }

  if (errorScatterData.length > 0) {
    series.push({
      id: 'latency-error-points',
      name: '__errors__',
      type: 'scatter',
      data: errorScatterData,
      symbol: 'circle',
      symbolSize: 5.5,
      z: 95,
      itemStyle: {
        color: (params: { data?: { endpoint?: string } }) => {
          const endpoint = String(params.data?.endpoint ?? '');
          const base = endpointColor(metrics, endpoint, theme);
          return blendHexColors(base, '#ef4444', 0.22);
        },
        opacity: 0.92,
      },
      emphasis: {
        scale: 1.15,
        itemStyle: {
          color: (params: { data?: { endpoint?: string } }) => {
            const endpoint = String(params.data?.endpoint ?? '');
            const base = endpointColor(metrics, endpoint, theme);
            return blendHexColors(base, '#dc2626', 0.15);
          },
          opacity: 1,
        },
      },
      large: false,
      progressive: 0,
      progressiveThreshold: 0,
    });
  }

  return {
    filename: RUN_CHART_FILENAMES.latencyDistribution,
    width: DEFAULT_CANVAS_WIDTH,
    height: chartHeight,
    backgroundColor: '#f8fafc',
    option: {
      backgroundColor: '#f8fafc',
      animation: false,
      textStyle: { fontFamily: FONT_FAMILY, color: '#0f172a' },
      title: standardTitle(
        'Latency vs Stage Cost by Endpoint',
        [
          'Dots show latency over time by endpoint; bars show stage cost (% of standard); heatmaps summarize avg/p50/p95/p99.',
          chartContextLine(metrics),
        ].join('\n'),
      ),
      tooltip: { show: false },
      legend: {
        left: 'center',
        top: legendTop,
        orient: 'horizontal',
        icon: 'circle',
        itemWidth: 16,
        itemHeight: 16,
        itemGap: legendItemGap,
        textStyle: { fontSize: LEGEND_FONT_SIZE, color: '#334155' },
        data: endpointLegendData(metrics, theme, 'circle'),
        formatter: (name: string) => endpointShortLabel(name),
      },
      grid: { left: GRID_LEFT, right: GRID_RIGHT, top: GRID_TOP, bottom: gridBottom },
      xAxis: {
        type: 'value',
        min: chartXMin,
        max: chartXMax,
        interval: 1,
        axisLabel: {
          fontSize: AXIS_LABEL_FONT_SIZE,
          color: '#334155',
          formatter: (value: number) => {
            const rounded = Math.round(value);
            if (Math.abs(value - rounded) > 1e-6) {
              return '';
            }
            const endpoint = metrics.endpoints[rounded];
            return endpoint ? endpointShortLabel(endpoint) : '';
          },
        },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          min: 0,
          position: 'left',
          axisLine: {
            show: true,
            onZero: false,
            lineStyle: { color: '#94a3b8', width: 1 },
          },
          name: 'Latency (ms)',
          nameLocation: 'middle',
          nameGap: 66,
          axisLabel: {
            fontSize: AXIS_LABEL_FONT_SIZE,
            color: '#334155',
            formatter: (value: number) => Math.round(Number(value)).toLocaleString('en-US'),
          },
          nameTextStyle: { fontSize: AXIS_NAME_FONT_SIZE, color: '#0f172a' },
          splitLine: { lineStyle: { color: '#dbeafe', type: 'dashed' } },
        },
        {
          type: 'value',
          position: 'right',
          min: 0,
          max: stageCostAxisMax,
          axisLine: { show: true, onZero: false, lineStyle: { color: '#94a3b8', width: 1 } },
          axisTick: { show: true },
          name: 'Cost (% of std)',
          nameLocation: 'middle',
          nameGap: 52,
          axisLabel: {
            fontSize: AXIS_LABEL_FONT_SIZE,
            color: '#475569',
            formatter: (value: number) => `${Math.round(value)}%`,
          },
          nameTextStyle: { fontSize: AXIS_NAME_FONT_SIZE, color: '#334155' },
          splitLine: { show: false },
        },
      ],
      series,
      graphic: [
        ...endpointDividerGraphics,
        ...stageTickGraphics,
        ...stageLabelGraphics,
        ...heatmapGraphics,
        {
          type: 'text',
          left: legendPrefixLeft,
          top: legendTop + 3,
          z: 170,
          silent: true,
          style: {
            text: legendPrefixText,
            fill: '#334155',
            fontFamily: FONT_FAMILY,
            fontSize: LEGEND_FONT_SIZE,
            fontWeight: 400,
            align: 'left',
            verticalAlign: 'middle',
          },
        },
      ],
    },
  };
}

export function buildEChartsRenderSpecs(
  metrics: MetricsBundle,
  theme: ChartTheme = 'light',
): EChartsRenderSpec[] {
  return [
    buildLatencyDistribution(metrics, theme),
  ].map((spec) => applyThemeSpec(spec, theme));
}
