---
title: Bootstrap macro
description: Khone bootstrap resources, gateway config publisher behavior, custom resource attributes, and exported outputs.
---

# Bootstrap macro

The bootstrap stack installs the per-account/per-region resources that application stacks consume:

- S3 bucket for config/spec artifacts.
- `Custom::KhoneConfigPublisher` Lambda (writes the manifest).
- `KhoneGateway` CloudFormation macro (expands `Khone::Gateway::Service`).
- Shared Mode A runtime API proxy layers (arm64 and amd64).

## `Khone::Gateway::Service`

`Khone::Gateway::Service` is a config-artifact resource. The macro replaces it with a
`Custom::KhoneConfigPublisher` using the same logical ID, so callers can reference the original
logical ID (for example `!GetAtt GatewayConfig.ConfigS3Uri`).

```yaml
GatewayConfig:
  Type: Khone::Gateway::Service
  Properties:
    ConfigPrefix: !Sub "khone/${AWS::StackName}/gateway/"
    GatewayConfig:
      DefaultTimeoutMs: 2000
    Spec:
      openapi: 3.0.0
      paths: {}
```

Supported properties:

| Property | Required | Description |
| --- | --- | --- |
| `GatewayConfig` | Yes | Runtime settings excluding `Spec`. Must be an object. |
| `Spec` | Yes | OpenAPI-ish route document embedded into the manifest. Must be an object. |
| `ConfigPrefix` | No | S3 key prefix. Defaults to `khone/${AWS::StackName}/<LogicalId>/`. |

The macro additionally preserves `Condition`, `DeletionPolicy`, `DependsOn`, `Metadata`, and
`UpdateReplacePolicy` from the original resource fragment.

Returned attributes (via `!GetAtt`):

| Attribute | Description |
| --- | --- |
| `BucketName` | Config artifact bucket. |
| `Prefix` | Normalized S3 key prefix. |
| `ConfigKey` | S3 object key. |
| `ConfigS3Uri` | `s3://<bucket>/<key>` URI consumed by `KHONE_CONFIG_URI`. |
| `ConfigSha256` | SHA-256 of the canonical manifest JSON (`{...GatewayConfig, "Spec": Spec}`). |

## Deployment ownership

`Khone::Gateway::Service` only publishes configuration. Define gateway compute, IAM, environment
variables, observability, and scaling directly on the explicit SAM gateway function.

## Bootstrap outputs

| Logical output | Exported as | Description |
| --- | --- | --- |
| `ConfigBucketName` | `KhoneConfigBucketName` | S3 bucket name for config manifests. |
| `ConfigPublisherServiceToken` | `KhoneConfigPublisherServiceToken` | Service token (Lambda ARN) for `Custom::KhoneConfigPublisher`. |
| `GatewayMacroName` | _(not exported)_ | Macro name, always the literal `KhoneGateway`. |
| `LayerArm64Arn` | `KhoneLayerArm64Arn` | ARN of the arm64 runtime API proxy layer. |
| `LayerAmd64Arn` | `KhoneLayerAmd64Arn` | ARN of the amd64 runtime API proxy layer. |

Application stacks should reference the macro via `Transform: [KhoneGateway]` (the literal name) and
import the other values via `Fn::ImportValue`.
