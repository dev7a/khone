# Benchmark Report

Executor: ramping-arrival-rate
Mode: per_endpoint
Max delay: 0ms
Endpoints: steady, adaptive, target-aware, standard

## Test Configuration

Region: `us-east-1`

### Workload Shape

| Stage | Window | Duration | From rps | To rps |
| ---: | :-- | :-- | ---: | ---: |
| 1 | 0-180s | 3m | 0 | 50 |
| 2 | 180-360s | 3m | 50 | 100 |
| 3 | 360-540s | 3m | 100 | 150 |

### k6 Settings

| Setting | Value |
| :-- | :-- |
| Executor | `ramping-arrival-rate` |
| Mode | `per_endpoint` |
| Profile | `default` |
| Total scheduled duration | `540s` |
| Max delay query value | `0ms` |
| Warmup requests | `true` |
| Keyspace size | `1000` |
| Arrival time unit | `1s` |
| Arrival VUs multiplier | `1` |
| Arrival max VUs multiplier | `2` |
| Ramping VUs setting | `50` |

### Endpoint Labels

| Endpoint |
| :-- |
| steady |
| adaptive |
| target-aware |
| standard |

### Stack Parameters

| Parameter | Value |
| :-- | :-- |
| BenchmarkHandlerMemorySize | `256` |
| BenchmarkBackendBaseDelayMs | `80` |
| BenchmarkBackendJitterMs | `80` |
| BenchmarkBackendPoints | `48` |
| BenchmarkBackendTimeoutMs | `7000` |
| KhoneMaxConcurrency | `16` |

### Lambda Configuration

_Lambda configuration was not captured for this run._

## Key Findings

- Fastest p95 endpoint: **standard** at **196.72 ms**.
- Most cost-efficient endpoint (estimate): **target-aware** at **17.67%** of standard baseline.
- Lowest observed error rate is a tie at **0.000%** across: **steady, target-aware**.

## Endpoint Ranking

| Rank | Endpoint | p95 (ms) | Error rate | Cost (% of standard) | Effective batch | Requests |
| ---: | :-- | ---: | ---: | ---: | ---: | ---: |
| 1 | standard | 196.72 | 0.002% | 100.00 | 1.00 | 40499 |
| 2 | adaptive | 304.31 | 0.002% | 36.15 | 2.77 | 40499 |
| 3 | steady | 308.23 | 0.000% | 32.36 | 3.09 | 40499 |
| 4 | target-aware | 463.88 | 0.000% | 17.67 | 5.66 | 40499 |

## Stage Latency Stats (per endpoint)

Computed from sampled `http_req_duration` points with status `200`, grouped by configured stage windows.

### steady

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 0-180 | 230 | 258.60 | 256.90 | 312.66 | 444.69 | 639.41 |
| 2 | 100 | 180-360 | 652 | 243.14 | 240.89 | 307.13 | 382.56 | 1863.11 |
| 3 | 150 | 360-540 | 1118 | 239.58 | 239.49 | 305.25 | 345.38 | 471.60 |

### adaptive

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 0-180 | 251 | 211.70 | 209.28 | 277.49 | 308.14 | 324.15 |
| 2 | 100 | 180-360 | 692 | 238.31 | 238.70 | 303.94 | 332.91 | 446.33 |
| 3 | 150 | 360-540 | 1057 | 237.29 | 239.65 | 301.44 | 327.59 | 540.01 |

### target-aware

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 0-180 | 259 | 336.36 | 350.67 | 455.53 | 481.94 | 530.98 |
| 2 | 100 | 180-360 | 683 | 317.46 | 319.59 | 436.43 | 471.06 | 1110.28 |
| 3 | 150 | 360-540 | 1058 | 326.85 | 324.67 | 455.94 | 589.21 | 712.92 |

### standard

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 0-180 | 258 | 161.45 | 159.69 | 197.99 | 208.87 | 266.73 |
| 2 | 100 | 180-360 | 648 | 159.49 | 156.97 | 194.05 | 201.81 | 1186.55 |
| 3 | 150 | 360-540 | 1094 | 157.53 | 156.71 | 196.98 | 205.91 | 243.73 |


## Charts

### Latency distribution

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/dark/latency-distribution.png">
  <source media="(prefers-color-scheme: light)" srcset="charts/light/latency-distribution.png">
  <img alt="Latency distribution" src="charts/light/latency-distribution.png">
</picture>
