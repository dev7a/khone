use std::{collections::HashMap, sync::Arc};

use bytes::Bytes;
use http::StatusCode;
use tokio::sync::{mpsc, oneshot, OwnedSemaphorePermit, Semaphore};

use crate::lambda::{LambdaInvokeResult, LambdaInvoker};

use super::scheduler::DurationFeedback;
use super::{
    clock::Clock, probe_feedback::ProbeFeedbackReporter, response_dispatch::ResponseDispatcher,
    BatchKey, GatewayResponse, StreamPending,
};

pub(super) enum InvocationJob {
    Buffered {
        clock: Arc<dyn Clock>,
        probe_feedback_reporter: Arc<dyn ProbeFeedbackReporter>,
        dispatcher: Arc<dyn ResponseDispatcher>,
        key: BatchKey,
        wait_ms: u64,
        estimated_rps: Option<f64>,
        is_probe: bool,
        duration_feedback_tx: Option<mpsc::Sender<DurationFeedback>>,
        payload: Bytes,
        pending: HashMap<String, oneshot::Sender<GatewayResponse>>,
    },
    Stream {
        clock: Arc<dyn Clock>,
        probe_feedback_reporter: Arc<dyn ProbeFeedbackReporter>,
        dispatcher: Arc<dyn ResponseDispatcher>,
        key: BatchKey,
        wait_ms: u64,
        estimated_rps: Option<f64>,
        is_probe: bool,
        duration_feedback_tx: Option<mpsc::Sender<DurationFeedback>>,
        payload: Bytes,
        pending: HashMap<String, StreamPending>,
    },
}

impl InvocationJob {
    pub(super) fn fail(self, status: StatusCode, msg: String) {
        match self {
            InvocationJob::Buffered {
                probe_feedback_reporter,
                dispatcher,
                wait_ms,
                is_probe,
                duration_feedback_tx,
                pending,
                ..
            } => {
                if is_probe {
                    probe_feedback_reporter.report_best_effort(duration_feedback_tx, false, 0);
                }
                let batch_size = pending.len();
                dispatcher.fail_all_buffered(pending, batch_size, wait_ms, None, status, msg)
            }
            InvocationJob::Stream {
                probe_feedback_reporter,
                dispatcher,
                wait_ms,
                is_probe,
                duration_feedback_tx,
                pending,
                ..
            } => {
                if is_probe {
                    probe_feedback_reporter.report_best_effort(duration_feedback_tx, false, 0);
                }
                let batch_size = pending.len();
                dispatcher.fail_all_stream(pending, batch_size, wait_ms, None, status, msg)
            }
        }
    }
}

pub(super) async fn invocation_dispatcher(
    invoker: Arc<dyn LambdaInvoker>,
    inflight: Arc<Semaphore>,
    mut rx: mpsc::Receiver<InvocationJob>,
) {
    while let Some(job) = rx.recv().await {
        let permit = match inflight.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => {
                job.fail(StatusCode::BAD_GATEWAY, "gateway shutting down".to_string());
                continue;
            }
        };

        let invoker = Arc::clone(&invoker);
        tokio::spawn(async move {
            run_invocation_job(invoker, permit, job).await;
        });
    }
}

