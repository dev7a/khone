---
title: Bootstrap from SAR
description: Install the Khone bootstrap application from Serverless Application Repository.
---

# Bootstrap from SAR

The released Khone bootstrap application installs the shared account/region resources:

- `KhoneGateway` CloudFormation macro.
- `Custom::KhoneConfigPublisher`.
- Config artifact bucket.
- Mode A runtime API proxy layers.
- Versioned gateway Lambda zip coordinates used by the macro.

Install the published SAR application before deploying application stacks that use
`Khone::Gateway::Service`.

```yaml
KhoneBootstrap:
  Type: AWS::Serverless::Application
  Properties:
    Location:
      ApplicationId: arn:aws:serverlessrepo:us-east-1:<publisher-account-id>:applications/khone-bootstrap
      SemanticVersion: 0.1.0
```

The release template sets `GatewayCodeS3Bucket`, `GatewayCodeS3Key`, and optional
`GatewayCodeS3ObjectVersion` defaults to the versioned gateway artifact uploaded during release.
Application stacks do not need `CodeUri` access to the gateway source tree.

## Source checkout installs

When deploying the bootstrap stack directly from this repository, provide your own gateway artifact
coordinates:

```bash
cargo lambda build --release --arm64 --output-format zip -p khone-gateway
aws s3 cp target/lambda/khone-gateway/bootstrap.zip \
  "s3://$GATEWAY_ARTIFACT_BUCKET/khone/dev/gateway/bootstrap.zip"

make bootstrap-deploy \
  GATEWAY_CODE_S3_BUCKET="$GATEWAY_ARTIFACT_BUCKET" \
  GATEWAY_CODE_S3_KEY="khone/dev/gateway/bootstrap.zip"
```

The artifact bucket policy must allow every account that will deploy gateway Lambdas to read the
versioned zip object.
