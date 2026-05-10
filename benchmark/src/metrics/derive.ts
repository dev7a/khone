import { epochSecondToMs, mean, normalizeEndpointName, parseDurationToSeconds, quantile, round } from '../utils.js';
import type {
  BatchSample,
  EndpointSummaryRow,
  Executor,
  LatencySample,
  MetricsBundle,
  RawK6Record,
  RequestSample,
  Stage,
  StageDurationCostPoint,
} from '../types.js';

interface DeriveMetricsArgs {
  records: RawK6Record[];
  endpointOrder: string[];
  stages: Stage[];
  executor: Executor;
  mode: 'per_endpoint' | 'batch';
  stackName: string;
  maxDelayMs: number;
}

interface EndpointAccumulator {
  requests: number;
  errors: number;
  errors4xx: number;
  errors5xx: number;
  errors429: number;
  okLatencies: number[];
  batchSizes: number[];
  estInvocations: number;
}

function newAccumulator(): EndpointAccumulator {
  return {
    requests: 0,
    errors: 0,
    errors4xx: 0,
    errors5xx: 0,
    errors429: 0,
    okLatencies: [],
    batchSizes: [],
    estInvocations: 0,
  };
}

interface DurationBatchPairState {
  pendingDurations: Array<{
    durationMs: number;
    stageIndex: number | null;
  }>;
  pendingBatchSizes: number[];
}

interface StageWindow {
  index: number;
  target: number;
  startSeconds: number;
  endSeconds: number;
}

interface DurationCostAggregation {
  byEndpoint: Map<string, number>;
  byEndpointStage: Map<string, number>;
}

interface DurationCounts {
  http: number;
  target: number;
}

function buildStageWindows(stages: readonly Stage[]): StageWindow[] {
  const windows: StageWindow[] = [];
  let cursorSeconds = 0;
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    let durationSeconds = 0;
    try {
      durationSeconds = parseDurationToSeconds(stage.duration);
    } catch {
      durationSeconds = 0;
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      continue;
    }
    const startSeconds = cursorSeconds;
    const endSeconds = startSeconds + durationSeconds;
    windows.push({
      index,
      target: stage.target,
      startSeconds,
      endSeconds,
    });
    cursorSeconds = endSeconds;
  }
  return windows;
}

function stageKey(endpoint: string, stageIndex: number): string {
  return `${endpoint}|${stageIndex}`;
}

function findStageIndex(elapsedSeconds: number, stageWindows: readonly StageWindow[]): number | null {
  if (stageWindows.length < 1 || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return null;
  }
  for (let i = 0; i < stageWindows.length; i += 1) {
    const stage = stageWindows[i];
    const isLast = i === stageWindows.length - 1;
    if (elapsedSeconds >= stage.startSeconds && (elapsedSeconds < stage.endSeconds || (isLast && elapsedSeconds <= stage.endSeconds))) {
      return stage.index;
    }
  }
  const last = stageWindows[stageWindows.length - 1];
  if (elapsedSeconds > last.endSeconds) {
    return last.index;
  }
  return null;
}

