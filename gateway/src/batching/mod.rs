//! Per-route microbatching and response demultiplexing.
//!
//! `BatcherManager` maintains a map of per-batch-key Tokio tasks. Each task buffers requests for a
//! short period (or until it reaches a maximum size), invokes Lambda once, then dispatches the
//! per-request responses back to the waiting HTTP handlers.

use std::{collections::HashMap, sync::Arc, time::Duration};

use bytes::Bytes;
use dashmap::{mapref::entry::Entry, DashMap};
use http::{HeaderMap, Method, StatusCode};
use tokio::sync::{mpsc, oneshot, Semaphore};

use crate::{
    lambda::LambdaInvoker,
    spec::{BatchKeyDimension, DurationWaitConfig, DynamicWaitConfig, InvokeMode, OperationConfig},
};

mod batch_event_builder;
mod clock;
mod flush;
mod invocation;
mod planner;
mod probe_feedback;
mod response_dispatch;
mod scheduler;
mod wait_policy;
mod wire;

use self::batch_event_builder::{BatchEventBuilder, V1BatchEventBuilder};
use self::clock::{Clock, SystemClock};
#[cfg(test)]
use self::flush::flush_batch;
use self::invocation::{invocation_dispatcher, InvocationJob};
#[cfg(test)]
use self::planner::build_payload_bytes;
use self::probe_feedback::{DefaultProbeFeedbackReporter, ProbeFeedbackReporter};
#[cfg(test)]
use self::response_dispatch::build_gateway_response_parts;
use self::response_dispatch::{DefaultResponseDispatcher, ResponseDispatcher};
use self::scheduler::{batcher_task, BatcherRuntime};
#[cfg(test)]
use self::wait_policy::{sigmoid_wait_ms, smoothed_probe_ms, DynamicRateEstimator};
use self::wait_policy::{DefaultWaitPolicy, DurationWaitPolicy, DynamicWaitPolicy};
#[cfg(test)]
use self::wire::{ApiGatewayV2HttpDescription, ApiGatewayV2RequestContext};
use self::wire::{
    BatchItem, BatchResponse, StreamRecordType, StreamResponseRecord,
    StreamResponseRecordInterleaved, StreamResponseRecordLegacy,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Metadata about the batch that produced a particular per-request response.
pub struct GatewayResponseMeta {
    pub batch_size: usize,
    pub batch_wait_ms: u64,
    pub target_elapsed_ms: Option<u64>,
}

#[derive(Debug, Clone)]
/// HTTP response returned to the original client.
pub struct GatewayResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Bytes,
    pub meta: Option<GatewayResponseMeta>,
}

impl GatewayResponse {
    /// Convenience constructor for a plain text response (no default content-type is set).
    pub fn text(status: StatusCode, body: impl Into<String>) -> Self {
        Self {
            status,
            headers: HeaderMap::new(),
            body: Bytes::from(body.into()),
            meta: None,
        }
    }
}

impl axum::response::IntoResponse for GatewayResponse {
    fn into_response(self) -> axum::response::Response {
        let mut res = axum::response::Response::new(axum::body::Body::from(self.body));
        *res.status_mut() = self.status;
        *res.headers_mut() = self.headers;
        if let Some(meta) = self.meta {
            res.extensions_mut().insert(meta);
        }
        res
    }
}

#[derive(Debug)]
pub(crate) enum ResponseSink {
    Buffered(oneshot::Sender<GatewayResponse>),
    Stream(StreamSender),
}

#[derive(Debug)]
pub(crate) struct StreamSender {
    pub(crate) init: oneshot::Sender<StreamInit>,
    pub(crate) body: mpsc::Sender<Bytes>,
}

#[derive(Debug)]
pub(crate) enum StreamInit {
    Response(GatewayResponse),
    Stream(StreamHead),
}

#[derive(Debug)]
pub(crate) struct StreamHead {
    pub(crate) status: StatusCode,
    pub(crate) headers: HeaderMap,
    pub(crate) meta: GatewayResponseMeta,
}

