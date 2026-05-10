# Observability Reference

The gateway exposes OpenTelemetry traces and CloudWatch EMF metrics. It does not export
OpenTelemetry metrics today.

## OpenTelemetry Traces

Tracing is enabled when either endpoint variable is set:

- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_ENDPOINT`

Supported protocols:

- `http/protobuf`
- `grpc`

If protocol is not set, the gateway defaults to `grpc` when `OTEL_EXPORTER_OTLP_ENDPOINT` contains
`localhost:4317`, and `http/protobuf` otherwise.

Common variables:

- `OTEL_SERVICE_NAME`
- `KHONE_OBSERVABILITY_VENDOR=AWSXRAY`
- `OTEL_PROPAGATORS` (defaults to `xray,tracecontext,baggage`)
- `OTEL_EXPORTER_OTLP_HEADERS` or `OTEL_EXPORTER_OTLP_TRACES_HEADERS`
- `KHONE_OTEL_HEADERS_JSON`

## EMF Metrics

Enable EMF with:

- `KHONE_EMF_METRICS=1`
- `KHONE_EMF_NAMESPACE=KhoneGateway`
- `KHONE_EMF_HIGH_RES=1`

Dimension sets:

- no dimensions
- `http.route` + `khone.invoke.mode`
- `http.route` + `http.request.method` + `http.response.status_code`

## Metric Inventory

| Metric name | Dimensions | Unit |
| --- | --- | --- |
| `http.server.active_requests` | none | Count |
| `http.server.request.count` | `http.route`, `http.request.method`, `http.response.status_code` | Count |
| `http.server.request.duration` | `http.route`, `http.request.method`, `http.response.status_code` | Millisecond |
| `khone.lambda.invoke.batch.size` | `http.route`, `khone.invoke.mode` | Count |
| `khone.lambda.invoke.batch.wait` | `http.route`, `khone.invoke.mode` | Millisecond |
| `khone.lambda.invoke.duration` | `http.route`, `khone.invoke.mode` | Millisecond |
| `khone.lambda.invoke.billed_duration` | `http.route`, `khone.invoke.mode` | Millisecond |
| `khone.lambda.invoke.init_duration` | `http.route`, `khone.invoke.mode` | Millisecond |
| `khone.lambda.memory.size` | `http.route`, `khone.invoke.mode` | Count |
| `khone.lambda.memory.max_used` | `http.route`, `khone.invoke.mode` | Count |
| `khone.batching.invocation_queue.depth` | none | Count |
| `khone.batching.invocation_queue.rejections` | none | Count |
| `khone.batching.plan.splits` | `http.route`, `khone.invoke.mode` | Count |
| `khone.batching.responses.missing` | `http.route`, `khone.invoke.mode` | Count |
| `khone.batching.probe.success` | none | Count |
| `khone.batching.probe.failure` | none | Count |

Profiling metrics require route-level `x-khone.profiling: true`. Profiling asks Lambda for the last
4 KB of invoke logs and adds overhead.
