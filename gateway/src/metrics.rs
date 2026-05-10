use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use metrique::unit::Millisecond;
use metrique::unit_of_work::metrics;
use metrique::writer::GlobalEntrySink;
use metrique::{append_and_close, ServiceMetrics};
use metrique_writer_format_emf::{Emf, HighStorageResolution};

use crate::lambda::LambdaInvokeReport;
use crate::spec::InvokeMode;

static EMF_ENABLED: AtomicBool = AtomicBool::new(false);
static HTTP_SERVER_ACTIVE_REQUESTS: AtomicU64 = AtomicU64::new(0);

fn env_truthy(name: &str) -> bool {
    matches!(
        std::env::var(name).ok().as_deref().map(str::trim),
        Some("1")
            | Some("true")
            | Some("TRUE")
            | Some("yes")
            | Some("YES")
            | Some("on")
            | Some("ON")
    )
}

fn invoke_mode_value(invoke_mode: InvokeMode) -> String {
    match invoke_mode {
        InvokeMode::Buffered => "buffered".to_string(),
        InvokeMode::ResponseStream => "response_stream".to_string(),
    }
}

/// Attach an EMF writer to the global `ServiceMetrics` sink (stdout).
///
/// When `KHONE_EMF_METRICS` is unset/falsey, this is a no-op and returns `Ok(None)`.
pub fn init_emf_from_env() -> anyhow::Result<Option<metrique::writer::sink::AttachHandle>> {
    if !env_truthy("KHONE_EMF_METRICS") {
        return Ok(None);
    }

    let high_res = env_truthy("KHONE_EMF_HIGH_RES");

    let namespace = std::env::var("KHONE_EMF_NAMESPACE")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "KhoneGateway".to_string());

    // Provide both "global" aggregation (no dimensions) and per-route/mode series.
    let dimension_sets = vec![
        vec![],
        vec!["http.route".to_string(), "khone.invoke.mode".to_string()],
        vec![
            "http.route".to_string(),
            "http.request.method".to_string(),
            "http.response.status_code".to_string(),
        ],
    ];

    // `attach_to_stream` comes from `metrique::writer::AttachGlobalEntrySinkExt`.
    use metrique::writer::AttachGlobalEntrySinkExt as _;
    use metrique::writer::FormatExt as _;

    let stream = Emf::no_validations(namespace.clone(), dimension_sets)
        .output_to_makewriter(|| std::io::stdout().lock());
    let handle = if high_res {
        ServiceMetrics::attach_to_stream(HighStorageResolution::from(stream))
    } else {
        ServiceMetrics::attach_to_stream(stream)
    };
    tracing::info!(
        event = "emf_metrics_enabled",
        namespace = %namespace,
        high_resolution = high_res,
        "attached EMF metrics sink"
    );
    EMF_ENABLED.store(true, Ordering::Relaxed);
    Ok(Some(handle))
}

#[metrics]
struct KhoneLambdaInvokeProfile {
    // Dimensions must be strings when using EMF.
    #[metrics(name = "http.route")]
    http_route: String,
    #[metrics(name = "khone.invoke.mode")]
    khone_invoke_mode: String,

    #[metrics(name = "khone.lambda.invoke.batch.size")]
    batch_size: u64,
    #[metrics(name = "khone.lambda.invoke.batch.wait", unit = Millisecond)]
    batch_wait_ms: u64,

    #[metrics(name = "khone.lambda.invoke.duration", unit = Millisecond)]
    lambda_duration_ms: Option<f64>,
    #[metrics(name = "khone.lambda.invoke.billed_duration", unit = Millisecond)]
    lambda_billed_duration_ms: Option<f64>,
    #[metrics(name = "khone.lambda.invoke.init_duration", unit = Millisecond)]
    lambda_init_duration_ms: Option<f64>,

    #[metrics(name = "khone.lambda.memory.size")]
    memory_size_mb: Option<u64>,
    #[metrics(name = "khone.lambda.memory.max_used")]
    max_memory_used_mb: Option<u64>,
}

#[metrics]
struct KhoneHttpServer {
    #[metrics(name = "http.server.active_requests")]
    http_server_active_requests: u64,
}

#[metrics]
struct KhoneHttpServerRequest {
    #[metrics(name = "http.route")]
    http_route: String,
    #[metrics(name = "http.request.method")]
    http_request_method: String,
    #[metrics(name = "http.response.status_code")]
    http_response_status_code: String,
    #[metrics(name = "http.server.request.duration", unit = Millisecond)]
    http_server_request_duration_ms: u64,
    #[metrics(name = "http.server.request.count")]
    http_server_request_count: u64,
}

#[metrics]
struct KhoneBatchingQueueDepth {
    #[metrics(name = "khone.batching.invocation_queue.depth")]
    depth: u64,
}

#[metrics]
struct KhoneBatchingQueueRejections {
    #[metrics(name = "khone.batching.invocation_queue.rejections")]
    rejections: u64,
}

#[metrics]
struct KhoneBatchingProbeSuccess {
    #[metrics(name = "khone.batching.probe.success")]
    success: u64,
}

#[metrics]
struct KhoneBatchingProbeFailure {
    #[metrics(name = "khone.batching.probe.failure")]
    failure: u64,
}

