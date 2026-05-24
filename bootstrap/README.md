# Bootstrap Stack

The bootstrap stack installs the account/region resources used by application stacks:

- config artifact bucket.
- `Custom::KhoneConfigPublisher`.
- `KhoneGateway` CloudFormation macro.
- shared Mode A runtime API proxy layers.

See [Bootstrap macro](../docs/reference/bootstrap-macro.md) for the resource contract and
[SAM gateway](../docs/deploy/sam-gateway.md) for the application-stack pattern.

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
