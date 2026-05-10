use std::{collections::HashMap, sync::Arc};

use http::StatusCode;
use tokio::sync::{mpsc, oneshot};

use crate::spec::InvokeMode;

use super::planner::{
    encode_body, extract_source_ip, parse_cookie_header, plan_invocations, InvocationPlan,
};
use super::scheduler::BatcherRuntime;
use super::wire::{ApiGatewayV2HttpDescription, ApiGatewayV2RequestContext, BatchItem};
use super::{
    BatchKey, GatewayResponse, InvocationJob, PendingRequest, ResponseSink, StreamPending,
};

pub(super) async fn flush_batch(
    key: &BatchKey,
    runtime: &BatcherRuntime,
    wait_ms: u64,
    estimated_rps: Option<f64>,
    is_probe: bool,
    batch: Vec<PendingRequest>,
) {
    let received_at_ms = runtime.clock.wall_now_ms();

    let mut pending_buffered: HashMap<String, oneshot::Sender<GatewayResponse>> = HashMap::new();
    let mut pending_stream: HashMap<String, StreamPending> = HashMap::new();
    let mut batch_items = Vec::with_capacity(batch.len());
    for req in batch {
        let id = req.id;
        match req.respond_to {
            ResponseSink::Buffered(tx) => {
                pending_buffered.insert(id.clone(), tx);
            }
            ResponseSink::Stream(stream) => {
                pending_stream.insert(
                    id.clone(),
                    StreamPending {
                        init: Some(stream.init),
                        body: stream.body,
                    },
                );
            }
        }

        let route_key = format!("{} {}", req.method, req.route);
        let source_ip = extract_source_ip(&req.headers);
        let user_agent = req.headers.get("user-agent").cloned();
        let cookies = parse_cookie_header(&req.headers);
        let (body, is_base64_encoded) = encode_body(&req.body);

        batch_items.push(BatchItem {
            id: id.clone(),
            version: "2.0",
            route_key: route_key.clone(),
            raw_path: req.path.clone(),
            raw_query_string: req.raw_query_string,
            cookies,
            headers: req.headers,
            query_string_parameters: req.query,
            path_parameters: req.path_params,
            request_context: ApiGatewayV2RequestContext {
                account_id: None,
                api_id: None,
                domain_name: None,
                domain_prefix: None,
                route_key: route_key.clone(),
                stage: "$default",
                request_id: id,
                time: None,
                time_epoch: received_at_ms as i64,
                http: ApiGatewayV2HttpDescription {
                    method: req.method.to_string(),
                    path: req.path,
                    protocol: "HTTP/1.1",
                    source_ip,
                    user_agent,
                },
            },
            stage_variables: HashMap::new(),
            body,
            is_base64_encoded,
        });
    }

    if key.invoke_mode == InvokeMode::Buffered {
        if !pending_stream.is_empty() {
            tracing::warn!(
                event = "batcher_state_error",
                reason = "unexpected_stream_sink",
                target_lambda = %key.target_lambda,
                route = %key.route,
                pending = pending_stream.len(),
                "unexpected streaming response sink for buffered invocation"
            );
            let batch_size = pending_stream.len();
            runtime.response_dispatcher.fail_all_stream(
                pending_stream,
                batch_size,
                wait_ms,
                None,
                StatusCode::BAD_GATEWAY,
                "unexpected streaming response sink".to_string(),
            );
        }

        let planned = plan_invocations(
            runtime.batch_event_builder.as_ref(),
            key,
            received_at_ms,
            runtime.max_invoke_payload_bytes,
            pending_buffered,
            batch_items,
        );
        if planned.split_count > 0 {
            crate::metrics::emit_batched_plan_splits(
                key.route.clone(),
                key.invoke_mode,
                planned.split_count,
            );
        }

        for plan in planned.plans {
            match plan {
                InvocationPlan::Fail {
                    pending,
                    status,
                    msg,
                } => {
                    tracing::warn!(
                        event = "lambda_invocation_plan_failed",
                        target_lambda = %key.target_lambda,
                        route = %key.route,
                        status = %status,
                        batch_size = pending.len(),
                        error = %msg,
                        "invocation plan failed"
                    );
                    let batch_size = pending.len();
                    runtime
                        .response_dispatcher
                        .fail_all_buffered(pending, batch_size, wait_ms, None, status, msg)
                }
                InvocationPlan::Invoke { pending, payload } => {
                    let job = InvocationJob::Buffered {
                        clock: Arc::clone(&runtime.clock),
                        probe_feedback_reporter: Arc::clone(&runtime.probe_feedback_reporter),
                        dispatcher: Arc::clone(&runtime.response_dispatcher),
                        key: key.clone(),
                        wait_ms,
                        estimated_rps,
                        is_probe,
                        duration_feedback_tx: runtime.duration_feedback_tx.clone(),
                        payload,
                        pending,
                    };
                    enqueue_invocation_job(key, runtime, wait_ms, job);
                }
            }
        }
    } else {
        if !pending_buffered.is_empty() {
            tracing::warn!(
                event = "batcher_state_error",
                reason = "unexpected_buffered_sink",
                target_lambda = %key.target_lambda,
                route = %key.route,
                pending = pending_buffered.len(),
                "unexpected buffered response sink for streaming invocation"
            );
            let batch_size = pending_buffered.len();
            runtime.response_dispatcher.fail_all_buffered(
                pending_buffered,
                batch_size,
                wait_ms,
                None,
                StatusCode::BAD_GATEWAY,
                "unexpected buffered response sink".to_string(),
            );
        }

        let planned = plan_invocations(
            runtime.batch_event_builder.as_ref(),
            key,
            received_at_ms,
            runtime.max_invoke_payload_bytes,
            pending_stream,
            batch_items,
        );
        if planned.split_count > 0 {
            crate::metrics::emit_batched_plan_splits(
                key.route.clone(),
                key.invoke_mode,
                planned.split_count,
            );
        }

        for plan in planned.plans {
            match plan {
                InvocationPlan::Fail {
                    pending,
                    status,
                    msg,
                } => {
                    tracing::warn!(
                        event = "lambda_invocation_plan_failed",
                        target_lambda = %key.target_lambda,
                        route = %key.route,
                        status = %status,
                        batch_size = pending.len(),
                        error = %msg,
                        "invocation plan failed"
                    );
                    let batch_size = pending.len();
                    runtime
                        .response_dispatcher
                        .fail_all_stream(pending, batch_size, wait_ms, None, status, msg)
                }
                InvocationPlan::Invoke { pending, payload } => {
                    let job = InvocationJob::Stream {
                        clock: Arc::clone(&runtime.clock),
                        probe_feedback_reporter: Arc::clone(&runtime.probe_feedback_reporter),
                        dispatcher: Arc::clone(&runtime.response_dispatcher),
                        key: key.clone(),
                        wait_ms,
                        estimated_rps,
                        is_probe,
                        duration_feedback_tx: runtime.duration_feedback_tx.clone(),
                        payload,
                        pending,
                    };
                    enqueue_invocation_job(key, runtime, wait_ms, job);
                }
            }
        }
    }
}

