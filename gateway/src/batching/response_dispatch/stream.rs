use std::collections::HashMap;

use bytes::Bytes;
use http::StatusCode;
use memchr::memchr;

use super::parts::{
    append_cookies, build_gateway_response_parts, decode_body_bytes, headers_from_map,
};
use super::{
    fail_all_stream_impl, BatchKey, GatewayResponse, GatewayResponseMeta, StreamHead, StreamInit,
    StreamPending, StreamRecordType, StreamResponseRecord, StreamResponseRecordInterleaved,
    StreamResponseRecordLegacy,
};

fn send_stream_head(
    entry: &mut StreamPending,
    batch_size: usize,
    wait_ms: u64,
    target_elapsed_ms: u64,
    status_code: u16,
    headers: HashMap<String, String>,
    cookies: Vec<String>,
) -> Result<bool, String> {
    if let Some(init) = entry.init.take() {
        let status =
            StatusCode::from_u16(status_code).map_err(|err| format!("bad status code: {err}"))?;
        let mut headers =
            headers_from_map(headers).map_err(|err| format!("bad response headers: {err}"))?;
        append_cookies(&mut headers, cookies)
            .map_err(|err| format!("bad response cookies: {err}"))?;
        if init
            .send(StreamInit::Stream(StreamHead {
                status,
                headers,
                meta: GatewayResponseMeta {
                    batch_size,
                    batch_wait_ms: wait_ms,
                    target_elapsed_ms: Some(target_elapsed_ms),
                },
            }))
            .is_err()
        {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) async fn dispatch_response_stream_impl(
    key: &BatchKey,
    wait_ms: u64,
    target_started_at: tokio::time::Instant,
    mut stream: tokio::sync::mpsc::Receiver<anyhow::Result<Bytes>>,
    mut pending: HashMap<String, StreamPending>,
) {
    let batch_size = pending.len();
    const MAX_BUFFER_BYTES: usize = 8 * 1024 * 1024;

    let mut buffer: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.recv().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(err) => {
                tracing::warn!(
                    event = "lambda_response_error",
                    reason = "stream_error",
                    target_lambda = %key.target_lambda,
                    route = %key.route,
                    batch_size = pending.len(),
                    error = %err,
                    "response stream error"
                );
                fail_all_stream_impl(
                    pending,
                    batch_size,
                    wait_ms,
                    Some(elapsed_ms_since(target_started_at)),
                    StatusCode::BAD_GATEWAY,
                    format!("response stream error: {err}"),
                );
                return;
            }
        };

        buffer.extend_from_slice(&chunk);
        if buffer.len() > MAX_BUFFER_BYTES {
            tracing::warn!(
                event = "lambda_response_error",
                reason = "stream_too_large",
                target_lambda = %key.target_lambda,
                route = %key.route,
                batch_size = pending.len(),
                bytes = buffer.len(),
                "response stream exceeded buffer limit"
            );
            fail_all_stream_impl(
                pending,
                batch_size,
                wait_ms,
                Some(elapsed_ms_since(target_started_at)),
                StatusCode::BAD_GATEWAY,
                "response stream too large".to_string(),
            );
            return;
        }

        let mut start = 0usize;
        while let Some(rel_nl) = memchr(b'\n', &buffer[start..]) {
            let nl = start + rel_nl;
            let mut line = &buffer[start..nl];
            if line.ends_with(b"\r") {
                line = &line[..line.len().saturating_sub(1)];
            }
            start = nl + 1;

            if line.is_empty() {
                continue;
            }

            let record = match parse_stream_record(line) {
                Ok(r) => r,
                Err(err) => {
                    tracing::warn!(
                        event = "lambda_response_error",
                        reason = "bad_ndjson",
                        target_lambda = %key.target_lambda,
                        route = %key.route,
                        batch_size = pending.len(),
                        error = %err,
                        "invalid ndjson record"
                    );
                    fail_all_stream_impl(
                        pending,
                        batch_size,
                        wait_ms,
                        Some(elapsed_ms_since(target_started_at)),
                        StatusCode::BAD_GATEWAY,
                        err,
                    );
                    return;
                }
            };

            if let Err(msg) = dispatch_stream_record(
                record,
                &mut pending,
                batch_size,
                wait_ms,
                elapsed_ms_since(target_started_at),
            )
            .await
            {
                tracing::warn!(
                    event = "lambda_response_error",
                    reason = "dispatch_record",
                    target_lambda = %key.target_lambda,
                    route = %key.route,
                    batch_size = pending.len(),
                    error = %msg,
                    "failed to dispatch stream record"
                );
                fail_all_stream_impl(
                    pending,
                    batch_size,
                    wait_ms,
                    Some(elapsed_ms_since(target_started_at)),
                    StatusCode::BAD_GATEWAY,
                    msg,
                );
                return;
            }
        }

        if start > 0 {
            buffer.drain(..start);
        }
    }

    // Allow the final record to omit the trailing newline.
    let mut end = buffer.len();
    while end > 0 && (buffer[end - 1] == b'\n' || buffer[end - 1] == b'\r') {
        end -= 1;
    }
    let tail = &buffer[..end];
    if !tail.is_empty() {
        let record = match parse_stream_record(tail) {
            Ok(r) => r,
            Err(err) => {
                tracing::warn!(
                    event = "lambda_response_error",
                    reason = "bad_tail_record",
                    target_lambda = %key.target_lambda,
                    route = %key.route,
                    batch_size = pending.len(),
                    error = %err,
                    "invalid trailing ndjson record"
                );
                fail_all_stream_impl(
                    pending,
                    batch_size,
                    wait_ms,
                    Some(elapsed_ms_since(target_started_at)),
                    StatusCode::BAD_GATEWAY,
                    err,
                );
                return;
            }
        };

        if let Err(msg) = dispatch_stream_record(
            record,
            &mut pending,
            batch_size,
            wait_ms,
            elapsed_ms_since(target_started_at),
        )
        .await
        {
            tracing::warn!(
                event = "lambda_response_error",
                reason = "dispatch_tail",
                target_lambda = %key.target_lambda,
                route = %key.route,
                batch_size = pending.len(),
                error = %msg,
                "failed to dispatch trailing record"
            );
            fail_all_stream_impl(
                pending,
                batch_size,
                wait_ms,
                Some(elapsed_ms_since(target_started_at)),
                StatusCode::BAD_GATEWAY,
                msg,
            );
            return;
        }
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
            "missing stream response records"
        );
    }
    fail_all_stream_impl(
        pending,
        batch_size,
        wait_ms,
        Some(elapsed_ms_since(target_started_at)),
        StatusCode::BAD_GATEWAY,
        "missing response record".to_string(),
    );
}