#[metrics]
struct KhoneBatchingPlanSplits {
    #[metrics(name = "http.route")]
    http_route: String,
    #[metrics(name = "khone.invoke.mode")]
    khone_invoke_mode: String,
    #[metrics(name = "khone.batching.plan.splits")]
    splits: u64,
}

#[metrics]
struct KhoneBatchingResponsesMissing {
    #[metrics(name = "http.route")]
    http_route: String,
    #[metrics(name = "khone.invoke.mode")]
    khone_invoke_mode: String,
    #[metrics(name = "khone.batching.responses.missing")]
    missing: u64,
}

fn emit_http_server_active_requests(active_requests: u64) {
    if !EMF_ENABLED.load(Ordering::Relaxed) {
        return;
    }

    drop(append_and_close(
        KhoneHttpServer {
            http_server_active_requests: active_requests,
        },
        ServiceMetrics::sink(),
    ));
}

pub fn emit_http_server_request(
    route: String,
    method: String,
    status_code: http::StatusCode,
    duration_ms: u64,
) {
    if !EMF_ENABLED.load(Ordering::Relaxed) {
        return;
    }

    drop(append_and_close(
        KhoneHttpServerRequest {
            http_route: route,
            http_request_method: method,
            http_response_status_code: status_code.as_u16().to_string(),
            http_server_request_duration_ms: duration_ms,
            http_server_request_count: 1,
        },
        ServiceMetrics::sink(),
    ));
}

pub fn emit_batched_invocation_queue_depth(depth: u64) {
    if !EMF_ENABLED.load(Ordering::Relaxed) {
        return;
    }

    drop(append_and_close(
        KhoneBatchingQueueDepth { depth },
        ServiceMetrics::sink(),
    ));
}

pub fn emit_batched_invocation_queue_rejection() {
    if !EMF_ENABLED.load(Ordering::Relaxed) {
        return;
    }

    drop(append_and_close(
        KhoneBatchingQueueRejections { rejections: 1 },
        ServiceMetrics::sink(),
    ));
}

pub fn emit_batched_probe_feedback(success: bool) {
    if !EMF_ENABLED.load(Ordering::Relaxed) {
        return;
    }

    if success {
        drop(append_and_close(
            KhoneBatchingProbeSuccess { success: 1 },
            ServiceMetrics::sink(),
        ));
    } else {
        drop(append_and_close(
            KhoneBatchingProbeFailure { failure: 1 },
            ServiceMetrics::sink(),
        ));
    }
}

pub fn emit_batched_plan_splits(route: String, invoke_mode: InvokeMode, splits: u64) {
    if !EMF_ENABLED.load(Ordering::Relaxed) || splits == 0 {
        return;
    }

    drop(append_and_close(
        KhoneBatchingPlanSplits {
            http_route: route,
            khone_invoke_mode: invoke_mode_value(invoke_mode),
            splits,
        },
        ServiceMetrics::sink(),
    ));
}

pub fn emit_batched_missing_responses(route: String, invoke_mode: InvokeMode, missing: u64) {
    if !EMF_ENABLED.load(Ordering::Relaxed) || missing == 0 {
        return;
    }

    drop(append_and_close(
        KhoneBatchingResponsesMissing {
            http_route: route,
            khone_invoke_mode: invoke_mode_value(invoke_mode),
            missing,
        },
        ServiceMetrics::sink(),
    ));
}

fn decrement_active_requests_saturating() -> u64 {
    loop {
        let current = HTTP_SERVER_ACTIVE_REQUESTS.load(Ordering::Relaxed);
        let next = current.saturating_sub(1);
        if HTTP_SERVER_ACTIVE_REQUESTS
            .compare_exchange(current, next, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            return next;
        }
    }
}

pub struct HttpServerActiveRequestGuard;

impl Drop for HttpServerActiveRequestGuard {
    fn drop(&mut self) {
        let current = decrement_active_requests_saturating();
        emit_http_server_active_requests(current);
    }
}

pub fn start_http_server_request() -> Option<HttpServerActiveRequestGuard> {
    if !EMF_ENABLED.load(Ordering::Relaxed) {
        return None;
    }

    let current = HTTP_SERVER_ACTIVE_REQUESTS.fetch_add(1, Ordering::Relaxed) + 1;
    emit_http_server_active_requests(current);
    Some(HttpServerActiveRequestGuard)
}

pub fn emit_lambda_invoke_profile(
    route: impl Into<String>,
    invoke_mode: InvokeMode,
    batch_size: usize,
    batch_wait_ms: u64,
    report: Option<&LambdaInvokeReport>,
) {
    if !EMF_ENABLED.load(Ordering::Relaxed) {
        return;
    }

    let report = report.cloned().unwrap_or_default();

    // `ServiceMetrics::sink()` will panic if no sink is attached; keep it behind `EMF_ENABLED`.
    drop(append_and_close(
        KhoneLambdaInvokeProfile {
            http_route: route.into(),
            khone_invoke_mode: invoke_mode_value(invoke_mode),
            batch_size: batch_size as u64,
            batch_wait_ms,
            lambda_duration_ms: report.duration_ms,
            lambda_billed_duration_ms: report.billed_duration_ms,
            lambda_init_duration_ms: report.init_duration_ms,
            memory_size_mb: report.memory_size_mb,
            max_memory_used_mb: report.max_memory_used_mb,
        },
        ServiceMetrics::sink(),
    ));
}
