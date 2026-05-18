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

### Benchmark Scenario Notes

- Target handler Lambdas call the benchmark backend Lambda URL for each item; the backend simulates a delayed downstream response before returning JSON.
- This models an I/O-bound handler where request time is dominated by waiting on another service; CPU-bound handlers are less likely to benefit from batching because there are fewer wait states to overlap.
- Backend delay is `80` ms base plus `80` ms item-key-seeded jitter, for an effective `80-160 ms` backend sleep. This is separate from the k6 max-delay query value.
- Backend responses include `48` generated points per item.
- Benchmark handlers use a `7000` ms timeout when calling the backend.
- The LMI capacity provider for this public run was configured with `m8g` instances. The gateway template used `2048 MB`, `arm64`, `64` concurrent requests per execution environment, `2.0 GiB/vCPU`, and `4/4` execution environments.

## Key Findings

- Fastest p95 endpoint: **standard** at **195.79 ms**.
- Most cost-efficient endpoint (estimate): **target-aware** at **17.68%** of standard baseline.
- Lowest observed error rate is a tie at **0.000%** across: **steady, adaptive, target-aware, standard**.

## Endpoint Ranking

| Rank | Endpoint | p95 (ms) | Error rate | Cost (% of standard) | Effective batch | Requests |
| ---: | :-- | ---: | ---: | ---: | ---: | ---: |
| 1 | standard | 195.79 | 0.000% | 100.00 | 1.00 | 40499 |
| 2 | adaptive | 301.43 | 0.000% | 36.13 | 2.77 | 40499 |
| 3 | steady | 308.82 | 0.000% | 32.51 | 3.08 | 40499 |
| 4 | target-aware | 466.89 | 0.000% | 17.68 | 5.66 | 40499 |

## Stage Latency Stats (per endpoint)

Computed from sampled `http_req_duration` points with status `200`, grouped by configured stage windows.

### steady

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 0-180 | 247 | 253.36 | 258.47 | 312.97 | 332.60 | 475.85 |
| 2 | 100 | 180-360 | 645 | 240.73 | 242.34 | 302.37 | 369.30 | 877.47 |
| 3 | 150 | 360-540 | 1108 | 236.73 | 238.19 | 300.89 | 322.85 | 459.22 |

### adaptive

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 0-180 | 212 | 208.11 | 205.55 | 271.59 | 292.45 | 350.18 |
| 2 | 100 | 180-360 | 677 | 238.38 | 239.83 | 298.85 | 319.78 | 540.63 |
| 3 | 150 | 360-540 | 1111 | 234.26 | 236.09 | 299.70 | 314.80 | 464.49 |

### target-aware

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 0-180 | 228 | 337.59 | 354.76 | 451.72 | 475.83 | 524.86 |
| 2 | 100 | 180-360 | 673 | 320.94 | 324.70 | 443.95 | 472.95 | 556.15 |
| 3 | 150 | 360-540 | 1099 | 312.37 | 312.33 | 437.32 | 509.72 | 844.91 |

### standard

| Stage | Target (rps) | Window (s) | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| ---: | ---: | :-- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 0-180 | 230 | 164.49 | 165.56 | 196.93 | 204.15 | 551.20 |
| 2 | 100 | 180-360 | 701 | 160.31 | 160.36 | 196.55 | 207.77 | 261.40 |
| 3 | 150 | 360-540 | 1069 | 158.10 | 156.98 | 195.64 | 210.46 | 310.08 |


## Charts

### Latency distribution

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/dark/latency-distribution.png">
  <source media="(prefers-color-scheme: light)" srcset="charts/light/latency-distribution.png">
  <img alt="Latency distribution" src="charts/light/latency-distribution.png">
</picture>