async fn run_invocation_job(
    invoker: Arc<dyn LambdaInvoker>,
    _permit: OwnedSemaphorePermit,
    job: InvocationJob,
) {
    match job {
        InvocationJob::Buffered {
            clock,
            probe_feedback_reporter,
            dispatcher,
            key,
            wait_ms,
            estimated_rps,
            is_probe,
            duration_feedback_tx,
            payload,
            pending,
        } => {
            let started = clock.mono_now();
            let batch_size = pending.len();
            tracing::debug!(
                event = "lambda_invoke",
                target_lambda = %key.target_lambda,
                method = %key.method,
                route = %key.route,
                invoke_mode = ?key.invoke_mode,
                wait_ms,
                estimated_rps = estimated_rps,
                batch_size,
                payload_bytes = payload.len(),
                "invoking"
            );

            match invoker
                .invoke(&key.target_lambda, payload, key.invoke_mode, key.profiling)
                .await
            {
                Ok(LambdaInvokeResult::Buffered {
                    payload: bytes,
                    report,
                }) => {
                    if key.profiling {
                        crate::metrics::emit_lambda_invoke_profile(
                            key.route.clone(),
                            key.invoke_mode,
                            batch_size,
                            wait_ms,
                            report.as_ref(),
                        );
                    }
                    let target_elapsed_ms =
                        clock.mono_now().duration_since(started).as_millis() as u64;
                    dispatcher.dispatch_buffered(&key, wait_ms, target_elapsed_ms, bytes, pending);
                    if is_probe {
                        probe_feedback_reporter
                            .report_async(duration_feedback_tx.as_ref(), true, target_elapsed_ms)
                            .await;
                    }
                }
                Ok(LambdaInvokeResult::ResponseStream { .. }) => {
                    tracing::warn!(
                        event = "lambda_response_error",
                        reason = "unexpected_stream",
                        target_lambda = %key.target_lambda,
                        route = %key.route,
                        batch_size,
                        "unexpected response stream for buffered invocation"
                    );
                    dispatcher.fail_all_buffered(
                        pending,
                        batch_size,
                        wait_ms,
                        Some(clock.mono_now().duration_since(started).as_millis() as u64),
                        StatusCode::BAD_GATEWAY,
                        "unexpected response stream".to_string(),
                    );
                    if is_probe {
                        probe_feedback_reporter
                            .report_async(
                                duration_feedback_tx.as_ref(),
                                false,
                                clock.mono_now().duration_since(started).as_millis() as u64,
                            )
                            .await;
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        event = "lambda_invoke_failed",
                        target_lambda = %key.target_lambda,
                        route = %key.route,
                        batch_size,
                        error = %err,
                        "lambda invoke failed"
                    );
                    dispatcher.fail_all_buffered(
                        pending,
                        batch_size,
                        wait_ms,
                        Some(clock.mono_now().duration_since(started).as_millis() as u64),
                        StatusCode::BAD_GATEWAY,
                        format!("invoke: {err}"),
                    );
                    if is_probe {
                        probe_feedback_reporter
                            .report_async(
                                duration_feedback_tx.as_ref(),
                                false,
                                clock.mono_now().duration_since(started).as_millis() as u64,
                            )
                            .await;
                    }
                }
            }
        }
        InvocationJob::Stream {
            clock,
            probe_feedback_reporter,
            dispatcher,
            key,
            wait_ms,
            estimated_rps,
            is_probe,
            duration_feedback_tx,
            payload,
            pending,
        } => {
            let started = clock.mono_now();
            let batch_size = pending.len();
            tracing::debug!(
                event = "lambda_invoke",
                target_lambda = %key.target_lambda,
                method = %key.method,
                route = %key.route,
                invoke_mode = ?key.invoke_mode,
                wait_ms,
                estimated_rps = estimated_rps,
                batch_size,
                payload_bytes = payload.len(),
                "invoking"
            );

            match invoker
                .invoke(&key.target_lambda, payload, key.invoke_mode, key.profiling)
                .await
            {
                Ok(LambdaInvokeResult::Buffered { .. }) => {
                    tracing::warn!(
                        event = "lambda_response_error",
                        reason = "unexpected_buffered",
                        target_lambda = %key.target_lambda,
                        route = %key.route,
                        batch_size,
                        "unexpected buffered response for streaming invocation"
                    );
                    dispatcher.fail_all_stream(
                        pending,
                        batch_size,
                        wait_ms,
                        Some(clock.mono_now().duration_since(started).as_millis() as u64),
                        StatusCode::BAD_GATEWAY,
                        "unexpected buffered response".to_string(),
                    );
                    if is_probe {
                        probe_feedback_reporter
                            .report_async(
                                duration_feedback_tx.as_ref(),
                                false,
                                clock.mono_now().duration_since(started).as_millis() as u64,
                            )
                            .await;
                    }
                }
                Ok(LambdaInvokeResult::ResponseStream { stream, report }) => {
                    if key.profiling {
                        if let Some(report_rx) = report {
                            let route = key.route.clone();
                            let invoke_mode = key.invoke_mode;
                            let batch_wait_ms = wait_ms;
                            tokio::spawn(async move {
                                if let Ok(report) = report_rx.await {
                                    crate::metrics::emit_lambda_invoke_profile(
                                        route,
                                        invoke_mode,
                                        batch_size,
                                        batch_wait_ms,
                                        Some(&report),
                                    );
                                }
                            });
                        } else {
                            crate::metrics::emit_lambda_invoke_profile(
                                key.route.clone(),
                                key.invoke_mode,
                                batch_size,
                                wait_ms,
                                None,
                            );
                        }
                    }
                    dispatcher
                        .dispatch_response_stream(&key, wait_ms, started, stream, pending)
                        .await;
                    if is_probe {
                        probe_feedback_reporter
                            .report_async(
                                duration_feedback_tx.as_ref(),
                                true,
                                clock.mono_now().duration_since(started).as_millis() as u64,
                            )
                            .await;
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        event = "lambda_invoke_failed",
                        target_lambda = %key.target_lambda,
                        route = %key.route,
                        batch_size,
                        error = %err,
                        "lambda invoke failed"
                    );
                    dispatcher.fail_all_stream(
                        pending,
                        batch_size,
                        wait_ms,
                        Some(clock.mono_now().duration_since(started).as_millis() as u64),
                        StatusCode::BAD_GATEWAY,
                        format!("invoke: {err}"),
                    );
                    if is_probe {
                        probe_feedback_reporter
                            .report_async(
                                duration_feedback_tx.as_ref(),
                                false,
                                clock.mono_now().duration_since(started).as_millis() as u64,
                            )
                            .await;
                    }
                }
            }
        }
    }
}
