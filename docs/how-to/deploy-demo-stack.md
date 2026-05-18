# Deploy the example templates

The SAM examples are split into individually deployable templates. Each template deploys one Khone
gateway plus the target Lambda functions needed to show a specific mode or language.

| Template | Shows | Stack name |
| --- | --- | --- |
| `layer-proxy-node` | Layer proxy, Mode A with an unmodified Node handler | `khone-layer-proxy-node` |
| `layer-proxy-python` | Layer proxy, Mode A with an unmodified Python handler | `khone-layer-proxy-python` |
| `adapter-node` | Adapter, Mode B Node targets for buffered, response-streaming, and SSE-style responses | `khone-adapter-node` |
| `adapter-rust` | Adapter, Mode B Rust target for buffered responses | `khone-adapter-rust` |
| `native-batch-node` | Native batch, Mode C Node handler with fixed, adaptive, target-aware, and streaming routes | `khone-native-batch-node` |

## Prerequisites

- Bootstrap stack deployed with `make bootstrap-deploy`.
- Existing LMI capacity provider ARN.
- SAM CLI, Rust, `cargo-lambda`, and `SAM_CLI_BETA_RUST_CARGO_LAMBDA=1`.

## Deploy

```bash
make examples-sam-deploy GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

That deploys `EXAMPLE_TEMPLATE=adapter-node`. Choose another template explicitly:

```bash
make examples-sam-deploy \
  EXAMPLE_TEMPLATE=adapter-rust \
  GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

Layer proxy templates, Mode A, also need the bootstrap layer export. The Makefile resolves
`KhoneLayerArm64Arn` automatically when a template declares that parameter.

Or run SAM directly from one template directory:

```bash
cd examples/sam/templates/layer-proxy-python
SAM_CLI_BETA_RUST_CARGO_LAMBDA=1 sam build
sam deploy --parameter-overrides \
  KhoneLayerArm64Arn="$(aws cloudformation list-exports --query 'Exports[?Name==`KhoneLayerArm64Arn`].Value | [0]' --output text)" \
  GatewayCapacityProviderArn="arn:aws:lambda:..."
```

## Try the routes

Use `GatewayFunctionUrl` as the base URL:

- `layer-proxy-node`: `GET {GatewayFunctionUrl}layer-proxy/node/hello?max-delay=0`
- `layer-proxy-python`: `GET {GatewayFunctionUrl}layer-proxy/python/hello?max-delay=0`
- `adapter-node`: `GET {GatewayFunctionUrl}adapter/node/buffered/hello?max-delay=0`
- `adapter-node`: `GET {GatewayFunctionUrl}adapter/node/streaming/hello?max-delay=0`
- `adapter-node`: `GET {GatewayFunctionUrl}adapter/node/sse?max-delay=0`
- `adapter-rust`: `GET {GatewayFunctionUrl}adapter/rust/hello?max-delay=0`
- `native-batch-node`: `GET {GatewayFunctionUrl}native-batch/node/buffered/hello?max-delay=0`
- `native-batch-node`: `GET {GatewayFunctionUrl}native-batch/node/adaptive/hello?max-delay=0`
- `native-batch-node`: `GET {GatewayFunctionUrl}native-batch/node/target-aware/hello?max-delay=0`
- `native-batch-node`: `GET {GatewayFunctionUrl}native-batch/node/streaming/hello?max-delay=0`

`max-delay=0` disables artificial sleep in the sample handlers.
