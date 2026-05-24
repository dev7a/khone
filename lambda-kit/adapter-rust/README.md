# Rust Adapter

`batch_adapter(handler)` converts a single-request Rust handler into a batch handler compatible with
Khone. `batch_adapter_stream(handler)` emits NDJSON response records for
`invokeMode: response_stream`.

See [Adapters](../../docs/integrate/adapters.md) and
[SDK adapters](../../docs/reference/sdk-adapters.md).
