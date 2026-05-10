type ApiGatewayV2Event = {
  rawPath?: string;
  pathParameters?: Record<string, string>;
  requestContext?: { requestId?: string };
};

type ApiGatewayV2Response = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
};

const DEFAULT_BASE_DELAY_MS = 80;
const DEFAULT_JITTER_MS = 80;
const DEFAULT_POINTS = 48;
const MAX_DELAY_MS = 10_000;
const MAX_POINTS = 512;

function parseEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  return Math.max(min, Math.min(max, rounded));
}

function parseItemKey(event: ApiGatewayV2Event): string {
  const fromParams = event?.pathParameters?.id;
  if (typeof fromParams === "string" && fromParams.length > 0) {
    return fromParams;
  }

  const rawPath = typeof event?.rawPath === "string" ? event.rawPath : "";
  const parts = rawPath.split("/").filter((p) => p.length > 0);
  const last = parts.length > 0 ? parts[parts.length - 1] : "";
  return last || "0";
}

function seedFromString(value: string): number {
  let hash = 2_169_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let z = Math.imul(t ^ (t >>> 15), t | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function generatePoints(random: () => number, pointCount: number): number[] {
  const phase = random() * Math.PI * 2;
  const amplitude = 0.18 + random() * 0.52;
  const trend = (random() - 0.5) * 0.35;
  const wobble = 0.35 + random() * 0.65;
  const points: number[] = [];
  for (let i = 0; i < pointCount; i += 1) {
    const t = i / Math.max(1, pointCount - 1);
    const waveA = Math.sin(t * Math.PI * 2 * wobble + phase) * amplitude;
    const waveB = Math.sin(t * Math.PI * 6 + phase / 2) * 0.08;
    const noise = (random() - 0.5) * 0.1;
    const value = clamp01(0.5 + waveA + waveB + trend * (t - 0.5) + noise);
    points.push(Math.round(value * 1000) / 10);
  }
  return points;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handler(event: ApiGatewayV2Event): Promise<ApiGatewayV2Response> {
  const itemKey = parseItemKey(event);
  const requestId = event?.requestContext?.requestId ?? "";
  const seed = seedFromString(itemKey);
  const random = mulberry32(seed);
  const baseDelayMs = parseEnvInt(
    "BENCHMARK_BACKEND_BASE_DELAY_MS",
    DEFAULT_BASE_DELAY_MS,
    0,
    MAX_DELAY_MS,
  );
  const jitterMs = parseEnvInt("BENCHMARK_BACKEND_JITTER_MS", DEFAULT_JITTER_MS, 0, MAX_DELAY_MS);
  const pointCount = parseEnvInt("BENCHMARK_BACKEND_POINTS", DEFAULT_POINTS, 8, MAX_POINTS);
  const delayMs = baseDelayMs + Math.floor(random() * (jitterMs + 1));

  await sleep(delayMs);
  const points = generatePoints(random, pointCount);

  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify({
      ok: true,
      requestId,
      itemKey,
      seed,
      delayMs,
      pointCount,
      points,
    }),
    isBase64Encoded: false,
  };
}
