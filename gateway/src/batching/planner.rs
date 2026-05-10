use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use bytes::Bytes;
use http::StatusCode;
use memchr::memchr;

use super::batch_event_builder::BatchEventBuilder;
#[cfg(test)]
use super::batch_event_builder::V1BatchEventBuilder;
use super::{BatchItem, BatchKey};

pub(super) enum InvocationPlan<T> {
    Invoke {
        pending: HashMap<String, T>,
        payload: Bytes,
    },
    Fail {
        pending: HashMap<String, T>,
        status: StatusCode,
        msg: String,
    },
}

pub(super) struct PlannedInvocations<T> {
    pub(super) plans: Vec<InvocationPlan<T>>,
    pub(super) split_count: u64,
    pub(super) oversized_single_count: u64,
}

pub(super) fn encode_body(body: &Bytes) -> (Option<String>, bool) {
    if body.is_empty() {
        return (None, false);
    }

    // JSON strings must escape control characters; a binary body that happens to be valid UTF-8
    // (e.g. many `\0` bytes) can balloon in size when serialized. Prefer base64 for such bodies.
    if memchr(b'\0', body.as_ref()).is_some() {
        return (Some(STANDARD.encode(body.as_ref())), true);
    }

    match std::str::from_utf8(body.as_ref()) {
        Ok(s) => (Some(s.to_string()), false),
        Err(_) => (Some(STANDARD.encode(body.as_ref())), true),
    }
}

pub(super) fn parse_cookie_header(headers: &HashMap<String, String>) -> Option<Vec<String>> {
    let header_value = headers.get("cookie")?;
    let cookies: Vec<String> = header_value
        .split(';')
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .collect();
    if cookies.is_empty() {
        None
    } else {
        Some(cookies)
    }
}

pub(super) fn extract_source_ip(headers: &HashMap<String, String>) -> Option<String> {
    let forwarded = headers.get("x-forwarded-for")?;
    forwarded
        .split(',')
        .next()
        .map(|ip| ip.trim().to_string())
        .filter(|ip| !ip.is_empty())
}

pub(super) fn plan_invocations<T>(
    builder: &dyn BatchEventBuilder,
    key: &BatchKey,
    received_at_ms: u64,
    max_invoke_payload_bytes: usize,
    pending: HashMap<String, T>,
    batch_items: Vec<BatchItem>,
) -> PlannedInvocations<T> {
    let payload = match builder.build_payload(key, received_at_ms, &batch_items) {
        Ok(p) => p,
        Err(err) => {
            return PlannedInvocations {
                plans: vec![InvocationPlan::Fail {
                    pending,
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                    msg: format!("encode: {err}"),
                }],
                split_count: 0,
                oversized_single_count: 0,
            };
        }
    };

    if payload.len() <= max_invoke_payload_bytes {
        return PlannedInvocations {
            plans: vec![InvocationPlan::Invoke { pending, payload }],
            split_count: 0,
            oversized_single_count: 0,
        };
    }

    // Lambda imposes request payload limits. If a collected batch exceeds our configured limit,
    // we recursively split it into smaller invocations. In the worst case, a single request may
    // still exceed the limit (e.g., extremely large headers); in that case we fail it.
    if batch_items.len() <= 1 {
        return PlannedInvocations {
            plans: vec![InvocationPlan::Fail {
                pending,
                status: StatusCode::BAD_GATEWAY,
                msg: "invoke payload too large".to_string(),
            }],
            split_count: 0,
            oversized_single_count: 1,
        };
    }

    let mid = batch_items.len() / 2;
    let mut left_items = batch_items;
    let right_items = left_items.split_off(mid);

    let (left_pending, right_pending) = split_pending(pending, &left_items);

    let left = plan_invocations(
        builder,
        key,
        received_at_ms,
        max_invoke_payload_bytes,
        left_pending,
        left_items,
    );
    let right = plan_invocations(
        builder,
        key,
        received_at_ms,
        max_invoke_payload_bytes,
        right_pending,
        right_items,
    );

    let mut plans = left.plans;
    plans.extend(right.plans);

    PlannedInvocations {
        plans,
        split_count: 1 + left.split_count + right.split_count,
        oversized_single_count: left.oversized_single_count + right.oversized_single_count,
    }
}

#[cfg(test)]
pub(super) fn build_payload_bytes(
    key: &BatchKey,
    received_at_ms: u64,
    batch_items: &[BatchItem],
) -> anyhow::Result<Bytes> {
    V1BatchEventBuilder.build_payload(key, received_at_ms, batch_items)
}

