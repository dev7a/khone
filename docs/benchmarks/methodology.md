---
title: Benchmark methodology
description: How Khone public benchmark reports define endpoints, workload shape, measurements, and cost estimates.
---

# Benchmark methodology

Benchmarks compare Khone gateway routes against a standard API Gateway HTTP API baseline under the
same workload shape.

For public result numbers and charts, start with [Benchmark results](results.md). This page explains
how those reports are produced and how to read the measurements.

## Endpoints

- `steady`: Mode A proxy-layer route with a fixed bounded wait.
- `adaptive`: Mode A proxy-layer route with rate-aware adaptive wait behavior.
- `target-aware`: Mode A proxy-layer route with duration probe-aware wait behavior.
- `standard`: API Gateway HTTP API plus Lambda baseline.

All four endpoints use target handlers that call the same benchmark backend Lambda URL. The backend
simulates a delayed downstream service: for the public snapshot it sleeps for an 80 ms base delay
plus up to 80 ms of item-key-seeded jitter before returning JSON points. That backend delay is
separate from the k6 `max-delay` query value, which was `0ms` in the public reports.

This intentionally models an I/O-bound handler, where much of the request duration is spent waiting
for another service. The benchmark is less representative of CPU-bound handlers, where each item
mostly consumes compute and batching cannot hide wait states.

The public snapshot used 256 MB target handlers on `arm64`. The Khone gateway ran on LMI with a
capacity provider configured with m8g instances, 2048 MB gateway memory, 64 concurrent requests per
execution environment, 2.0 GiB/vCPU, and four warm execution environments during the final pass.

## Measurements

k6 records client-observed `http_req_duration`, status codes, endpoint labels, debug batch headers,
and target elapsed headers when present.

The reports derive:

- request counts and error rates
- latency percentiles
- effective batch size
- estimated target invocation count
- estimated relative cost

## Cost estimates are not bills

The estimate uses observed batch size and router-measured target elapsed time when available. It is a
workload-efficiency proxy, not Lambda billed duration. Real cost depends on target runtime, memory,
architecture, request duration, and AWS pricing. It also excludes gateway LMI capacity cost, Function
URL/API Gateway charges, CloudWatch, networking, and other account-level charges.
