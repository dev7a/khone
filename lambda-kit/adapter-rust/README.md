# Rust Adapter

`batch_adapter(handler)` converts a single-request Rust handler into a batch handler compatible with
Khone. `batch_adapter_stream(handler)` emits NDJSON response records for
`invokeMode: response_stream`.

See [Integrate Lambda handlers](../../docs/how-to/integrate-handlers.md) and
[SDK adapters reference](../../docs/reference/sdk-adapters.md).
