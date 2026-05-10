use std::collections::HashMap;

use async_trait::async_trait;
use bytes::Bytes;
use http::StatusCode;
use tokio::sync::oneshot;

use super::*;

mod buffered;
mod parts;
mod stream;

use self::buffered::dispatch_buffered_impl;
#[cfg(test)]
pub(super) use self::parts::build_gateway_response_parts;
use self::stream::dispatch_response_stream_impl;

#[async_trait]
pub(super) trait ResponseDispatcher: Send + Sync {
    fn dispatch_buffered(
        &self,
        key: &BatchKey,
        wait_ms: u64,
        target_elapsed_ms: u64,
        resp_bytes: Bytes,
        pending: HashMap<String, oneshot::Sender<GatewayResponse>>,
    );

    async fn dispatch_response_stream(
        &self,
        key: &BatchKey,
        wait_ms: u64,
        target_started_at: tokio::time::Instant,
        stream: tokio::sync::mpsc::Receiver<anyhow::Result<Bytes>>,
        pending: HashMap<String, StreamPending>,
    );

    fn fail_all_buffered(
        &self,
        pending: HashMap<String, oneshot::Sender<GatewayResponse>>,
        batch_size: usize,
        wait_ms: u64,
        target_elapsed_ms: Option<u64>,
        status: StatusCode,
        msg: String,
    );

    fn fail_all_stream(
        &self,
        pending: HashMap<String, StreamPending>,
        batch_size: usize,
        wait_ms: u64,
        target_elapsed_ms: Option<u64>,
        status: StatusCode,
        msg: String,
    );
}

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct DefaultResponseDispatcher;

#[async_trait]
impl ResponseDispatcher for DefaultResponseDispatcher {
    fn dispatch_buffered(
        &self,
        key: &BatchKey,
        wait_ms: u64,
        target_elapsed_ms: u64,
        resp_bytes: Bytes,
        pending: HashMap<String, oneshot::Sender<GatewayResponse>>,
    ) {
        dispatch_buffered_impl(key, wait_ms, target_elapsed_ms, resp_bytes, pending);
    }

    async fn dispatch_response_stream(
        &self,
        key: &BatchKey,
        wait_ms: u64,
        target_started_at: tokio::time::Instant,
        stream: tokio::sync::mpsc::Receiver<anyhow::Result<Bytes>>,
        pending: HashMap<String, StreamPending>,
    ) {
        dispatch_response_stream_impl(key, wait_ms, target_started_at, stream, pending).await;
    }

    fn fail_all_buffered(
        &self,
        pending: HashMap<String, oneshot::Sender<GatewayResponse>>,
        batch_size: usize,
        wait_ms: u64,
        target_elapsed_ms: Option<u64>,
        status: StatusCode,
        msg: String,
    ) {
        fail_all_buffered_impl(pending, batch_size, wait_ms, target_elapsed_ms, status, msg);
    }

    fn fail_all_stream(
        &self,
        pending: HashMap<String, StreamPending>,
        batch_size: usize,
        wait_ms: u64,
        target_elapsed_ms: Option<u64>,
        status: StatusCode,
        msg: String,
    ) {
        fail_all_stream_impl(pending, batch_size, wait_ms, target_elapsed_ms, status, msg);
    }
}

pub(super) fn fail_all_buffered_impl(
    pending: HashMap<String, oneshot::Sender<GatewayResponse>>,
    batch_size: usize,
    wait_ms: u64,
    target_elapsed_ms: Option<u64>,
    status: StatusCode,
    msg: String,
) {
    for (_id, tx) in pending {
        let mut resp = GatewayResponse::text(status, msg.clone());
        resp.meta = Some(GatewayResponseMeta {
            batch_size,
            batch_wait_ms: wait_ms,
            target_elapsed_ms,
        });
        let _ = tx.send(resp);
    }
}

pub(super) fn fail_all_stream_impl(
    pending: HashMap<String, StreamPending>,
    batch_size: usize,
    wait_ms: u64,
    target_elapsed_ms: Option<u64>,
    status: StatusCode,
    msg: String,
) {
    for (_id, mut entry) in pending {
        if let Some(init) = entry.init.take() {
            let mut resp = GatewayResponse::text(status, msg.clone());
            resp.meta = Some(GatewayResponseMeta {
                batch_size,
                batch_wait_ms: wait_ms,
                target_elapsed_ms,
            });
            let _ = init.send(StreamInit::Response(resp));
        }
        // Dropping the sender closes the response body stream.
        drop(entry.body);
    }
}
