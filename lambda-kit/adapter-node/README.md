# Node Adapter

`batchAdapter(handler)` converts a single-request Node handler into a batch handler compatible with
Khone. `batchAdapterStream(handler)` emits NDJSON response records for
`invokeMode: response_stream`.

See [Integrate Lambda handlers](../../docs/how-to/integrate-handlers.md) and
[SDK adapters reference](../../docs/reference/sdk-adapters.md).
