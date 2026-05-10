use std::collections::HashMap;

use bytes::Bytes;
use http::StatusCode;
use tokio::sync::oneshot;

use super::parts::build_gateway_response_parts;
use super::{
    fail_all_buffered_impl, BatchKey, BatchResponse, GatewayResponse, GatewayResponseMeta,
};

pub(super) fn dispatch_buffered_impl(
    key: &BatchKey,
    wait_ms: u64,
    target_elapsed_ms: u64,
    resp_bytes: Bytes,
    mut pending: HashMap<String, oneshot::Sender<GatewayResponse>>,
) {
    let batch_size = pending.len();
    let parsed: BatchResponse = match serde_json::from_slice(&resp_bytes) {
        Ok(r) => r,
        Err(err) => {
            tracing::warn!(
                event = "lambda_response_error",
                reason = "decode_response",
                target_lambda = %key.target_lambda,
                route = %key.route,
                batch_size = pending.len(),
                error = %err,
                "failed to decode buffered response"
            );
            fail_all_buffered_impl(
                pending,
                batch_size,
                wait_ms,
                Some(target_elapsed_ms),
                StatusCode::BAD_GATEWAY,
                format!("decode response: {err}"),
            );
            return;
        }
    };

    if parsed.v != 1 {
        tracing::warn!(
            event = "lambda_response_error",
            reason = "unsupported_version",
            target_lambda = %key.target_lambda,
            route = %key.route,
            batch_size = pending.len(),
            version = parsed.v,
            "unsupported buffered response version"
        );
        fail_all_buffered_impl(
            pending,
            batch_size,
            wait_ms,
            Some(target_elapsed_ms),
            StatusCode::BAD_GATEWAY,
            format!("unsupported response version: {}", parsed.v),
        );
        return;
    }

    for item in parsed.responses {
        let Some(tx) = pending.remove(&item.id) else {
            continue;
        };
        let mut resp = match build_gateway_response_parts(
            item.status_code,
            item.headers,
            item.cookies,
            item.body,
            item.is_base64_encoded,
        ) {
            Ok(r) => r,
            Err(err) => {
                tracing::warn!(
                    event = "lambda_response_error",
                    reason = "bad_response",
                    target_lambda = %key.target_lambda,
                    route = %key.route,
                    request_id = %item.id,
                    error = %err,
                    "bad buffered response record"
                );
                GatewayResponse::text(StatusCode::BAD_GATEWAY, format!("bad response: {err}"))
            }
        };
        resp.meta = Some(GatewayResponseMeta {
            batch_size,
            batch_wait_ms: wait_ms,
            target_elapsed_ms: Some(target_elapsed_ms),
        });
        let _ = tx.send(resp);
    }

    if !pending.is_empty() {
        crate::metrics::emit_batched_missing_responses(
            key.route.clone(),
            key.invoke_mode,
            pending.len() as u64,
        );
        tracing::warn!(
            event = "lambda_response_error",
            reason = "missing_response",
            target_lambda = %key.target_lambda,
            route = %key.route,
            missing = pending.len(),
            "missing buffered response records"
        );
    }
    fail_all_buffered_impl(
        pending,
        batch_size,
        wait_ms,
        Some(target_elapsed_ms),
        StatusCode::BAD_GATEWAY,
        "missing response record".to_string(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::InvokeMode;
    use http::Method;

    fn key() -> BatchKey {
        BatchKey {
            target_lambda: "fn".to_string(),
            method: Method::GET,
            route: "/hello".to_string(),
            invoke_mode: InvokeMode::Buffered,
            profiling: false,
            key_values: vec![],
        }
    }

    #[tokio::test]
    async fn buffered_missing_record_marks_remaining_as_bad_gateway() {
        let (tx_a, rx_a) = oneshot::channel();
        let (tx_b, rx_b) = oneshot::channel();
        let mut pending = HashMap::new();
        pending.insert("a".to_string(), tx_a);
        pending.insert("b".to_string(), tx_b);

        let resp = Bytes::from_static(
            br#"{"v":1,"responses":[{"id":"a","statusCode":200,"headers":{},"body":"ok","isBase64Encoded":false}]}"#,
        );
        dispatch_buffered_impl(&key(), 12, 34, resp, pending);

        let a = rx_a.await.expect("a");
        let b = rx_b.await.expect("b");
        assert_eq!(a.status, StatusCode::OK);
        assert_eq!(b.status, StatusCode::BAD_GATEWAY);
        assert_eq!(
            std::str::from_utf8(&b.body).unwrap(),
            "missing response record"
        );
    }

    #[tokio::test]
    async fn buffered_unsupported_version_fails_all() {
        let (tx_a, rx_a) = oneshot::channel();
        let mut pending = HashMap::new();
        pending.insert("a".to_string(), tx_a);
        dispatch_buffered_impl(
            &key(),
            1,
            2,
            Bytes::from_static(br#"{"v":2,"responses":[]}"#),
            pending,
        );

        let a = rx_a.await.expect("a");
        assert_eq!(a.status, StatusCode::BAD_GATEWAY);
        assert!(std::str::from_utf8(&a.body)
            .unwrap()
            .contains("unsupported response version"));
    }
}
