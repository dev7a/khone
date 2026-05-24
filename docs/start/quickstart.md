---
title: Quickstart
description: Deploy the Khone bootstrap stack, deploy one example gateway, and send a request through it.
---

# Quickstart

This quickstart deploys the account-level bootstrap stack and one example gateway stack. At the end
you will have a Rust gateway Lambda running on Lambda Managed Instances (LMI) behind a
response-streaming Function URL, plus a working `curl` request against a sample target.

## Prerequisites

- AWS credentials and a default region. The example `samconfig.toml` files pin `us-east-1`; export
  `AWS_REGION` to override.
- IAM permissions to create IAM roles, Lambda functions, CloudFormation macros, S3 buckets, and
  custom resources.
- AWS SAM CLI, AWS CLI, Rust, and [`cargo-lambda`](https://www.cargo-lambda.info/).
- An existing LMI capacity provider ARN. CloudFormation accepts the
  `arn:aws:lambda:<region>:<account>:capacity-provider:<name>` form; the Makefile also accepts and
  normalizes the `capacity-provider/<name>` form.

The Makefile sets `SAM_CLI_BETA_RUST_CARGO_LAMBDA=1` automatically. Set it yourself only when
running `sam build` directly.

## 1. Deploy bootstrap resources

```bash
make bootstrap-deploy
```

The bootstrap stack is shared per account and region. It creates:

- an S3 bucket `khone-config-<account>-<region>` for gateway config manifests
- the `Custom::KhoneConfigPublisher` Lambda
- the `KhoneGateway` CloudFormation macro
- arm64 and amd64 Mode A runtime API proxy layers

It also exports `KhoneLayerArm64Arn`, `KhoneLayerAmd64Arn`, `KhoneConfigBucketName`, and
`KhoneConfigPublisherServiceToken`.

## 2. Deploy the default example gateway

```bash
make examples-sam-deploy GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

This builds the gateway and sample target handlers, normalizes the capacity provider ARN if needed,
and deploys the default `adapter-node` stack named `khone-adapter-node`.

Choose another example with `EXAMPLE_TEMPLATE`:

```bash
make examples-sam-deploy \
  EXAMPLE_TEMPLATE=layer-proxy-python \
  GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

## 3. Find a route URL

```bash
aws cloudformation describe-stacks \
  --stack-name khone-adapter-node \
  --query 'Stacks[0].Outputs'
```

Look for `GatewayFunctionUrl` and route-specific outputs such as `AdapterNodeStreamingUrl`.

## 4. Send a request

```bash
curl -sS "$(aws cloudformation describe-stacks \
  --stack-name khone-adapter-node \
  --query 'Stacks[0].Outputs[?OutputKey==`AdapterNodeStreamingUrl`].OutputValue' \
  --output text)?max-delay=0"
```

`max-delay=0` disables artificial sleep in the demo handler. Expect JSON with fields such as
`"ok": true` and `"greeting": "hello"`.

The gateway matched the Function URL path against `Spec.paths`, applied the route's `x-khone`
policy, flushed a single-request batch, invoked the target with `InvokeWithResponseStream`, decoded
the NDJSON response record, and forwarded that record's body back to `curl`.

Replay the route under load with `hey`, `k6`, or a similar tool to see batching start.

## Next steps

- Deploy other examples with [Example templates](../deploy/examples.md).
- Adapt the pattern with [SAM gateway](../deploy/sam-gateway.md).
- Pick a handler integration with [Choose an integration mode](../integrate/choose-mode.md).
- Tune the route with [Tune batching](../operate/tune-batching.md).
