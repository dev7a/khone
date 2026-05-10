# Configuration Reference

Gateway config is YAML with PascalCase top-level fields. The config publisher embeds the OpenAPI-ish
`Spec` into the same manifest consumed by `KHONE_CONFIG_URI`.

## Top-Level Fields

| Field | Default | Notes |
| --- | ---: | --- |
| `Spec` | `{ paths: {} }` | OpenAPI-ish route document. |
| `AwsRegion` | Lambda environment region | Optional Lambda client region override. |
| `MaxInflightInvocations` | `64` | Must be greater than zero. |
| `MaxInflightRequests` | `4096` | Must be greater than zero; exceeded requests return 429. |
| `MaxPendingInvocations` | `256` | Must be greater than zero; exceeded queued batches return 429. |
| `MaxQueueDepthPerKey` | `1000` | Must be greater than zero; per-key queue cap. |
| `IdleTtlMs` | `30000` | Idle batcher eviction time. |
| `DefaultTimeoutMs` | `2000` | Per-request fallback timeout. |
| `MaxBodyBytes` | `1048576` | Maximum accepted request body size. `0` is accepted. |
| `MaxInvokePayloadBytes` | `6291456` | Must be greater than zero; oversized batches are split when possible. |
| `ForwardHeaders` | forward all decodable headers except hop-by-hop | Optional allow/deny policy. |

Numeric fields may be written as numbers or strings.

## Header Forwarding

```yaml
ForwardHeaders:
  Allow:
    - x-tenant-id
    - authorization
  Deny:
    - x-internal-debug
```

If `Allow` is non-empty, only those request headers are forwarded to target Lambdas. `Deny` always
wins. Batch-key header dimensions are derived from the original request headers, so filtering a
header does not collapse isolation keys.

## Route Operations

Each operation is declared under `Spec.paths`:

```yaml
Spec:
  openapi: 3.0.0
  paths:
    /hello/{id}:
      get:
        operationId: getHello
        x-target-lambda: arn:aws:lambda:us-east-1:123456789012:function:hello
        x-khone:
          maxWaitMs: 25
          maxBatchSize: 8
          invokeMode: buffered
```

Supported HTTP methods are `get`, `post`, `put`, `delete`, `patch`, `head`, and `options`.

## `x-khone`

| Field | Required | Notes |
| --- | --- | --- |
| `maxWaitMs` | Yes | Maximum wait before flushing a batch. |
| `maxBatchSize` | Yes | Maximum requests per batch. |
| `key` | No | Extra batch-key dimensions such as `header:x-tenant-id` or `query:tenant`. |
| `timeoutMs` | No | Per-operation timeout override. |
| `invokeMode` | No | `buffered` by default; use `response_stream` for streaming target invocation. |
| `profiling` | No | Enables Lambda log tail profiling. Adds overhead. |
| `dynamicWait` | No | Rate-based adaptive wait policy. |
| `durationWait` | No | Probe-smoothed duration-based wait policy. |

## Dynamic Wait

`dynamicWait` derives a wait from observed request rate. Use it when traffic changes quickly and a
fixed `maxWaitMs` either over-waits at high traffic or under-batches at low traffic.

## Duration Wait

```yaml
durationWait:
  fraction: 0.5
  probeIntervalMs: 5000
  smoothingSamples: 5
  warmupProbes: 1
```

Duration wait uses single-request probes for each route/key, smooths the samples, and multiplies the
smoothed target duration by `fraction`. `maxWaitMs` remains the upper bound.
