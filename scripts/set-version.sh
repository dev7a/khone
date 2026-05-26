#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <semantic-version>" >&2
  exit 2
fi

version="$1"
semver_regex='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9A-Za-z-][0-9A-Za-z-]*))*))?(\+([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?$'
if [[ ! "$version" =~ $semver_regex ]]; then
  echo "version must be semantic version without a leading v" >&2
  exit 2
fi

printf '%s\n' "$version" > VERSION

python3 - "$version" <<'PY'
import sys
from pathlib import Path

version = sys.argv[1]
path = Path("bootstrap/template.yaml")
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
for index, line in enumerate(lines):
    if line.startswith("    SemanticVersion:"):
        lines[index] = f"    SemanticVersion: {version}\n"
        break
else:
    raise SystemExit("Metadata.AWS::ServerlessRepo::Application.SemanticVersion was not found.")

path.write_text("".join(lines), encoding="utf-8")
PY

echo "Updated Khone version to $version."
