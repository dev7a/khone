# Benchmarking methodology

Benchmarks compare the gateway routes against a standard API Gateway HTTP API baseline under the
same workload shape.

For the public result narrative and charts, start with [Performance and cost](performance-and-cost.md).
This page explains how those reports are produced and how to read the measurements.

## Endpoints

- `steady`: Mode A proxy-layer route with a fixed bounded wait.
- `adaptive`: Mode A proxy-layer route with rate-aware adaptive wait behavior.
- `target-aware`: Mode A proxy-layer route with duration probe-aware wait behavior.
- `standard`: API Gateway HTTP API plus Lambda baseline.

## Measurements

k6 records client-observed `http_req_duration`, status codes, endpoint labels, debug batch headers,
and target elapsed headers when present.

The reports derive:

- request counts and error rates.
- latency percentiles.
- effective batch size.
- estimated target invocation count.
- estimated relative cost.

## Cost estimates are not bills

The estimate uses observed batch size and router-measured target elapsed time when available. It is
a workload-efficiency proxy, not Lambda billed duration. Real cost depends on target runtime,
memory, architecture, request duration, and AWS pricing. It also excludes gateway LMI capacity cost,
Function URL/API Gateway charges, CloudWatch, networking, and other account-level charges.