#[derive(Debug)]
/// A single HTTP request waiting to be included in a batch.
pub struct PendingRequest {
    /// Gateway-generated request identifier (unique within the batch).
    pub id: String,
    pub method: Method,
    pub path: String,
    /// The matched OpenAPI route template (e.g. `/v1/items/{id}`).
    pub route: String,
    /// Path parameters extracted from the route template (e.g. `{ "id": "123" }`).
    pub path_params: HashMap<String, String>,
    /// Header values used for `x-khone.key`, collected before forwarding policy is applied.
    ///
    /// These values influence only batching isolation and are not sent to Lambda unless they also
    /// pass the configured header forwarding policy.
    pub key_headers: HashMap<String, String>,
    pub headers: HashMap<String, String>,
    pub query: HashMap<String, String>,
    /// Raw query string as received (without the leading `?`).
    pub raw_query_string: String,
    pub body: Bytes,
    pub(crate) respond_to: ResponseSink,
}

#[derive(Debug, Clone)]
/// Batching limits and resource caps.
pub struct BatchingConfig {
    /// Global in-flight invocation limit across all routes.
    pub max_inflight_invocations: usize,
    /// Maximum number of queued invocation jobs waiting to be executed.
    ///
    /// When full, the gateway rejects new batches with 429 to avoid unbounded memory growth.
    pub max_pending_invocations: usize,
    /// Per-batch-key queue depth.
    pub max_queue_depth_per_key: usize,
    /// Idle eviction time for per-key batcher tasks.
    pub idle_ttl: Duration,
    /// Maximum JSON payload size sent to Lambda per invocation.
    pub max_invoke_payload_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct BatchKey {
    target_lambda: String,
    method: Method,
    route: String,
    invoke_mode: InvokeMode,
    profiling: bool,
    key_values: Vec<Option<String>>,
}

impl BatchKey {
    fn from_operation_and_request(op: &OperationConfig, req: &PendingRequest) -> Self {
        let key_values = op
            .key
            .iter()
            .map(|dim| match dim {
                BatchKeyDimension::Header(name) => req.key_headers.get(name.as_str()).cloned(),
                BatchKeyDimension::Query(name) => req.query.get(name).cloned(),
            })
            .collect();
        Self {
            target_lambda: op.target_lambda.clone(),
            method: op.method.clone(),
            route: op.route_template.clone(),
            invoke_mode: op.invoke_mode,
            profiling: op.profiling,
            key_values,
        }
    }
}

#[derive(Debug, Clone)]
struct BatcherConfig {
    max_wait_ms: u64,
    max_batch_size: usize,
    dynamic_wait: Option<DynamicWaitConfig>,
    duration_wait: Option<DurationWaitConfig>,
}

#[derive(Debug)]
struct StreamPending {
    init: Option<oneshot::Sender<StreamInit>>,
    body: mpsc::Sender<Bytes>,
}

impl BatcherConfig {
    fn from_operation(op: &OperationConfig) -> Self {
        Self {
            max_wait_ms: op.max_wait_ms,
            max_batch_size: op.max_batch_size,
            dynamic_wait: op.dynamic_wait.clone(),
            duration_wait: op.duration_wait.clone(),
        }
    }
}

#[derive(Clone)]
/// Manages per-batch-key microbatchers.
pub struct BatcherManager {
    cfg: BatchingConfig,
    invocation_tx: mpsc::Sender<InvocationJob>,
    clock: Arc<dyn Clock>,
    batch_event_builder: Arc<dyn BatchEventBuilder>,
    probe_feedback_reporter: Arc<dyn ProbeFeedbackReporter>,
    response_dispatcher: Arc<dyn ResponseDispatcher>,
    dynamic_wait_policy: Arc<dyn DynamicWaitPolicy>,
    duration_wait_policy: Arc<dyn DurationWaitPolicy>,
    batchers: Arc<DashMap<BatchKey, mpsc::Sender<PendingRequest>>>,
}

#[derive(Debug)]
/// Errors that can occur while enqueueing a request for batching.
pub enum EnqueueError {
    /// The per-key queue is at capacity.
    QueueFull,
    /// The batcher task exited while enqueueing.
    BatcherClosed,
}

impl BatcherManager {
    /// Create a new manager using the given Lambda invoker and batching config.
    pub fn new(invoker: Arc<dyn LambdaInvoker>, cfg: BatchingConfig) -> Self {
        let wait_policy = Arc::new(DefaultWaitPolicy);
        let inflight = Arc::new(Semaphore::new(cfg.max_inflight_invocations));
        let (invocation_tx, invocation_rx) = mpsc::channel(cfg.max_pending_invocations.max(1));

        tokio::spawn(invocation_dispatcher(
            Arc::clone(&invoker),
            Arc::clone(&inflight),
            invocation_rx,
        ));

        Self {
            cfg,
            invocation_tx,
            clock: Arc::new(SystemClock),
            batch_event_builder: Arc::new(V1BatchEventBuilder),
            probe_feedback_reporter: Arc::new(DefaultProbeFeedbackReporter),
            response_dispatcher: Arc::new(DefaultResponseDispatcher),
            dynamic_wait_policy: wait_policy.clone(),
            duration_wait_policy: wait_policy,
            batchers: Arc::new(DashMap::new()),
        }
    }

