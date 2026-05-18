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
| 1 | 0-300s | 5m | 0 | 1 |
| 2 | 300-600s | 5m | 1 | 10 |
| 3 | 600-900s | 5m | 10 | 50 |

### k6 Settings

| Setting | Value |
| :-- | :-- |
| Executor | `ramping-arrival-rate` |
| Mode | `per_endpoint` |
| Profile | `default` |
| Total scheduled duration | `900s` |
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

### Benchmark Scenario Notes

- Target handler Lambdas call the benchmark backend Lambda URL for each item; the backend simulates a delayed downstream response before returning JSON.
- This models an I/O-bound handler where request time is dominated by waiting on another service; CPU-bound handlers are less likely to benefit from batching because there are fewer wait states to overlap.
- Backend delay is `80` ms base plus `80` ms item-key-seeded jitter, for an effective `80-160 ms` backend sleep. This is separate from the k6 max-delay query value.
- Backend responses include `48` generated points per item.
- Benchmark handlers use a `7000` ms timeout when calling the backend.
- The LMI capacity provider for this public run was configured with `m8g` instances. The gateway template used `2048 MB`, `arm64`, `64` concurrent requests per execution environment, `2.0 GiB/vCPU`, and `4/4` execution environments.

## Key Findings

- Fastest p95 endpoint: **standard** at **198.11 ms**.
- Most cost-efficient endpoint (estimate): **target-aware** at **45.14%** of standard baseline.
- Lowest observed error rate is a tie at **0.000%** across: **steady, adaptive, target-aware, standard**.

## Endpoint Ranking

| Rank | Endpoint | p95 (ms) | Error rate | Cost (% of standard) | Effective batch | Requests |
| ---: | :-- | ---: | ---: | ---: | ---: | ---: |
| 1 | standard | 198.11 | 0.000% | 100.00 | 1.00 | 10799 |
| 2 | adaptive | 282.81 | 0.000% | 85.10 | 1.18 | 10799 |
| 3 | steady | 316.52 | 0.000% | 65.39 | 1.53 | 10800 |
| 4 | target-aware | 462.74 | 0.000% | 45.14 | 2.22 | 10800 |

## Stage Latency Stats (per endpoint)

Computed from sampled `http_req_duration` points with status `200`, grouped by configured stage windows.

### steady

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0-300 | 30 | 300.30 | 299.24 | 337.91 | 346.59 | 349.63 |
| 2 | 10 | 300-600 | 341 | 279.63 | 281.40 | 323.18 | 344.94 | 387.86 |
| 3 | 50 | 600-900 | 1629 | 256.10 | 254.65 | 311.15 | 328.38 | 2120.26 |

### adaptive

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0-300 | 36 | 196.70 | 192.12 | 230.68 | 235.20 | 237.16 |
| 2 | 10 | 300-600 | 335 | 190.00 | 190.17 | 230.66 | 256.51 | 599.03 |
| 3 | 50 | 600-900 | 1629 | 211.49 | 208.61 | 276.59 | 308.67 | 1480.95 |

### target-aware

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0-300 | 27 | 270.06 | 220.34 | 471.85 | 487.96 | 489.81 |
| 2 | 10 | 300-600 | 353 | 364.67 | 405.86 | 468.55 | 488.45 | 837.33 |
| 3 | 50 | 600-900 | 1620 | 336.19 | 352.74 | 452.86 | 480.83 | 608.59 |

### standard

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0-300 | 27 | 169.71 | 167.23 | 220.73 | 228.01 | 229.86 |
| 2 | 10 | 300-600 | 366 | 163.41 | 161.88 | 200.80 | 209.65 | 252.24 |
| 3 | 50 | 600-900 | 1607 | 161.76 | 161.58 | 196.83 | 206.46 | 1260.95 |


## Charts

### Latency distribution

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/dark/latency-distribution.png">
  <source media="(prefers-color-scheme: light)" srcset="charts/light/latency-distribution.png">
  <img alt="Latency distribution" src="charts/light/latency-distribution.png">
</picture>
