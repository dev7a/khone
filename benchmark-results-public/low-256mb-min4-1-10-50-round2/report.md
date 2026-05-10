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
| 1 | 0-1s | 1s | 0 | 1 |
| 2 | 1-301s | 5m | 1 | 1 |
| 3 | 301-601s | 5m | 1 | 10 |
| 4 | 601-901s | 5m | 10 | 50 |

### k6 Settings

| Setting | Value |
| :-- | :-- |
| Executor | `ramping-arrival-rate` |
| Mode | `per_endpoint` |
| Profile | `default` |
| Total scheduled duration | `901s` |
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

- Fastest p95 endpoint: **standard** at **197.97 ms**.
- Most cost-efficient endpoint (estimate): **pct** at **45.74%** of standard baseline.
- Lowest observed error rate is a tie at **0.000%** across: **mux, pct, standard**.

## Endpoint Ranking

| Rank | Endpoint | p95 (ms) | Error rate | Cost (% of standard) | Effective batch | Requests |
| ---: | :-- | ---: | ---: | ---: | ---: | ---: |
| 1 | standard | 197.97 | 0.000% | 100.00 | 1.00 | 10950 |
| 2 | mux | 274.86 | 0.000% | 85.26 | 1.17 | 10950 |
| 3 | pct | 460.06 | 0.000% | 45.74 | 2.19 | 10950 |

## Stage Latency Stats (per endpoint)

Computed from sampled `http_req_duration` points with status `200`, grouped by configured stage windows.

### mux

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0-1 | 1 | 232.71 | 232.71 | 232.71 | 232.71 | 232.71 |
| 2 | 1 | 1-301 | 300 | 191.57 | 190.12 | 230.68 | 242.28 | 337.40 |
| 3 | 10 | 301-601 | 1657 | 191.17 | 189.70 | 230.35 | 248.43 | 489.76 |
| 4 | 50 | 601-901 | 8992 | 211.09 | 207.90 | 278.86 | 305.27 | 1617.57 |

### pct

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0-1 | 1 | 177.46 | 177.46 | 177.46 | 177.46 | 177.46 |
| 2 | 1 | 1-301 | 300 | 283.98 | 211.17 | 471.15 | 486.46 | 540.97 |
| 3 | 10 | 301-601 | 1655 | 370.12 | 412.43 | 475.34 | 499.23 | 1738.29 |
| 4 | 50 | 601-901 | 8994 | 336.21 | 350.65 | 452.52 | 483.52 | 1351.66 |

### standard

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0-1 | 1 | 186.95 | 186.95 | 186.95 | 186.95 | 186.95 |
| 2 | 1 | 1-301 | 300 | 163.46 | 160.28 | 202.26 | 225.28 | 303.44 |
| 3 | 10 | 301-601 | 1657 | 163.54 | 162.24 | 200.79 | 209.03 | 562.55 |
| 4 | 50 | 601-901 | 8992 | 160.89 | 159.17 | 197.27 | 206.06 | 1331.48 |


## Charts

### Latency distribution

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/dark/latency-distribution.png">
  <source media="(prefers-color-scheme: light)" srcset="charts/light/latency-distribution.png">
  <img alt="Latency distribution" src="charts/light/latency-distribution.png">
</picture>
