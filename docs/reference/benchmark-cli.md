# Benchmark CLI Reference

`benchviz` runs k6 or renders reports from existing CSV files.

## Common Commands

```bash
npm --prefix benchmark run benchviz -- run --stack khone-benchmark --region us-east-1
```

```bash
npm --prefix benchmark run benchviz -- run \
  --skip-test \
  --run-dir benchmark-results/some-run \
  --public-run-name high-256mb-min4-50-100-150-round2 \
  --public-output-dir benchmark-results-public \
  --themes light-transparent,dark-transparent
```

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `--stack` | `khone-benchmark` | CloudFormation stack name. |
| `--region` | AWS config | AWS region. |
| `--output-dir` | `benchmark-results` | Raw output parent directory. |
| `--run-name` | generated | Stable raw-run directory under `--output-dir`. |
| `--run-dir` | none | Existing or explicit run directory. |
| `--public-run-name` | raw run directory name | Stable sanitized directory under `--public-output-dir`. |
| `--csv-path` | none | Existing k6 CSV; implies `--skip-test`. |
| `--csv-dir` | none | Uses newest k6 CSV; implies `--skip-test`. |
| `--mode` | `per_endpoint` | `per_endpoint` or `batch`. |
| `--executor` | `ramping-arrival-rate` | `ramping-arrival-rate` or `ramping-vus`. |
| `--duration` | `3m` | Per-stage duration. |
| `--stage-targets` | `50,100,150` | Comma-separated targets. |
| `--stages-json` | none | Full JSON stage override. |
| `--max-delay-ms` | `0` | Query value sent to benchmark handlers. |
| `--themes` | none | Comma-separated `light,print,dark,transparent,light-transparent,dark-transparent`. |
| `--public-output-dir` | none | Writes curated public artifacts only. |
| `--endpoint` | all stack targets | Repeatable endpoint filter. |

## Raw Output

Raw run directories contain `run.json`, `k6.csv`, `summary.csv`, `report.md`, `data/metrics.json`,
and charts. Raw output is ignored and should not be published.

## Public Output

Public output contains `report.md`, `summary.csv`, and themed latency distribution charts only.
