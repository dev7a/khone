---
title: Architecture
description: How Khone accepts HTTP, batches inside each LMI execution environment, invokes target Lambdas, and demultiplexes responses.
---

# Architecture

Khone is a Lambda Function URL router. It accepts HTTP requests, batches them inside each LMI
execution environment, invokes target Lambda functions with batched payloads, and demultiplexes
per-request responses back to clients. A normal flushed batch maps to one target invocation; if the
serialized payload would exceed `MaxInvokePayloadBytes`, the gateway splits it into smaller
invocations.

```text
Client
  │
  │ Lambda Function URL · RESPONSE_STREAM
  ▼
Gateway Lambda on LMI
  │
  │ in-memory batch per target/method/route/mode/key
  ▼
Target Lambda invocation(s)
  │
  ▼
Per-request responses ──→ demultiplex ──→ Client
```

## Why the gateway owns batching state

Batching needs short-lived shared state: queue membership, flush timers, request ids, and response
channels. LMI lets one Lambda execution environment serve many concurrent requests, so the Rust
gateway can keep that state in memory for the lifetime of the environment.

State is still **per execution environment**. Scale-out creates additional independent batchers;
deployments, scaling changes, failures, or Lambda lifecycle decisions can replace an environment at
any time.

> Treat batching state as opportunistic. Public benchmarks separate first-round scale behavior from
> steady-state behavior precisely because environments come and go.

## Request flow

1. The Function URL invokes the gateway.
2. The gateway matches a compiled route from `Spec.paths`.
3. The request is queued by target Lambda, method, route template, invoke mode, profiling setting,
   and optional `x-khone.key` dimensions.
4. The queue flushes when `maxBatchSize` is reached, `maxWaitMs` expires, or `dynamicWait` or
   `durationWait` chooses an earlier flush window.
5. The target Lambda returns buffered JSON or NDJSON response records. Oversized flushed batches can
   be split into multiple target invocations before this step.
6. The gateway maps each response id back to the waiting client request.

## Integration modes

Khone targets three handler shapes. The mode you pick determines how much of the batch protocol your
Lambda code sees.

| Mode | Name | Code changes | Best fit |
| --- | --- | --- | --- |
| A | Layer proxy | None | Existing handlers that cannot change. |
| B | Adapter | Small wrapper | Most new or modifiable handlers. |
| C | Native batch | Full control | Custom batch processing or shared work. |

## Non-goals

- Cross-route batching.
- Full API Gateway feature parity, including auth, custom domains, WAF, and edge caching.
- Automatic request retries or deduplication.
- WebSockets or bidirectional protocols.
- Creating or managing LMI capacity providers.

## Config shape

The `KhoneGateway` macro publishes a small spec to S3. The target Lambda ARN is declared on each
operation with `x-target-lambda`; per-route batching configuration lives under `x-khone` and is read
by the gateway at startup.

```yaml
Spec:
  openapi: 3.0.0
  paths:
    /items/{id}:
      get:
        operationId: getItem
        x-target-lambda: arn:aws:lambda:us-east-1:123456789012:function:items
        x-khone:
          maxBatchSize: 16
          maxWaitMs: 35
          key:
            - header:x-tenant-id
          dynamicWait:
            minWaitMs: 5
            targetRps: 50
```

## Read Next

- [LMI runtime model](lmi-runtime-model.md): why environment lifetime matters here.
- [Performance and cost](performance-and-cost.md): what the benchmark numbers actually mean.
- [Configuration reference](../reference/config.md): the full `Spec` and `x-khone` surface.
