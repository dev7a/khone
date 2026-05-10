type ApiGatewayV2Event = {
  body?: string;
  isBase64Encoded?: boolean;
  rawPath?: string;
  pathParameters?: Record<string, string>;
  requestContext?: { requestId?: string; http?: { method?: string } };
  queryStringParameters?: Record<string, string>;
};

type ApiGatewayV2Response = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
};

type BackendPayload = {
  itemKey: string;
  seed: number;
  delayMs: number;
  pointCount: number;
  points: number[];
};

const DEFAULT_BACKEND_TIMEOUT_MS = 7_000;

function parseBackendTimeoutMs(): number {
  const raw = process.env.BENCHMARK_BACKEND_TIMEOUT_MS;
  if (raw == null) return DEFAULT_BACKEND_TIMEOUT_MS;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_BACKEND_TIMEOUT_MS;
  return Math.max(100, Math.min(90_000, n));
}

function backendBaseUrl(): string {
  const raw = process.env.BENCHMARK_BACKEND_URL;
  if (typeof raw !== "string" || raw.trim().length < 1) {
    throw new Error("BENCHMARK_BACKEND_URL is required");
  }
  return raw.trim();
}

function buildBackendItemUrl(itemKey: string): string {
  const url = new URL(backendBaseUrl());
  const basePath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${basePath}${encodeURIComponent(itemKey)}`;
  return url.toString();
}

function toNumberArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .map((v) => Math.round(v * 10) / 10);
}

function extractBackendPayload(raw: unknown): BackendPayload | null {
  const body = raw as {
    itemKey?: unknown;
    seed?: unknown;
    delayMs?: unknown;
    pointCount?: unknown;
    points?: unknown;
  };
  const itemKey = typeof body?.itemKey === "string" ? body.itemKey : "";
  const seed = Number(body?.seed);
  const delayMs = Number(body?.delayMs);
  const pointCount = Number(body?.pointCount);
  const points = toNumberArray(body?.points);
  if (!itemKey || points.length < 1) return null;
  return {
    itemKey,
    seed: Number.isFinite(seed) ? seed : 0,
    delayMs: Number.isFinite(delayMs) ? delayMs : 0,
    pointCount: Number.isFinite(pointCount) ? pointCount : points.length,
    points,
  };
}

async function invokeBackend(itemKey: string): Promise<{
  backendUrl: string;
  backendStatus: number;
  payload: BackendPayload | null;
}> {
  const backendUrl = buildBackendItemUrl(itemKey);
  const timeoutMs = parseBackendTimeoutMs();
  const response = await fetch(backendUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const backendStatus = response.status;
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Backend request failed (${backendStatus}): ${rawText.slice(0, 256)}`);
  }
  if (!rawText) {
    return { backendUrl, backendStatus, payload: null };
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = null;
  }
  return {
    backendUrl,
    backendStatus,
    payload: extractBackendPayload(parsed),
  };
}

function decodeBodyUtf8(event: ApiGatewayV2Event): string {
  const body = typeof event?.body === "string" ? event.body : "";
  if (!body) return "";
  if (event?.isBase64Encoded) return Buffer.from(body, "base64").toString("utf8");
  return body;
}

function parseItemKey(event: ApiGatewayV2Event): string {
  const pathParameters = event?.pathParameters ?? {};
  const fromParams = pathParameters?.id;
  if (typeof fromParams === "string" && fromParams.length > 0) {
    return fromParams;
  }

  const rawPath = typeof event?.rawPath === "string" ? event.rawPath : "";
  const parts = rawPath.split("/").filter((p) => p.length > 0);
  const last = parts.length > 0 ? parts[parts.length - 1] : "";
  return last || "hello";
}

export async function handler(event: ApiGatewayV2Event): Promise<ApiGatewayV2Response> {
  const requestId = event?.requestContext?.requestId ?? "";
  const method = event?.requestContext?.http?.method ?? "";
  const path = event?.rawPath ?? "";
  const itemKey = parseItemKey(event);

  const bodyUtf8 = decodeBodyUtf8(event);
  const { payload, backendStatus, backendUrl } = await invokeBackend(itemKey);

  const out = {
    ok: true,
    requestId,
    method,
    path,
    query: event?.queryStringParameters ?? {},
    itemKey,
    itemFound: payload != null,
    payload,
    backendStatus,
    backendUrl,
    bodyUtf8,
  };

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(out),
    isBase64Encoded: false,
  };
}
