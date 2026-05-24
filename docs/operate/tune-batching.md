---
title: Tune batching
description: Tune Khone wait windows, batch sizes, timeouts, tenant keys, and payload limits per route.
---

# Tune batching

Tune one route at a time. Record the workload, target memory, backend delay, `maxWaitMs`,
`maxBatchSize`, and whether the route uses steady, adaptive, or target-aware batching.

## Start with conservative bounds

- Use `maxWaitMs` between 5 and 25 ms for latency-sensitive routes.
- Use `maxBatchSize` between 4 and 16 for simple handlers.
- Keep `maxWaitMs` below client timeouts.
- Set `timeoutMs` per route and `DefaultTimeoutMs` as the fallback.

```yaml
paths:
  /v1/search:
    get:
      x-target-lambda: arn:aws:lambda:us-east-1:123456789012:function:search
      x-khone:
        maxWaitMs: 10
        maxBatchSize: 8
        invokeMode: buffered
        timeoutMs: 900
```

## Isolate tenants or auth contexts

Use `x-khone.key` when requests must not be co-batched together.

```yaml
x-khone:
  maxWaitMs: 20
  maxBatchSize: 4
  key:
    - header:x-tenant-id
```

Batch keys are derived from the original request headers. Header forwarding controls what target
functions receive, not how isolation keys are read.

## Use target-aware waits for slow or variable targets

`durationWait` is the YAML field for target-aware batching. It uses periodically refreshed
single-request probes, smooths the observed target duration, and derives the wait window from that
smoothed value.

```yaml
x-khone:
  maxWaitMs: 2000
  maxBatchSize: 16
  durationWait:
    fraction: 0.5
    probeIntervalMs: 5000
    smoothingSamples: 5
    warmupProbes: 1
```

The gateway starts from the minimum wait path and updates duration-derived waits after probe samples
are available.

## Watch payload size

`MaxInvokePayloadBytes` defaults to 6 MiB. Keep request bodies small enough for batch payloads to fit
the Lambda invoke limit. A single request that cannot fit fails.

See [Configuration](../reference/configuration.md) for every batching field and default.
