# Benchmark Stack

This SAM stack deploys the dedicated benchmark environment:

- LMI Rust gateway with a response-streaming Function URL.
- Config artifact resource expanded by the `KhoneGateway` macro.
- Mode A Node target functions for `mux` and `pct`.
- Standard API Gateway HTTP API baseline.
- Shared backend Lambda URL workload.

See [Deploy the benchmark stack](../../docs/how-to/deploy-benchmark-stack.md) for deployment steps
and [Run benchmarks](../../docs/how-to/run-benchmarks.md) for `benchviz` usage.
