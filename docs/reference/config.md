# Configuration reference

Gateway config is YAML with PascalCase top-level fields. The config publisher embeds the OpenAPI-ish
`Spec` into the same manifest consumed by the gateway via `KHONE_CONFIG_URI`.

## Top-level fields

| Field | Type | Default | Notes |
| --- | --- | ---: | --- |
| `Spec` | object | required | OpenAPI-ish route document. Startup fails if it is missing. |
| `AwsRegion` | string | Lambda environment region | Optional Lambda client region override. |
| `MaxInflightInvocations` | usize | `64` | Must be greater than zero. |
| `MaxInflightRequests` | usize | `4096` | Must be greater than zero; exceeded requests return 429. |
| `MaxPendingInvocations` | usize | `256` | Must be greater than zero; exceeded queued batches return 429. |
| `MaxQueueDepthPerKey` | usize | `1000` | Must be greater than zero; per-key queue cap. |
| `IdleTtlMs` | u64 (ms) | `30000` | Idle batcher eviction time. |
| `DefaultTimeoutMs` | u64 (ms) | `2000` | Per-request fallback timeout (used when an operation does not set `x-khone.timeoutMs`). |
| `MaxBodyBytes` | usize (bytes) | `1048576` | Maximum accepted request body size. `0` is accepted and rejects every non-empty body. |
| `MaxInvokePayloadBytes` | usize (bytes) | `6291456` | Must be greater than zero; oversized batches are split into multiple invocations when possible. A single request that exceeds this limit fails. |
| `ForwardHeaders` | object | forward all decodable headers except hop-by-hop | Optional allow/deny policy. |

Numeric fields and the boolean `profiling` may be written as numbers/booleans or as strings.

The gateway reads the manifest at startup from the `KHONE_CONFIG_URI` environment variable
(`s3://<bucket>/<key>`). The macro exposes the `ConfigS3Uri` attribute so that application templates
can set it as `KHONE_CONFIG_URI` on the gateway function; see [Bootstrap macro and config
publisher](bootstrap-macro.md).

## Header forwarding

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

## Route operations

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
`x-target-lambda` must be a Lambda function ARN. Paths use `{name}` placeholders.

## `x-khone`

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `maxWaitMs` | u64 (ms) | Yes | — | Maximum time the gateway holds a batch open. |
| `maxBatchSize` | usize | Yes | — | Maximum requests per batch. Must be greater than zero. |
| `key` | string[] | No | `[]` | Extra batch-key dimensions. Supported forms: `header:<name>` and `query:<name>`. The literals `method`, `route`, `lambda`, `target_lambda`, `target-lambda` are accepted and silently ignored (the gateway always keys by these). |
| `timeoutMs` | u64 (ms) | No | `DefaultTimeoutMs` | Per-operation timeout override. |
| `invokeMode` | enum | No | `buffered` | One of `buffered` or `response_stream`. |
| `profiling` | bool | No | `false` | Enables Lambda log-tail profiling (extracts the `REPORT` line for billed duration, init duration, etc.). Adds overhead. |
| `dynamicWait` | object | No | absent | Rate-based adaptive wait policy. Mutually exclusive with `durationWait`. |
| `durationWait` | object | No | absent | Probe-smoothed duration-based wait policy. Mutually exclusive with `dynamicWait`. |

The gateway always partitions batches by `(target_lambda, method, route_template, invokeMode,
profiling)`; any `key` entries add further partitions on top.

## Dynamic wait

`dynamicWait` derives a per-batch flush window from observed request rate using a sigmoid centered
on `targetRps`. Use it when traffic changes quickly and a fixed `maxWaitMs` either over-waits at low
traffic or under-batches at high traffic.

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `minWaitMs` | u64 (ms) | Yes | — | Floor of the computed window. Must be `<= maxWaitMs`. |
| `targetRps` | f64 | No | `50.0` | Request rate where the sigmoid is centered. Must be finite and non-negative. |
| `steepness` | f64 | No | `0.01` | Sigmoid steepness around `targetRps`. Must be finite and greater than zero. |
| `samplingIntervalMs` | u64 (ms) | No | `100` | Sampling period for request counts. Must be greater than zero. |
| `smoothingSamples` | usize | No | `10` | Moving-average window size. Must be greater than zero. |

```yaml
dynamicWait:
  minWaitMs: 5
  targetRps: 50
  steepness: 0.01
  samplingIntervalMs: 100
  smoothingSamples: 10
```

## Duration wait

`durationWait` uses single-request probe invocations per batch key, smooths the observed durations,
and sets the per-batch flush window from `fraction` of the smoothed target duration. `maxWaitMs`
remains the upper bound. Probes avoid the positive feedback loop that would result from measuring
batched durations.

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `fraction` | f64 | Yes | — | Multiplier applied to the smoothed probe duration. Must be finite and non-negative. |
| `minWaitMs` | u64 (ms) | No | `0` | Floor of the computed window. Must be `<= maxWaitMs`. |
| `probeIntervalMs` | u64 (ms) | No | `30000` | How often to schedule a single-request probe flush per batch key. Must be greater than zero. |
| `probeJitterMs` | u64 (ms) | No | `1000` | Stable per-batch-key jitter applied to the probe schedule. |
| `smoothingSamples` | usize | No | `10` | Moving-average window size over probe samples. Must be greater than zero. |
| `warmupProbes` | usize | No | `1` | Number of scheduled probe samples required before using duration-derived waits. Must be greater than zero. |

```yaml
durationWait:
  fraction: 0.5
  probeIntervalMs: 30000
  smoothingSamples: 10
  warmupProbes: 1
```
