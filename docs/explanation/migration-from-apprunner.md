# Migration From App Runner-Era Assumptions

The project originally explored a gateway service shape where the macro owned gateway deployment
concerns. The current LMI model separates those responsibilities.

## What Changed

- The gateway now runs as an explicit Rust Lambda function.
- The HTTP interface is a Lambda Function URL with response streaming enabled.
- SAM `CapacityProviderConfig` configures LMI on the visible gateway function.
- The macro only publishes `GatewayConfig + Spec` to S3.

## Removed Macro Properties

The macro rejects App Runner-era properties including `ImageIdentifier`, `Port`, `ServiceName`,
`Environment`, `EnvironmentSecrets`, `InstanceRoleArn`, `InstanceConfiguration`,
`AutoDeploymentsEnabled`, `AutoScalingConfiguration*`, `ObservabilityConfiguration*`, and
`EmfMetrics`.

Move those concerns to explicit SAM resources:

- gateway code packaging on `AWS::Serverless::Function`.
- environment variables on the gateway function.
- IAM on the gateway execution role.
- Function URL on `FunctionUrlConfig`.
- LMI scaling on `CapacityProviderConfig` and `FunctionScalingConfig`.

## What Stays

`Khone::Gateway::Service` remains the user-facing config artifact resource. Application templates
still use `!GetAtt GatewayConfig.ConfigS3Uri` for `KHONE_CONFIG_URI`.
