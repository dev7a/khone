# Use The Mode A Layer Proxy

Use Mode A only when target handler code cannot change. It is experimental and runtime-specific.

## Add The Layer

Deploy the bootstrap stack and pass the exported layer ARN into your function:

```bash
KhoneLayerArm64Arn="$(aws cloudformation list-exports \
  --query 'Exports[?Name==`KhoneLayerArm64Arn`].Value | [0]' \
  --output text)"
```

## Configure The Exec Wrapper

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/khone/exec-wrapper.sh
KHONE_MAX_CONCURRENCY=4
```

Set `KHONE_MAX_CONCURRENCY` to the route `maxBatchSize` as a starting point.

## Runtime Notes

- Node is the most tested Mode A runtime.
- The exec wrapper sets `AWS_LAMBDA_NODEJS_USE_ALTERNATIVE_CLIENT_1=true` when multi-concurrency is
  enabled, unless you override it.
- Python 3.14 concurrency remains experimental and uses a telemetry file descriptor workaround.
- User-code streaming is not supported in Mode A.
- Duplicate request ids in a batch are rejected.
