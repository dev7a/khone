import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { epochSecondToMs, normalizeEndpointName, parseDurationToSeconds, round } from '../utils.js';
import type {
  BatchSample,
  Executor,
  EndpointSummaryRow,
  LatencySample,
  MetricsBundle,
  RequestSample,
  Stage,
  StageDurationCostPoint,
} from '../types.js';
import { P2Quantile } from './p2Quantile.js';
import { extractEndpoint } from '../utils.js';

function normalizeHeaderKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_');
}

function reservoirAdd<T>(state: { seen: number; items: T[] }, item: T, limit: number, rng: () => number): void {
  state.seen += 1;
  if (state.items.length < limit) {
    state.items.push(item);
    return;
  }
  const j = Math.floor(rng() * state.seen);
  if (j < limit) {
    state.items[j] = item;
  }
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

interface BatchTimeSliceBin {
  picks: Array<{ hash: number; sample: BatchSample }>;
}

interface BatchTimeSliceSampler {
  sliceSeconds: number;
  perSliceCap: number;
  bins: Map<number, BatchTimeSliceBin>;
}

function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function batchSampleKey(sample: BatchSample): string {
  return `${sample.timestamp}|${sample.batchSize}`;
}

function batchSampleHash(sample: BatchSample): number {
  return fnv1aHash(batchSampleKey(sample));
}

function newBatchTimeSliceSampler(limit: number, plannedDurationSeconds: number): BatchTimeSliceSampler {
  const sliceSeconds = 1;
  const estimatedSliceCount = Math.max(1, Math.ceil(Math.max(1, plannedDurationSeconds) / sliceSeconds));
  const cappedBudget = Math.max(1, Math.floor(limit * 0.85));
  const perSliceCap = Math.max(1, Math.floor(cappedBudget / estimatedSliceCount));
  return {
    sliceSeconds,
    perSliceCap,
    bins: new Map<number, BatchTimeSliceBin>(),
  };
}

function batchTimeSliceAdd(state: BatchTimeSliceSampler, sample: BatchSample): void {
  const sliceIndex = Math.floor(Math.max(0, sample.elapsedSeconds) / state.sliceSeconds);
  const slot = state.bins.get(sliceIndex) ?? { picks: [] };
  if (!state.bins.has(sliceIndex)) {
    state.bins.set(sliceIndex, slot);
  }

  const hash = batchSampleHash(sample);
  if (slot.picks.length < state.perSliceCap) {
    slot.picks.push({ hash, sample });
    return;
  }

  let worstIndex = 0;
  let worstHash = slot.picks[0].hash;
  for (let i = 1; i < slot.picks.length; i += 1) {
    if (slot.picks[i].hash > worstHash) {
      worstHash = slot.picks[i].hash;
      worstIndex = i;
    }
  }
  if (hash < worstHash) {
    slot.picks[worstIndex] = { hash, sample };
  }
}

function collectBatchTimeSliceSamples(state: BatchTimeSliceSampler): BatchSample[] {
  const samples: BatchSample[] = [];
  const sliceIndexes = [...state.bins.keys()].sort((a, b) => a - b);
  for (const sliceIndex of sliceIndexes) {
    const slot = state.bins.get(sliceIndex);
    if (!slot) {
      continue;
    }
    const unique = new Map<string, BatchSample>();
    for (const pick of slot.picks) {
      unique.set(batchSampleKey(pick.sample), pick.sample);
    }
    samples.push(...unique.values());
  }
  samples.sort((a, b) => {
    if (a.elapsedSeconds !== b.elapsedSeconds) {
      return a.elapsedSeconds - b.elapsedSeconds;
    }
    return a.timestamp - b.timestamp;
  });
  return samples;
}

interface Quantiles {
  p50: P2Quantile;
  p90: P2Quantile;
  p95: P2Quantile;
  p99: P2Quantile;
}

function newQuantiles(): Quantiles {
  return {
    p50: new P2Quantile(0.5),
    p90: new P2Quantile(0.9),
    p95: new P2Quantile(0.95),
    p99: new P2Quantile(0.99),
  };
}

interface EndpointAccumulator {
  requests: number;
  errors: number;
  errors4xx: number;
  errors5xx: number;
  errors429: number;

  okCount: number;
  okSum: number;
  okMin: number | null;
  okMax: number | null;
  okQ: Quantiles;

  batchCount: number;
  batchSum: number;
  batchMin: number | null;
  batchMax: number | null;
  batchQ: Quantiles;

  estInvocations: number;

  latencySamples: { seen: number; items: LatencySample[] };
  requestSamples: { seen: number; items: RequestSample[] };
}

function newAccumulator(): EndpointAccumulator {
  return {
    requests: 0,
    errors: 0,
    errors4xx: 0,
    errors5xx: 0,
    errors429: 0,
    okCount: 0,
    okSum: 0,
    okMin: null,
    okMax: null,
    okQ: newQuantiles(),
    batchCount: 0,
    batchSum: 0,
    batchMin: null,
    batchMax: null,
    batchQ: newQuantiles(),
    estInvocations: 0,
    latencySamples: { seen: 0, items: [] },
    requestSamples: { seen: 0, items: [] },
  };
}

interface DeriveFromCsvArgs {
  csvPath: string;
  endpointOrder: string[];
  stages: Stage[];
  executor: Executor;
  mode: 'per_endpoint' | 'batch';
  stackName: string;
  maxDelayMs: number;
  sampleLimits?: {
    latency?: number;
    requests?: number;
    batch?: number;
  };
  sampleSeed?: number;
}

interface DurationCostSourceState {
  pendingDurations: Array<{
    durationMs: number;
    stageIndex: number | null;
  }>;
  pendingBatchSizes: number[];
  totalDurationCostProxyMs: number;
  stageDurationCostProxyMs: Map<number, number>;
  durationCount: number;
}

interface DurationBatchPairState {
  http: DurationCostSourceState;
  target: DurationCostSourceState;
}

type DurationCostSource = 'http' | 'target';

function newDurationCostSourceState(): DurationCostSourceState {
  return {
    pendingDurations: [],
    pendingBatchSizes: [],
    totalDurationCostProxyMs: 0,
    stageDurationCostProxyMs: new Map<number, number>(),
    durationCount: 0,
  };
}

function selectedDurationCostState(state: DurationBatchPairState | undefined): DurationCostSourceState | null {
  if (!state) {
    return null;
  }
  const hasCompleteTargetDurations =
    state.target.durationCount > 0 &&
    (state.http.durationCount === 0 || state.target.durationCount >= state.http.durationCount);
  return hasCompleteTargetDurations ? state.target : state.http;
}

interface StageWindow {
  index: number;
  target: number;
  startSeconds: number;
  endSeconds: number;
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

export async function deriveMetricsFromK6CsvStream(
  args: DeriveFromCsvArgs,
): Promise<{ metrics: MetricsBundle; endpointsSeen: string[] }> {
  const sampleLatency = args.sampleLimits?.latency ?? 6000;
  const sampleRequests = args.sampleLimits?.requests ?? 4000;
  const sampleBatch = args.sampleLimits?.batch ?? 6000;
  const seed = Number.isFinite(args.sampleSeed) ? Math.trunc(args.sampleSeed as number) : 1337;
  const latencyRng = mulberry32(seed >>> 0);
  const requestRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);

  const normalizedEndpointOrder = args.endpointOrder
    .map((endpoint) => normalizeEndpointName(endpoint))
    .filter((endpoint, index, arr) => arr.indexOf(endpoint) === index);
  const stageWindows = buildStageWindows(args.stages);
  const plannedDurationSeconds = stageWindows.length > 0 ? stageWindows[stageWindows.length - 1].endSeconds : 1;
  const selected = new Set(normalizedEndpointOrder);
  const endpointsSeen = new Set<string>();

  const acc = new Map<string, EndpointAccumulator>();
  const durationCostStates = new Map<string, DurationBatchPairState>();
  const batchSamplers = new Map<string, BatchTimeSliceSampler>();
  for (const endpoint of normalizedEndpointOrder) {
    acc.set(endpoint, newAccumulator());
    durationCostStates.set(endpoint, {
      http: newDurationCostSourceState(),
      target: newDurationCostSourceState(),
    });
    batchSamplers.set(endpoint, newBatchTimeSliceSampler(sampleBatch, plannedDurationSeconds));
  }

  const latencySamples: LatencySample[] = [];
  const parser = createReadStream(args.csvPath).pipe(
    parse({
      columns: (headers: string[]) => headers.map(normalizeHeaderKey),
      relax_column_count: true,
      skip_empty_lines: true,
      trim: false,
    }),
  );

  let baseMs: number | null = null;

  function pairDurationBatch(endpoint: string, source: DurationCostSource): void {
    const state = durationCostStates.get(endpoint);
    if (!state) {
      return;
    }
    const sourceState = state[source];
    while (sourceState.pendingDurations.length > 0 && sourceState.pendingBatchSizes.length > 0) {
      const pendingDuration = sourceState.pendingDurations.shift() as { durationMs: number; stageIndex: number | null };
      const batchSize = sourceState.pendingBatchSizes.shift() as number;
      const safeBatchSize = Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 1;
      const cost = pendingDuration.durationMs / safeBatchSize;
      sourceState.totalDurationCostProxyMs += cost;
      if (pendingDuration.stageIndex != null) {
        sourceState.stageDurationCostProxyMs.set(
          pendingDuration.stageIndex,
          (sourceState.stageDurationCostProxyMs.get(pendingDuration.stageIndex) ?? 0) + cost,
        );
      }
    }
  }

  for await (const rowRaw of parser) {
    const row = rowRaw as Record<string, unknown>;
    const metricName = String(row.metric_name ?? '').trim();
    if (
      metricName !== 'http_req_duration' &&
      metricName !== 'http_reqs' &&
      metricName !== 'khone_batch_size' &&
      metricName !== 'khone_target_elapsed_ms'
    ) {
      continue;
    }

    const timestampSeconds = Number.parseFloat(String(row.timestamp ?? '0'));
    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
      continue;
    }
    const timestampMs = epochSecondToMs(timestampSeconds);

    if (baseMs == null && (metricName === 'http_req_duration' || metricName === 'http_reqs')) {
      baseMs = timestampMs;
    }
    if (baseMs == null) {
      baseMs = timestampMs;
    }

    const extraTags = String(row.extra_tags ?? '');
    const endpoint = extractEndpoint(extraTags);
    if (!endpoint || endpoint === 'unknown') {
      continue;
    }
    endpointsSeen.add(endpoint);
    if (!selected.has(endpoint)) {
      continue;
    }

    const elapsedSeconds = Math.max(0, (timestampMs - baseMs) / 1000);

    if (metricName === 'http_reqs') {
      const statusText = String(row.status ?? '').trim();
      const status = statusText === '' ? null : Number.parseInt(statusText, 10);
      const safeStatus = Number.isFinite(status as number) ? (status as number) : null;
      const error = String(row.error ?? '').trim();

      const slot = acc.get(endpoint);
      if (slot) {
        slot.requests += 1;
        const isTransport = error.length > 0 || safeStatus === 0 || safeStatus == null;
        const isHttpError = safeStatus != null && safeStatus >= 400;
        if (isTransport || isHttpError) {
          slot.errors += 1;
        }
        if (safeStatus != null && safeStatus >= 400 && safeStatus < 500) {
          slot.errors4xx += 1;
        }
        if (safeStatus != null && safeStatus >= 500 && safeStatus < 600) {
          slot.errors5xx += 1;
        }
        if (safeStatus === 429) {
          slot.errors429 += 1;
        }

        reservoirAdd(
          slot.requestSamples,
          { endpoint, timestamp: timestampMs, elapsedSeconds, status: safeStatus, error },
          sampleRequests,
          requestRng,
        );
      }

      continue;
    }

    if (metricName === 'http_req_duration' || metricName === 'khone_target_elapsed_ms') {
      const metricValue = Number.parseFloat(String(row.metric_value ?? '0'));
      if (!Number.isFinite(metricValue) || metricValue < 0) {
        continue;
      }
      const durationSource: DurationCostSource = metricName === 'khone_target_elapsed_ms' ? 'target' : 'http';
      const durationState = durationCostStates.get(endpoint)?.[durationSource];
      if (durationState) {
        durationState.durationCount += 1;
        durationState.pendingDurations.push({
          durationMs: metricValue,
          stageIndex: findStageIndex(elapsedSeconds, stageWindows),
        });
        pairDurationBatch(endpoint, durationSource);
      }
      if (metricName === 'khone_target_elapsed_ms') {
        continue;
      }
      const statusText = String(row.status ?? '').trim();
      const status = statusText === '' ? null : Number.parseInt(statusText, 10);
      const safeStatus = Number.isFinite(status as number) ? (status as number) : null;

      const slot = acc.get(endpoint);
      if (slot) {
        reservoirAdd(
          slot.latencySamples,
          { endpoint, timestamp: timestampMs, elapsedSeconds, latencyMs: metricValue, status: safeStatus },
          sampleLatency,
          latencyRng,
        );
      }

      if (safeStatus === 200) {
        const slot2 = acc.get(endpoint);
        if (slot2) {
          slot2.okCount += 1;
          slot2.okSum += metricValue;
          slot2.okMin = slot2.okMin == null ? metricValue : Math.min(slot2.okMin, metricValue);
          slot2.okMax = slot2.okMax == null ? metricValue : Math.max(slot2.okMax, metricValue);
          slot2.okQ.p50.add(metricValue);
          slot2.okQ.p90.add(metricValue);
          slot2.okQ.p95.add(metricValue);
          slot2.okQ.p99.add(metricValue);
        }

      }

      continue;
    }

    if (metricName === 'khone_batch_size') {
      const batchSize = Number.parseFloat(String(row.metric_value ?? '0'));
      if (!Number.isFinite(batchSize) || batchSize <= 0) {
        continue;
      }
      const durationState = durationCostStates.get(endpoint);
      if (durationState) {
        durationState.http.pendingBatchSizes.push(batchSize);
        pairDurationBatch(endpoint, 'http');
        durationState.target.pendingBatchSizes.push(batchSize);
        pairDurationBatch(endpoint, 'target');
      }
      const slot = acc.get(endpoint);
      if (slot) {
        slot.batchCount += 1;
        slot.batchSum += batchSize;
        slot.batchMin = slot.batchMin == null ? batchSize : Math.min(slot.batchMin, batchSize);
        slot.batchMax = slot.batchMax == null ? batchSize : Math.max(slot.batchMax, batchSize);
        slot.batchQ.p50.add(batchSize);
        slot.batchQ.p90.add(batchSize);
        slot.batchQ.p95.add(batchSize);
        slot.batchQ.p99.add(batchSize);
        slot.estInvocations += 1 / batchSize;

      }
      const batchSampler = batchSamplers.get(endpoint);
      if (batchSampler) {
        batchTimeSliceAdd(batchSampler, { endpoint, timestamp: timestampMs, elapsedSeconds, batchSize });
      }
      continue;
    }
  }

  for (const endpoint of normalizedEndpointOrder) {
    const state = durationCostStates.get(endpoint);
    if (!state) {
      continue;
    }
    for (const sourceState of [state.http, state.target]) {
      if (sourceState.pendingDurations.length > 0) {
        for (const pendingDuration of sourceState.pendingDurations) {
          sourceState.totalDurationCostProxyMs += pendingDuration.durationMs;
          if (pendingDuration.stageIndex != null) {
            sourceState.stageDurationCostProxyMs.set(
              pendingDuration.stageIndex,
              (sourceState.stageDurationCostProxyMs.get(pendingDuration.stageIndex) ?? 0) + pendingDuration.durationMs,
            );
          }
        }
        sourceState.pendingDurations = [];
      }
    }
  }

  const summaryRows: EndpointSummaryRow[] = normalizedEndpointOrder.map((endpoint) => {
    const item = acc.get(endpoint) ?? newAccumulator();
    const okAvg = item.okCount > 0 ? item.okSum / item.okCount : null;
    const batchAvg = item.batchCount > 0 ? item.batchSum / item.batchCount : null;

    const invocationsPerRequest = item.requests > 0 ? item.estInvocations / item.requests : null;
    const effectiveBatchSize = item.estInvocations > 0 ? item.requests / item.estInvocations : null;

    return {
      endpoint,
      requests: item.requests,
      errors: item.errors,
      errors_4xx: item.errors4xx,
      errors_5xx: item.errors5xx,
      errors_429: item.errors429,
      error_rate: item.requests > 0 ? item.errors / item.requests : 0,
      ok_count: item.okCount,
      avg: round(okAvg),
      min: round(item.okMin),
      max: round(item.okMax),
      p50: round(item.okQ.p50.value()),
      p90: round(item.okQ.p90.value()),
      p95: round(item.okQ.p95.value()),
      p99: round(item.okQ.p99.value()),
      batch_count: item.batchCount,
      batch_avg: round(batchAvg),
      batch_min: round(item.batchMin),
      batch_max: round(item.batchMax),
      batch_p50: round(item.batchQ.p50.value()),
      batch_p90: round(item.batchQ.p90.value()),
      batch_p95: round(item.batchQ.p95.value()),
      batch_p99: round(item.batchQ.p99.value()),
      est_lambda_invocations: round(item.estInvocations, 4),
      est_invocations_per_request: invocationsPerRequest != null && Number.isFinite(invocationsPerRequest) ? round(invocationsPerRequest, 6) : null,
      est_effective_batch_size: effectiveBatchSize != null && Number.isFinite(effectiveBatchSize) ? round(effectiveBatchSize, 6) : null,
      est_cost_pct_of_direct: null,
      duration_cost_proxy_ms: round(selectedDurationCostState(durationCostStates.get(endpoint))?.totalDurationCostProxyMs ?? null, 3),
      duration_cost_pct_of_standard: null,
    };
  });

  const baselineStandard = summaryRows.find((row) => row.endpoint === 'standard') ?? null;
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
      selectedDurationCostState(durationCostStates.get('standard'))?.stageDurationCostProxyMs.get(stage.index) ??
      null;
    for (const endpoint of normalizedEndpointOrder) {
      const cost = selectedDurationCostState(durationCostStates.get(endpoint))?.stageDurationCostProxyMs.get(stage.index);
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

  const requestSamples: RequestSample[] = [];
  const batchSamples: BatchSample[] = [];
  for (const endpoint of normalizedEndpointOrder) {
    const item = acc.get(endpoint);
    if (!item) continue;
    if (item.latencySamples.items.length > 0) {
      latencySamples.push(...item.latencySamples.items);
    }
    requestSamples.push(...item.requestSamples.items);
    batchSamples.push(
      ...collectBatchTimeSliceSamples(
        batchSamplers.get(endpoint) ?? newBatchTimeSliceSampler(sampleBatch, plannedDurationSeconds),
      ),
    );
  }

  // Keep deterministic-ish ordering for downstream chart logic.
  latencySamples.sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
  requestSamples.sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
  batchSamples.sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);

  const metrics: MetricsBundle = {
    endpoints: args.endpointOrder,
    stages: args.stages,
    executor: args.executor,
    mode: args.mode,
    stackName: args.stackName,
    maxDelayMs: args.maxDelayMs,
    run: null,
    latencySamples,
    requestSamples,
    batchSamples,
    summaryRows,
    stageDurationCostSeries,
  };

  return { metrics, endpointsSeen: [...endpointsSeen].sort() };
}