function accumulateDurationCostProxyMs(
  records: RawK6Record[],
  endpoints: readonly string[],
  baseMs: number,
  stageWindows: readonly StageWindow[],
): DurationCostAggregation {
  const selected = new Set(endpoints);
  const durationCountsByEndpoint = new Map<string, DurationCounts>();
  for (const record of records) {
    if (!selected.has(record.endpoint) || !Number.isFinite(record.metricValue) || record.metricValue < 0) {
      continue;
    }
    if (record.metricName !== 'http_req_duration' && record.metricName !== 'khone_target_elapsed_ms') {
      continue;
    }
    const counts = durationCountsByEndpoint.get(record.endpoint) ?? { http: 0, target: 0 };
    if (record.metricName === 'khone_target_elapsed_ms') {
      counts.target += 1;
    } else {
      counts.http += 1;
    }
    durationCountsByEndpoint.set(record.endpoint, counts);
  }
  const endpointsWithCompleteTargetDurations = new Set(
    Array.from(durationCountsByEndpoint.entries())
      .filter(([, counts]) => counts.target > 0 && (counts.http === 0 || counts.target >= counts.http))
      .map(([endpoint]) => endpoint),
  );
  const byEndpoint = new Map<string, DurationBatchPairState>();
  const totalsByEndpoint = new Map<string, number>();
  const totalsByEndpointStage = new Map<string, number>();

  function endpointState(endpoint: string): DurationBatchPairState {
    const state = byEndpoint.get(endpoint);
    if (state) {
      return state;
    }
    const created: DurationBatchPairState = { pendingDurations: [], pendingBatchSizes: [] };
    byEndpoint.set(endpoint, created);
    return created;
  }

  function addDurationCost(endpoint: string, stageIndex: number | null, durationMs: number, batchSize: number): void {
    const safeBatch = Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 1;
    const cost = durationMs / safeBatch;
    totalsByEndpoint.set(endpoint, (totalsByEndpoint.get(endpoint) ?? 0) + cost);
    if (stageIndex != null) {
      const key = stageKey(endpoint, stageIndex);
      totalsByEndpointStage.set(key, (totalsByEndpointStage.get(key) ?? 0) + cost);
    }
  }

  function pairPending(endpoint: string): void {
    const state = endpointState(endpoint);
    while (state.pendingDurations.length > 0 && state.pendingBatchSizes.length > 0) {
      const duration = state.pendingDurations.shift() as { durationMs: number; stageIndex: number | null };
      const batchSize = state.pendingBatchSizes.shift() as number;
      addDurationCost(endpoint, duration.stageIndex, duration.durationMs, batchSize);
    }
  }

  for (const record of records) {
    if (!selected.has(record.endpoint)) {
      continue;
    }
    if (record.metricName === 'http_req_duration' || record.metricName === 'khone_target_elapsed_ms') {
      const useTargetDuration = endpointsWithCompleteTargetDurations.has(record.endpoint);
      if (useTargetDuration !== (record.metricName === 'khone_target_elapsed_ms')) {
        continue;
      }
      if (Number.isFinite(record.metricValue) && record.metricValue >= 0) {
        const elapsedSeconds = Math.max(0, (epochSecondToMs(record.timestamp) - baseMs) / 1000);
        endpointState(record.endpoint).pendingDurations.push({
          durationMs: record.metricValue,
          stageIndex: findStageIndex(elapsedSeconds, stageWindows),
        });
        pairPending(record.endpoint);
      }
      continue;
    }
    if (record.metricName === 'khone_batch_size') {
      if (Number.isFinite(record.metricValue) && record.metricValue > 0) {
        endpointState(record.endpoint).pendingBatchSizes.push(record.metricValue);
        pairPending(record.endpoint);
      }
    }
  }

  for (const endpoint of selected) {
    const state = byEndpoint.get(endpoint);
    if (!state) {
      continue;
    }
    if (state.pendingDurations.length > 0) {
      for (const duration of state.pendingDurations) {
        addDurationCost(endpoint, duration.stageIndex, duration.durationMs, 1);
      }
    }
  }

  return {
    byEndpoint: totalsByEndpoint,
    byEndpointStage: totalsByEndpointStage,
  };
}

function minNumber(values: readonly number[]): number | null {
  if (values.length < 1) {
    return null;
  }
  let min = values[0];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < min) {
      min = values[i];
    }
  }
  return min;
}

function maxNumber(values: readonly number[]): number | null {
  if (values.length < 1) {
    return null;
  }
  let max = values[0];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > max) {
      max = values[i];
    }
  }
  return max;
}

