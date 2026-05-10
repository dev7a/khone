use super::*;
use crate::lambda::LambdaInvokeResult;
use crate::lambda::LambdaInvoker;
use crate::spec::{DurationWaitConfig, InvokeMode};
use async_trait::async_trait;
use aws_lambda_events::event::apigw::ApiGatewayV2httpRequest;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    sync::atomic::{AtomicUsize, Ordering},
};

fn pending(id: &str) -> (PendingRequest, oneshot::Receiver<GatewayResponse>) {
    pending_with_body(id, Bytes::new())
}

fn pending_with_body(
    id: &str,
    body: Bytes,
) -> (PendingRequest, oneshot::Receiver<GatewayResponse>) {
    let (tx, rx) = oneshot::channel();
    (
        PendingRequest {
            id: id.to_string(),
            method: Method::GET,
            path: "/hello".to_string(),
            route: "/hello".to_string(),
            path_params: HashMap::new(),
            key_headers: HashMap::new(),
            headers: HashMap::new(),
            query: HashMap::new(),
            raw_query_string: String::new(),
            body,
            respond_to: ResponseSink::Buffered(tx),
        },
        rx,
    )
}

fn stream_pending(
    id: &str,
) -> (
    PendingRequest,
    oneshot::Receiver<StreamInit>,
    mpsc::Receiver<Bytes>,
) {
    let (init_tx, init_rx) = oneshot::channel();
    let (body_tx, body_rx) = mpsc::channel(16);
    (
        PendingRequest {
            id: id.to_string(),
            method: Method::GET,
            path: "/hello".to_string(),
            route: "/hello".to_string(),
            path_params: HashMap::new(),
            key_headers: HashMap::new(),
            headers: HashMap::new(),
            query: HashMap::new(),
            raw_query_string: String::new(),
            body: Bytes::new(),
            respond_to: ResponseSink::Stream(StreamSender {
                init: init_tx,
                body: body_tx,
            }),
        },
        init_rx,
        body_rx,
    )
}

#[test]
fn batch_items_deserialize_as_apigw_v2_events() {
    #[derive(Deserialize)]
    struct Envelope {
        v: u8,
        batch: Vec<ApiGatewayV2httpRequest>,
    }

    let key = BatchKey {
        target_lambda: "fn".to_string(),
        method: Method::GET,
        route: "/hello".to_string(),
        invoke_mode: InvokeMode::Buffered,
        profiling: false,
        key_values: vec![],
    };

    let item = BatchItem {
        id: "r-1".to_string(),
        version: "2.0",
        route_key: "GET /hello".to_string(),
        raw_path: "/hello".to_string(),
        raw_query_string: "x=1".to_string(),
        cookies: None,
        headers: HashMap::from([("x-foo".to_string(), "bar".to_string())]),
        query_string_parameters: HashMap::from([("x".to_string(), "1".to_string())]),
        path_parameters: HashMap::new(),
        request_context: ApiGatewayV2RequestContext {
            account_id: None,
            api_id: None,
            domain_name: None,
            domain_prefix: None,
            route_key: "GET /hello".to_string(),
            stage: "$default",
            request_id: "r-1".to_string(),
            time: None,
            time_epoch: 1_700_000_000_000,
            http: ApiGatewayV2HttpDescription {
                method: "GET".to_string(),
                path: "/hello".to_string(),
                protocol: "HTTP/1.1",
                source_ip: None,
                user_agent: None,
            },
        },
        stage_variables: HashMap::new(),
        body: Some("hi".to_string()),
        is_base64_encoded: false,
    };

    let payload = build_payload_bytes(&key, 1_700_000_000_000, &[item]).unwrap();
    let raw: serde_json::Value = serde_json::from_slice(&payload).unwrap();
    assert!(raw["batch"][0]["httpMethod"].is_null());
    let env: Envelope = serde_json::from_slice(&payload).unwrap();
    assert_eq!(env.v, 1);
    assert_eq!(env.batch.len(), 1);
    let evt = &env.batch[0];

    assert_eq!(evt.version.as_deref(), Some("2.0"));
    assert_eq!(evt.route_key.as_deref(), Some("GET /hello"));
    assert_eq!(evt.raw_path.as_deref(), Some("/hello"));
    assert_eq!(evt.raw_query_string.as_deref(), Some("x=1"));
    assert_eq!(evt.request_context.request_id.as_deref(), Some("r-1"));
    assert_eq!(evt.request_context.http.method, Method::GET);
}

