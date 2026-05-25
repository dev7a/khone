# Bootstrap Stack

The bootstrap stack installs the account/region resources used by application stacks:

- config artifact bucket.
- `Custom::KhoneConfigPublisher`.
- `KhoneGateway` CloudFormation macro.
- shared Mode A runtime API proxy layers.
- versioned gateway Lambda artifact settings used by the macro.

See [Bootstrap macro](../docs/reference/bootstrap-macro.md) for the resource contract and
[SAM gateway](../docs/deploy/sam-gateway.md) for the application-stack pattern.

SAR release templates set the gateway artifact bucket/key defaults. Source deployments can pass
`GatewayCodeS3Bucket`, `GatewayCodeS3Key`, and optional `GatewayCodeS3ObjectVersion` explicitly.

Deploy from the repository root:

```bash
make bootstrap-deploy
```

Important exported values:

- `KhoneConfigBucketName`
- `KhoneConfigPublisherServiceToken`
- `GatewayMacroName`
- `KhoneLayerArm64Arn`
- `KhoneLayerAmd64Arn`