fn split_pending<T>(
    mut pending: HashMap<String, T>,
    left_items: &[BatchItem],
) -> (HashMap<String, T>, HashMap<String, T>) {
    let mut left = HashMap::with_capacity(left_items.len());
    for item in left_items {
        if let Some(tx) = pending.remove(&item.id) {
            left.insert(item.id.clone(), tx);
        }
    }
    (left, pending)
}

#[cfg(test)]
mod property_tests {
    use super::*;
    use crate::spec::InvokeMode;
    use http::Method;
    use proptest::prelude::*;

    fn mk_item(id: String, body: Bytes) -> BatchItem {
        let (body, is_base64_encoded) = encode_body(&body);
        BatchItem {
            id: id.clone(),
            version: "2.0",
            route_key: "POST /items".to_string(),
            raw_path: "/items".to_string(),
            raw_query_string: String::new(),
            cookies: None,
            headers: HashMap::new(),
            query_string_parameters: HashMap::new(),
            path_parameters: HashMap::new(),
            request_context: crate::batching::ApiGatewayV2RequestContext {
                account_id: None,
                api_id: None,
                domain_name: None,
                domain_prefix: None,
                route_key: "POST /items".to_string(),
                stage: "$default",
                request_id: id,
                time: None,
                time_epoch: 1_700_000_000_000,
                http: crate::batching::ApiGatewayV2HttpDescription {
                    method: "POST".to_string(),
                    path: "/items".to_string(),
                    protocol: "HTTP/1.1",
                    source_ip: None,
                    user_agent: None,
                },
            },
            stage_variables: HashMap::new(),
            body,
            is_base64_encoded,
        }
    }

    fn payload_ids(payload: &Bytes) -> Vec<String> {
        let v: serde_json::Value = serde_json::from_slice(payload).expect("valid payload json");
        let batch = v["batch"].as_array().expect("batch array");
        batch
            .iter()
            .map(|item| {
                item["requestContext"]["requestId"]
                    .as_str()
                    .expect("request id")
                    .to_string()
            })
            .collect()
    }

    fn base_key() -> BatchKey {
        BatchKey {
            target_lambda: "fn".to_string(),
            method: Method::POST,
            route: "/items".to_string(),
            invoke_mode: InvokeMode::Buffered,
            profiling: false,
            key_values: vec![],
        }
    }

    proptest! {
        #[test]
        fn planner_preserves_ids_and_limits_payloads(
            bodies in prop::collection::vec(prop::collection::vec(any::<u8>(), 0..256), 1..8),
            max_bytes in 200usize..2500usize,
        ) {
            let key = base_key();
            let received_at_ms = 1_700_000_000_000u64;
            let builder = V1BatchEventBuilder;

            let mut pending = HashMap::new();
            let mut items = Vec::new();
            for (idx, body) in bodies.iter().enumerate() {
                let id = format!("id-{idx}");
                pending.insert(id.clone(), idx);
                items.push(mk_item(id, Bytes::from(body.clone())));
            }
            let expected_ids = items.iter().map(|i| i.id.clone()).collect::<Vec<_>>();
            let single_fits = items.iter().all(|item| {
                build_payload_bytes(&key, received_at_ms, std::slice::from_ref(item))
                    .map(|p| p.len() <= max_bytes)
                    .unwrap_or(false)
            });

            let planned = plan_invocations(
                &builder,
                &key,
                received_at_ms,
                max_bytes,
                pending,
                items,
            );

            let mut seen_ids = Vec::new();
            let mut fail_count = 0usize;
            for plan in planned.plans {
                match plan {
                    InvocationPlan::Invoke { pending, payload } => {
                        prop_assert!(payload.len() <= max_bytes);
                        let ids = payload_ids(&payload);
                        for id in &ids {
                            prop_assert!(pending.contains_key(id));
                        }
                        seen_ids.extend(ids);
                    }
                    InvocationPlan::Fail { pending, .. } => {
                        fail_count += pending.len();
                        seen_ids.extend(pending.into_keys());
                    }
                }
            }

            seen_ids.sort();
            let mut expected_ids = expected_ids;
            expected_ids.sort();
            prop_assert_eq!(seen_ids, expected_ids);

            // Failures are only expected when a single-item payload cannot fit the limit.
            if single_fits {
                prop_assert_eq!(fail_count, 0);
            }
        }
    }
}
