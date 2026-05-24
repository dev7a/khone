---
title: LMI deployment model
description: How Khone uses bootstrap resources, an explicit gateway function, a Function URL, and Lambda Managed Instances.
---

# LMI deployment model

Khone runs as a Rust Lambda gateway on Lambda Managed Instances (LMI). The gateway accepts HTTP
requests through a response-streaming Lambda Function URL, keeps batching state inside each
execution environment, invokes target Lambdas, and demultiplexes responses back to clients.

```text
Client
  |
  | Lambda Function URL, RESPONSE_STREAM
  v
Gateway Lambda on LMI
  |
  | in-memory batch per target, method, route, mode, and key
  v
Target Lambda invocation(s)
  |
  v
Per-request responses -> gateway demux -> client
```

## Two stacks, different owners

The bootstrap stack is shared per account and region. It installs the config bucket, config
publisher, CloudFormation macro, and Mode A layer artifacts.

Application stacks own the actual gateway function and target functions. The `Khone::Gateway::Service`
resource publishes a config artifact; it does not create the gateway compute.

## Gateway function

Application templates define the gateway as an explicit `AWS::Serverless::Function`:

- `Runtime: provided.al2023`
- `PackageType: Zip`
- `Architectures: [arm64]`
- `FunctionUrlConfig.InvokeMode: RESPONSE_STREAM`
- `CapacityProviderConfig` attached to an existing LMI capacity provider
- `KHONE_CONFIG_URI` set from `!GetAtt <GatewayConfig>.ConfigS3Uri`

Use response streaming on the Function URL even when a route invokes buffered targets. The gateway
needs the client-facing response stream for routes that do stream.

## Execution environments

Each LMI execution environment has its own router, batchers, queues, timers, and probe state. There
is no cross-environment coordination. Requests can be batched together only when Lambda routes them
to the same execution environment.

Minimum execution environments provide baseline warm capacity. Maximum execution environments bound
scale-out and cost exposure.

## In-memory state

The gateway keeps short-lived state in memory: queue membership, flush timers, request ids, response
channels, request-rate samples, and target-duration probe data. A new execution environment starts
without that history, so adaptive and target-aware batching can take a short ramp-up period.

Treat batching state as opportunistic. Deployments, scaling changes, failures, or Lambda lifecycle
decisions can replace an environment at any time.

## Scale-out effects

When Lambda adds execution environments, traffic is split across independent batchers. Effective
batch size may temporarily drop until each environment has enough traffic and probe data.

429 responses can come from gateway request limits, pending invocation limits, target Lambda
throttling, or Function URL/Lambda capacity. Use logs and metrics to distinguish them.

## Read next

- [Quickstart](../start/quickstart.md) for the first deployment.
- [SAM gateway](sam-gateway.md) for the application template shape.
- [Bootstrap macro](../reference/bootstrap-macro.md) for config publisher details.
