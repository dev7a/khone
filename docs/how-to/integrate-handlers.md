# Integrate Lambda Handlers

Khone supports three target Lambda integration modes.

## Use Mode B Adapters For Most Handlers

Mode B wraps a single-request handler and maps each batch item into a normal API Gateway HTTP API
v2 event.

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
use khone_lambda_adapter::{batch_adapter, HandlerResponse};

async fn handler(
    _event: ApiGatewayV2httpRequest,
    _ctx: &lambda_runtime::Context,
) -> Result<HandlerResponse, Infallible> {
    Ok(HandlerResponse::text(200, "ok"))
}
```

## Use Response Streaming When Early Return Matters

Routes with `invokeMode: response_stream` expect NDJSON response records. The adapters provide
streaming helpers:

```javascript
const { batchAdapterStream } = require("khone-lambda-adapter");
exports.handler = batchAdapterStream(handler);
```

```rust
use khone_lambda_adapter::batch_adapter_stream;
```

## Use Mode C For Custom Batch Handling

Mode C handlers receive `event.batch` directly and return the gateway protocol documented in
[Batch and response protocol](../reference/batch-and-response-protocol.md).

Use Mode C when the handler needs custom fan-out, shared work across items, or a response shape the
adapters do not cover.
