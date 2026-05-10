//! Gateway configuration loaded from YAML.
//!
//! This config is intentionally small and focused on batching behavior and safe defaults.

use anyhow::ensure;
use serde::Deserialize;

use crate::spec::OpenApiLikeSpec;

fn default_max_inflight_invocations() -> usize {
    64
}

fn default_max_queue_depth_per_key() -> usize {
    1000
}

fn default_idle_ttl_ms() -> u64 {
    30_000
}

fn default_default_timeout_ms() -> u64 {
    2_000
}

fn default_max_body_bytes() -> usize {
    1024 * 1024
}

fn default_max_invoke_payload_bytes() -> usize {
    6 * 1024 * 1024
}

fn default_max_inflight_requests() -> usize {
    4096
}

fn default_max_pending_invocations() -> usize {
    256
}

#[derive(Debug, Clone, Default, Deserialize)]
/// Header forwarding policy.
///
/// By default (empty `allow` + empty `deny`) the gateway forwards all headers that can be decoded as
/// UTF-8, except hop-by-hop headers.
#[serde(rename_all = "PascalCase")]
pub struct ForwardHeadersConfig {
    /// If non-empty, only forward these headers (case-insensitive).
    #[serde(default)]
    pub allow: Vec<String>,
    /// Always drop these headers (case-insensitive).
    #[serde(default)]
    pub deny: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
/// Top-level gateway configuration.
#[serde(rename_all = "PascalCase")]
pub struct GatewayConfig {
    /// OpenAPI-ish spec document (only `paths` are used).
    #[serde(default)]
    pub spec: Option<OpenApiLikeSpec>,

    #[serde(default)]
    /// Optional AWS region override for the Lambda client.
    pub aws_region: Option<String>,

    #[serde(
        default = "default_max_inflight_invocations",
        deserialize_with = "crate::serde_ext::de_usize_or_string"
    )]
    /// Maximum number of concurrent in-flight Lambda invocations across all routes.
    pub max_inflight_invocations: usize,

    #[serde(
        default = "default_max_inflight_requests",
        deserialize_with = "crate::serde_ext::de_usize_or_string"
    )]
    /// Maximum number of in-flight HTTP requests across all routes.
    ///
    /// When exceeded, the gateway rejects requests with 429.
    pub max_inflight_requests: usize,

    #[serde(
        default = "default_max_pending_invocations",
        deserialize_with = "crate::serde_ext::de_usize_or_string"
    )]
    /// Maximum number of queued Lambda invocations waiting for execution.
    ///
    /// When full, the gateway rejects new batches with 429.
    pub max_pending_invocations: usize,

    #[serde(
        default = "default_max_queue_depth_per_key",
        deserialize_with = "crate::serde_ext::de_usize_or_string"
    )]
    /// Per-batch-key enqueue depth. When full, requests are rejected with 429.
    pub max_queue_depth_per_key: usize,

    #[serde(
        default = "default_idle_ttl_ms",
        deserialize_with = "crate::serde_ext::de_u64_or_string"
    )]
    /// If a batch key sees no traffic for this long, its batching task is evicted.
    pub idle_ttl_ms: u64,

    #[serde(
        default = "default_default_timeout_ms",
        deserialize_with = "crate::serde_ext::de_u64_or_string"
    )]
    /// Default per-request timeout (used when an operation doesn't specify `x-khone.timeoutMs`).
    pub default_timeout_ms: u64,

    #[serde(
        default = "default_max_body_bytes",
        deserialize_with = "crate::serde_ext::de_usize_or_string"
    )]
    /// Maximum accepted request body size.
    pub max_body_bytes: usize,

    #[serde(
        default = "default_max_invoke_payload_bytes",
        deserialize_with = "crate::serde_ext::de_usize_or_string"
    )]
    /// Maximum JSON payload size sent to Lambda per invocation.
    ///
    /// If a batch exceeds this limit, the gateway will split it into multiple invocations when
    /// possible; otherwise the affected requests will fail.
    pub max_invoke_payload_bytes: usize,

    /// Header forwarding allow/deny configuration.
    #[serde(default)]
    pub forward_headers: ForwardHeadersConfig,
}