    /// Enqueue a request for batching according to the operation's configuration.
    ///
    /// This function is synchronous and uses `try_send` to apply backpressure immediately.
    pub fn enqueue(
        &self,
        op: &OperationConfig,
        mut req: PendingRequest,
    ) -> Result<(), EnqueueError> {
        let key = BatchKey::from_operation_and_request(op, &req);

        // Handle idle eviction + races by retrying once if the channel is closed.
        for _ in 0..2 {
            let sender = match self.batchers.entry(key.clone()) {
                Entry::Occupied(o) => o.get().clone(),
                Entry::Vacant(v) => {
                    let (tx, rx) = mpsc::channel(self.cfg.max_queue_depth_per_key);
                    v.insert(tx.clone());
                    let batch_cfg = BatcherConfig::from_operation(op);
                    let (duration_tx, duration_rx) =
                        if let Some(cfg) = batch_cfg.duration_wait.as_ref() {
                            let cap = cfg.smoothing_samples.saturating_add(2).max(1);
                            let (tx, rx) = mpsc::channel(cap);
                            (Some(tx), Some(rx))
                        } else {
                            (None, None)
                        };
                    let runtime = BatcherRuntime {
                        idle_ttl: self.cfg.idle_ttl,
                        invocation_tx: self.invocation_tx.clone(),
                        max_invoke_payload_bytes: self.cfg.max_invoke_payload_bytes,
                        duration_feedback_tx: duration_tx,
                        clock: Arc::clone(&self.clock),
                        batch_event_builder: Arc::clone(&self.batch_event_builder),
                        probe_feedback_reporter: Arc::clone(&self.probe_feedback_reporter),
                        response_dispatcher: Arc::clone(&self.response_dispatcher),
                        dynamic_wait_policy: Arc::clone(&self.dynamic_wait_policy),
                        duration_wait_policy: Arc::clone(&self.duration_wait_policy),
                    };
                    tokio::spawn(batcher_task(
                        key.clone(),
                        batch_cfg,
                        rx,
                        duration_rx,
                        runtime,
                        Arc::clone(&self.batchers),
                    ));
                    tx
                }
            };

            match sender.try_send(req) {
                Ok(()) => return Ok(()),
                Err(mpsc::error::TrySendError::Full(_req)) => return Err(EnqueueError::QueueFull),
                Err(mpsc::error::TrySendError::Closed(unsent)) => {
                    self.batchers.remove(&key);
                    req = unsent;
                    continue;
                }
            }
        }

        Err(EnqueueError::BatcherClosed)
    }
}

#[cfg(test)]
mod tests;
