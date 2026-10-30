use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
    },
    time::{Duration, Instant},
};

pub(super) struct Card {
    child: Child,
    input: ChildStdin,
    output: Receiver<Value>,
    cancelled: Arc<AtomicBool>,
    pub(super) payload: String,
    pub(super) digest: String,
    pub(super) native_source: String,
}
impl Card {
    pub(super) fn prepare(cancelled: Arc<AtomicBool>) -> Option<Self> {
        if cancelled.load(Ordering::Acquire) {
            return None;
        }
        let node = PathBuf::from(std::env::var_os("MEDIFLOW_CHAT_CARD_NODE")?);
        let script = PathBuf::from(std::env::var_os("MEDIFLOW_CHAT_CARD_OWNER")?);
        let installation = PathBuf::from(std::env::var_os("MEDIFLOW_CHAT_CARD_INSTALLATION")?);
        if ![&node, &script, &installation]
            .iter()
            .all(|p| p.is_absolute() && p.is_file())
        {
            return None;
        }
        if std::fs::read(&script).ok()?.as_slice()
            != include_bytes!("../../../../../scripts/chat-card-native-owner.mjs")
        {
            return None;
        }
        let mut child = Command::new(node)
            .arg(script)
            .arg(installation)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let input = child.stdin.take()?;
        let mut reader = BufReader::new(child.stdout.take()?);
        let (sender, output) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            loop {
                let mut bytes = Vec::new();
                if Read::take(&mut reader, 65_537)
                    .read_until(b'\n', &mut bytes)
                    .is_err()
                    || bytes.len() > 65_536
                    || bytes.last() != Some(&b'\n')
                {
                    break;
                }
                let Ok(value) = serde_json::from_slice(&bytes) else {
                    break;
                };
                if sender.send(value).is_err() {
                    break;
                }
            }
        });
        let mut card = Self {
            child,
            cancelled,
            input,
            output,
            payload: String::new(),
            digest: String::new(),
            native_source: String::new(),
        };
        let review = card.call("prepare")?;
        if review.as_object()?.len() != 3 {
            return None;
        }
        card.payload = review["payload"].as_str()?.into();
        card.digest = review["payloadSha256"].as_str()?.into();
        if card.digest.len() != 64 || !card.digest.bytes().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        card.native_source = serde_json::to_string_pretty(&review["nativeSource"]).ok()?;
        Some(card)
    }
    fn call(&mut self, command: &str) -> Option<Value> {
        writeln!(self.input, "{}", json!({"command":command})).ok()?;
        self.input.flush().ok()?;
        let deadline =
            Instant::now() + Duration::from_secs(if command == "prepare" { 90 } else { 2 });
        loop {
            if self.cancelled.load(Ordering::Acquire) || Instant::now() >= deadline {
                return None;
            }
            match self.output.recv_timeout(Duration::from_millis(50)) {
                Ok(value) => return Some(value),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => return None,
            }
        }
    }
    pub(super) fn consume(&mut self) -> Option<String> {
        let result = self.call("consume")?;
        if result.as_object()?.len() != 1 || result["payload"].as_str()? != self.payload {
            return None;
        }
        Some(self.payload.clone())
    }
}
impl Drop for Card {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.payload.clear();
        self.native_source.clear();
    }
}
