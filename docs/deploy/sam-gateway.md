---
title: SAM gateway
description: Define a Khone gateway resource in your SAM application stack.
---

# SAM gateway

Use this guide to deploy an application gateway rather than the demo or benchmark stack. The
bootstrap stack installs the SAR-versioned macro and gateway artifact settings; your application
stack supplies target functions and an existing LMI capacity provider ARN.

## 1. Add the transform

```yaml
Transform:
  - AWS::Serverless-2016-10-31
  - KhoneGateway
```

Deploy the bootstrap stack first so the macro and config publisher exist in the account and region.

## 2. Define the gateway

```yaml
GatewayService:
  Type: Khone::Gateway::Service
  Properties:
    CapacityProviderArn: !Ref GatewayCapacityProviderArn
    FunctionName: !Sub "${AWS::StackName}-gateway"
    Description: Khone router running on Lambda Managed Instances.
    MemorySize: 2048
    Timeout: 30
    ExecutionEnvironmentMemoryGiBPerVCpu: 2.0
    PerExecutionEnvironmentMaxConcurrency: 64
    MinExecutionEnvironments: 1
    MaxExecutionEnvironments: 4
    Environment:
      RUST_LOG: info
    ConfigPrefix: !Sub "khone/${AWS::StackName}/gateway/"
    GatewayConfig:
      MaxInflightRequests: 4096
      DefaultTimeoutMs: 2000
    Spec:
      openapi: 3.0.0
      paths:
        /hello:
          get:
            x-target-lambda: !GetAtt HelloFunction.Arn
            x-khone:
              maxWaitMs: 25
              maxBatchSize: 4
              invokeMode: buffered
```

The macro emits a native `AWS::Lambda::Function` using the same logical ID, plus:

- `GatewayServiceKhoneConfigPublisher`
- `GatewayServiceKhoneExecutionRole`
- `GatewayServiceKhoneFunctionUrl`
- `GatewayServiceKhoneFunctionUrlPermission` when `FunctionUrlAuthType: NONE`
- `GatewayServiceKhoneLogGroup` when `LogRetentionInDays` is set

See [Configuration](../reference/configuration.md) for gateway config fields and
[Bootstrap macro](../reference/bootstrap-macro.md) for the complete resource contract.

## 3. Permissions

The macro generates the gateway execution role. It grants:

- CloudWatch Logs write permissions.
- `s3:GetObject` for the generated config artifact prefix.
- `lambda:InvokeFunction` and `lambda:InvokeWithResponseStream` for each
  `x-target-lambda` found under `Spec.paths`.

Use a literal Lambda ARN or an intrinsic object such as `!GetAtt HelloFunction.Arn` for
`x-target-lambda`. Literal values must be Lambda ARNs.

## 4. Output the function URL

```yaml
Outputs:
  GatewayFunctionUrl:
    Value: !GetAtt GatewayServiceKhoneFunctionUrl.FunctionUrl
```

`GatewayService` itself is the Lambda function after macro expansion. `!Ref GatewayService` returns
the function name, and `!GetAtt GatewayService.Arn` returns the function ARN.
