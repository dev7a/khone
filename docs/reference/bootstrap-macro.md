---
title: Bootstrap macro
description: Khone bootstrap resources, gateway macro behavior, generated resources, and exported outputs.
---

# Bootstrap macro

The bootstrap stack installs the per-account/per-region resources that application stacks consume:

- S3 bucket for config/spec artifacts.
- `Custom::KhoneConfigPublisher` Lambda (writes the manifest).
- `KhoneGateway` CloudFormation macro (expands `Khone::Gateway::Service`).
- Shared Mode A runtime API proxy layers (arm64 and amd64).
- Versioned gateway Lambda artifact settings used by the macro.

## `Khone::Gateway::Service`

`Khone::Gateway::Service` is the deployable gateway resource. The macro replaces the original
logical ID with a native `AWS::Lambda::Function`, then generates the config publisher, execution
role, Function URL, and optional log group around it.

```yaml
GatewayService:
  Type: Khone::Gateway::Service
  Properties:
    CapacityProviderArn: !Ref GatewayCapacityProviderArn
    FunctionName: !Sub "${AWS::StackName}-gateway"
    MemorySize: 2048
    Timeout: 30
    ExecutionEnvironmentMemoryGiBPerVCpu: 2.0
    PerExecutionEnvironmentMaxConcurrency: 64
    MinExecutionEnvironments: 1
    MaxExecutionEnvironments: 4
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
| `CapacityProviderArn` | Yes | Existing Lambda Managed Instances capacity provider ARN. |
| `GatewayConfig` | Yes | Runtime settings excluding `Spec`. Must be an object. |
| `Spec` | Yes | OpenAPI-ish route document embedded into the manifest. Must be an object. |
| `ConfigPrefix` | No | S3 key prefix. Defaults to `khone/${AWS::StackName}/<LogicalId>/`. |
| `FunctionName` | No | Gateway Lambda function name. |
| `Description` | No | Gateway Lambda description. |
| `MemorySize` | No | Gateway Lambda memory in MB. Defaults to `2048`. |
| `Timeout` | No | Gateway Lambda timeout in seconds. Defaults to `30`. |
| `ExecutionEnvironmentMemoryGiBPerVCpu` | No | LMI execution environment memory per vCPU. Defaults to `2.0`. |
| `PerExecutionEnvironmentMaxConcurrency` | No | LMI max concurrency per execution environment. Defaults to `64`. |
| `MinExecutionEnvironments` | No | LMI minimum execution environments. Defaults to `1`. |
| `MaxExecutionEnvironments` | No | LMI maximum execution environments. Defaults to `4`. |
| `FunctionUrlAuthType` | No | Function URL auth type, `NONE` or `AWS_IAM`. Defaults to `NONE`. |
| `Environment` | No | Gateway environment variables as a map of strings or intrinsics. `KHONE_CONFIG_URI` is reserved. |
| `TracingConfig` | No | Native Lambda tracing config. |
| `LoggingConfig` | No | Native Lambda logging config. |
| `LogRetentionInDays` | No | Creates a generated CloudWatch log group with the requested retention. |

The macro additionally preserves `Condition`, `DeletionPolicy`, `DependsOn`, `Metadata`, and
`UpdateReplacePolicy` from the original resource fragment.

The original logical ID becomes the gateway Lambda. `!Ref GatewayService` returns the function name,
and `!GetAtt GatewayService.Arn` returns the gateway Lambda ARN.

Generated logical IDs:

| Logical ID | Resource |
| --- | --- |
| `<Gateway>KhoneConfigPublisher` | `Custom::KhoneConfigPublisher` |
| `<Gateway>KhoneExecutionRole` | `AWS::IAM::Role` |
| `<Gateway>KhoneFunctionUrl` | `AWS::Lambda::Url` |
| `<Gateway>KhoneFunctionUrlPermission` | `AWS::Lambda::Permission` when `FunctionUrlAuthType: NONE` |
| `<Gateway>KhoneLogGroup` | `AWS::Logs::LogGroup` when `LogRetentionInDays` is set |

Config publisher attributes are available from `<Gateway>KhoneConfigPublisher`:

| Attribute | Description |
| --- | --- |
| `BucketName` | Config artifact bucket. |
| `Prefix` | Normalized S3 key prefix. |
| `ConfigKey` | S3 object key. |
| `ConfigS3Uri` | `s3://<bucket>/<key>` URI consumed by `KHONE_CONFIG_URI`. |
| `ConfigSha256` | SHA-256 of the canonical manifest JSON (`{...GatewayConfig, "Spec": Spec}`). |

## Deployment ownership

`Khone::Gateway::Service` owns gateway compute, IAM, environment variables, observability, Function
URL, and scaling. Capacity providers remain external: pass the existing capacity provider ARN into
`CapacityProviderArn`.

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
