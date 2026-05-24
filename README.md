# Khone

Khone is an HTTP microbatching gateway for AWS Lambda.

It buffers requests by route and batching dimensions for a few milliseconds, invokes target Lambda
functions with batched payloads, and routes each per-request response back to the original caller.
This gives you a configurable latency-vs-cost dial: small bounded delays can reduce invocation count
and improve Lambda utilization under load.

The name Khone comes from Ancient Greek χώνη / χοάνη, meaning "funnel." Khone is pronounced
roughly **KOH-nay**.

The gateway runs as a Rust Lambda function on Lambda Managed Instances (LMI). It keeps batching
state in memory for each Lambda execution environment and uses Function URL response streaming for
client-facing responses.

## Why It Exists

Khone is for workloads where many short Lambda requests can be grouped without breaking the caller's
HTTP semantics. It is strongest for I/O-bound handlers that spend much of their time waiting on
databases, APIs, or other backend responses: batching lets one warm execution context hold multiple
in-flight items and share setup or data loading while those waits happen.

It is a weaker fit for CPU-bound handlers where each item spends most of its time consuming CPU. In
that case, grouping work into one invocation does not create useful wait states to hide, and the
gateway still adds a small amount of routing and batching latency.

It is not a general API Gateway replacement. It does not manage auth, DNS, WAF, or LMI capacity
providers; public deployments are usually best placed behind CloudFront. See
[When Khone helps](docs/start/when-khone-helps.md) for the full boundary.

## Performance and Cost Snapshot

The public benchmark snapshot compares four endpoints:

- `standard`: API Gateway HTTP API plus Lambda baseline handler, with one backend request per
  client request.
- `steady`: Mode A proxy-layer route with a fixed bounded wait.
- `adaptive`: Mode A proxy-layer route that adjusts wait time from observed request rate.
- `target-aware`: Mode A proxy-layer route that waits longer when duration probes indicate batching
  can reduce target invocation work.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/performance-cost/cost-estimate-summary-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/performance-cost/cost-estimate-summary-light.svg">
  <img alt="Estimated target invocation cost by endpoint, normalized to the standard endpoint" src="docs/assets/performance-cost/cost-estimate-summary-light.svg">
</picture>

The public runs used 256 MB target-function memory. The LMI gateway capacity provider was
configured with m8g instances and a minimum of four execution environments. Each target Lambda calls
a backend Lambda URL that simulates downstream response latency with an 80 ms base delay plus up to
80 ms of item-key-seeded jitter.

At that configuration, target-aware batching produced the lowest estimated target invocation cost in
the curated public runs: 45.1% of the standard baseline in the low-traffic profile and 17.7% in the
high-traffic profile. Steady batching reached 65.4% and 32.4%; adaptive reached 85.1% and 36.2%.
These projections cover target Lambda invocation work, not the full AWS bill.

The generated benchmark chart below is the high-traffic round 2 public report. It shows sampled
latency over time, per-stage cost bars, and heatmap summaries.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="benchmark-results-public/high-256mb-min4-50-100-150-round2/charts/dark/latency-distribution.png">
  <source media="(prefers-color-scheme: light)" srcset="benchmark-results-public/high-256mb-min4-50-100-150-round2/charts/light/latency-distribution.png">
  <img alt="High traffic benchmark latency distribution and stage cost by endpoint" src="benchmark-results-public/high-256mb-min4-50-100-150-round2/charts/light/latency-distribution.png">
</picture>

The standard endpoint had the lowest P95 latency in these runs. Khone's value is the
cost/throughput tradeoff, not minimum single-request latency. See
[Benchmark results](docs/benchmarks/results.md) for the exact scenario metadata,
caveats, and links to the sanitized reports.

## Current Deployment Model

- The `KhoneGateway` macro publishes the gateway config/spec artifact to S3.
- User templates define the gateway as an explicit `AWS::Serverless::Function`.
- The gateway reads `KHONE_CONFIG_URI` from `!GetAtt <GatewayConfig>.ConfigS3Uri`.
- SAM `CapacityProviderConfig` attaches an existing LMI capacity provider.
- `FunctionUrlConfig.InvokeMode: RESPONSE_STREAM` exposes the HTTP interface.

Deployment resources stay explicit in your SAM template; the macro is only responsible for the
gateway config artifact.

## Quick Start

```bash
make bootstrap-deploy
make examples-sam-deploy GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

`examples-sam-deploy` defaults to the Node adapter, Mode B template. Set
`EXAMPLE_TEMPLATE` to `adapter-node`, `adapter-rust`, `layer-proxy-node`,
`layer-proxy-python`, or `native-batch-node` to deploy a specific example.

SAM Rust builds require `cargo-lambda` and `SAM_CLI_BETA_RUST_CARGO_LAMBDA=1`.

## Documentation

Start with [the public docs](docs/index.md):

- [When Khone helps](docs/start/when-khone-helps.md)
- [Quickstart](docs/start/quickstart.md)
- [LMI deployment model](docs/deploy/lmi-deployment-model.md)
- [SAM gateway](docs/deploy/sam-gateway.md)
- [Choose an integration mode](docs/integrate/choose-mode.md)
- [Tune batching](docs/operate/tune-batching.md)
- [Configuration reference](docs/reference/configuration.md)
- [Benchmark results](docs/benchmarks/results.md)

## Repository Layout

- `gateway/`: Rust Axum/Lambda gateway.
- `bootstrap/`: config publisher, macro, and shared Mode A layer.
- `lambda-kit/`: Node and Rust adapters for target Lambdas.
- `examples/sam/`: individually deployable SAM examples by integration and language.
- `benchmark/`: benchmark stack, k6 runner, and report tooling.
- `docs/`: public documentation.

## Status

Experimental. Interfaces may change.
