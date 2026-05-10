# Project Scope

Khone is a Lambda gateway for stateful request batching. It sits in front of Lambda target functions, keeps short-lived batching state in memory, and forwards grouped requests to handlers that understand the Khone batch protocol.

The current branch is specifically the Lambda Managed Instances (LMI) migration. The gateway is deployed as a Rust Lambda function behind a Lambda Function URL, and the CloudFormation macro is reduced to a config publisher that stores the gateway spec in S3.

## What This Project Is

- A Rust router that accepts HTTP requests through a Lambda Function URL.
- A batching gateway that can reduce target Lambda invocations when traffic can be grouped.
- A protocol and adapter set for Lambda handlers that receive batched requests and return per-request responses.
- A CloudFormation macro package that publishes inline gateway configuration to S3.
- A benchmark harness for comparing direct API Gateway invocation, mux batching, and duration-aware percentage batching.

## What This Project Is Not

- It is not an API Gateway replacement for every route pattern.
- It does not create LMI capacity providers. Templates accept a user-provided capacity provider ARN.
- It does not manage public DNS, authentication, WAF, tenant authorization, or edge caching.
- It is not a durable workflow engine. Gateway state is in-memory per Lambda execution environment.
- It does not publish raw benchmark runs as public artifacts. Public benchmark results are curated and sanitized.
- It no longer deploys App Runner, Docker image release infrastructure, or SAR publishing workflows.

## Repository Map

| Area | Purpose |
| --- | --- |
| `gateway/` | Rust Lambda gateway runtime and batching logic. |
| `bootstrap/gateway_macro/` | CloudFormation macro/config publisher package. |
| `benchmark/` | Benchmark harness, target functions, reports, and curated publication tooling. |
| `examples/` | SAM templates for demo and benchmark deployments. |
| `lambda-kit/` | Node and Rust SDK adapters and integration helpers. |
| `docs/` | Public documentation in Diataxis form. |

## Operating Model

The gateway Lambda initializes the router and batcher once per execution environment. On LMI, execution environments are more stable than standard Lambda environments, so the gateway can keep useful in-memory state for longer periods. The state remains opportunistic: deployments, scaling changes, failures, or Lambda lifecycle decisions can still replace an execution environment.

The practical consequence is that benchmarks should separate first-round scale behavior from steady-state behavior. Public reports include warmup-aware runs, but the cost and latency summaries should still be read as scenario measurements rather than global guarantees.

## Maturity

This is a greenfield LMI migration path. The public docs describe the intended product surface for this branch, not a backward-compatible contract with the earlier App Runner implementation. App Runner details remain only where they explain migration context or removed properties.
