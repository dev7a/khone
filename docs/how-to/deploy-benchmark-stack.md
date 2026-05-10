# Deploy The Benchmark Stack

The benchmark stack deploys a dedicated LMI gateway, two Mode A target handlers, a standard
API Gateway HTTP API baseline, and a shared backend Lambda URL workload.

## Prerequisites

- Bootstrap stack deployed with `make bootstrap-deploy`.
- Existing LMI capacity provider ARN.
- SAM CLI, Rust, `cargo-lambda`, and `SAM_CLI_BETA_RUST_CARGO_LAMBDA=1`.

## Deploy

```bash
make deploy-benchmark GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

Override target handler memory when comparing CPU/memory effects:

```bash
make benchmark-sam-deploy \
  GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:... \
  BENCHMARK_HANDLER_MEMORY_SIZE=512
```

## Outputs Used By Benchmark Tooling

- `BenchmarkTargetsJson`: preferred explicit list of benchmark endpoints.
- `BenchmarkEndpointsCsv`: optional endpoint name list.
- `MuxUrl`, `PctUrl`, and `StandardUrl`: endpoint outputs.
- `BenchmarkBackendUrl`: backend workload URL.
- `GatewayFunctionUrl`: gateway Function URL.

These outputs are consumed by the `benchviz` CLI.

## Cost-Relevant Metrics

The stack publishes CloudWatch Logs metric filters for Lambda `platform.report` events:

- `MUXBilledDurationMs`
- `PCTBilledDurationMs`
- `STDBilledDurationMs`

Gateway EMF metrics can also be enabled with `EmfMetricsEnabled=true`.
