use std::{
    collections::hash_map::DefaultHasher,
    collections::VecDeque,
    hash::{Hash, Hasher},
    time::Duration,
};

use super::BatchKey;

pub(super) trait DynamicWaitPolicy: Send + Sync {
    fn wait_ms(
        &self,
        rps: f64,
        min_wait_ms: u64,
        max_wait_ms: u64,
        target_rps: f64,
        steepness: f64,
    ) -> u64;
}

pub(super) trait DurationWaitPolicy: Send + Sync {
    fn wait_ms(&self, probe_ms: f64, fraction: f64, min_wait_ms: u64, max_wait_ms: u64) -> u64;
}

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct DefaultWaitPolicy;

impl DynamicWaitPolicy for DefaultWaitPolicy {
    fn wait_ms(
        &self,
        rps: f64,
        min_wait_ms: u64,
        max_wait_ms: u64,
        target_rps: f64,
        steepness: f64,
    ) -> u64 {
        sigmoid_wait_ms(rps, min_wait_ms, max_wait_ms, target_rps, steepness)
    }
}

impl DurationWaitPolicy for DefaultWaitPolicy {
    fn wait_ms(&self, probe_ms: f64, fraction: f64, min_wait_ms: u64, max_wait_ms: u64) -> u64 {
        duration_wait_ms(probe_ms, fraction, min_wait_ms, max_wait_ms)
    }
}

pub(super) fn sigmoid_wait_ms(
    rps: f64,
    min_wait_ms: u64,
    max_wait_ms: u64,
    target_rps: f64,
    steepness: f64,
) -> u64 {
    if max_wait_ms <= min_wait_ms {
        return max_wait_ms;
    }

    let adjusted = (rps - target_rps) * steepness;
    let sigmoid = 1.0 / (1.0 + (-adjusted).exp());
    let scaled = min_wait_ms as f64 + sigmoid * (max_wait_ms - min_wait_ms) as f64;
    let rounded = scaled.round();
    let clamped = rounded
        .clamp(min_wait_ms as f64, max_wait_ms as f64)
        .trunc();
    clamped as u64
}

#[derive(Debug)]
pub(super) struct DynamicRateEstimator {
    interval: Duration,
    window_size: usize,
    count: u64,
    samples_rps: VecDeque<f64>,
}

impl DynamicRateEstimator {
    pub(super) fn new(interval: Duration, window_size: usize) -> Self {
        Self {
            interval,
            window_size,
            count: 0,
            samples_rps: VecDeque::with_capacity(window_size),
        }
    }

    pub(super) fn record_request(&mut self) {
        self.count = self.count.saturating_add(1);
    }

    pub(super) fn tick(&mut self) {
        let secs = self.interval.as_secs_f64();
        let rps = if secs > 0.0 {
            self.count as f64 / secs
        } else {
            0.0
        };
        self.count = 0;

        self.samples_rps.push_back(rps);
        while self.samples_rps.len() > self.window_size {
            self.samples_rps.pop_front();
        }
    }

    pub(super) fn smoothed_rps(&self) -> f64 {
        if self.samples_rps.is_empty() {
            return 0.0;
        }
        self.samples_rps.iter().copied().sum::<f64>() / self.samples_rps.len() as f64
    }
}

pub(super) fn stable_probe_offset_ms(key: &BatchKey, probe_jitter_ms: u64) -> u64 {
    if probe_jitter_ms == 0 {
        return 0;
    }
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    let h = hasher.finish();
    let range = probe_jitter_ms.saturating_add(1);
    if range == 0 {
        0
    } else {
        h % range
    }
}

pub(super) fn record_probe_sample(
    samples: &mut VecDeque<f64>,
    window_size: usize,
    elapsed_ms: u64,
) {
    if window_size == 0 {
        return;
    }
    samples.push_back(elapsed_ms as f64);
    while samples.len() > window_size {
        samples.pop_front();
    }
}

pub(super) fn smoothed_probe_ms(samples: &VecDeque<f64>) -> f64 {
    let mut count = 0usize;
    let mut sum = 0.0;
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;

    for value in samples.iter().copied().filter(|v| v.is_finite() && *v > 0.0) {
        count += 1;
        sum += value;
        min = min.min(value);
        max = max.max(value);
    }

    if count == 0 {
        return 0.0;
    }

    if count >= 3 {
        (sum - min - max) / (count - 2) as f64
    } else {
        sum / count as f64
    }
}

pub(super) fn duration_wait_ms(
    probe_ms: f64,
    fraction: f64,
    min_wait_ms: u64,
    max_wait_ms: u64,
) -> u64 {
    if max_wait_ms <= min_wait_ms {
        return max_wait_ms;
    }
    let base = if probe_ms.is_finite() && probe_ms > 0.0 {
        probe_ms
    } else {
        min_wait_ms as f64
    };
    let computed = base * (1.0 + fraction.max(0.0));
    let rounded = computed.round();
    let clamped = rounded
        .clamp(min_wait_ms as f64, max_wait_ms as f64)
        .trunc();
    clamped as u64
}
