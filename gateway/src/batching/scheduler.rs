use std::{collections::VecDeque, sync::Arc, time::Duration};

use dashmap::DashMap;
use tokio::sync::mpsc;

use super::flush::flush_batch;
use super::wait_policy::{
    record_probe_sample, smoothed_probe_ms, stable_probe_offset_ms, DurationWaitPolicy,
    DynamicRateEstimator, DynamicWaitPolicy,
};
use super::{
    batch_event_builder::BatchEventBuilder, clock::Clock, probe_feedback::ProbeFeedbackReporter,
    response_dispatch::ResponseDispatcher, BatchKey, BatcherConfig, InvocationJob, PendingRequest,
};
use crate::spec::{DurationWaitConfig, DynamicWaitConfig};

pub(super) struct BatcherRuntime {
    pub(super) idle_ttl: Duration,
    pub(super) invocation_tx: mpsc::Sender<InvocationJob>,
    pub(super) max_invoke_payload_bytes: usize,
    pub(super) duration_feedback_tx: Option<mpsc::Sender<DurationFeedback>>,
    pub(super) clock: Arc<dyn Clock>,
    pub(super) batch_event_builder: Arc<dyn BatchEventBuilder>,
    pub(super) probe_feedback_reporter: Arc<dyn ProbeFeedbackReporter>,
    pub(super) response_dispatcher: Arc<dyn ResponseDispatcher>,
    pub(super) dynamic_wait_policy: Arc<dyn DynamicWaitPolicy>,
    pub(super) duration_wait_policy: Arc<dyn DurationWaitPolicy>,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct DurationFeedback {
    pub(super) is_probe: bool,
    pub(super) success: bool,
    pub(super) elapsed_ms: u64,
}

pub(super) async fn batcher_task(
    key: BatchKey,
    cfg: BatcherConfig,
    rx: mpsc::Receiver<PendingRequest>,
    duration_rx: Option<mpsc::Receiver<DurationFeedback>>,
    runtime: BatcherRuntime,
    batchers: Arc<DashMap<BatchKey, mpsc::Sender<PendingRequest>>>,
) {
    if let Some(duration_wait) = cfg.duration_wait {
        let duration_rx = duration_rx.unwrap_or_else(|| {
            let (_tx, rx) = mpsc::channel(1);
            rx
        });
        batcher_task_duration(
            &key,
            cfg.max_wait_ms,
            cfg.max_batch_size,
            duration_wait,
            rx,
            duration_rx,
            &runtime,
        )
        .await;
    } else if let Some(dynamic_wait) = cfg.dynamic_wait {
        batcher_task_dynamic(
            &key,
            cfg.max_wait_ms,
            cfg.max_batch_size,
            dynamic_wait,
            rx,
            &runtime,
        )
        .await;
    } else {
        batcher_task_fixed(&key, cfg.max_wait_ms, cfg.max_batch_size, rx, &runtime).await;
    }

    batchers.remove(&key);
}

async fn batcher_task_fixed(
    key: &BatchKey,
    max_wait_ms: u64,
    max_batch_size: usize,
    mut rx: mpsc::Receiver<PendingRequest>,
    runtime: &BatcherRuntime,
) {
    loop {
        let first = match tokio::time::timeout(runtime.idle_ttl, rx.recv()).await {
            Ok(Some(req)) => req,
            Ok(None) => break,
            Err(_) => break,
        };

        let max_wait = Duration::from_millis(max_wait_ms);
        let mut batch = vec![first];

        if max_batch_size > 1 {
            let flush_at = runtime.clock.mono_now() + max_wait;
            while batch.len() < max_batch_size {
                let now = runtime.clock.mono_now();
                if now >= flush_at {
                    break;
                }

                let remaining = flush_at - now;
                match tokio::time::timeout(remaining, rx.recv()).await {
                    Ok(Some(req)) => batch.push(req),
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        }

        flush_batch(key, runtime, max_wait_ms, None, false, batch).await;
    }
}

async fn batcher_task_duration(
    key: &BatchKey,
    max_wait_ms: u64,
    max_batch_size: usize,
    duration_wait: DurationWaitConfig,
    mut rx: mpsc::Receiver<PendingRequest>,
    mut duration_rx: mpsc::Receiver<DurationFeedback>,
    runtime: &BatcherRuntime,
) {
    let probe_interval = Duration::from_millis(duration_wait.probe_interval_ms);
    let offset_ms = stable_probe_offset_ms(key, duration_wait.probe_jitter_ms);
    let offset = Duration::from_millis(offset_ms);
    let mut next_probe_at = runtime.clock.mono_now() + probe_interval + offset;

    let mut probe_samples_ms: VecDeque<f64> =
        VecDeque::with_capacity(duration_wait.smoothing_samples);
    let mut probe_inflight = false;

    loop {
        let idle_sleep = tokio::time::sleep(runtime.idle_ttl);
        tokio::pin!(idle_sleep);

        let first = loop {
            tokio::select! {
                _ = &mut idle_sleep => return,
                fb = duration_rx.recv() => {
                    let Some(fb) = fb else { /* sender dropped */ continue; };
                    if fb.is_probe {
                        probe_inflight = false;
                        if fb.success {
                            record_probe_sample(
                                &mut probe_samples_ms,
                                duration_wait.smoothing_samples,
                                fb.elapsed_ms,
                            );
                        }
                    }
                }
                req = rx.recv() => match req {
                    Some(r) => break r,
                    None => return,
                }
            }
        };

        let now = runtime.clock.mono_now();
        let probe_due = now >= next_probe_at;
        if probe_due {
            while next_probe_at <= now {
                next_probe_at += probe_interval;
            }
        }
        let should_probe = !probe_inflight && probe_due;

        if should_probe {
            probe_inflight = true;
            flush_batch(
                key,
                runtime,
                duration_wait.min_wait_ms,
                None,
                true,
                vec![first],
            )
            .await;
            continue;
        }

        let probe_ms = if probe_samples_ms.len() >= duration_wait.warmup_probes {
            smoothed_probe_ms(&probe_samples_ms)
        } else {
            0.0
        };
        let wait_ms = runtime.duration_wait_policy.wait_ms(
            probe_ms,
            duration_wait.fraction,
            duration_wait.min_wait_ms,
            max_wait_ms,
        );
        let mut batch = vec![first];

        let flush_at = runtime.clock.mono_now() + Duration::from_millis(wait_ms);
        let flush_sleep = tokio::time::sleep_until(flush_at);
        tokio::pin!(flush_sleep);

        let mut closed = false;
        while batch.len() < max_batch_size {
            tokio::select! {
                _ = &mut flush_sleep => break,
                fb = duration_rx.recv() => {
                    let Some(fb) = fb else { continue; };
                    if fb.is_probe {
                        probe_inflight = false;
                        if fb.success {
                            record_probe_sample(
                                &mut probe_samples_ms,
                                duration_wait.smoothing_samples,
                                fb.elapsed_ms,
                            );
                        }
                    }
                }
                req = rx.recv() => match req {
                    Some(r) => {
                        batch.push(r);
                        if batch.len() >= max_batch_size {
                            break;
                        }
                    }
                    None => {
                        closed = true;
                        break;
                    }
                }
            }
        }

        flush_batch(key, runtime, wait_ms, None, false, batch).await;
        if closed {
            return;
        }
    }
}

async fn batcher_task_dynamic(
    key: &BatchKey,
    max_wait_ms: u64,
    max_batch_size: usize,
    dynamic_wait: DynamicWaitConfig,
    mut rx: mpsc::Receiver<PendingRequest>,
    runtime: &BatcherRuntime,
) {
    let interval = Duration::from_millis(dynamic_wait.sampling_interval_ms);
    let mut sampler = tokio::time::interval(interval);
    sampler.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    // Tokio intervals tick immediately; advance to the first full interval.
    sampler.tick().await;

    let mut est = DynamicRateEstimator::new(interval, dynamic_wait.smoothing_samples);

    loop {
        let idle_sleep = tokio::time::sleep(runtime.idle_ttl);
        tokio::pin!(idle_sleep);

        let first = loop {
            tokio::select! {
                _ = &mut idle_sleep => return,
                _ = sampler.tick() => {
                    est.tick();
                }
                req = rx.recv() => match req {
                    Some(r) => break r,
                    None => return,
                }
            }
        };

        est.record_request();
        let wait_ms = runtime.dynamic_wait_policy.wait_ms(
            est.smoothed_rps(),
            dynamic_wait.min_wait_ms,
            max_wait_ms,
            dynamic_wait.target_rps,
            dynamic_wait.steepness,
        );
        let mut batch = vec![first];

        let flush_at = runtime.clock.mono_now() + Duration::from_millis(wait_ms);
        let flush_sleep = tokio::time::sleep_until(flush_at);
        tokio::pin!(flush_sleep);

        let mut closed = false;
        while batch.len() < max_batch_size {
            tokio::select! {
                _ = &mut flush_sleep => break,
                _ = sampler.tick() => {
                    est.tick();
                }
                req = rx.recv() => match req {
                    Some(r) => {
                        est.record_request();
                        batch.push(r);
                        if batch.len() >= max_batch_size {
                            break;
                        }
                    }
                    None => {
                        closed = true;
                        break;
                    }
                }
            }
        }

        let smoothed_rps = est.smoothed_rps();
        flush_batch(key, runtime, wait_ms, Some(smoothed_rps), false, batch).await;

        if closed {
            return;
        }
    }
}
