# Node Adapter

`batchAdapter(handler)` converts a single-request Node handler into a batch handler compatible with
Khone. `batchAdapterStream(handler)` emits NDJSON response records for
`invokeMode: response_stream`.

See [Adapters](../../docs/integrate/adapters.md) and
[SDK adapters](../../docs/reference/sdk-adapters.md).