fn elapsed_ms_since(started_at: tokio::time::Instant) -> u64 {
    started_at.elapsed().as_millis() as u64
}

fn parse_stream_record(line: &[u8]) -> Result<StreamResponseRecord, String> {
    let value: serde_json::Value =
        serde_json::from_slice(line).map_err(|err| format!("bad ndjson record: {err}"))?;
    if value.get("type").is_some() {
        let record: StreamResponseRecordInterleaved =
            serde_json::from_value(value).map_err(|err| format!("bad ndjson record: {err}"))?;
        Ok(StreamResponseRecord::Interleaved(record))
    } else {
        let record: StreamResponseRecordLegacy =
            serde_json::from_value(value).map_err(|err| format!("bad ndjson record: {err}"))?;
        Ok(StreamResponseRecord::Legacy(record))
    }
}

async fn dispatch_stream_record(
    record: StreamResponseRecord,
    pending: &mut HashMap<String, StreamPending>,
    batch_size: usize,
    wait_ms: u64,
    target_elapsed_ms: u64,
) -> Result<(), String> {
    match record {
        StreamResponseRecord::Legacy(record) => {
            if record.v != 1 {
                return Err(format!("unsupported record version: {}", record.v));
            }

            if let Some(mut entry) = pending.remove(&record.id) {
                let mut resp = build_gateway_response_parts(
                    record.status_code,
                    record.headers,
                    record.cookies,
                    record.body,
                    record.is_base64_encoded,
                )
                .map_err(|err| format!("bad response: {err}"))?;
                resp.meta = Some(GatewayResponseMeta {
                    batch_size,
                    batch_wait_ms: wait_ms,
                    target_elapsed_ms: Some(target_elapsed_ms),
                });
                if let Some(init) = entry.init.take() {
                    let _ = init.send(StreamInit::Response(resp));
                }
                drop(entry.body);
            }
        }
        StreamResponseRecord::Interleaved(record) => {
            if record.v != 1 {
                return Err(format!("unsupported record version: {}", record.v));
            }

            match record.record_type {
                StreamRecordType::Head => {
                    if let Some(mut entry) = pending.remove(&record.id) {
                        let status_code = record.status_code.unwrap_or(200);
                        let keep = send_stream_head(
                            &mut entry,
                            batch_size,
                            wait_ms,
                            target_elapsed_ms,
                            status_code,
                            record.headers,
                            record.cookies,
                        )?;
                        if keep {
                            pending.insert(record.id, entry);
                        }
                    }
                }
                StreamRecordType::Chunk => {
                    if let Some(mut entry) = pending.remove(&record.id) {
                        if entry.init.is_some() {
                            let keep = send_stream_head(
                                &mut entry,
                                batch_size,
                                wait_ms,
                                target_elapsed_ms,
                                200,
                                HashMap::new(),
                                Vec::new(),
                            )?;
                            if !keep {
                                return Ok(());
                            }
                        }
                        let body = record.body.unwrap_or_default();
                        let bytes = decode_body_bytes(&body, record.is_base64_encoded)
                            .map_err(|err| format!("bad chunk body: {err}"))?;
                        if entry.body.send(bytes).await.is_err() {
                            return Ok(());
                        }
                        pending.insert(record.id, entry);
                    }
                }
                StreamRecordType::End => {
                    if let Some(mut entry) = pending.remove(&record.id) {
                        if entry.init.is_some() {
                            let _ = send_stream_head(
                                &mut entry,
                                batch_size,
                                wait_ms,
                                target_elapsed_ms,
                                200,
                                HashMap::new(),
                                Vec::new(),
                            )?;
                        }
                        drop(entry.body);
                    }
                }
                StreamRecordType::Error => {
                    if let Some(mut entry) = pending.remove(&record.id) {
                        if let Some(init) = entry.init.take() {
                            let status = record.status_code.unwrap_or(502);
                            let msg = record.message.unwrap_or_else(|| "error".to_string());
                            let mut resp = GatewayResponse::text(
                                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                                msg,
                            );
                            resp.meta = Some(GatewayResponseMeta {
                                batch_size,
                                batch_wait_ms: wait_ms,
                                target_elapsed_ms: Some(target_elapsed_ms),
                            });
                            let _ = init.send(StreamInit::Response(resp));
                        }
                        drop(entry.body);
                    }
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::InvokeMode;
    use http::Method;
    use tokio::sync::{mpsc, oneshot};

    fn key() -> BatchKey {
        BatchKey {
            target_lambda: "fn".to_string(),
            method: Method::GET,
            route: "/hello".to_string(),
            invoke_mode: InvokeMode::ResponseStream,
            profiling: false,
            key_values: vec![],
        }
    }

    fn pending_entry() -> (
        HashMap<String, StreamPending>,
        oneshot::Receiver<StreamInit>,
    ) {
        let (init_tx, init_rx) = oneshot::channel();
        let (body_tx, _body_rx) = mpsc::channel(8);
        let mut pending = HashMap::new();
        pending.insert(
            "a".to_string(),
            StreamPending {
                init: Some(init_tx),
                body: body_tx,
            },
        );
        (pending, init_rx)
    }

    #[tokio::test]
    async fn stream_accepts_tail_record_without_newline() {
        let (pending, init_rx) = pending_entry();
        let (tx, rx) = mpsc::channel(4);
        tx.send(Ok(Bytes::from_static(
            br#"{"v":1,"id":"a","statusCode":200,"headers":{},"body":"ok","isBase64Encoded":false}"#,
        )))
        .await
        .unwrap();
        drop(tx);

        dispatch_response_stream_impl(&key(), 0, tokio::time::Instant::now(), rx, pending).await;

        let init = init_rx.await.expect("init");
        match init {
            StreamInit::Response(resp) => assert_eq!(resp.status, StatusCode::OK),
            StreamInit::Stream(_) => panic!("expected buffered response"),
        }
    }

    #[tokio::test]
    async fn stream_invalid_ndjson_fails_pending() {
        let (pending, init_rx) = pending_entry();
        let (tx, rx) = mpsc::channel(4);
        tx.send(Ok(Bytes::from_static(b"{bad-json}\n")))
            .await
            .unwrap();
        drop(tx);

        dispatch_response_stream_impl(&key(), 0, tokio::time::Instant::now(), rx, pending).await;

        let init = init_rx.await.expect("init");
        match init {
            StreamInit::Response(resp) => assert_eq!(resp.status, StatusCode::BAD_GATEWAY),
            StreamInit::Stream(_) => panic!("expected error response"),
        }
    }
}