impl GatewayConfig {
    /// Parse a YAML gateway config from bytes.
    pub fn from_yaml_bytes(bytes: &[u8]) -> anyhow::Result<Self> {
        let cfg: Self = serde_yaml::from_slice(bytes)?;
        cfg.validate()?;
        Ok(cfg)
    }

    fn validate(&self) -> anyhow::Result<()> {
        ensure_non_zero("MaxInflightInvocations", self.max_inflight_invocations)?;
        ensure_non_zero("MaxInflightRequests", self.max_inflight_requests)?;
        ensure_non_zero("MaxPendingInvocations", self.max_pending_invocations)?;
        ensure_non_zero("MaxQueueDepthPerKey", self.max_queue_depth_per_key)?;
        ensure_non_zero("MaxInvokePayloadBytes", self.max_invoke_payload_bytes)?;
        Ok(())
    }
}

fn ensure_non_zero(field: &'static str, value: usize) -> anyhow::Result<()> {
    ensure!(value > 0, "{field} must be greater than zero");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(field: &str, value: &str) -> Vec<u8> {
        format!(
            r#"
Spec:
  paths: {{}}
{field}: {value}
"#
        )
        .into_bytes()
    }

    #[test]
    fn defaults_apply_for_optional_fields() {
        let yaml = br#"
Spec:
  paths: {}
"#;
        let cfg = GatewayConfig::from_yaml_bytes(yaml).unwrap();
        assert_eq!(cfg.max_inflight_invocations, 64);
        assert_eq!(cfg.max_inflight_requests, 4096);
        assert_eq!(cfg.max_pending_invocations, 256);
        assert_eq!(cfg.max_queue_depth_per_key, 1000);
        assert_eq!(cfg.idle_ttl_ms, 30_000);
        assert_eq!(cfg.default_timeout_ms, 2_000);
        assert_eq!(cfg.max_body_bytes, 1024 * 1024);
        assert_eq!(cfg.max_invoke_payload_bytes, 6 * 1024 * 1024);
        assert!(cfg.forward_headers.allow.is_empty());
        assert!(cfg.forward_headers.deny.is_empty());
        assert!(cfg.aws_region.is_none());
        assert!(cfg.spec.is_some());
    }

    #[test]
    fn accepts_numeric_fields_as_strings() {
        let yaml = br#"
Spec:
  paths: {}
MaxInflightInvocations: "12"
MaxInflightRequests: "56"
MaxPendingInvocations: "78"
MaxQueueDepthPerKey: "34"
IdleTtlMs: "56000"
DefaultTimeoutMs: "789"
MaxBodyBytes: "1024"
MaxInvokePayloadBytes: "2048"
"#;
        let cfg = GatewayConfig::from_yaml_bytes(yaml).unwrap();
        assert_eq!(cfg.max_inflight_invocations, 12);
        assert_eq!(cfg.max_inflight_requests, 56);
        assert_eq!(cfg.max_pending_invocations, 78);
        assert_eq!(cfg.max_queue_depth_per_key, 34);
        assert_eq!(cfg.idle_ttl_ms, 56_000);
        assert_eq!(cfg.default_timeout_ms, 789);
        assert_eq!(cfg.max_body_bytes, 1024);
        assert_eq!(cfg.max_invoke_payload_bytes, 2048);
    }

    #[test]
    fn rejects_zero_resource_caps() {
        for field in [
            "MaxInflightInvocations",
            "MaxInflightRequests",
            "MaxPendingInvocations",
            "MaxQueueDepthPerKey",
            "MaxInvokePayloadBytes",
        ] {
            for value in ["0", r#""0""#] {
                let yaml = config_with(field, value);
                let err = GatewayConfig::from_yaml_bytes(&yaml).unwrap_err();
                let msg = err.to_string();
                assert!(
                    msg.contains(field),
                    "expected error for {field}={value} to name field, got: {msg}"
                );
                assert!(
                    msg.contains("greater than zero"),
                    "expected error for {field}={value} to explain bound, got: {msg}"
                );
            }
        }
    }

    #[test]
    fn allows_zero_max_body_bytes_to_reject_non_empty_bodies() {
        let yaml = config_with("MaxBodyBytes", "0");
        let cfg = GatewayConfig::from_yaml_bytes(&yaml).unwrap();
        assert_eq!(cfg.max_body_bytes, 0);
    }
}
