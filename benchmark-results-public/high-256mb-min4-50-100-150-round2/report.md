# Benchmark Report

Executor: ramping-arrival-rate
Mode: per_endpoint
Max delay: 0ms
Endpoints: mux, pct, standard

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
| mux |
| pct |
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

- Fastest p95 endpoint: **standard** at **202.20 ms**.
- Most cost-efficient endpoint (estimate): **pct** at **17.77%** of standard baseline.
- Lowest observed error rate is a tie at **0.000%** across: **mux, pct, standard**.

## Endpoint Ranking

| Rank | Endpoint | p95 (ms) | Error rate | Cost (% of standard) | Effective batch | Requests |
| ---: | :-- | ---: | ---: | ---: | ---: | ---: |
| 1 | standard | 202.20 | 0.000% | 100.00 | 1.00 | 40499 |
| 2 | mux | 302.03 | 0.000% | 36.37 | 2.75 | 40499 |
| 3 | pct | 469.53 | 0.000% | 17.77 | 5.63 | 40498 |

## Stage Latency Stats (per endpoint)

Computed from sampled `http_req_duration` points with status `200`, grouped by configured stage windows.

### mux

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 0-180 | 224 | 212.42 | 213.83 | 276.53 | 293.79 | 311.30 |
| 2 | 100 | 180-360 | 712 | 236.13 | 237.61 | 297.57 | 318.04 | 607.01 |
| 3 | 150 | 360-540 | 1064 | 238.99 | 238.30 | 299.23 | 320.10 | 511.86 |

### pct

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 0-180 | 245 | 342.79 | 361.70 | 467.86 | 488.63 | 662.53 |
| 2 | 100 | 180-360 | 681 | 322.84 | 326.35 | 439.46 | 511.48 | 828.34 |
| 3 | 150 | 360-540 | 1074 | 316.94 | 316.00 | 447.31 | 505.72 | 841.50 |

### standard

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 0-180 | 231 | 159.55 | 155.60 | 198.32 | 206.00 | 374.94 |
| 2 | 100 | 180-360 | 711 | 158.06 | 156.47 | 194.60 | 202.34 | 221.72 |
| 3 | 150 | 360-540 | 1058 | 157.15 | 155.06 | 194.80 | 206.11 | 266.30 |


## Charts

### Latency distribution

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/dark/latency-distribution.png">
  <source media="(prefers-color-scheme: light)" srcset="charts/light/latency-distribution.png">
  <img alt="Latency distribution" src="charts/light/latency-distribution.png">
</picture>
