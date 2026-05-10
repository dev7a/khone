//! Lambda invocation abstraction.
//!
//! The gateway supports two modes:
//! - Buffered (`Invoke`) where the entire Lambda response is returned as a single payload.
//! - Response streaming (`InvokeWithResponseStream`) where the Lambda response is delivered as a
//!   stream of byte chunks (used for NDJSON records).

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use bytes::Bytes;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

use crate::spec::InvokeMode;

#[derive(Debug, Clone, Default)]
pub struct LambdaInvokeReport {
    pub duration_ms: Option<f64>,
    pub billed_duration_ms: Option<f64>,
    pub init_duration_ms: Option<f64>,
    pub memory_size_mb: Option<u64>,
    pub max_memory_used_mb: Option<u64>,
    pub raw_report_line: Option<String>,
}

/// Result of invoking a Lambda function.
pub enum LambdaInvokeResult {
    /// Entire response payload (buffered).
    Buffered {
        payload: Bytes,
        report: Option<LambdaInvokeReport>,
    },
    /// Stream of payload chunks.
    ///
    /// The receiver yields `Ok(Bytes)` chunks, or a terminal `Err` if the stream reports an error.
    ResponseStream {
        stream: mpsc::Receiver<anyhow::Result<Bytes>>,
        report: Option<oneshot::Receiver<LambdaInvokeReport>>,
    },
}

#[async_trait]
/// Abstract Lambda invoker to allow unit-testing the gateway without AWS.
pub trait LambdaInvoker: Send + Sync {
    async fn invoke(
        &self,
        function_name: &str,
        payload: Bytes,
        mode: InvokeMode,
        profiling: bool,
    ) -> anyhow::Result<LambdaInvokeResult>;
}

pub(crate) fn parse_lambda_report_from_log_result(
    log_result_b64: &str,
) -> Option<LambdaInvokeReport> {
    let decoded = STANDARD.decode(log_result_b64).ok()?;
    let text = String::from_utf8_lossy(&decoded);
    let report_line = text
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with("REPORT "))
        .map(|l| l.trim().to_string());

    if let Some(report_line) = report_line {
        // REPORT lines are typically tab-delimited segments like:
        // `Duration: 1.23 ms\tBilled Duration: 2 ms\tMemory Size: 128 MB ...`
        let mut fields: std::collections::HashMap<&str, &str> = std::collections::HashMap::new();
        for part in report_line.split('\t') {
            let Some((k, v)) = part.split_once(':') else {
                continue;
            };
            let k = k.trim();
            let v = v.trim();
            if !k.is_empty() && !v.is_empty() {
                fields.insert(k, v);
            }
        }

        fn parse_ms(value: &str) -> Option<f64> {
            let mut end = 0usize;
            for (i, ch) in value.char_indices() {
                if !(ch.is_ascii_digit() || ch == '.') {
                    break;
                }
                end = i + ch.len_utf8();
            }
            if end == 0 {
                None
            } else {
                value[..end].trim().parse::<f64>().ok()
            }
        }

        fn parse_mb(value: &str) -> Option<u64> {
            let mut end = 0usize;
            for (i, ch) in value.char_indices() {
                if !ch.is_ascii_digit() {
                    break;
                }
                end = i + ch.len_utf8();
            }
            if end == 0 {
                None
            } else {
                value[..end].trim().parse::<u64>().ok()
            }
        }

        return Some(LambdaInvokeReport {
            duration_ms: fields.get("Duration").and_then(|v| parse_ms(v)),
            billed_duration_ms: fields.get("Billed Duration").and_then(|v| parse_ms(v)),
            init_duration_ms: fields.get("Init Duration").and_then(|v| parse_ms(v)),
            memory_size_mb: fields.get("Memory Size").and_then(|v| parse_mb(v)),
            max_memory_used_mb: fields.get("Max Memory Used").and_then(|v| parse_mb(v)),
            raw_report_line: Some(report_line),
        });
    }

    // If system logs are configured for structured JSON, `REPORT` is emitted as a JSON object.
    // See Lambda Telemetry API schema for `platform.report`.
    for line in text.lines().rev() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }

        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("platform.report") {
            continue;
        }
        let metrics = v.get("record").and_then(|r| r.get("metrics"))?;

        let duration_ms = metrics.get("durationMs").and_then(|n| n.as_f64());
        let billed_duration_ms = metrics
            .get("billedDurationMs")
            .and_then(|n| n.as_f64().or_else(|| n.as_i64().map(|i| i as f64)));
        let init_duration_ms = metrics.get("initDurationMs").and_then(|n| n.as_f64());

        let memory_size_mb = metrics.get("memorySizeMB").and_then(|n| {
            n.as_u64()
                .or_else(|| n.as_i64().and_then(|i| u64::try_from(i).ok()))
        });
        let max_memory_used_mb = metrics.get("maxMemoryUsedMB").and_then(|n| {
            n.as_u64()
                .or_else(|| n.as_i64().and_then(|i| u64::try_from(i).ok()))
        });

        return Some(LambdaInvokeReport {
            duration_ms,
            billed_duration_ms,
            init_duration_ms,
            memory_size_mb,
            max_memory_used_mb,
            raw_report_line: Some(line.to_string()),
        });
    }

    None
}

