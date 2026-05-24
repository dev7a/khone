---
title: Khone docs
description: Human-first documentation for evaluating, deploying, integrating, operating, and benchmarking Khone.
---

# Khone docs

Khone is an HTTP microbatching gateway for AWS Lambda. It groups short-lived HTTP requests for a few
milliseconds, invokes target Lambda functions with batched payloads, and returns each response to the
right caller.

Use these docs to answer one question at a time: whether Khone fits your workload, how to deploy the
gateway, how to connect handlers, how to tune it, and where to look up exact fields and protocols.

## Start

- [When Khone helps](start/when-khone-helps.md): decide whether the latency-vs-cost tradeoff fits
  your workload.
- [Quickstart](start/quickstart.md): deploy the bootstrap stack, deploy one example gateway, and send
  a request through it.

## Deploy

- [LMI deployment model](deploy/lmi-deployment-model.md): understand the gateway function, bootstrap
  stack, Function URL, and Lambda Managed Instances shape.
- [Example templates](deploy/examples.md): deploy one of the included SAM examples.
- [SAM gateway](deploy/sam-gateway.md): adapt the deployment pattern to your own application stack.

## Integrate

- [Choose an integration mode](integrate/choose-mode.md): pick adapters, native batch, or the layer
  proxy.
- [Adapters](integrate/adapters.md): wrap normal Node or Rust handlers.
- [Native batch](integrate/native-batch.md): handle the full batch yourself when shared work matters.
- [Layer proxy](integrate/layer-proxy.md): use an experimental compatibility path for unmodified
  handlers.

## Operate

- [Tune batching](operate/tune-batching.md): choose wait windows, batch sizes, timeout bounds, and
  isolation keys.
- [Observability](operate/observability.md): enable traces, EMF metrics, and debug headers.

## Benchmarks

- [Benchmark results](benchmarks/results.md): read the public cost and latency snapshot.
- [Benchmark methodology](benchmarks/methodology.md): understand what the public reports measure.
- [Deploy the benchmark stack](benchmarks/deploy-stack.md): create the dedicated benchmark
  environment.
- [Run benchmarks](benchmarks/run.md): run k6 and render report bundles.

## Reference

- [Configuration](reference/configuration.md): author `GatewayConfig`, `Spec`, and `x-khone`.
- [Batch protocol](reference/batch-protocol.md): implement target request and response payloads.
- [Streaming protocol](reference/streaming-protocol.md): stream chunks per request from one batched
  invocation.
- [Bootstrap macro](reference/bootstrap-macro.md): publish gateway config artifacts from
  CloudFormation.
- [SDK adapters](reference/sdk-adapters.md): look up adapter APIs.
- [Benchmark CLI](reference/benchmark-cli.md): look up `benchviz` commands and flags.

## Status

Khone is experimental. Interfaces may change while the LMI deployment model settles.
