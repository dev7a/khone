# Run Benchmarks

Use `benchviz` to run k6 and generate reports from the benchmark stack.

For the curated public result narrative, see
[Performance and cost](../explanation/performance-and-cost.md). This guide is about producing and
publishing benchmark artifacts.

## Install Dependencies

```bash
npm --prefix benchmark install
```

## Run The Default Sweep

```bash
npm --prefix benchmark run benchviz -- run \
  --stack khone-benchmark \
  --region us-east-1 \
  --duration 3m \
  --stage-targets 50,100,150 \
  --max-delay-ms 0
```

## Run A Smoke Test

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

## Render From An Existing CSV

```bash
npm --prefix benchmark run benchviz -- run \
  --skip-test \
  --csv-path benchmark-results/some-run/k6.csv \
  --run-name rerender \
  --themes light-transparent,dark-transparent
```

## Generate A Curated Public Bundle

Use a stable, descriptive `--public-run-name` when the bundle may be published. Do not publish
generated timestamp directory names.

```bash
npm --prefix benchmark run benchviz -- run \
  --skip-test \
  --run-dir benchmark-results/some-run \
  --public-run-name high-256mb-min4-50-100-150-round2 \
  --public-output-dir benchmark-results-public \
  --themes light-transparent,dark-transparent
```

The public bundle contains only:

- `report.md`
- `summary.csv`
- `charts/light/latency-distribution.png` with light colors and a transparent background
- `charts/dark/latency-distribution.png` with dark colors and a transparent background

Raw `run.json`, `k6.csv`, `benchviz.log`, and `data/metrics.json` stay private under
`benchmark-results/`.
