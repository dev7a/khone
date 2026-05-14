# Deploy the demo stack

The demo stack deploys sample buffered, streaming, adapter, and Mode A routes.

## Prerequisites

- Bootstrap stack deployed with `make bootstrap-deploy`.
- Existing LMI capacity provider ARN.
- SAM CLI, Rust, `cargo-lambda`, and `SAM_CLI_BETA_RUST_CARGO_LAMBDA=1`.

## Deploy

```bash
make examples-sam-deploy GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

Or run SAM directly:

```bash
cd examples/sam
SAM_CLI_BETA_RUST_CARGO_LAMBDA=1 sam build
sam deploy --parameter-overrides \
  KhoneLayerArm64Arn="$(aws cloudformation list-exports --query 'Exports[?Name==`KhoneLayerArm64Arn`].Value | [0]' --output text)" \
  GatewayCapacityProviderArn="arn:aws:lambda:..."
```

## Try the routes

Use `GatewayFunctionUrl` as the base URL:

- `GET {GatewayFunctionUrl}buffering/simple/hello?max-delay=0`
- `GET {GatewayFunctionUrl}buffering/dynamic/hello?max-delay=0`
- `GET {GatewayFunctionUrl}buffering/duration/hello?max-delay=0`
- `GET {GatewayFunctionUrl}streaming/simple/hello?max-delay=0`
- `GET {GatewayFunctionUrl}streaming/dynamic/hello?max-delay=0`
- `GET {GatewayFunctionUrl}buffering/adapter/hello?max-delay=0`
- `GET {GatewayFunctionUrl}streaming/adapter/hello?max-delay=0`
- `GET {GatewayFunctionUrl}streaming/adapter/sse?max-delay=0`
- `GET {GatewayFunctionUrl}streaming/mode-a/python/hello?max-delay=0`
- `GET {GatewayFunctionUrl}streaming/mode-a/node/hello?max-delay=0`

`max-delay=0` disables artificial sleep in the sample handlers.
