# Benchmark CLI reference

`benchviz` runs k6 against a deployed benchmark stack, or renders reports from existing k6 CSV
files. A bare invocation is equivalent to the `run` subcommand.

## Common commands

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

### Stack and output

| Option | Default | Notes |
| --- | --- | --- |
| `--stack <name>` | `khone-benchmark` | CloudFormation stack name. |
| `--region <region>` | AWS config | AWS region. |
| `--profile <profile>` | `default` | Run profile: `default` or `cost-focused`. |
| `--output-dir <dir>` | `benchmark-results` | Raw output parent directory. |
| `--run-name <name>` | generated | Stable raw-run directory under `--output-dir`. |
| `--run-dir <dir>` | none | Existing or explicit run directory. |
| `--label <label>` | none | Optional label for timestamped run directories. |
| `--public-output-dir <dir>` | none | Writes a compact report bundle under this directory. |
| `--public-run-name <name>` | raw run name | Stable directory name under `--public-output-dir`. |
| `--csv-path <path>` | none | Existing k6 CSV; implies `--skip-test`. |
| `--csv-dir <dir>` | none | Directory of k6 CSVs (uses newest); implies `--skip-test`. |
| `--skip-test` | `false` | Skip the k6 run and render from existing CSV. |

### Load shape

| Option | Default | Notes |
| --- | --- | --- |
| `--mode <mode>` | `per_endpoint` | `per_endpoint` or `batch`. |
| `--executor <executor>` | `ramping-arrival-rate` | `ramping-arrival-rate` or `ramping-vus`. |
| `--duration <duration>` | `3m` | Per-stage ramp duration. |
| `--hold-duration <duration>` | `0s` | Optional hold duration after each stage. |
| `--stage-targets <targets>` | `50,100,150` | Comma-separated stage targets. |
| `--stages-json <json>` | none | Override with a full JSON stages array. |
| `--vus <n>` | `50` | VUs for `ramping-vus` mode. |
| `--arrival-time-unit <unit>` | `1s` | Time unit for `ramping-arrival-rate`. |
| `--arrival-preallocated-vus <n>` | `0` | Pre-allocated VU count override. |
| `--arrival-max-vus <n>` | `0` | Maximum VU count override. |
| `--arrival-vus-multiplier <n>` | `1` | Pre-allocated VU multiplier applied to the stage target. |
| `--arrival-max-vus-multiplier <n>` | `2` | Max VU multiplier applied to the stage target. |
| `--max-delay-ms <ms>` | `0` | `max-delay` query value sent to benchmark handlers. |
| `--keyspace-size <n>` | `1000` | Keyspace size for random item IDs appended by k6. |
| `--warmup` / `--no-warmup` | on | Send warmup request to each endpoint before measurement. |
| `--endpoint <name>` | all stack targets | Repeatable endpoint filter. |

### Rendering and sampling

| Option | Default | Notes |
| --- | --- | --- |
| `--theme <theme>` | `light` | Single chart theme. |
| `--themes <themes>` | none | Comma-separated chart themes (`light`, `print`, `dark`, `transparent`, `light-transparent`, `dark-transparent`). |
| `--sample-latency <n>` | `2000` | Maximum latency samples per endpoint in streaming mode. |
| `--sample-seed <n>` | none | Seed for the streaming sampler. |

## Raw output

Raw run directories contain `run.json`, `k6.csv`, `summary.csv`, `report.md`, `data/metrics.json`,
and themed chart subdirectories under `charts/<theme>/`.

## Report bundle output

Report bundle output (under `--public-output-dir`) contains `report.md`, `summary.csv`, and the
themed latency distribution chart files.
