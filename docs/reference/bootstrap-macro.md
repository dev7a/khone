# Bootstrap Macro And Config Publisher

The bootstrap stack installs the account/region resources needed by application stacks:

- S3 bucket for config/spec artifacts.
- `Custom::KhoneConfigPublisher`.
- `KhoneGateway` CloudFormation macro.
- Shared Mode A runtime API proxy layers.

## `Khone::Gateway::Service`

`Khone::Gateway::Service` is a config-artifact resource. The macro replaces it with a
`Custom::KhoneConfigPublisher` using the same logical ID.

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
| `GatewayConfig` | Yes | Runtime settings excluding `Spec`. |
| `Spec` | Yes | OpenAPI-ish route document embedded into the manifest. |
| `ConfigPrefix` | No | S3 key prefix. |

Returned attributes:

| Attribute | Description |
| --- | --- |
| `BucketName` | Config artifact bucket. |
| `Prefix` | Normalized S3 key prefix. |
| `ConfigKey` | S3 object key. |
| `ConfigS3Uri` | URI consumed by `KHONE_CONFIG_URI`. |
| `ConfigSha256` | SHA-256 of the canonical manifest JSON. |

## Removed Properties

The macro rejects old App Runner-era properties such as `ImageIdentifier`, `Port`, `ServiceName`,
`Environment`, `EnvironmentSecrets`, `InstanceRoleArn`, `InstanceConfiguration`,
`AutoDeploymentsEnabled`, `AutoScalingConfiguration*`, `ObservabilityConfiguration*`, and
`EmfMetrics`.

Define gateway compute, IAM, environment variables, observability, and scaling directly on the
explicit SAM gateway function.

## Outputs

- `KhoneConfigBucketName`
- `KhoneConfigPublisherServiceToken`
- `GatewayMacroName`
- `KhoneLayerArm64Arn`
- `KhoneLayerAmd64Arn`
