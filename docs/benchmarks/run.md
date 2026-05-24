---
title: Run benchmarks
description: Use benchviz to run k6 against the benchmark stack and generate Khone benchmark reports.
---

# Run benchmarks

Use `benchviz` to run k6 and generate reports from the benchmark stack.

For the public result narrative, see [Benchmark results](results.mdx). This guide is about producing
and reviewing benchmark artifacts.

## Install dependencies

```bash
npm --prefix benchmark install
```

## Run the default sweep

```bash
npm --prefix benchmark run benchviz -- run \
  --stack khone-benchmark \
  --region us-east-1 \
  --duration 3m \
  --stage-targets 50,100,150 \
  --max-delay-ms 0
```

## Run a smoke test

```bash
npm --prefix benchmark run benchviz -- run \
  --stack khone-benchmark \
  --region us-east-1 \
  --run-name smoke \
  --duration 5s \
  --stage-targets 1 \
  --executor ramping-vus \
  --max-delay-ms 0
```

## Render from an existing CSV

```bash
npm --prefix benchmark run benchviz -- run \
  --skip-test \
  --csv-path benchmark-results/some-run/k6.csv \
  --run-name rerender \
  --themes light-transparent,dark-transparent
```

## Generate a shareable report bundle

Use a stable, descriptive `--public-run-name` for report bundles you want to keep or share. Avoid
generated timestamp directory names when the result should be easy to compare later.

```bash
npm --prefix benchmark run benchviz -- run \
  --skip-test \
  --run-dir benchmark-results/some-run \
  --public-run-name high-256mb-min4-50-100-150-round2 \
  --public-output-dir benchmark-results-public \
  --themes light-transparent,dark-transparent
```

The report bundle contains:

- `report.md`
- `summary.csv`
- `charts/light/latency-distribution.png` with light colors and a transparent background
- `charts/dark/latency-distribution.png` with dark colors and a transparent background

The raw run directory still contains additional files such as `run.json`, `k6.csv`, `benchviz.log`,
and `data/metrics.json`.
