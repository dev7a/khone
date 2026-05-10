# Architecture

Khone is a Lambda Function URL router. It accepts HTTP requests, batches them
inside each LMI execution environment, invokes target Lambda functions once per batch, and
demultiplexes per-request responses back to clients.

```text
Client
  |
  | Lambda Function URL (RESPONSE_STREAM)
  v
Gateway Lambda on LMI
  |
  | in-memory batch per route/key
  v
Target Lambda invocation
  |
  v
Per-request responses
```

## Why The Gateway Owns Batching State

Batching needs short-lived shared state: queue membership, flush timers, request ids, and response
channels. LMI lets one Lambda execution environment serve many concurrent requests, so the Rust
gateway can keep that state in memory for the lifetime of the environment.

State is still per execution environment. Scale-out creates additional independent batchers.

## Request Flow

1. The Function URL invokes the gateway.
2. The gateway matches a compiled route from `Spec.paths`.
3. The request is queued by target Lambda, method, route template, and optional `x-khone.key`
   dimensions.
4. The queue flushes when `maxBatchSize` is reached, `maxWaitMs` expires, or an adaptive wait policy
   decides to flush.
5. The target Lambda returns buffered JSON or NDJSON response records.
6. The gateway maps each response id back to the waiting client request.

## Non-Goals

- Cross-route batching.
- Full API Gateway feature parity.
- Automatic request retries or deduplication.
- WebSockets or bidirectional protocols.
- Creating or managing LMI capacity providers.