export function deriveMetrics(args: DeriveMetricsArgs): MetricsBundle {
  const { records, endpointOrder, stages, executor, mode, stackName, maxDelayMs } = args;
  const normalizedEndpointOrder = endpointOrder
    .map((endpoint) => normalizeEndpointName(endpoint))
    .filter((endpoint, index, arr) => arr.indexOf(endpoint) === index);
  const selected = new Set(normalizedEndpointOrder);
  const filtered = records.filter((r) => selected.has(r.endpoint));

  const latencyRaw = filtered.filter((r) => r.metricName === 'http_req_duration');
  const requestRaw = filtered.filter((r) => r.metricName === 'http_reqs');
  const batchRaw = filtered.filter((r) => r.metricName === 'khone_batch_size');

  const baseMsCandidates = latencyRaw.length > 0 ? latencyRaw : requestRaw;
  let baseMs = 0;
  if (baseMsCandidates.length > 0) {
    baseMs = epochSecondToMs(baseMsCandidates[0].timestamp);
    for (let i = 1; i < baseMsCandidates.length; i += 1) {
      const ts = epochSecondToMs(baseMsCandidates[i].timestamp);
      if (ts < baseMs) {
        baseMs = ts;
      }
    }
  }
  const stageWindows = buildStageWindows(stages);
  const durationCosts = accumulateDurationCostProxyMs(filtered, normalizedEndpointOrder, baseMs, stageWindows);
  const durationCostByEndpoint = durationCosts.byEndpoint;
  const durationCostByEndpointStage = durationCosts.byEndpointStage;

  const latencySamples: LatencySample[] = latencyRaw.map((r) => {
    const timestamp = epochSecondToMs(r.timestamp);
    return {
      endpoint: r.endpoint,
      timestamp,
      elapsedSeconds: Math.max(0, (timestamp - baseMs) / 1000),
      latencyMs: r.metricValue,
      status: r.status,
    };
  });

  const requestSamples: RequestSample[] = requestRaw.map((r) => {
    const timestamp = epochSecondToMs(r.timestamp);
    return {
      endpoint: r.endpoint,
      timestamp,
      elapsedSeconds: Math.max(0, (timestamp - baseMs) / 1000),
      status: r.status,
      error: r.error,
    };
  });

  const batchSamples: BatchSample[] = batchRaw
    .filter((r) => Number.isFinite(r.metricValue) && r.metricValue > 0)
    .map((r) => {
      const timestamp = epochSecondToMs(r.timestamp);
      return {
        endpoint: r.endpoint,
        timestamp,
        elapsedSeconds: Math.max(0, (timestamp - baseMs) / 1000),
        batchSize: r.metricValue,
      };
    });

  const acc = new Map<string, EndpointAccumulator>();
  for (const endpoint of normalizedEndpointOrder) {
    acc.set(endpoint, newAccumulator());
  }

  for (const req of requestSamples) {
    const slot = acc.get(req.endpoint);
    if (!slot) continue;
    slot.requests += 1;

    const isTransport = req.error.length > 0 || req.status === 0 || req.status == null;
    const isHttpError = req.status != null && req.status >= 400;
    if (isTransport || isHttpError) {
      slot.errors += 1;
    }
    if (req.status != null && req.status >= 400 && req.status < 500) {
      slot.errors4xx += 1;
    }
    if (req.status != null && req.status >= 500 && req.status < 600) {
      slot.errors5xx += 1;
    }
    if (req.status === 429) {
      slot.errors429 += 1;
    }
  }

  for (const latency of latencySamples) {
    if (latency.status !== 200) continue;
    const slot = acc.get(latency.endpoint);
    if (!slot) continue;
    slot.okLatencies.push(latency.latencyMs);
  }

  for (const batch of batchSamples) {
    const slot = acc.get(batch.endpoint);
    if (!slot) continue;
    slot.batchSizes.push(batch.batchSize);
    if (batch.batchSize > 0) {
      slot.estInvocations += 1 / batch.batchSize;
    }
  }

  const summaryRows: EndpointSummaryRow[] = normalizedEndpointOrder.map((endpoint) => {
    const item = acc.get(endpoint) ?? newAccumulator();
    const ok = item.okLatencies;
    const batch = item.batchSizes;

    return {
      endpoint,
      requests: item.requests,
      errors: item.errors,
      errors_4xx: item.errors4xx,
      errors_5xx: item.errors5xx,
      errors_429: item.errors429,
      error_rate: item.requests > 0 ? item.errors / item.requests : 0,
      ok_count: ok.length,
      avg: round(mean(ok)),
      min: round(minNumber(ok)),
      max: round(maxNumber(ok)),
      p50: round(quantile(ok, 0.5)),
      p90: round(quantile(ok, 0.9)),
      p95: round(quantile(ok, 0.95)),
      p99: round(quantile(ok, 0.99)),
      batch_count: batch.length,
      batch_avg: round(mean(batch)),
      batch_min: round(minNumber(batch)),
      batch_max: round(maxNumber(batch)),
      batch_p50: round(quantile(batch, 0.5)),
      batch_p90: round(quantile(batch, 0.9)),
      batch_p95: round(quantile(batch, 0.95)),
      batch_p99: round(quantile(batch, 0.99)),
      est_lambda_invocations: round(item.estInvocations, 4),
      est_invocations_per_request:
        item.requests > 0 && item.estInvocations > 0 ? round(item.estInvocations / item.requests, 6) : null,
      est_effective_batch_size:
        item.estInvocations > 0 ? round(item.requests / item.estInvocations, 6) : null,
      est_cost_pct_of_direct: null,
      duration_cost_proxy_ms: round(durationCostByEndpoint.get(endpoint) ?? null, 3),
      duration_cost_pct_of_standard: null,
    };
  });

  const standardCandidates = summaryRows.filter((row) => row.endpoint === 'standard');
  const legacyDirectCandidates = summaryRows.filter((row) => row.endpoint.startsWith('direct-'));
  const baselineStandard =
    summaryRows.find((row) => row.endpoint === 'standard') ??
    summaryRows.find((row) => row.endpoint === 'direct-item') ??
    (standardCandidates.length > 0 ? standardCandidates[0] : null) ??
    (legacyDirectCandidates.length > 0 ? legacyDirectCandidates[0] : null);
  const baseline = baselineStandard?.est_invocations_per_request ?? null;
  if (baseline && baseline > 0) {
    for (const row of summaryRows) {
      if (row.est_invocations_per_request != null) {
        row.est_cost_pct_of_direct = round((100 * row.est_invocations_per_request) / baseline, 6);
      }
    }
  }

  const durationCostBaseline =
    summaryRows.find((row) => row.endpoint === 'standard')?.duration_cost_proxy_ms ??
    summaryRows.find((row) => row.endpoint === 'direct-item')?.duration_cost_proxy_ms ??
    summaryRows.find((row) => row.endpoint.startsWith('direct-'))?.duration_cost_proxy_ms ??
    null;
  if (durationCostBaseline && durationCostBaseline > 0) {
    for (const row of summaryRows) {
      if (row.duration_cost_proxy_ms != null) {
        row.duration_cost_pct_of_standard = round((100 * row.duration_cost_proxy_ms) / durationCostBaseline, 6);
      }
    }
  }

  const stageDurationCostSeries: StageDurationCostPoint[] = [];
  for (const stage of stageWindows) {
    const baselineCost =
      durationCostByEndpointStage.get(stageKey('standard', stage.index)) ??
      durationCostByEndpointStage.get(stageKey('direct-item', stage.index)) ??
      normalizedEndpointOrder
        .filter((endpoint) => endpoint.startsWith('direct-'))
        .map((endpoint) => durationCostByEndpointStage.get(stageKey(endpoint, stage.index)))
        .find((value) => value != null) ??
      null;
    for (const endpoint of normalizedEndpointOrder) {
      const cost = durationCostByEndpointStage.get(stageKey(endpoint, stage.index));
      stageDurationCostSeries.push({
        endpoint,
        stage_index: stage.index,
        stage_target: stage.target,
        stage_start_seconds: stage.startSeconds,
        stage_end_seconds: stage.endSeconds,
        duration_cost_proxy_ms: round(cost ?? null, 3),
        duration_cost_pct_of_standard:
          baselineCost != null && baselineCost > 0 && cost != null ? round((100 * cost) / baselineCost, 6) : null,
      });
    }
  }

  return {
    endpoints: endpointOrder,
    stages,
    executor,
    mode,
    stackName,
    maxDelayMs,
    run: null,
    latencySamples,
    requestSamples,
    batchSamples,
    summaryRows,
    stageDurationCostSeries,
  };
}
