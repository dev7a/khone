---
title: Observability
description: Enable Khone traces, CloudWatch EMF metrics, profiling metrics, and debug response headers.
---

# Observability

Use traces and metrics together. Gateway latency, batch size, target invocation duration, and 429
sources can move independently, especially when LMI scales out into multiple independent execution
environments.

## OpenTelemetry traces

Tracing is enabled when either endpoint variable is set:

- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_ENDPOINT`

Supported protocols:

- `http/protobuf`
- `grpc`

Protocol can be set explicitly via `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` or
`OTEL_EXPORTER_OTLP_PROTOCOL`. Otherwise the gateway defaults to `grpc` when
`OTEL_EXPORTER_OTLP_ENDPOINT` contains `localhost:4317`, and `http/protobuf` otherwise.

Common variables:

- `OTEL_SERVICE_NAME`
- `KHONE_OBSERVABILITY_VENDOR=AWSXRAY` (exact match, case-sensitive)
- `OTEL_PROPAGATORS` (defaults to `xray,tracecontext,baggage`)
- `OTEL_EXPORTER_OTLP_HEADERS` or `OTEL_EXPORTER_OTLP_TRACES_HEADERS`
- `KHONE_OTEL_HEADERS_JSON` - JSON object of header names to string values. The gateway encodes it
  into `OTEL_EXPORTER_OTLP_HEADERS` at startup if neither headers variable is already set.

The gateway does not export OpenTelemetry metrics. When OpenTelemetry tracing is enabled, it sets
`OTEL_METRICS_EXPORTER=none` if the variable is unset.

## CloudWatch EMF metrics

Enable EMF by setting `KHONE_EMF_METRICS` to a truthy value. The truthy parser accepts `1`,
`true`/`TRUE`, `yes`/`YES`, or `on`/`ON`.

- `KHONE_EMF_METRICS=1` enables EMF emission.
- `KHONE_EMF_NAMESPACE=KhoneGateway` sets the CloudWatch namespace. The default is `KhoneGateway`.
- `KHONE_EMF_HIGH_RES=1` requests high storage resolution.

Dimension sets:

- no dimensions
- `http.route` + `khone.invoke.mode`
- `http.route` + `http.request.method` + `http.response.status_code`

## Metric inventory

| Metric name | Dimensions | Unit (EMF) |
| --- | --- | --- |
| `http.server.active_requests` | none | Count |
| `http.server.request.count` | `http.route`, `http.request.method`, `http.response.status_code` | Count |
| `http.server.request.duration` | `http.route`, `http.request.method`, `http.response.status_code` | Millisecond |
| `khone.lambda.invoke.batch.size` | `http.route`, `khone.invoke.mode` | Count |
| `khone.lambda.invoke.batch.wait` | `http.route`, `khone.invoke.mode` | Millisecond |
| `khone.lambda.invoke.duration` | `http.route`, `khone.invoke.mode` | Millisecond |
| `khone.lambda.invoke.billed_duration` | `http.route`, `khone.invoke.mode` | Millisecond |
| `khone.lambda.invoke.init_duration` | `http.route`, `khone.invoke.mode` | Millisecond |
| `khone.lambda.memory.size` | `http.route`, `khone.invoke.mode` | Count [^mb] |
| `khone.lambda.memory.max_used` | `http.route`, `khone.invoke.mode` | Count [^mb] |
| `khone.batching.invocation_queue.depth` | none | Count |
| `khone.batching.invocation_queue.rejections` | none | Count |
| `khone.batching.plan.splits` | `http.route`, `khone.invoke.mode` | Count |
| `khone.batching.responses.missing` | `http.route`, `khone.invoke.mode` | Count |
| `khone.batching.probe.success` | none | Count |
| `khone.batching.probe.failure` | none | Count |

[^mb]: Values are in megabytes but emitted without an EMF unit annotation.

Profiling metrics (`billed_duration`, `init_duration`, `memory.size`, `memory.max_used`) require
route-level `x-khone.profiling: true`. Profiling asks Lambda for the last 4 KB of invoke logs and
adds overhead.

## Debug response headers

Setting `KHONE_DEBUG_RESPONSE_HEADERS` to a truthy value adds these headers to every gateway
response:

- `x-khone-batch-size`
- `x-khone-target-elapsed-ms`

Use debug headers during integration or load testing only; they leak internal scheduling
information.
