# SAM Examples

These examples are deployable one at a time. Each template owns one Khone gateway and a small target
set for a specific integration mode or language.

| Template | Shows | Target language | Route outputs |
| --- | --- | --- | --- |
| `layer-proxy-node` | Layer proxy, Mode A | Node.js | `LayerProxyNodeHelloUrl` |
| `layer-proxy-python` | Layer proxy, Mode A | Python | `LayerProxyPythonHelloUrl` |
| `adapter-node` | Adapter, Mode B, buffered and response streaming | Node.js | `AdapterNodeBufferedUrl`, `AdapterNodeStreamingUrl`, `AdapterNodeSseUrl` |
| `adapter-rust` | Adapter, Mode B, buffered | Rust | `AdapterRustBufferedUrl` |
| `native-batch-node` | Native batch, Mode C, fixed/adaptive/target-aware waits, response streaming | Node.js | `NativeBatchNodeBufferedUrl`, `NativeBatchNodeAdaptiveUrl`, `NativeBatchNodeTargetAwareUrl`, `NativeBatchNodeStreamingUrl` |

Deploy the default Node adapter example:

```bash
make examples-sam-deploy GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

Choose a specific template with `EXAMPLE_TEMPLATE`:

```bash
make examples-sam-deploy \
  EXAMPLE_TEMPLATE=adapter-rust \
  GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...
```

See [Deploy the example templates](../../docs/how-to/deploy-demo-stack.md) for deployment and route
examples. The first-time walkthrough is [First LMI deployment](../../docs/tutorials/first-lmi-deployment.md).
