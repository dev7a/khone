#!/usr/bin/env python3
"""Render the bootstrap SAR template with immutable gateway artifact defaults."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)"
    r"(?:-((?:0|[1-9][0-9]*|[0-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)


def yaml_scalar(value: str) -> str:
    return json.dumps(value)


def replace_parameter_default(lines: list[str], parameter_name: str, value: str) -> None:
    header = f"  {parameter_name}:\n"
    try:
        start = lines.index(header)
    except ValueError as exc:
        raise SystemExit(f"Parameter {parameter_name} was not found.") from exc

    for index in range(start + 1, len(lines)):
        line = lines[index]
        if line.startswith("  ") and not line.startswith("    ") and line.strip():
            break
        if line.startswith("    Default:"):
            lines[index] = f"    Default: {yaml_scalar(value)}\n"
            return

    raise SystemExit(f"Parameter {parameter_name} does not have a Default field.")


def replace_semantic_version(lines: list[str], version: str) -> None:
    for index, line in enumerate(lines):
        if line.startswith("    SemanticVersion:"):
            lines[index] = f"    SemanticVersion: {yaml_scalar(version)}\n"
            return

    raise SystemExit("Metadata.AWS::ServerlessRepo::Application.SemanticVersion was not found.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, default=Path("bootstrap/template.yaml"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--gateway-code-s3-bucket", required=True)
    parser.add_argument("--gateway-code-s3-key", required=True)
    parser.add_argument("--gateway-code-s3-object-version", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not SEMVER_RE.fullmatch(args.version):
        raise SystemExit("--version must be a semantic version without a leading v.")
    if not args.gateway_code_s3_bucket:
        raise SystemExit("--gateway-code-s3-bucket is required.")
    if not args.gateway_code_s3_key:
        raise SystemExit("--gateway-code-s3-key is required.")

    lines = args.template.read_text(encoding="utf-8").splitlines(keepends=True)
    replace_semantic_version(lines, args.version)
    replace_parameter_default(lines, "GatewayCodeS3Bucket", args.gateway_code_s3_bucket)
    replace_parameter_default(lines, "GatewayCodeS3Key", args.gateway_code_s3_key)
    replace_parameter_default(lines, "GatewayCodeS3ObjectVersion", args.gateway_code_s3_object_version)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