fn enqueue_invocation_job(
    key: &BatchKey,
    runtime: &BatcherRuntime,
    wait_ms: u64,
    job: InvocationJob,
) {
    let depth = runtime
        .invocation_tx
        .max_capacity()
        .saturating_sub(runtime.invocation_tx.capacity());
    crate::metrics::emit_batched_invocation_queue_depth(depth as u64);

    match runtime.invocation_tx.try_send(job) {
        Ok(()) => {
            let depth = runtime
                .invocation_tx
                .max_capacity()
                .saturating_sub(runtime.invocation_tx.capacity());
            crate::metrics::emit_batched_invocation_queue_depth(depth as u64);
        }
        Err(mpsc::error::TrySendError::Full(job)) => {
            crate::metrics::emit_batched_invocation_queue_rejection();
            tracing::debug!(
                event = "invoke_rejected",
                reason = "invocation_queue_full",
                target_lambda = %key.target_lambda,
                route = %key.route,
                wait_ms,
                "invocation queue full"
            );
            job.fail(
                StatusCode::TOO_MANY_REQUESTS,
                "gateway overloaded".to_string(),
            );
        }
        Err(mpsc::error::TrySendError::Closed(job)) => {
            job.fail(StatusCode::BAD_GATEWAY, "gateway shutting down".to_string());
        }
    }
}