/// AWS SDK implementation of [`LambdaInvoker`].
pub struct AwsLambdaInvoker {
    client: aws_sdk_lambda::Client,
}

impl AwsLambdaInvoker {
    /// Create an invoker using standard AWS credential resolution.
    pub async fn new(region: Option<String>) -> anyhow::Result<Self> {
        let mut loader = aws_config::from_env();
        if let Some(region) = region {
            loader = loader.region(aws_config::Region::new(region));
        }
        let cfg = loader.load().await;
        let client = aws_sdk_lambda::Client::new(&cfg);
        Ok(Self { client })
    }
}

#[async_trait]
impl LambdaInvoker for AwsLambdaInvoker {
    async fn invoke(
        &self,
        function_name: &str,
        payload: Bytes,
        mode: InvokeMode,
        profiling: bool,
    ) -> anyhow::Result<LambdaInvokeResult> {
        match mode {
            InvokeMode::Buffered => {
                let mut req = self
                    .client
                    .invoke()
                    .function_name(function_name)
                    .payload(aws_sdk_lambda::primitives::Blob::new(payload));
                if profiling {
                    req = req.log_type(aws_sdk_lambda::types::LogType::Tail);
                }
                let out = req.send().await?;

                if let Some(function_error) = out.function_error() {
                    anyhow::bail!("lambda function error ({function_error}) for {function_name}");
                }

                let report = if profiling {
                    out.log_result()
                        .and_then(parse_lambda_report_from_log_result)
                } else {
                    None
                };

                let bytes = out
                    .payload()
                    .map(|b| Bytes::copy_from_slice(b.as_ref()))
                    .unwrap_or_default();

                Ok(LambdaInvokeResult::Buffered {
                    payload: bytes,
                    report,
                })
            }
            InvokeMode::ResponseStream => {
                let mut req = self
                    .client
                    .invoke_with_response_stream()
                    .function_name(function_name)
                    .payload(aws_sdk_lambda::primitives::Blob::new(payload));
                if profiling {
                    req = req.log_type(aws_sdk_lambda::types::LogType::Tail);
                }
                let out = req.send().await?;

                if out.status_code() != 200 {
                    anyhow::bail!(
                        "InvokeWithResponseStream failed for {function_name} (status {})",
                        out.status_code()
                    );
                }

                let stream = out.event_stream;
                let (tx, rx) = mpsc::channel::<anyhow::Result<Bytes>>(16);
                let (report_tx, report_rx) = if profiling {
                    let (tx, rx) = oneshot::channel();
                    (Some(tx), Some(rx))
                } else {
                    (None, None)
                };

                tokio::spawn(async move {
                    let mut stream = stream;
                    let mut can_send = true;
                    let mut report_tx = report_tx;
                    loop {
                        let event = match stream.recv().await {
                            Ok(Some(e)) => e,
                            Ok(None) => break,
                            Err(err) => {
                                if can_send {
                                    let _ = tx
                                        .send(Err(anyhow::anyhow!("event stream recv: {err}")))
                                        .await;
                                }
                                break;
                            }
                        };

                        match event {
                            aws_sdk_lambda::types::InvokeWithResponseStreamResponseEvent::PayloadChunk(
                                chunk,
                            ) => {
                                if !can_send {
                                    continue;
                                }
                                let Some(payload) = chunk.payload() else {
                                    continue;
                                };
                                let bytes = Bytes::copy_from_slice(payload.as_ref());
                                if tx.send(Ok(bytes)).await.is_err() {
                                    // Downstream no longer needs the response body. Keep draining the
                                    // upstream event stream to avoid locally resetting the HTTP/2 stream.
                                    can_send = false;
                                }
                            }
                            aws_sdk_lambda::types::InvokeWithResponseStreamResponseEvent::InvokeComplete(
                                complete,
                            ) => {
                                if let Some(tx) = report_tx.take() {
                                    let report = complete
                                        .log_result()
                                        .and_then(parse_lambda_report_from_log_result)
                                        .unwrap_or_default();
                                    let _ = tx.send(report);
                                }

                                if let Some(code) = complete.error_code() {
                                    let details = complete.error_details().unwrap_or_default();
                                    if can_send {
                                        let _ = tx
                                            .send(Err(anyhow::anyhow!(
                                                "lambda stream error ({code}): {details}"
                                            )))
                                            .await;
                                    }
                                }

                                // Best-effort: drain to EOF so the underlying HTTP stream can close
                                // cleanly. Dropping the event stream without draining results in a
                                // local reset (RST_STREAM), which can accumulate and trigger
                                // `h2::proto::streams::streams` warnings like:
                                // "locally-reset streams reached limit (1024)".
                                let _ = timeout(Duration::from_secs(1), async {
                                    while let Ok(Some(_)) = stream.recv().await {}
                                })
                                .await;
                                break;
                            }
                            _ => {}
                        }
                    }
                });

                Ok(LambdaInvokeResult::ResponseStream {
                    stream: rx,
                    report: report_rx,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_report_line_from_log_tail() {
        let log = concat!(
            "START RequestId: abc Version: $LATEST\n",
            "some log line\n",
            "REPORT RequestId: abc\tDuration: 12.34 ms\tBilled Duration: 13 ms\tMemory Size: 256 MB\tMax Memory Used: 128 MB\tInit Duration: 100.00 ms\n",
            "END RequestId: abc\n"
        );
        let b64 = STANDARD.encode(log.as_bytes());
        let report = parse_lambda_report_from_log_result(&b64).expect("report");
        assert_eq!(report.duration_ms, Some(12.34));
        assert_eq!(report.billed_duration_ms, Some(13.0));
        assert_eq!(report.init_duration_ms, Some(100.00));
        assert_eq!(report.memory_size_mb, Some(256));
        assert_eq!(report.max_memory_used_mb, Some(128));
        assert!(report
            .raw_report_line
            .as_deref()
            .unwrap()
            .starts_with("REPORT "));
    }

    #[test]
    fn parses_platform_report_from_json_system_logs() {
        let log = concat!(
            "{\"time\":\"2022-10-12T00:01:15.000Z\",\"type\":\"platform.start\",\"record\":{\"requestId\":\"abc\"}}\n",
            "{\"time\":\"2022-10-12T00:01:15.000Z\",\"type\":\"platform.report\",\"record\":{\"metrics\":{\"billedDurationMs\":694,\"durationMs\":693.92,\"initDurationMs\":397.68,\"maxMemoryUsedMB\":84,\"memorySizeMB\":128},\"requestId\":\"abc\"}}\n"
        );
        let b64 = STANDARD.encode(log.as_bytes());
        let report = parse_lambda_report_from_log_result(&b64).expect("report");
        assert_eq!(report.duration_ms, Some(693.92));
        assert_eq!(report.billed_duration_ms, Some(694.0));
        assert_eq!(report.init_duration_ms, Some(397.68));
        assert_eq!(report.memory_size_mb, Some(128));
        assert_eq!(report.max_memory_used_mb, Some(84));
        assert!(report
            .raw_report_line
            .as_deref()
            .unwrap()
            .contains("\"platform.report\""));
    }
}
