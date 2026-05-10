#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) trait Clock: Send + Sync {
    fn mono_now(&self) -> tokio::time::Instant;
    fn wall_now_ms(&self) -> u64;
}

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct SystemClock;

impl Clock for SystemClock {
    fn mono_now(&self) -> tokio::time::Instant {
        tokio::time::Instant::now()
    }

    fn wall_now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(super) struct TestClock {
    wall_ms: AtomicU64,
}

#[cfg(test)]
impl TestClock {
    pub(super) fn new(initial_wall_ms: u64) -> Self {
        Self {
            wall_ms: AtomicU64::new(initial_wall_ms),
        }
    }

    pub(super) fn set_wall_ms(&self, wall_ms: u64) {
        self.wall_ms.store(wall_ms, Ordering::Relaxed);
    }

    pub(super) fn advance_wall_ms(&self, delta_ms: u64) {
        self.wall_ms.fetch_add(delta_ms, Ordering::Relaxed);
    }
}

#[cfg(test)]
impl Clock for TestClock {
    fn mono_now(&self) -> tokio::time::Instant {
        tokio::time::Instant::now()
    }

    fn wall_now_ms(&self) -> u64 {
        self.wall_ms.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::{Clock, TestClock};

    #[test]
    fn test_clock_updates_wall_time() {
        let clock = TestClock::new(100);
        assert_eq!(clock.wall_now_ms(), 100);
        clock.advance_wall_ms(25);
        assert_eq!(clock.wall_now_ms(), 125);
        clock.set_wall_ms(7);
        assert_eq!(clock.wall_now_ms(), 7);
    }
}
