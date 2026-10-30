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
    input: Option<ChildStdin>,
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
        let supervisor = script.parent()?.join("chat-card-process-owner.mjs");
        if std::fs::read(&supervisor).ok()?.as_slice()
            != include_bytes!("../../../../../scripts/chat-card-process-owner.mjs")
        {
            return None;
        }
        let mut command = Command::new(node);
        command.arg(supervisor).arg(script).arg(installation);
        let mut card = Self::spawn(&mut command, cancelled)?;
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
    fn spawn(command: &mut Command, cancelled: Arc<AtomicBool>) -> Option<Self> {
        let mut child = command
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
        Some(Self {
            child,
            cancelled,
            input: Some(input),
            output,
            payload: String::new(),
            digest: String::new(),
            native_source: String::new(),
        })
    }
    fn stop(&mut self) -> std::io::Result<()> {
        self.input.take();
        if self.child.wait()?.success() {
            Ok(())
        } else {
            Err(std::io::Error::other(
                "Arresto del gruppo posseduto non verificato",
            ))
        }
    }
    fn call(&mut self, command: &str) -> Option<Value> {
        let timeout = Duration::from_secs(if command == "prepare" { 90 } else { 2 });
        self.call_with_timeout(command, timeout)
    }
    fn call_with_timeout(&mut self, command: &str, timeout: Duration) -> Option<Value> {
        let result = self.exchange(command, timeout);
        if result.is_none() && self.stop().is_err() {
            eprintln!("Arresto del gruppo posseduto non verificato");
        }
        result
    }
    fn exchange(&mut self, command: &str, timeout: Duration) -> Option<Value> {
        let input = self.input.as_mut()?;
        writeln!(input, "{}", json!({"command":command})).ok()?;
        input.flush().ok()?;
        let deadline = Instant::now() + timeout;
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
    #[cfg(test)]
    pub(super) fn synthetic() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let module = root.join("scripts/chat-card-process-owner.mjs");
        let fixture = root.join("scripts/fixtures/chat-card-owned-tree.mjs");
        let source = format!(
            "import {{superviseNativeCard}} from {}; await superviseNativeCard(process.execPath, [{}]);",
            json!(format!("file://{}", module.display())),
            json!(fixture)
        );
        let node = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .map(|dir| dir.join("node"))
            .find(|file| file.is_file())
            .expect("Node 24.18.0 required");
        let mut command = Command::new(node);
        command.args(["--input-type=module", "-e", &source]);
        let mut card = Self::spawn(&mut command, Arc::new(AtomicBool::new(false))).unwrap();
        let review = card.call("prepare").unwrap();
        card.payload = review["payload"].as_str().unwrap().into();
        card.digest = review["payloadSha256"].as_str().unwrap().into();
        card.native_source = review["nativeSource"].to_string();
        card
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
        if self.stop().is_err() {
            eprintln!("Arresto del gruppo posseduto non verificato");
        }
        self.payload.clear();
        self.native_source.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pids(card: &Card) -> Vec<u64> {
        serde_json::from_str::<Value>(&card.native_source).unwrap()["pids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap())
            .collect()
    }
    fn survivors(pids: &[u64]) -> usize {
        let output = Command::new("/bin/ps")
            .args(["-axo", "pid="])
            .output()
            .unwrap();
        assert!(output.status.success());
        String::from_utf8(output.stdout)
            .unwrap()
            .split_whitespace()
            .filter_map(|p| p.parse::<u64>().ok())
            .filter(|p| pids.contains(p))
            .count()
    }
    #[test]
    fn revoke_timeout_and_drop_stop_every_owned_descendant_only() {
        let other = Card::synthetic();
        let others = pids(&other);
        for scenario in ["revoke", "timeout", "drop"] {
            let mut card = Card::synthetic();
            let owned = pids(&card);
            assert_eq!(owned.len(), 3);
            assert_eq!(survivors(&owned), 3);
            match scenario {
                "revoke" => {
                    let cancelled = card.cancelled.clone();
                    let revoke = std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(100));
                        cancelled.store(true, Ordering::Release);
                    });
                    assert!(card.call("prepare").is_none());
                    revoke.join().unwrap();
                }
                "timeout" => {
                    assert!(
                        card.call_with_timeout("prepare", Duration::from_millis(20))
                            .is_none()
                    );
                }
                _ => {
                    drop(card);
                    assert_eq!(survivors(&owned), 0, "{scenario}");
                    assert_eq!(survivors(&others), 3);
                    continue;
                }
            }
            assert!(
                card.child.try_wait().unwrap().unwrap().success(),
                "{scenario}"
            );
            assert_eq!(survivors(&owned), 0, "{scenario}");
            assert_eq!(survivors(&others), 3, "{scenario} stopped another request");
        }
        drop(other);
        assert_eq!(survivors(&others), 0);
    }
}
