# First LMI deployment

This tutorial deploys the bootstrap stack and the demo gateway stack. At the end, you will have a
Rust gateway Lambda running on Lambda Managed Instances (LMI) behind a response-streaming Function
URL, with a working `curl` against a sample target.

The two stacks split deliberately:

- The bootstrap stack is shared per account and region. It creates the config bucket, the macro,
  and the layers that every application stack consumes.
- An application stack (here, `examples/sam/`) owns the gateway `AWS::Serverless::Function` and the
  target Lambdas.

## Prerequisites

- AWS credentials and a default region. The demo `samconfig.toml` pins `us-east-1`; export
  `AWS_REGION` to override.
- IAM permissions to create IAM roles, Lambda functions, CloudFormation macros, S3 buckets, and
  custom resources.
- AWS SAM CLI, AWS CLI, Rust, and [`cargo-lambda`](https://www.cargo-lambda.info/).
- An existing LMI capacity provider ARN. CloudFormation accepts the
  `arn:aws:lambda:<region>:<account>:capacity-provider:<name>` form; the Makefile also accepts and
  normalizes the `capacity-provider/<name>` form.

The Makefile sets `SAM_CLI_BETA_RUST_CARGO_LAMBDA=1` automatically. Set it yourself only when
running `sam build` directly.

## 1. Deploy the bootstrap stack

```bash
make bootstrap-deploy
```

This creates the per-account/region resources:

- An S3 bucket `khone-config-<account>-<region>` (Retain policy) for config manifests.
- A `Custom::KhoneConfigPublisher` Lambda that writes manifest objects.
- The `KhoneGateway` CloudFormation macro.
- The arm64 and amd64 Mode A runtime API proxy layers.

It also exports `KhoneLayerArm64Arn`, `KhoneLayerAmd64Arn`, `KhoneConfigBucketName`, and
`KhoneConfigPublisherServiceToken`. The bootstrap stack only needs to be deployed once per account
and region.

## 2. Deploy the demo stack

```bash
make examples-sam-deploy GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

This step builds the gateway and sample target handlers, resolves `KhoneLayerArm64Arn` from the
bootstrap exports, normalizes the capacity provider ARN if needed, and deploys the stack
(`khone-demo` by default, from `examples/sam/samconfig.toml`).

The demo stack deploys:

- Sample target Lambdas (buffered, streaming, dynamic-wait, duration-wait variants).
- One `Khone::Gateway::Service` resource, which the macro expands into the config manifest object.
- The gateway as an `AWS::Serverless::Function` (`provided.al2023`, arm64, with the LMI capacity
  provider attached and `FunctionUrlConfig.InvokeMode: RESPONSE_STREAM`).
- A scoped IAM policy that allows the gateway to invoke target Lambdas.

If deployment fails on a missing `KhoneLayerArm64Arn` import, the bootstrap stack has not been
deployed in this account/region — go back to step 1.

## 3. Find the Function URL

```bash
aws cloudformation describe-stacks \
  --stack-name khone-demo \
  --query 'Stacks[0].Outputs'
```

Look for `GatewayFunctionUrl` (the base URL) and route-specific outputs such as
`StreamingSimpleHelloUrl`.

## 4. Send a request

```bash
curl -sS "$(aws cloudformation describe-stacks \
  --stack-name khone-demo \
  --query 'Stacks[0].Outputs[?OutputKey==`StreamingSimpleHelloUrl`].OutputValue' \
  --output text)?max-delay=0"
```

`max-delay=0` disables artificial sleep in the demo handler. The target Lambda emits NDJSON records
because the route is configured with `invokeMode: response_stream`, and the gateway returns the
matching record body to `curl`; expect JSON with fields such as `"ok": true` and `"greeting":
`"hello"`.

What the gateway just did:

1. Matched the Function URL path against `Spec.paths`.
2. Applied the route's `x-khone` policy (`maxWaitMs: 25`, `maxBatchSize: 4`, `invokeMode:
   response_stream`).
3. Flushed a single-request batch when no other request arrived in the wait window.
4. Invoked the target with `InvokeWithResponseStream`, decoded the NDJSON response record, and
   forwarded that record's body back to `curl`.

Remove `max-delay=0` and replay under load (`hey`, `k6`, or similar) to see batching kick in.

## Next steps

- Adapt the pattern for your own stack with [Deploy your own SAM gateway](../how-to/deploy-your-own-sam-gateway.md).
- Walk the demo stack in detail with [Deploy the demo stack](../how-to/deploy-demo-stack.md).
- Wire up your handler code with [Integrate Lambda handlers](../how-to/integrate-handlers.md).
- Pick a batching policy with [Tune batching and timeouts](../how-to/tune-batching.md).
- Learn the config shape in [Configuration](../reference/config.md).
- Compare integration choices in [Integration modes](../explanation/integration-modes.md).
