use mediflow_local_voice::whisper::{AudioSource, SourcePhase};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

pub const SAMPLE_RATE: usize = 16_000;
pub const MAX_PENDING: usize = 120 * SAMPLE_RATE;
pub const FIRST_AUDIO: Duration = Duration::from_secs(15);

#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    OddLength,
    Full,
    Paused,
    Closed,
}

struct Buffer {
    samples: Zeroizing<Vec<f32>>,
    started: Option<Instant>,
    received: bool,
    paused: bool,
    closed: bool,
    accepted: usize,
}

#[derive(Clone)]
pub struct Feed(Arc<Mutex<Buffer>>);

pub struct Source(Arc<Mutex<Buffer>>);

pub fn channel() -> (Feed, Source) {
    let buffer = Arc::new(Mutex::new(Buffer {
        samples: Zeroizing::new(Vec::new()),
        started: None,
        received: false,
        paused: false,
        closed: false,
        accepted: 0,
    }));
    (Feed(buffer.clone()), Source(buffer))
}

impl Feed {
    pub fn push(&self, pcm: &[u8]) -> Result<usize, Refused> {
        if !pcm.len().is_multiple_of(2) {
            return Err(Refused::OddLength);
        }
        let mut buffer = self.0.lock().map_err(|_| Refused::Closed)?;
        if buffer.closed {
            return Err(Refused::Closed);
        }
        if buffer.paused {
            return Err(Refused::Paused);
        }
        let count = pcm.len() / 2;
        if buffer.samples.len() + count > MAX_PENDING {
            return Err(Refused::Full);
        }
        buffer.samples.extend(
            pcm.as_chunks::<2>()
                .0
                .iter()
                .map(|pair| f32::from(i16::from_le_bytes(*pair)) / 32_768.0),
        );
        if count > 0 {
            buffer.received = true;
        }
        buffer.accepted += count;
        Ok(count)
    }
    pub fn pending(&self) -> usize {
        self.0.lock().map_or(0, |b| b.samples.len())
    }
    pub fn accepted(&self) -> usize {
        self.0.lock().map_or(0, |b| b.accepted)
    }
    pub fn close(&self) {
        if let Ok(mut buffer) = self.0.lock() {
            buffer.closed = true;
        }
    }
    pub fn hold(&self) {
        if let Ok(mut buffer) = self.0.lock() {
            buffer.paused = true;
        }
    }
    pub fn release(&self) {
        if let Ok(mut buffer) = self.0.lock() {
            buffer.paused = false;
        }
    }
}

impl AudioSource for Source {
    fn start(&mut self) {
        if let Ok(mut buffer) = self.0.lock() {
            buffer.started.get_or_insert_with(Instant::now);
        }
    }
    fn phase(&mut self) -> SourcePhase {
        let Ok(buffer) = self.0.lock() else {
            return SourcePhase::Failed;
        };
        if buffer.received {
            SourcePhase::Running
        } else if buffer
            .started
            .is_some_and(|started| started.elapsed() >= FIRST_AUDIO)
        {
            SourcePhase::Failed
        } else {
            SourcePhase::Starting
        }
    }
    fn read(&mut self, out: &mut Vec<f32>) {
        let Ok(mut buffer) = self.0.lock() else {
            return;
        };
        let room = out.capacity() - out.len();
        let count = room.min(buffer.samples.len());
        if count == 0 {
            return;
        }
        out.extend_from_slice(&buffer.samples[..count]);
        let remaining = buffer.samples.len() - count;
        buffer.samples.copy_within(count.., 0);
        buffer.samples[remaining..].fill(0.0);
        buffer.samples.truncate(remaining);
    }
    fn pause(&mut self) {
        if let Ok(mut buffer) = self.0.lock() {
            buffer.paused = true;
        }
    }
    fn resume(&mut self) {
        if let Ok(mut buffer) = self.0.lock() {
            buffer.paused = false;
        }
    }
    fn stop(&mut self) {
        if let Ok(mut buffer) = self.0.lock() {
            buffer.closed = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pcm(values: &[i16]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    #[test]
    fn samples_arrive_in_order_and_leave_no_copy_behind() {
        let (feed, mut source) = channel();
        source.start();
        assert_eq!(source.phase(), SourcePhase::Starting);
        assert_eq!(feed.push(&pcm(&[16_384, -32_768, 0])), Ok(3));
        assert_eq!(source.phase(), SourcePhase::Running);
        let mut out = Vec::with_capacity(2);
        source.read(&mut out);
        assert_eq!(out, vec![0.5, -1.0]);
        assert_eq!(feed.pending(), 1);
        let mut rest = Vec::with_capacity(8);
        source.read(&mut rest);
        assert_eq!(rest, vec![0.0]);
        assert_eq!(feed.accepted(), 3);
    }

    #[test]
    fn odd_bytes_pause_close_and_a_full_buffer_are_refused() {
        let (feed, mut source) = channel();
        assert_eq!(feed.push(&[1, 2, 3]), Err(Refused::OddLength));
        source.pause();
        assert_eq!(feed.push(&pcm(&[1])), Err(Refused::Paused));
        source.resume();
        assert_eq!(feed.push(&vec![0; MAX_PENDING * 2]), Ok(MAX_PENDING));
        assert_eq!(feed.push(&pcm(&[1])), Err(Refused::Full));
        source.stop();
        assert_eq!(feed.push(&[]), Err(Refused::Closed));
    }

    #[test]
    fn no_audio_after_the_start_is_a_missing_microphone() {
        let (_feed, mut source) = channel();
        source.0.lock().unwrap().started = Some(Instant::now() - FIRST_AUDIO);
        assert_eq!(source.phase(), SourcePhase::Failed);
    }
}
