# Khone

Khone is an HTTP microbatching gateway for AWS Lambda.

It buffers requests per route for a few milliseconds, invokes Lambda with a single batched payload,
and routes each per-request response back to the original caller. This gives you a configurable
latency-vs-cost dial: small bounded delays can reduce invocation count and improve Lambda
utilization under load.

The name Khone comes from Ancient Greek χώνη / χοάνη, meaning "funnel." Khone is pronounced
roughly **KOH-nay**.

The gateway runs as a Rust Lambda function on Lambda Managed Instances (LMI). It keeps batching
state in memory for each Lambda execution environment and uses Function URL response streaming for
client-facing responses.

## Why It Exists

Khone is for workloads where many short Lambda requests can be grouped without breaking the caller's
HTTP semantics. The gateway adds a small amount of routing and batching latency, but can reduce the
number of target Lambda invocations and the amount of downstream work.

It is not a general API Gateway replacement. It does not manage auth, DNS, WAF, durable workflow
state, or LMI capacity providers. See [Project scope](docs/explanation/project-scope.md) for the
full boundary.

## Performance and Cost Snapshot

The public benchmark snapshot compares three endpoints:

- `standard`: API Gateway HTTP API directly invoking the target Lambda.
- `mux`: fixed-wait Khone batching.
- `pct`: duration-aware Khone batching that waits longer when batching is expected to save cost.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/performance-cost/cost-estimate-summary-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/performance-cost/cost-estimate-summary-light.svg">
  <img alt="Estimated target invocation cost by endpoint, normalized to the standard endpoint" src="docs/assets/performance-cost/cost-estimate-summary-light.svg">
</picture>

At 256 MB target-function memory, pct produced the lowest estimated target invocation cost in the
curated public runs: 45.7% of the standard baseline in the low-traffic profile and 17.8% in the
high-traffic profile. Mux reached 85.3% and 36.4% respectively. These projections cover target
Lambda invocation work, not the full AWS bill.

The generated benchmark chart below is the high-traffic round 2 public report. It shows sampled
latency over time, per-stage cost bars, and heatmap summaries.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="benchmark-results-public/high-256mb-min4-50-100-150-round2/charts/dark/latency-distribution.png">
  <source media="(prefers-color-scheme: light)" srcset="benchmark-results-public/high-256mb-min4-50-100-150-round2/charts/light/latency-distribution.png">
  <img alt="High traffic benchmark latency distribution and stage cost by endpoint" src="benchmark-results-public/high-256mb-min4-50-100-150-round2/charts/light/latency-distribution.png">
</picture>

The standard endpoint had the lowest P95 latency in these runs. Khone's value is the
cost/throughput tradeoff, not minimum single-request latency. See
[Performance and cost](docs/explanation/performance-and-cost.md) for the exact scenario metadata,
caveats, and links to the sanitized reports.

## Current Deployment Model

- The `KhoneGateway` macro publishes the gateway config/spec artifact to S3.
- User templates define the gateway as an explicit `AWS::Serverless::Function`.
- The gateway reads `KHONE_CONFIG_URI` from `!GetAtt <GatewayConfig>.ConfigS3Uri`.
- SAM `CapacityProviderConfig` attaches an existing LMI capacity provider.
- `FunctionUrlConfig.InvokeMode: RESPONSE_STREAM` exposes the HTTP interface.

The macro no longer creates App Runner resources, container images, gateway IAM roles, or release
automation.

## Quick Start

```bash
make bootstrap-deploy
make examples-sam-deploy GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

SAM Rust builds require `cargo-lambda` and `SAM_CLI_BETA_RUST_CARGO_LAMBDA=1`.

## Documentation

Start with [the public docs](docs/index.md):

- [Project scope](docs/explanation/project-scope.md)
- [Performance and cost](docs/explanation/performance-and-cost.md)
- [First LMI deployment](docs/tutorials/first-lmi-deployment.md)
- [Deploy your own SAM gateway](docs/how-to/deploy-your-own-sam-gateway.md)
- [Configuration reference](docs/reference/config.md)
- [Architecture](docs/explanation/architecture.md)
- [Benchmarking methodology](docs/explanation/benchmarking-methodology.md)

For a reviewer, the shortest useful path is: scope, architecture, LMI runtime model, bootstrap
macro reference, performance and cost, then benchmark methodology.

## Repository Layout

- `gateway/`: Rust Axum/Lambda gateway.
- `bootstrap/`: config publisher, macro, and shared Mode A layer.
- `lambda-kit/`: Node and Rust adapters for target Lambdas.
- `examples/sam/`: demo LMI deployment.
- `benchmark/`: benchmark stack, k6 runner, and report tooling.
- `docs/`: public documentation.

## Status

Experimental. Interfaces may change.
