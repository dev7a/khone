# First LMI Deployment

This tutorial deploys the bootstrap stack and the demo gateway stack. At the end, you will have a
Rust gateway Lambda running on Lambda Managed Instances behind a response-streaming Function URL.

## Prerequisites

- AWS credentials and a default region.
- AWS SAM CLI, AWS CLI, Rust, and `cargo-lambda`.
- SAM Rust beta support: `SAM_CLI_BETA_RUST_CARGO_LAMBDA=1`.
- An existing Lambda Managed Instances capacity provider ARN.

## 1. Deploy The Bootstrap Stack

```bash
make bootstrap-deploy
```

The bootstrap stack creates the config artifact bucket, config publisher custom resource,
`KhoneGateway` macro, and shared Mode A layers.

## 2. Deploy The Demo Stack

```bash
make examples-sam-deploy GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

CloudFormation expects the capacity provider ARN in `capacity-provider:<name>` form. The Makefile
accepts and normalizes `capacity-provider/<name>` if your CLI prints the slash form.

## 3. Find The Function URL

```bash
aws cloudformation describe-stacks \
  --stack-name khone-demo \
  --query 'Stacks[0].Outputs'
```

Look for `GatewayFunctionUrl` and the route-specific URL outputs.

## 4. Send A Request

```bash
curl -sS "$(aws cloudformation describe-stacks \
  --stack-name khone-demo \
  --query 'Stacks[0].Outputs[?OutputKey==`StreamingSimpleHelloUrl`].OutputValue' \
  --output text)?max-delay=0"
```

`max-delay=0` disables artificial sleep in the demo handler. Remove it when you want to observe
batching behavior under load.

## Next Steps

- Adapt the pattern for your own stack with [Deploy your own SAM gateway](../how-to/deploy-your-own-sam-gateway.md).
- Learn the config shape in [Configuration](../reference/config.md).
- Compare integration choices in [Integration modes](../explanation/integration-modes.md).
