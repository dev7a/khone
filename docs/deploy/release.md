---
title: Release
description: Maintain the SAR bootstrap release and versioned gateway artifact.
---

# Release

Khone releases publish two related artifacts:

- The `khone-gateway` arm64 Lambda zip at a versioned S3 key.
- The packaged SAR bootstrap application whose macro environment points at that zip.

The release workflow is `.github/workflows/publish-release.yml`. It runs for `v*` tags or manual
dispatch, checks the tag against `VERSION` and `bootstrap/template.yaml`, builds the gateway zip,
uploads it, renders `bootstrap/template.release.yaml`, packages the SAR app, and publishes it.

Manual release inputs:

| Input | Description |
| --- | --- |
| `release_tag` | Existing tag to publish, such as `v0.1.0`. |
| `share_scope` | `account` or `organization`. Organization sharing requires `organizations:DescribeOrganization` and `serverlessrepo:PutApplicationPolicy`. |

Required GitHub secrets:

| Secret | Description |
| --- | --- |
| `AWS_ROLE_TO_ASSUME` | Release role assumed through GitHub OIDC. |
| `SAR_ARTIFACT_BUCKET` | S3 bucket for SAM-packaged SAR assets. |
| `GATEWAY_ARTIFACT_BUCKET` | Optional S3 bucket for the gateway zip. Defaults to `SAR_ARTIFACT_BUCKET` when unset. |

Use `scripts/set-version.sh <version>` to update the repository version metadata before tagging.
