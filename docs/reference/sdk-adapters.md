# SDK adapters reference

Adapters convert normal single-request handlers into batch handlers compatible with the gateway.
Two adapters are available: Node (`khone-lambda-adapter`) and Rust (`khone-lambda-adapter`).

## Node adapter

Package: `khone-lambda-adapter` (CommonJS; `main: dist/index.js`).

### Buffered

```javascript
const { batchAdapter } = require("khone-lambda-adapter");

exports.handler = batchAdapter(async function handler(event) {
  return { statusCode: 200, body: "ok" };
});
```

`batchAdapter(handler, options?)` accepts an `options` object:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `concurrency` | number | `16` | Maximum concurrent in-flight handler invocations across the batch. |

### Streaming

```javascript
const { batchAdapterStream } = require("khone-lambda-adapter");

exports.handler = batchAdapterStream(handler);
```

Interleaved streaming is enabled with:

```javascript
exports.handler = batchAdapterStream(handler, { interleaved: true });
```

`batchAdapterStream(handler, options?)` options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `concurrency` | number | `16` | Maximum concurrent in-flight handler invocations. |
| `interleaved` | boolean | `false` | Emit `head`/`chunk`/`end`/`error` records per request. |
| `streamifyResponse` | function | `globalThis.awslambda.streamifyResponse` | Override the runtime streaming wrapper. |

Streaming requires `awslambda.streamifyResponse` from the AWS managed Node.js runtime, or an
explicit `streamifyResponse` override. The adapter throws if neither is available.

## Rust adapter

Crate: `khone-lambda-adapter` (`publish = false`; depend via git or path).

### Buffered

```rust
use khone_lambda_adapter::{batch_adapter, HandlerResponse};

let adapter = batch_adapter(handler).with_concurrency(16);
let response = adapter.handle(event, &ctx).await;
```

`batch_adapter(handler)` returns a `BatchAdapter` with:

- `.with_concurrency(usize)` — defaults to `16`.

### Streaming

```rust
use khone_lambda_adapter::batch_adapter_stream;

let adapter = batch_adapter_stream(handler).with_interleaved(true);
```

`batch_adapter_stream(handler)` returns a `BatchAdapterStream` with:

- `.with_concurrency(usize)` — defaults to `16`.
- `.with_interleaved(bool)` — defaults to `false`.

## Response mapping

- Each batch item becomes an API Gateway HTTP API v2 event.
- `requestContext.requestId` is the response correlation id.
- Handler errors become per-item `500` responses with `content-type: text/plain` and `internal
  error` as the body.
- `headers`, `cookies`, `body`, and `isBase64Encoded` follow the standard Lambda response shape.
- The Rust adapter clamps `statusCode == 0` to `200` for safety.
