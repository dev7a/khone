# Khone Docs

Khone is an HTTP microbatching gateway for AWS Lambda. It batches short-lived HTTP requests per
route/key and invokes target Lambda functions with one batched payload.

The current deployment model is Lambda Managed Instances (LMI), SAM zip packaging with
`rust-cargolambda`, a response-streaming Lambda Function URL, and an explicit user-owned gateway
function. The `KhoneGateway` macro only publishes the gateway config/spec artifact to S3.

Khone is most relevant when request grouping can reduce target Lambda work enough to justify an
extra gateway hop. It is not a replacement for API Gateway features such as auth, custom domains,
WAF, or durable workflow orchestration.

## Performance Snapshot

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/performance-cost/cost-estimate-summary-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/performance-cost/cost-estimate-summary-light.svg">
  <img alt="Estimated target invocation cost by endpoint, normalized to the standard endpoint" src="assets/performance-cost/cost-estimate-summary-light.svg">
</picture>

The public benchmark snapshot shows pct at 17.8% of the standard target-invocation cost estimate
in the high-traffic profile, with higher latency than direct invocation. Start with
[Performance and cost](explanation/performance-and-cost.md) before reading individual benchmark
reports.

## Start Here

- [Project scope](explanation/project-scope.md): understand what this branch does and does not
  provide.
- [Performance and cost](explanation/performance-and-cost.md): read the benchmark outcome,
  caveats, and public report links.
- [First LMI deployment](tutorials/first-lmi-deployment.md): deploy the bootstrap stack and demo
  gateway.
- [Deploy your own SAM gateway](how-to/deploy-your-own-sam-gateway.md): adapt the pattern for an
  application stack.
- [Configuration reference](reference/config.md): author `GatewayConfig`, `Spec`, and `x-khone`.
- [Architecture](explanation/architecture.md): understand the request, batching, and response flow.

## Reviewer Path

Read these pages in order to understand the scope of the current branch:

1. [Project scope](explanation/project-scope.md)
2. [Architecture](explanation/architecture.md)
3. [LMI runtime model](explanation/lmi-runtime-model.md)
4. [Bootstrap macro and config publisher](reference/bootstrap-macro.md)
5. [Performance and cost](explanation/performance-and-cost.md)
6. [Benchmarking methodology](explanation/benchmarking-methodology.md)

## Documentation Map

### Tutorials

- [First LMI deployment](tutorials/first-lmi-deployment.md)

### How-To Guides

- [Deploy your own SAM gateway](how-to/deploy-your-own-sam-gateway.md)
- [Deploy the demo stack](how-to/deploy-demo-stack.md)
- [Deploy the benchmark stack](how-to/deploy-benchmark-stack.md)
- [Run benchmarks](how-to/run-benchmarks.md)
- [Tune batching and timeouts](how-to/tune-batching.md)
- [Integrate Lambda handlers](how-to/integrate-handlers.md)
- [Use the Mode A layer proxy](how-to/use-mode-a-layer-proxy.md)

### Reference

- [Configuration](reference/config.md)
- [Batch and response protocol](reference/batch-and-response-protocol.md)
- [Interleaved streaming protocol](reference/interleaved-streaming-protocol.md)
- [Observability](reference/observability.md)
- [Bootstrap macro and config publisher](reference/bootstrap-macro.md)
- [SDK adapters](reference/sdk-adapters.md)
- [Benchmark CLI](reference/benchmark-cli.md)

### Explanation

- [Project scope](explanation/project-scope.md)
- [Performance and cost](explanation/performance-and-cost.md)
- [Architecture](explanation/architecture.md)
- [Integration modes](explanation/integration-modes.md)
- [LMI runtime model](explanation/lmi-runtime-model.md)
- [Benchmarking methodology](explanation/benchmarking-methodology.md)
- [Migration from App Runner-era assumptions](explanation/migration-from-apprunner.md)

## Status

Experimental. Interfaces may change while the LMI deployment model settles.
