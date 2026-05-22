# Khone docs

Khone is an HTTP microbatching gateway for AWS Lambda. It batches short-lived HTTP requests by
route, target, invoke mode, profiling setting, and optional key dimensions, then invokes target
Lambda functions with batched payloads. Batches that exceed the invoke payload limit are split
before invocation when possible.

The current deployment model is Lambda Managed Instances (LMI), SAM zip packaging with
`rust-cargolambda`, a response-streaming Lambda Function URL, and an explicit user-owned gateway
function. The `KhoneGateway` macro only publishes the gateway config/spec artifact to S3.

Khone is worth using when request grouping reduces target Lambda work enough to justify the extra
gateway hop. It helps most with I/O-bound Lambda handlers that spend much of their time waiting on
backend responses; CPU-bound handlers are less likely to benefit because batching does not add CPU
capacity or create wait states to hide. It is not a replacement for API Gateway features like auth,
custom domains, or WAF; public deployments are usually best placed behind CloudFront.

## Performance snapshot

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/performance-cost/cost-estimate-summary-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/performance-cost/cost-estimate-summary-light.svg">
  <img alt="Estimated target invocation cost by endpoint, normalized to the standard endpoint" src="assets/performance-cost/cost-estimate-summary-light.svg">
</picture>

The public benchmark snapshot used 256 MB target Lambdas, an LMI capacity provider configured with
m8g instances, and a backend Lambda that simulates delayed downstream responses. It shows
target-aware batching at 17.7% of the standard target-invocation cost estimate in the high-traffic
profile, with higher latency than direct invocation. Start with
[Performance and cost](explanation/performance-and-cost.md) before reading individual benchmark
reports.

## Start here

- [Project scope](explanation/project-scope.md): understand what this project does and does not
  provide.
- [Performance and cost](explanation/performance-and-cost.md): read the benchmark outcome,
  caveats, and public report links.
- [First LMI deployment](tutorials/first-lmi-deployment.md): deploy the bootstrap stack and demo
  gateway.
- [Deploy your own SAM gateway](how-to/deploy-your-own-sam-gateway.md): adapt the pattern for an
  application stack.
- [Configuration reference](reference/config.md): author `GatewayConfig`, `Spec`, and `x-khone`.
- [Architecture](explanation/architecture.md): understand the request, batching, and response flow.

## Reviewer path

Read these pages in this order to understand the scope of the service:

1. [Project scope](explanation/project-scope.md)
2. [Architecture](explanation/architecture.md)
3. [LMI runtime model](explanation/lmi-runtime-model.md)
4. [Bootstrap macro and config publisher](reference/bootstrap-macro.md)
5. [Performance and cost](explanation/performance-and-cost.md)
6. [Benchmarking methodology](explanation/benchmarking-methodology.md)

## Documentation map

### Tutorials

- [First LMI deployment](tutorials/first-lmi-deployment.md)

### How-to guides

- [Deploy your own SAM gateway](how-to/deploy-your-own-sam-gateway.md)
- [Deploy the example templates](how-to/deploy-demo-stack.md)
- [Deploy the benchmark stack](how-to/deploy-benchmark-stack.md)
- [Run benchmarks](how-to/run-benchmarks.md)
- [Tune batching and timeouts](how-to/tune-batching.md)
- [Integrate Lambda handlers](how-to/integrate-handlers.md)
- [Use the layer proxy, Mode A](how-to/use-mode-a-layer-proxy.md)

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

## Status

Experimental. Interfaces may change while the LMI deployment model settles.
