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

- Fastest p95 endpoint: **standard** at **198.08 ms**.
- Most cost-efficient endpoint (estimate): **pct** at **46.41%** of standard baseline.
- Lowest observed error rate is a tie at **0.000%** across: **mux, pct, standard**.

## Endpoint Ranking

| Rank | Endpoint | p95 (ms) | Error rate | Cost (% of standard) | Effective batch | Requests |
| ---: | :-- | ---: | ---: | ---: | ---: | ---: |
| 1 | standard | 198.08 | 0.000% | 100.00 | 1.00 | 10950 |
| 2 | mux | 276.63 | 0.000% | 85.50 | 1.17 | 10950 |
| 3 | pct | 458.42 | 0.000% | 46.41 | 2.15 | 10950 |

## Stage Latency Stats (per endpoint)

Computed from sampled `http_req_duration` points with status `200`, grouped by configured stage windows.

### mux

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0-1 | 1 | 158.83 | 158.83 | 158.83 | 158.83 | 158.83 |
| 2 | 1 | 1-301 | 300 | 193.02 | 193.17 | 231.79 | 250.35 | 396.70 |
| 3 | 10 | 301-601 | 1660 | 190.48 | 190.52 | 228.65 | 240.07 | 602.76 |
| 4 | 50 | 601-901 | 8989 | 213.19 | 210.13 | 280.74 | 306.11 | 1456.90 |

### pct

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0-1 | 1 | 242.42 | 242.42 | 242.42 | 242.42 | 242.42 |
| 2 | 1 | 1-301 | 300 | 292.90 | 219.63 | 466.99 | 492.88 | 812.99 |
| 3 | 10 | 301-601 | 1658 | 367.17 | 408.70 | 473.69 | 497.55 | 1691.76 |
| 4 | 50 | 601-901 | 8991 | 334.77 | 349.89 | 451.49 | 484.38 | 1697.14 |

### standard

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0-1 | 1 | 141.51 | 141.51 | 141.51 | 141.51 | 141.51 |
| 2 | 1 | 1-301 | 300 | 169.47 | 169.62 | 205.47 | 213.55 | 332.67 |
| 3 | 10 | 301-601 | 1661 | 162.92 | 161.64 | 200.77 | 208.38 | 515.21 |
| 4 | 50 | 601-901 | 8988 | 160.90 | 159.21 | 197.52 | 205.85 | 1263.46 |


## Charts

### Latency distribution

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/dark/latency-distribution.png">
  <source media="(prefers-color-scheme: light)" srcset="charts/light/latency-distribution.png">
  <img alt="Latency distribution" src="charts/light/latency-distribution.png">
</picture>
