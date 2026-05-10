use bytes::Bytes;
use serde::Serialize;

use super::{BatchItem, BatchKey};

pub(super) trait BatchEventBuilder: Send + Sync {
    fn build_payload(
        &self,
        key: &BatchKey,
        received_at_ms: u64,
        batch_items: &[BatchItem],
    ) -> anyhow::Result<Bytes>;
}

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct V1BatchEventBuilder;

impl BatchEventBuilder for V1BatchEventBuilder {
    fn build_payload(
        &self,
        key: &BatchKey,
        received_at_ms: u64,
        batch_items: &[BatchItem],
    ) -> anyhow::Result<Bytes> {
        #[derive(Serialize)]
        struct BatchEventBorrowed<'a> {
            v: u8,
            meta: BatchMetaBorrowed<'a>,
            batch: &'a [BatchItem],
        }

        #[derive(Serialize)]
        struct BatchMetaBorrowed<'a> {
            gateway: &'static str,
            route: &'a str,
            #[serde(rename = "receivedAtMs")]
            received_at_ms: u64,
        }

        let event = BatchEventBorrowed {
            v: 1,
            meta: BatchMetaBorrowed {
                gateway: "khone",
                route: &key.route,
                received_at_ms,
            },
            batch: batch_items,
        };

        Ok(Bytes::from(serde_json::to_vec(&event)?))
    }
}
