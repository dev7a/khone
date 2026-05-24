---
title: When Khone helps
description: Decide whether Khone's request batching tradeoff fits your Lambda workload.
---

# When Khone helps

Khone helps when many short HTTP requests can be grouped without changing the caller's HTTP
semantics. The gateway waits for a bounded window, invokes a target Lambda with a batch payload, and
routes each per-request response back to the original caller.

That makes Khone a latency-vs-cost dial. You add a small gateway hop and batching wait so target
functions can do more useful work per invocation.

## Strong fits

Khone is strongest for I/O-bound Lambda handlers:

- handlers that wait on databases, APIs, model endpoints, queues, or other backend services
- routes with enough concurrent traffic for several requests to arrive in the same short window
- workloads where the target function can share setup, connection reuse, data loading, or fan-out
  across items
- applications that can tolerate a bounded wait such as 5-25 ms on latency-sensitive routes, or a
  longer wait on cost-sensitive background-style routes

The public benchmark snapshot models this kind of workload. Each target Lambda calls a backend
Lambda URL with an 80-160 ms simulated downstream delay, so batching can reduce target invocation
work while requests are waiting on I/O.

## Weak fits

Khone is a weaker fit for CPU-bound handlers. If each request mostly consumes CPU, putting several
items into one target invocation does not add compute capacity or create useful wait states to
overlap.

It is also a poor fit when:

- requests must be served with the lowest possible single-request latency
- every request has a large body that makes batched invoke payloads impractical
- traffic is too sparse to form useful batches
- tenants, auth contexts, or request keys cannot safely share a target invocation
- the route needs API Gateway features that Khone does not provide

## What Khone is

- A Rust Lambda gateway that accepts HTTP requests through a Lambda Function URL.
- A stateful in-memory batcher for Lambda Managed Instances execution environments.
- A protocol and adapter set for Lambda handlers that receive batched requests and return
  per-request responses.
- A CloudFormation macro package that publishes gateway config artifacts to S3.
- A benchmark harness for comparing direct API Gateway invocation with Khone batching routes.

## What Khone is not

- It is not an API Gateway replacement.
- It does not create LMI capacity providers.
- It does not manage public DNS, authentication, WAF, tenant authorization, or edge caching.
- It is not a durable workflow engine; gateway state is in memory per Lambda execution environment.
- It is not a CPU parallelism layer.

## Read next

- Try the [Quickstart](quickstart.md) when the fit looks plausible.
- Read the [LMI deployment model](../deploy/lmi-deployment-model.md) before designing a production
  stack.
- Review [Benchmark results](../benchmarks/results.md) for the public I/O-bound snapshot.
