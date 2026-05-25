#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <yaml-scalar>" >&2
  exit 2
fi

ruby -e '
  require "yaml"

  scalar = ARGV.fetch(0)
  document = YAML.safe_load("value: #{scalar}\n", permitted_classes: [], aliases: false) || {}
  value = document["value"]
  puts(value.nil? ? "" : value.to_s)
' "$1"