#[test]
fn response_cookies_become_set_cookie_headers() {
    let resp = build_gateway_response_parts(
        200,
        HashMap::from([("content-type".to_string(), "text/plain".to_string())]),
        vec![
            "a=b; Path=/; HttpOnly".to_string(),
            "c=d; Path=/; Secure".to_string(),
        ],
        "ok".to_string(),
        false,
    )
    .unwrap();

    let cookies: Vec<String> = resp
        .headers
        .get_all(http::header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect();
    assert_eq!(cookies.len(), 2);
    assert!(cookies[0].starts_with("a=b"));
    assert!(cookies[1].starts_with("c=d"));
}

struct EchoInvoker {
    calls: AtomicUsize,
}

#[async_trait]
impl LambdaInvoker for EchoInvoker {
    async fn invoke(
        &self,
        _function_name: &str,
        payload: Bytes,
        mode: InvokeMode,
        _profiling: bool,
    ) -> anyhow::Result<LambdaInvokeResult> {
        assert_eq!(mode, InvokeMode::Buffered);
        self.calls.fetch_add(1, Ordering::SeqCst);

        let input: serde_json::Value = serde_json::from_slice(&payload)?;
        let batch = input["batch"].as_array().expect("batch array");

        #[derive(Serialize)]
        struct Out {
            v: u8,
            responses: Vec<OutItem>,
        }
        #[derive(Serialize)]
        struct OutItem {
            id: String,
            #[serde(rename = "statusCode")]
            status_code: u16,
            headers: HashMap<String, String>,
            body: String,
            #[serde(rename = "isBase64Encoded")]
            is_base64_encoded: bool,
        }
        let out = Out {
            v: 1,
            responses: batch
                .iter()
                .map(|item| OutItem {
                    id: item["requestContext"]["requestId"]
                        .as_str()
                        .expect("requestId")
                        .to_string(),
                    status_code: 200,
                    headers: HashMap::new(),
                    body: "ok".to_string(),
                    is_base64_encoded: false,
                })
                .collect(),
        };

        Ok(LambdaInvokeResult::Buffered {
            payload: Bytes::from(serde_json::to_vec(&out)?),
            report: None,
        })
    }
}

fn op_cfg(max_wait_ms: u64, max_batch_size: usize) -> OperationConfig {
    OperationConfig {
        route_template: "/hello".to_string(),
        method: Method::GET,
        operation_id: None,
        target_lambda: "fn".to_string(),
        max_wait_ms,
        max_batch_size,
        key: vec![],
        timeout_ms: 1000,
        invoke_mode: InvokeMode::Buffered,
        profiling: false,
        dynamic_wait: None,
        duration_wait: None,
    }
}

fn op_cfg_stream(max_wait_ms: u64, max_batch_size: usize) -> OperationConfig {
    OperationConfig {
        route_template: "/hello".to_string(),
        method: Method::GET,
        operation_id: None,
        target_lambda: "fn".to_string(),
        max_wait_ms,
        max_batch_size,
        key: vec![],
        timeout_ms: 1000,
        invoke_mode: InvokeMode::ResponseStream,
        profiling: false,
        dynamic_wait: None,
        duration_wait: None,
    }
}

#[tokio::test]
async fn flushes_by_batch_size() {
    let invoker = Arc::new(EchoInvoker {
        calls: AtomicUsize::new(0),
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg(10_000, 2);

    let (tx1, rx1) = oneshot::channel();
    mgr.enqueue(
        &op,
        PendingRequest {
            id: "a".to_string(),
            method: Method::GET,
            path: "/hello".to_string(),
            route: "/hello".to_string(),
            path_params: HashMap::new(),
            key_headers: HashMap::new(),
            headers: HashMap::new(),
            query: HashMap::new(),
            raw_query_string: String::new(),
            body: Bytes::new(),
            respond_to: ResponseSink::Buffered(tx1),
        },
    )
    .unwrap();

    let (tx2, rx2) = oneshot::channel();
    mgr.enqueue(
        &op,
        PendingRequest {
            id: "b".to_string(),
            method: Method::GET,
            path: "/hello".to_string(),
            route: "/hello".to_string(),
            path_params: HashMap::new(),
            key_headers: HashMap::new(),
            headers: HashMap::new(),
            query: HashMap::new(),
            raw_query_string: String::new(),
            body: Bytes::new(),
            respond_to: ResponseSink::Buffered(tx2),
        },
    )
    .unwrap();

    let r1 = rx1.await.expect("resp1");
    let r2 = rx2.await.expect("resp2");

    assert_eq!(r1.status, StatusCode::OK);
    assert_eq!(r2.status, StatusCode::OK);
}

#[tokio::test(start_paused = true)]
async fn flushes_by_timer() {
    let invoker = Arc::new(EchoInvoker {
        calls: AtomicUsize::new(0),
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg(10, 16);
    let (tx, rx) = oneshot::channel();
    mgr.enqueue(
        &op,
        PendingRequest {
            id: "a".to_string(),
            method: Method::GET,
            path: "/hello".to_string(),
            route: "/hello".to_string(),
            path_params: HashMap::new(),
            key_headers: HashMap::new(),
            headers: HashMap::new(),
            query: HashMap::new(),
            raw_query_string: String::new(),
            body: Bytes::new(),
            respond_to: ResponseSink::Buffered(tx),
        },
    )
    .unwrap();

    tokio::time::advance(Duration::from_millis(10)).await;
    tokio::task::yield_now().await;

    let r = rx.await.expect("resp");
    assert_eq!(r.status, StatusCode::OK);
}

struct RecordingInvoker {
    batch_sizes: tokio::sync::Mutex<Vec<usize>>,
}

#[async_trait]
impl LambdaInvoker for RecordingInvoker {
    async fn invoke(
        &self,
        _function_name: &str,
        payload: Bytes,
        mode: InvokeMode,
        _profiling: bool,
    ) -> anyhow::Result<LambdaInvokeResult> {
        assert_eq!(mode, InvokeMode::Buffered);
        let v: serde_json::Value = serde_json::from_slice(&payload)?;
        let batch = v["batch"].as_array().expect("batch array");
        self.batch_sizes.lock().await.push(batch.len());

        let responses = batch
            .iter()
            .map(|item| {
                let id = item["requestContext"]["requestId"]
                    .as_str()
                    .expect("requestId");
                serde_json::json!({
                  "id": id,
                  "statusCode": 200,
                  "headers": {},
                  "body": "ok",
                  "isBase64Encoded": false
                })
            })
            .collect::<Vec<_>>();

        let out = serde_json::json!({
          "v": 1,
          "responses": responses
        });

        Ok(LambdaInvokeResult::Buffered {
            payload: Bytes::from(serde_json::to_vec(&out)?),
            report: None,
        })
    }
}

struct SleepingRecordingInvoker {
    batch_sizes: tokio::sync::Mutex<Vec<usize>>,
    sleep: Duration,
}

#[async_trait]
impl LambdaInvoker for SleepingRecordingInvoker {
    async fn invoke(
        &self,
        _function_name: &str,
        payload: Bytes,
        mode: InvokeMode,
        _profiling: bool,
    ) -> anyhow::Result<LambdaInvokeResult> {
        assert_eq!(mode, InvokeMode::Buffered);
        let v: serde_json::Value = serde_json::from_slice(&payload)?;
        let batch = v["batch"].as_array().expect("batch array");
        self.batch_sizes.lock().await.push(batch.len());

        tokio::time::sleep(self.sleep).await;

        let responses = batch
            .iter()
            .map(|item| {
                let id = item["requestContext"]["requestId"]
                    .as_str()
                    .expect("requestId");
                serde_json::json!({
                  "id": id,
                  "statusCode": 200,
                  "headers": {},
                  "body": "ok",
                  "isBase64Encoded": false
                })
            })
            .collect::<Vec<_>>();

        let out = serde_json::json!({
          "v": 1,
          "responses": responses
        });

        Ok(LambdaInvokeResult::Buffered {
            payload: Bytes::from(serde_json::to_vec(&out)?),
            report: None,
        })
    }
}

fn op_cfg_duration(
    max_wait_ms: u64,
    max_batch_size: usize,
    fraction: f64,
    probe_interval_ms: u64,
) -> OperationConfig {
    let mut op = op_cfg(max_wait_ms, max_batch_size);
    op.duration_wait = Some(DurationWaitConfig {
        fraction,
        min_wait_ms: 0,
        probe_interval_ms,
        probe_jitter_ms: 0,
        smoothing_samples: 1,
        warmup_probes: 1,
    });
    op
}

#[test]
fn duration_wait_smoothing_trims_single_outlier() {
    let samples = VecDeque::from(vec![160.0, 170.0, 180.0, 2_000.0]);
    assert_eq!(smoothed_probe_ms(&samples), 175.0);
}

#[tokio::test]
async fn header_key_dimension_batches_same_value_together() {
    let invoker = Arc::new(RecordingInvoker {
        batch_sizes: tokio::sync::Mutex::new(Vec::new()),
    });
    let mgr = BatcherManager::new(
        invoker.clone(),
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let mut op = op_cfg(10_000, 2);
    op.key = vec![BatchKeyDimension::Header(
        http::HeaderName::from_bytes(b"x-tenant-id").unwrap(),
    )];

    let (mut req_a, rx_a) = pending("a");
    req_a
        .key_headers
        .insert("x-tenant-id".to_string(), "t1".to_string());
    mgr.enqueue(&op, req_a).unwrap();

    let (mut req_b, rx_b) = pending("b");
    req_b
        .key_headers
        .insert("x-tenant-id".to_string(), "t1".to_string());
    mgr.enqueue(&op, req_b).unwrap();

    assert_eq!(rx_a.await.unwrap().status, StatusCode::OK);
    assert_eq!(rx_b.await.unwrap().status, StatusCode::OK);

    let mut sizes = invoker.batch_sizes.lock().await.clone();
    sizes.sort_unstable();
    assert_eq!(sizes, vec![2]);
}

#[tokio::test(start_paused = true)]
async fn duration_wait_starts_at_min_wait_before_first_scheduled_probe() {
    let invoker = Arc::new(SleepingRecordingInvoker {
        batch_sizes: tokio::sync::Mutex::new(Vec::new()),
        sleep: Duration::from_millis(100),
    });
    let mgr = BatcherManager::new(
        invoker.clone(),
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg_duration(2_000, 16, 0.5, 1_000);
    let (req_a, rx_a) = pending("a");
    mgr.enqueue(&op, req_a).unwrap();

    tokio::time::advance(Duration::from_millis(100)).await;
    tokio::task::yield_now().await;
    assert_eq!(rx_a.await.unwrap().status, StatusCode::OK);

    let (req_b, rx_b) = pending("b");
    mgr.enqueue(&op, req_b).unwrap();
    tokio::time::advance(Duration::from_millis(100)).await;
    tokio::task::yield_now().await;
    assert_eq!(rx_b.await.unwrap().status, StatusCode::OK);

    let sizes = invoker.batch_sizes.lock().await.clone();
    assert_eq!(sizes, vec![1, 1]);
}

#[tokio::test(start_paused = true)]
async fn duration_wait_batches_requests_with_computed_window() {
    let invoker = Arc::new(SleepingRecordingInvoker {
        batch_sizes: tokio::sync::Mutex::new(Vec::new()),
        sleep: Duration::from_millis(100),
    });
    let mgr = BatcherManager::new(
        invoker.clone(),
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg_duration(2_000, 16, 0.5, 1_000);

    // Initial traffic uses minWaitMs until a scheduled probe has completed.
    let (req_a, rx_a) = pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    tokio::time::advance(Duration::from_millis(100)).await;
    tokio::task::yield_now().await;
    assert_eq!(rx_a.await.unwrap().status, StatusCode::OK);

    // The first scheduled probe is still a single request and takes 100ms.
    tokio::time::advance(Duration::from_millis(1_000)).await;
    tokio::task::yield_now().await;
    let (req_probe, rx_probe) = pending("probe");
    mgr.enqueue(&op, req_probe).unwrap();
    tokio::time::advance(Duration::from_millis(100)).await;
    tokio::task::yield_now().await;
    assert_eq!(rx_probe.await.unwrap().status, StatusCode::OK);

    // After the probe, the next window should be ~150ms (100ms * 1.5).
    let (req_b, rx_b) = pending("b");
    mgr.enqueue(&op, req_b).unwrap();
    let (req_c, rx_c) = pending("c");
    mgr.enqueue(&op, req_c).unwrap();

    tokio::time::advance(Duration::from_millis(149)).await;
    tokio::task::yield_now().await;
    assert_eq!(invoker.batch_sizes.lock().await.len(), 2);

    // Trigger timer flush and let invocation complete.
    tokio::time::advance(Duration::from_millis(1)).await;
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_millis(100)).await;
    tokio::task::yield_now().await;

    assert_eq!(rx_b.await.unwrap().status, StatusCode::OK);
    assert_eq!(rx_c.await.unwrap().status, StatusCode::OK);

    let sizes = invoker.batch_sizes.lock().await.clone();
    assert_eq!(sizes, vec![1, 1, 2]);
}

#[tokio::test(start_paused = true)]
async fn duration_wait_periodic_probe_forces_single_request() {
    let invoker = Arc::new(SleepingRecordingInvoker {
        batch_sizes: tokio::sync::Mutex::new(Vec::new()),
        sleep: Duration::from_millis(10),
    });
    let mgr = BatcherManager::new(
        invoker.clone(),
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg_duration(2_000, 16, 0.0, 1_000);
    let (req_a, rx_a) = pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    tokio::time::advance(Duration::from_millis(10)).await;
    tokio::task::yield_now().await;
    assert_eq!(rx_a.await.unwrap().status, StatusCode::OK);

    tokio::time::advance(Duration::from_millis(1_000)).await;
    tokio::task::yield_now().await;

    let (req_b, rx_b) = pending("b");
    mgr.enqueue(&op, req_b).unwrap();
    tokio::time::advance(Duration::from_millis(10)).await;
    tokio::task::yield_now().await;
    assert_eq!(rx_b.await.unwrap().status, StatusCode::OK);

    let sizes = invoker.batch_sizes.lock().await.clone();
    assert_eq!(sizes, vec![1, 1]);
}

#[tokio::test(start_paused = true)]
async fn header_key_dimension_separates_different_values() {
    let invoker = Arc::new(RecordingInvoker {
        batch_sizes: tokio::sync::Mutex::new(Vec::new()),
    });
    let mgr = BatcherManager::new(
        invoker.clone(),
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let mut op = op_cfg(10, 2);
    op.key = vec![BatchKeyDimension::Header(
        http::HeaderName::from_bytes(b"x-tenant-id").unwrap(),
    )];

    let (mut req_a, rx_a) = pending("a");
    req_a
        .key_headers
        .insert("x-tenant-id".to_string(), "t1".to_string());
    mgr.enqueue(&op, req_a).unwrap();

    let (mut req_b, rx_b) = pending("b");
    req_b
        .key_headers
        .insert("x-tenant-id".to_string(), "t2".to_string());
    mgr.enqueue(&op, req_b).unwrap();

    tokio::time::advance(Duration::from_millis(10)).await;
    tokio::task::yield_now().await;

    assert_eq!(rx_a.await.unwrap().status, StatusCode::OK);
    assert_eq!(rx_b.await.unwrap().status, StatusCode::OK);

    let mut sizes = invoker.batch_sizes.lock().await.clone();
    sizes.sort_unstable();
    assert_eq!(sizes, vec![1, 1]);
}

#[tokio::test]
async fn query_key_dimension_batches_same_value_together() {
    let invoker = Arc::new(RecordingInvoker {
        batch_sizes: tokio::sync::Mutex::new(Vec::new()),
    });
    let mgr = BatcherManager::new(
        invoker.clone(),
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let mut op = op_cfg(10_000, 2);
    op.key = vec![BatchKeyDimension::Query("version".to_string())];

    let (mut req_a, rx_a) = pending("a");
    req_a.query.insert("version".to_string(), "v1".to_string());
    mgr.enqueue(&op, req_a).unwrap();

    let (mut req_b, rx_b) = pending("b");
    req_b.query.insert("version".to_string(), "v1".to_string());
    mgr.enqueue(&op, req_b).unwrap();

    assert_eq!(rx_a.await.unwrap().status, StatusCode::OK);
    assert_eq!(rx_b.await.unwrap().status, StatusCode::OK);

    let mut sizes = invoker.batch_sizes.lock().await.clone();
    sizes.sort_unstable();
    assert_eq!(sizes, vec![2]);
}

#[tokio::test(start_paused = true)]
async fn query_key_dimension_separates_different_values() {
    let invoker = Arc::new(RecordingInvoker {
        batch_sizes: tokio::sync::Mutex::new(Vec::new()),
    });
    let mgr = BatcherManager::new(
        invoker.clone(),
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let mut op = op_cfg(10, 2);
    op.key = vec![BatchKeyDimension::Query("version".to_string())];

    let (mut req_a, rx_a) = pending("a");
    req_a.query.insert("version".to_string(), "v1".to_string());
    mgr.enqueue(&op, req_a).unwrap();

    let (mut req_b, rx_b) = pending("b");
    req_b.query.insert("version".to_string(), "v2".to_string());
    mgr.enqueue(&op, req_b).unwrap();

    tokio::time::advance(Duration::from_millis(10)).await;
    tokio::task::yield_now().await;

    assert_eq!(rx_a.await.unwrap().status, StatusCode::OK);
    assert_eq!(rx_b.await.unwrap().status, StatusCode::OK);

    let mut sizes = invoker.batch_sizes.lock().await.clone();
    sizes.sort_unstable();
    assert_eq!(sizes, vec![1, 1]);
}

struct StaticBufferedInvoker {
    response: Bytes,
}

#[async_trait]
impl LambdaInvoker for StaticBufferedInvoker {
    async fn invoke(
        &self,
        _function_name: &str,
        _payload: Bytes,
        mode: InvokeMode,
        _profiling: bool,
    ) -> anyhow::Result<LambdaInvokeResult> {
        assert_eq!(mode, InvokeMode::Buffered);
        Ok(LambdaInvokeResult::Buffered {
            payload: self.response.clone(),
            report: None,
        })
    }
}

#[tokio::test]
async fn buffered_missing_record_returns_bad_gateway_for_missing() {
    let invoker = Arc::new(StaticBufferedInvoker {
        response: Bytes::from_static(br#"{"v":1,"responses":[{"id":"a","statusCode":200,"headers":{},"body":"ok","isBase64Encoded":false}]}"#),
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg(10_000, 2);
    let (req_a, rx_a) = pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    let (req_b, rx_b) = pending("b");
    mgr.enqueue(&op, req_b).unwrap();

    let a = rx_a.await.expect("a response");
    let b = rx_b.await.expect("b response");
    assert_eq!(a.status, StatusCode::OK);
    assert_eq!(b.status, StatusCode::BAD_GATEWAY);
    assert_eq!(
        std::str::from_utf8(&b.body).unwrap(),
        "missing response record"
    );
}

#[tokio::test]
async fn buffered_invalid_json_fails_all() {
    let invoker = Arc::new(StaticBufferedInvoker {
        response: Bytes::from_static(b"not-json"),
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg(10_000, 2);
    let (req_a, rx_a) = pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    let (req_b, rx_b) = pending("b");
    mgr.enqueue(&op, req_b).unwrap();

    let a = rx_a.await.expect("a response");
    let b = rx_b.await.expect("b response");
    assert_eq!(a.status, StatusCode::BAD_GATEWAY);
    assert_eq!(b.status, StatusCode::BAD_GATEWAY);
    assert!(std::str::from_utf8(&a.body)
        .unwrap()
        .contains("decode response"));
}

#[tokio::test]
async fn buffered_unsupported_version_fails_all() {
    let invoker = Arc::new(StaticBufferedInvoker {
        response: Bytes::from_static(br#"{"v":2,"responses":[]}"#),
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg(10_000, 2);
    let (req_a, rx_a) = pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    let (req_b, rx_b) = pending("b");
    mgr.enqueue(&op, req_b).unwrap();

    let a = rx_a.await.expect("a response");
    let b = rx_b.await.expect("b response");
    assert_eq!(a.status, StatusCode::BAD_GATEWAY);
    assert_eq!(b.status, StatusCode::BAD_GATEWAY);
    assert!(std::str::from_utf8(&a.body)
        .unwrap()
        .contains("unsupported response version"));
}

#[tokio::test]
async fn buffered_bad_base64_only_fails_that_item() {
    let invoker = Arc::new(StaticBufferedInvoker {
        response: Bytes::from_static(br#"{"v":1,"responses":[{"id":"a","statusCode":200,"headers":{},"body":"ok","isBase64Encoded":false},{"id":"b","statusCode":200,"headers":{},"body":"!!!","isBase64Encoded":true}]}"#),
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg(10_000, 2);
    let (req_a, rx_a) = pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    let (req_b, rx_b) = pending("b");
    mgr.enqueue(&op, req_b).unwrap();

    let a = rx_a.await.expect("a response");
    let b = rx_b.await.expect("b response");
    assert_eq!(a.status, StatusCode::OK);
    assert_eq!(b.status, StatusCode::BAD_GATEWAY);
    assert!(std::str::from_utf8(&b.body)
        .unwrap()
        .contains("bad response"));
}

#[tokio::test]
async fn buffered_extra_records_are_ignored() {
    let invoker = Arc::new(StaticBufferedInvoker {
        response: Bytes::from_static(
            br#"{"v":1,"responses":[{"id":"a","statusCode":200,"headers":{},"body":"ok","isBase64Encoded":false},{"id":"b","statusCode":200,"headers":{},"body":"ok","isBase64Encoded":false},{"id":"extra","statusCode":200,"headers":{},"body":"ok","isBase64Encoded":false}]}"#,
        ),
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg(10_000, 2);
    let (req_a, rx_a) = pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    let (req_b, rx_b) = pending("b");
    mgr.enqueue(&op, req_b).unwrap();

    let a = rx_a.await.expect("a response");
    let b = rx_b.await.expect("b response");
    assert_eq!(a.status, StatusCode::OK);
    assert_eq!(b.status, StatusCode::OK);
}

#[tokio::test(flavor = "current_thread")]
async fn enqueue_returns_queue_full_without_yielding() {
    let invoker = Arc::new(EchoInvoker {
        calls: AtomicUsize::new(0),
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 1,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg(10_000, 16);
    let (req_a, _rx_a) = pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    let (req_b, _rx_b) = pending("b");
    assert!(matches!(
        mgr.enqueue(&op, req_b),
        Err(EnqueueError::QueueFull)
    ));
}

#[tokio::test]
async fn invocation_queue_full_rejects_with_too_many_requests() {
    // Keep the receiver alive but do not consume jobs so the queue stays full.
    let (invocation_tx, _invocation_rx) = mpsc::channel::<InvocationJob>(1);
    let wait_policy = Arc::new(DefaultWaitPolicy);
    let runtime = BatcherRuntime {
        idle_ttl: Duration::from_secs(60),
        invocation_tx,
        max_invoke_payload_bytes: 6 * 1024 * 1024,
        duration_feedback_tx: None,
        clock: Arc::new(SystemClock),
        batch_event_builder: Arc::new(V1BatchEventBuilder),
        probe_feedback_reporter: Arc::new(DefaultProbeFeedbackReporter),
        response_dispatcher: Arc::new(DefaultResponseDispatcher),
        dynamic_wait_policy: wait_policy.clone(),
        duration_wait_policy: wait_policy,
    };

    let key = BatchKey {
        target_lambda: "fn".to_string(),
        method: Method::GET,
        route: "/hello".to_string(),
        invoke_mode: InvokeMode::Buffered,
        profiling: false,
        key_values: vec![],
    };

    let (req_a, _rx_a) = pending("a");
    flush_batch(&key, &runtime, 0, None, false, vec![req_a]).await;

    let (req_b, rx_b) = pending("b");
    flush_batch(&key, &runtime, 0, None, false, vec![req_b]).await;

    let b = rx_b.await.expect("b response");
    assert_eq!(b.status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn oversized_invoke_payload_splits_batch() {
    let invoker = Arc::new(EchoInvoker {
        calls: AtomicUsize::new(0),
    });

    // Pick a limit between the serialized size of a 1-item and 2-item batch so that we force
    // splitting into two single-item invocations.
    let body = Bytes::from(vec![0u8; 256]);
    let body_b64 = STANDARD.encode(&body);
    let key = BatchKey {
        target_lambda: "fn".to_string(),
        method: Method::GET,
        route: "/hello".to_string(),
        invoke_mode: InvokeMode::Buffered,
        profiling: false,
        key_values: vec![],
    };

    let item_a_one = BatchItem {
        id: "a".to_string(),
        version: "2.0",
        route_key: "GET /hello".to_string(),
        raw_path: "/hello".to_string(),
        raw_query_string: String::new(),
        cookies: None,
        headers: HashMap::new(),
        query_string_parameters: HashMap::new(),
        path_parameters: HashMap::new(),
        request_context: ApiGatewayV2RequestContext {
            account_id: None,
            api_id: None,
            domain_name: None,
            domain_prefix: None,
            route_key: "GET /hello".to_string(),
            stage: "$default",
            request_id: "a".to_string(),
            time: None,
            time_epoch: 1_700_000_000_000,
            http: ApiGatewayV2HttpDescription {
                method: "GET".to_string(),
                path: "/hello".to_string(),
                protocol: "HTTP/1.1",
                source_ip: None,
                user_agent: None,
            },
        },
        stage_variables: HashMap::new(),
        body: Some(body_b64.clone()),
        is_base64_encoded: true,
    };
    let item_a_two = BatchItem {
        id: "a".to_string(),
        version: "2.0",
        route_key: "GET /hello".to_string(),
        raw_path: "/hello".to_string(),
        raw_query_string: String::new(),
        cookies: None,
        headers: HashMap::new(),
        query_string_parameters: HashMap::new(),
        path_parameters: HashMap::new(),
        request_context: ApiGatewayV2RequestContext {
            account_id: None,
            api_id: None,
            domain_name: None,
            domain_prefix: None,
            route_key: "GET /hello".to_string(),
            stage: "$default",
            request_id: "a".to_string(),
            time: None,
            time_epoch: 1_700_000_000_000,
            http: ApiGatewayV2HttpDescription {
                method: "GET".to_string(),
                path: "/hello".to_string(),
                protocol: "HTTP/1.1",
                source_ip: None,
                user_agent: None,
            },
        },
        stage_variables: HashMap::new(),
        body: Some(body_b64.clone()),
        is_base64_encoded: true,
    };
    let item_b_two = BatchItem {
        id: "b".to_string(),
        version: "2.0",
        route_key: "GET /hello".to_string(),
        raw_path: "/hello".to_string(),
        raw_query_string: String::new(),
        cookies: None,
        headers: HashMap::new(),
        query_string_parameters: HashMap::new(),
        path_parameters: HashMap::new(),
        request_context: ApiGatewayV2RequestContext {
            account_id: None,
            api_id: None,
            domain_name: None,
            domain_prefix: None,
            route_key: "GET /hello".to_string(),
            stage: "$default",
            request_id: "b".to_string(),
            time: None,
            time_epoch: 1_700_000_000_000,
            http: ApiGatewayV2HttpDescription {
                method: "GET".to_string(),
                path: "/hello".to_string(),
                protocol: "HTTP/1.1",
                source_ip: None,
                user_agent: None,
            },
        },
        stage_variables: HashMap::new(),
        body: Some(body_b64),
        is_base64_encoded: true,
    };

    let received_at_ms = 1_700_000_000_000u64;
    let one_len = build_payload_bytes(&key, received_at_ms, &[item_a_one])
        .unwrap()
        .len();
    let two_len = build_payload_bytes(&key, received_at_ms, &[item_a_two, item_b_two])
        .unwrap()
        .len();
    assert!(one_len < two_len);
    let max_invoke_payload_bytes = (one_len + two_len) / 2;

    let mgr = BatcherManager::new(
        invoker.clone(),
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes,
        },
    );

    let op = op_cfg(10_000, 2);
    let (req_a, rx_a) = pending_with_body("a", body.clone());
    mgr.enqueue(&op, req_a).unwrap();
    let (req_b, rx_b) = pending_with_body("b", body);
    mgr.enqueue(&op, req_b).unwrap();

    let a = rx_a.await.expect("a response");
    let b = rx_b.await.expect("b response");
    assert_eq!(a.status, StatusCode::OK);
    assert_eq!(b.status, StatusCode::OK);

    assert_eq!(invoker.calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn oversized_single_request_fails_without_invoking() {
    let invoker = Arc::new(EchoInvoker {
        calls: AtomicUsize::new(0),
    });

    let body = Bytes::from(vec![0u8; 256]);
    let body_b64 = STANDARD.encode(&body);
    let key = BatchKey {
        target_lambda: "fn".to_string(),
        method: Method::GET,
        route: "/hello".to_string(),
        invoke_mode: InvokeMode::Buffered,
        profiling: false,
        key_values: vec![],
    };

    let received_at_ms = 1_700_000_000_000u64;
    let item = BatchItem {
        id: "a".to_string(),
        version: "2.0",
        route_key: "GET /hello".to_string(),
        raw_path: "/hello".to_string(),
        raw_query_string: String::new(),
        cookies: None,
        headers: HashMap::new(),
        query_string_parameters: HashMap::new(),
        path_parameters: HashMap::new(),
        request_context: ApiGatewayV2RequestContext {
            account_id: None,
            api_id: None,
            domain_name: None,
            domain_prefix: None,
            route_key: "GET /hello".to_string(),
            stage: "$default",
            request_id: "a".to_string(),
            time: None,
            time_epoch: received_at_ms as i64,
            http: ApiGatewayV2HttpDescription {
                method: "GET".to_string(),
                path: "/hello".to_string(),
                protocol: "HTTP/1.1",
                source_ip: None,
                user_agent: None,
            },
        },
        stage_variables: HashMap::new(),
        body: Some(body_b64),
        is_base64_encoded: true,
    };
    let one_len = build_payload_bytes(&key, received_at_ms, &[item])
        .unwrap()
        .len();

    let mgr = BatcherManager::new(
        invoker.clone(),
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: one_len - 1,
        },
    );

    let op = op_cfg(0, 1);
    let (req_a, rx_a) = pending_with_body("a", body);
    mgr.enqueue(&op, req_a).unwrap();

    let a = rx_a.await.expect("a response");
    assert_eq!(a.status, StatusCode::BAD_GATEWAY);
    assert_eq!(
        std::str::from_utf8(&a.body).unwrap(),
        "invoke payload too large"
    );

    assert_eq!(invoker.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test(start_paused = true)]
async fn idle_batcher_is_evicted() {
    let invoker = Arc::new(EchoInvoker {
        calls: AtomicUsize::new(0),
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_millis(10),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg(0, 1);
    let (req_a, rx_a) = pending("a");
    mgr.enqueue(&op, req_a).unwrap();

    let a = rx_a.await.expect("a response");
    assert_eq!(a.status, StatusCode::OK);

    assert_eq!(mgr.batchers.len(), 1);
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_millis(10)).await;
    tokio::task::yield_now().await;
    assert_eq!(mgr.batchers.len(), 0);
}

struct StreamInvoker;

#[async_trait]
impl LambdaInvoker for StreamInvoker {
    async fn invoke(
        &self,
        _function_name: &str,
        _payload: Bytes,
        mode: InvokeMode,
        _profiling: bool,
    ) -> anyhow::Result<LambdaInvokeResult> {
        assert_eq!(mode, InvokeMode::ResponseStream);
        let (tx, rx) = tokio::sync::mpsc::channel::<anyhow::Result<Bytes>>(8);

        tokio::spawn(async move {
            let chunk1 = concat!(
                "{\"v\":1,\"id\":\"b\",\"statusCode\":200,\"headers\":{},\"body\":\"ok\",\"isBase64Encoded\":false}\n",
                "{\"v\":1,\"id\":\"a\""
            );
            let _ = tx.send(Ok(Bytes::from(chunk1))).await;
            tokio::time::sleep(Duration::from_millis(50)).await;
            let chunk2 =
                ",\"statusCode\":200,\"headers\":{},\"body\":\"ok\",\"isBase64Encoded\":false}\n";
            let _ = tx.send(Ok(Bytes::from(chunk2))).await;
        });

        Ok(LambdaInvokeResult::ResponseStream {
            stream: rx,
            report: None,
        })
    }
}

#[tokio::test(start_paused = true)]
async fn response_stream_dispatches_early_records() {
    let invoker = Arc::new(StreamInvoker);
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg_stream(10_000, 2);

    let (req_a, mut init_a, _body_a) = stream_pending("a");
    mgr.enqueue(&op, req_a).unwrap();

    let (req_b, init_b, _body_b) = stream_pending("b");
    mgr.enqueue(&op, req_b).unwrap();

    let b = init_b.await.expect("b init");
    match b {
        StreamInit::Response(resp) => assert_eq!(resp.status, StatusCode::OK),
        StreamInit::Stream(_) => panic!("expected buffered response"),
    }

    // `a` should not be ready until we advance time.
    assert!(tokio::time::timeout(Duration::from_millis(0), &mut init_a)
        .await
        .is_err());

    tokio::time::advance(Duration::from_millis(50)).await;
    tokio::task::yield_now().await;

    let a = init_a.await.expect("a init");
    match a {
        StreamInit::Response(resp) => assert_eq!(resp.status, StatusCode::OK),
        StreamInit::Stream(_) => panic!("expected buffered response"),
    }
}

struct StreamOnceInvoker {
    chunks: Vec<Bytes>,
}

#[async_trait]
impl LambdaInvoker for StreamOnceInvoker {
    async fn invoke(
        &self,
        _function_name: &str,
        _payload: Bytes,
        mode: InvokeMode,
        _profiling: bool,
    ) -> anyhow::Result<LambdaInvokeResult> {
        assert_eq!(mode, InvokeMode::ResponseStream);
        let (tx, rx) = tokio::sync::mpsc::channel::<anyhow::Result<Bytes>>(8);
        let chunks = self.chunks.clone();
        tokio::spawn(async move {
            for c in chunks {
                let _ = tx.send(Ok(c)).await;
            }
        });
        Ok(LambdaInvokeResult::ResponseStream {
            stream: rx,
            report: None,
        })
    }
}

#[tokio::test(start_paused = true)]
async fn response_stream_without_trailing_newline_is_accepted() {
    let invoker = Arc::new(StreamOnceInvoker {
        chunks: vec![Bytes::from_static(
            br#"{"v":1,"id":"a","statusCode":200,"headers":{},"body":"ok","isBase64Encoded":false}"#,
        )],
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg_stream(0, 1);
    let (req_a, init_a, _body_a) = stream_pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    let a = init_a.await.expect("a init");
    match a {
        StreamInit::Response(resp) => assert_eq!(resp.status, StatusCode::OK),
        StreamInit::Stream(_) => panic!("expected buffered response"),
    }
}

#[tokio::test(start_paused = true)]
async fn response_stream_accepts_crlf_records() {
    let invoker = Arc::new(StreamOnceInvoker {
        chunks: vec![Bytes::from_static(
            b"{\"v\":1,\"id\":\"a\",\"statusCode\":200,\"headers\":{},\"body\":\"ok\",\"isBase64Encoded\":false}\r\n",
        )],
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg_stream(0, 1);
    let (req_a, init_a, _body_a) = stream_pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    let a = init_a.await.expect("a init");
    match a {
        StreamInit::Response(resp) => assert_eq!(resp.status, StatusCode::OK),
        StreamInit::Stream(_) => panic!("expected buffered response"),
    }
}

struct StreamErrorInvoker;

#[async_trait]
impl LambdaInvoker for StreamErrorInvoker {
    async fn invoke(
        &self,
        _function_name: &str,
        _payload: Bytes,
        mode: InvokeMode,
        _profiling: bool,
    ) -> anyhow::Result<LambdaInvokeResult> {
        assert_eq!(mode, InvokeMode::ResponseStream);
        let (tx, rx) = tokio::sync::mpsc::channel::<anyhow::Result<Bytes>>(8);
        tokio::spawn(async move {
            let _ = tx.send(Err(anyhow::anyhow!("boom"))).await;
        });
        Ok(LambdaInvokeResult::ResponseStream {
            stream: rx,
            report: None,
        })
    }
}

#[tokio::test(start_paused = true)]
async fn response_stream_error_fails_all() {
    let invoker = Arc::new(StreamErrorInvoker);
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg_stream(10_000, 2);
    let (req_a, init_a, _body_a) = stream_pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    let (req_b, init_b, _body_b) = stream_pending("b");
    mgr.enqueue(&op, req_b).unwrap();

    let a = init_a.await.expect("a init");
    let b = init_b.await.expect("b init");
    match a {
        StreamInit::Response(resp) => assert_eq!(resp.status, StatusCode::BAD_GATEWAY),
        _ => panic!("expected buffered error"),
    }
    match b {
        StreamInit::Response(resp) => assert_eq!(resp.status, StatusCode::BAD_GATEWAY),
        _ => panic!("expected buffered error"),
    }
}

#[tokio::test(start_paused = true)]
async fn response_stream_missing_record_fails_remaining() {
    let invoker = Arc::new(StreamOnceInvoker {
        chunks: vec![Bytes::from_static(
            br#"{"v":1,"id":"a","statusCode":200,"headers":{},"body":"ok","isBase64Encoded":false}
"#,
        )],
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg_stream(10_000, 2);
    let (req_a, init_a, _body_a) = stream_pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    let (req_b, init_b, _body_b) = stream_pending("b");
    mgr.enqueue(&op, req_b).unwrap();

    let a = init_a.await.expect("a init");
    let b = init_b.await.expect("b init");
    match a {
        StreamInit::Response(resp) => assert_eq!(resp.status, StatusCode::OK),
        _ => panic!("expected buffered response"),
    }
    match b {
        StreamInit::Response(resp) => assert_eq!(resp.status, StatusCode::BAD_GATEWAY),
        _ => panic!("expected buffered error"),
    }
}

#[tokio::test(start_paused = true)]
async fn response_stream_invalid_record_fails_all() {
    let invoker = Arc::new(StreamOnceInvoker {
        chunks: vec![Bytes::from_static(b"{not-json}\n")],
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg_stream(10_000, 2);
    let (req_a, init_a, _body_a) = stream_pending("a");
    mgr.enqueue(&op, req_a).unwrap();
    let (req_b, init_b, _body_b) = stream_pending("b");
    mgr.enqueue(&op, req_b).unwrap();

    let a = init_a.await.expect("a init");
    let b = init_b.await.expect("b init");
    match a {
        StreamInit::Response(resp) => {
            assert_eq!(resp.status, StatusCode::BAD_GATEWAY);
            assert!(std::str::from_utf8(&resp.body)
                .unwrap()
                .contains("bad ndjson record"));
        }
        _ => panic!("expected buffered error"),
    }
    match b {
        StreamInit::Response(resp) => assert_eq!(resp.status, StatusCode::BAD_GATEWAY),
        _ => panic!("expected buffered error"),
    }
}

#[tokio::test(start_paused = true)]
async fn response_stream_interleaved_records_stream_body() {
    let invoker = Arc::new(StreamOnceInvoker {
        chunks: vec![Bytes::from_static(
            br#"{"v":1,"id":"a","type":"head","statusCode":200,"headers":{"content-type":"text/plain"}}
{"v":1,"id":"a","type":"chunk","body":"hello","isBase64Encoded":false}
{"v":1,"id":"a","type":"end"}
"#,
        )],
    });
    let mgr = BatcherManager::new(
        invoker,
        BatchingConfig {
            max_inflight_invocations: 10,
            max_pending_invocations: 10,
            max_queue_depth_per_key: 10,
            idle_ttl: Duration::from_secs(60),
            max_invoke_payload_bytes: 6 * 1024 * 1024,
        },
    );

    let op = op_cfg_stream(0, 1);
    let (req_a, init_a, mut body_a) = stream_pending("a");
    mgr.enqueue(&op, req_a).unwrap();

    let init = init_a.await.expect("init");
    match init {
        StreamInit::Stream(head) => {
            assert_eq!(head.status, StatusCode::OK);
            assert_eq!(head.headers.get("content-type").unwrap(), "text/plain");
        }
        StreamInit::Response(_) => panic!("expected streaming init"),
    }

    let chunk = body_a.recv().await.expect("chunk");
    assert_eq!(chunk, Bytes::from_static(b"hello"));
    assert!(body_a.recv().await.is_none());
}

#[test]
fn sigmoid_wait_ms_respects_bounds() {
    assert_eq!(sigmoid_wait_ms(0.0, 1, 100, 50.0, 1.0), 1);
    assert_eq!(sigmoid_wait_ms(100.0, 1, 100, 50.0, 1.0), 100);
}

#[test]
fn dynamic_rate_estimator_smooths_samples() {
    let mut est = DynamicRateEstimator::new(Duration::from_millis(100), 3);
    est.record_request();
    est.record_request();
    est.tick();
    assert_eq!(est.smoothed_rps(), 20.0);

    // Second interval with no requests should decay the average.
    est.tick();
    assert_eq!(est.smoothed_rps(), 10.0);
}
