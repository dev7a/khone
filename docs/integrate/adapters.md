---
title: Adapters
description: Wrap normal Node and Rust Lambda handlers so they can receive Khone batched requests.
---

# Adapters

Adapters, Mode B, wrap a single-request handler and map each batch item into a normal API Gateway
HTTP API v2 event. Use adapters for most new or modifiable handlers.

## Node buffered handler

```javascript
const { batchAdapter } = require("khone-lambda-adapter");

exports.handler = batchAdapter(async function handler(event) {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
});
```

## Rust buffered handler

```rust
use std::convert::Infallible;

use aws_lambda_events::event::apigw::ApiGatewayV2httpRequest;
use khone_lambda_adapter::{batch_adapter, BatchRequestEvent, HandlerResponse};

async fn handler(
    _event: ApiGatewayV2httpRequest,
    _ctx: &lambda_runtime::Context,
) -> Result<HandlerResponse, Infallible> {
    Ok(HandlerResponse::text(200, "ok"))
}

async fn entrypoint(
    event: BatchRequestEvent<ApiGatewayV2httpRequest>,
    ctx: &lambda_runtime::Context,
) -> Result<serde_json::Value, lambda_runtime::Error> {
    let adapter = batch_adapter(handler);
    let response = adapter.handle(event, ctx).await;
    Ok(serde_json::to_value(response)?)
}
```

The Node package is `khone-lambda-adapter`; the Rust crate is `khone-lambda-adapter` (depend via git
or path until publication). Both default `concurrency` to `16`; override with `{ concurrency }` in
Node or `.with_concurrency(...)` in Rust.

## Response streaming

Routes with `invokeMode: response_stream` expect NDJSON response records. The adapters provide
streaming helpers:

```javascript
const { batchAdapterStream } = require("khone-lambda-adapter");
exports.handler = batchAdapterStream(handler);
```

```rust
use khone_lambda_adapter::batch_adapter_stream;

let adapter = batch_adapter_stream(handler);
```

Enable interleaved per-request chunk streaming with `{ interleaved: true }` in Node or
`.with_interleaved(true)` in Rust. See the [Streaming protocol](../reference/streaming-protocol.md)
for the wire shape.

## Read next

- Use [Native batch](native-batch.md) when the handler should see the whole batch.
- Use [Layer proxy](layer-proxy.md) only when target code cannot change.
- Look up exact APIs in [SDK adapters](../reference/sdk-adapters.md).
