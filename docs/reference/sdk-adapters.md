# SDK Adapters Reference

Adapters convert normal single-request handlers into batch handlers compatible with the gateway.

## Node Adapter

```javascript
const { batchAdapter } = require("khone-lambda-adapter");

exports.handler = batchAdapter(async function handler(event) {
  return { statusCode: 200, body: "ok" };
});
```

For response streaming:

```javascript
const { batchAdapterStream } = require("khone-lambda-adapter");
exports.handler = batchAdapterStream(handler);
```

Interleaved streaming is enabled with:

```javascript
exports.handler = batchAdapterStream(handler, { interleaved: true });
```

## Rust Adapter

```rust
use khone_lambda_adapter::{batch_adapter, HandlerResponse};
```

For response streaming:

```rust
use khone_lambda_adapter::batch_adapter_stream;
```

Interleaved Rust streaming uses `batch_adapter_stream(handler).with_interleaved(true)`.

## Response Mapping

- Each batch item becomes an API Gateway HTTP API v2 event.
- `requestContext.requestId` is the response correlation id.
- Handler errors become per-item 500 responses.
- `headers`, `cookies`, `body`, and `isBase64Encoded` follow the standard Lambda response shape.
