use async_trait::async_trait;
use tokio::sync::mpsc;

use super::scheduler::DurationFeedback;

#[async_trait]
pub(super) trait ProbeFeedbackReporter: Send + Sync {
    fn report_best_effort(
        &self,
        duration_feedback_tx: Option<mpsc::Sender<DurationFeedback>>,
        success: bool,
        elapsed_ms: u64,
    );

    async fn report_async(
        &self,
        duration_feedback_tx: Option<&mpsc::Sender<DurationFeedback>>,
        success: bool,
        elapsed_ms: u64,
    );
}

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct DefaultProbeFeedbackReporter;

#[async_trait]
impl ProbeFeedbackReporter for DefaultProbeFeedbackReporter {
    fn report_best_effort(
        &self,
        duration_feedback_tx: Option<mpsc::Sender<DurationFeedback>>,
        success: bool,
        elapsed_ms: u64,
    ) {
        crate::metrics::emit_batched_probe_feedback(success);

        if let Some(tx) = duration_feedback_tx {
            let fb = DurationFeedback {
                is_probe: true,
                success,
                elapsed_ms,
            };
            if tx.try_send(fb).is_err() {
                tokio::spawn(async move {
                    let _ = tx.send(fb).await;
                });
            }
        }
    }

    async fn report_async(
        &self,
        duration_feedback_tx: Option<&mpsc::Sender<DurationFeedback>>,
        success: bool,
        elapsed_ms: u64,
    ) {
        crate::metrics::emit_batched_probe_feedback(success);

        if let Some(tx) = duration_feedback_tx {
            let fb = DurationFeedback {
                is_probe: true,
                success,
                elapsed_ms,
            };
            if tx.try_send(fb).is_err() {
                let _ = tx.send(fb).await;
            }
        }
    }
}
