# Deploy your own SAM gateway

Use this guide to deploy an application gateway rather than the demo or benchmark stack. The gateway
function is owned by your SAM template; the macro only publishes the config artifact.

## 1. Add the transform

```yaml
Transform:
  - AWS::Serverless-2016-10-31
  - KhoneGateway
```

Deploy the bootstrap stack first so the macro and config publisher exist in the account and region.

## 2. Publish the gateway config

```yaml
GatewayConfig:
  Type: Khone::Gateway::Service
  Properties:
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

See [Configuration](../reference/config.md) for field defaults and validation rules.

## 3. Define the gateway function

```yaml
GatewayFunction:
  Type: AWS::Serverless::Function
  Metadata:
    BuildMethod: rust-cargolambda
  Properties:
    CodeUri: ../../gateway
    Handler: bootstrap
    Runtime: provided.al2023
    PackageType: Zip
    Architectures: [arm64]
    MemorySize: 2048
    Timeout: 30
    CapacityProviderConfig:
      Arn: !Ref GatewayCapacityProviderArn
      ExecutionEnvironmentMemoryGiBPerVCpu: 2.0
      PerExecutionEnvironmentMaxConcurrency: 64
    FunctionScalingConfig:
      MinExecutionEnvironments: 1
      MaxExecutionEnvironments: 4
    FunctionUrlConfig:
      AuthType: NONE
      InvokeMode: RESPONSE_STREAM
    Environment:
      Variables:
        KHONE_CONFIG_URI: !GetAtt GatewayConfig.ConfigS3Uri
```

The function URL is the HTTP interface. Use `InvokeMode: RESPONSE_STREAM` even for buffered target
routes so the gateway can stream client responses when routes need it.

## 4. Grant gateway permissions

The gateway execution role needs:

- `s3:GetObject` for the config artifact bucket/prefix.
- `lambda:InvokeFunction` for buffered target routes.
- `lambda:InvokeWithResponseStream` for response-streaming target routes.
- CloudWatch Logs permissions for the gateway function.

If the Function URL uses `AuthType: NONE`, place public access controls in front of it or in the
target application protocol. The demo and benchmark stacks use unauthenticated URLs for simplicity.

## 5. Output the function URL

```yaml
Outputs:
  GatewayFunctionUrl:
    Value: !GetAtt GatewayFunctionUrl.FunctionUrl
```

SAM auto-creates a `<FunctionLogicalId>Url` resource when `FunctionUrlConfig` is set. The
`!GetAtt GatewayFunctionUrl.FunctionUrl` reference works only because the function logical ID is
exactly `GatewayFunction`. Adjust the resource name if you rename the function.
