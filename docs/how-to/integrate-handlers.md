# Integrate Lambda handlers

Khone supports three target Lambda integrations.

## Use adapters, Mode B, for most handlers

Adapters, Mode B, wrap a single-request handler and map each batch item into a normal API Gateway
HTTP API v2 event.

Node:

```javascript
const { batchAdapter } = require("khone-lambda-adapter");

exports.handler = batchAdapter(async function handler(event) {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
});
```

Rust:

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

The Node package is `khone-lambda-adapter`; the Rust crate is `khone-lambda-adapter` (depend via
git or path until publication). Both default `concurrency` to `16`; override with
`{ concurrency }` or `.with_concurrency(...)`.

## Use response streaming when early return matters

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

Enable interleaved per-request chunk streaming with `{ interleaved: true }` (Node) or
`.with_interleaved(true)` (Rust). See [Interleaved streaming protocol](../reference/interleaved-streaming-protocol.md).

## Use native batch, Mode C, for custom batch handling

Native batch handlers, Mode C, receive `event.batch` directly and return the gateway protocol
documented in [Batch and response protocol](../reference/batch-and-response-protocol.md).

Use native batch when the handler needs custom fan-out, shared work across items, or a response
shape the adapters do not cover.
