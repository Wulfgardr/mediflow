use super::chain::{self, MAX_ANCESTORS, Process};
#[cfg(target_os = "macos")]
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
#[repr(C)]
pub(super) struct Peer {
    token: [u32; 8],
    peer: i32,
    host: i32,
    peer_sec: u64,
    peer_usec: u64,
    host_sec: u64,
    host_usec: u64,
    kind: i32,
    host_hash: [u8; 32],
    host_hash_length: u32,
    chain_length: u32,
    chain: [Process; MAX_ANCESTORS],
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn MFChatCapturePeer(fd: i32, output: *mut Peer, require_host: i32) -> i32;
    fn MFChatBiometric(nonce: *const u8) -> i32;
    fn MFChatPrepareBiometric(nonce: *const u8) -> i32;
    fn MFChatCancelBiometric(nonce: *const u8);
    fn MFChatInstallLockObserver();
    fn MFChatLockEpoch() -> u64;
    fn MFChatScreenLocked() -> i32;
    fn MFChatUid() -> u32;
    fn MFChatConnectionOpen(fd: i32) -> i32;
}

pub(super) fn capture_channel(stream: &UnixStream) -> Option<Peer> {
    capture_checked(stream, true, true)
}

pub(super) fn capture(stream: &UnixStream, require_host: bool) -> Option<Peer> {
    capture_checked(stream, require_host, false)
}

fn capture_checked(stream: &UnixStream, require_host: bool, log: bool) -> Option<Peer> {
    #[cfg(target_os = "macos")]
    {
        let mut peer = Peer::default();
        let captured =
            unsafe { MFChatCapturePeer(stream.as_raw_fd(), &mut peer, i32::from(require_host)) }
                == 1;
        if !require_host {
            return captured.then_some(peer);
        }
        let chain = peer.chain();
        let decision = if captured {
            chain::evaluate(chain)
        } else {
            Err(chain::Denial::Incomplete)
        };
        if log {
            eprintln!("{}", chain::log_record(chain, &decision));
        }
        decision.ok().map(|()| peer)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (stream, require_host, log);
        None
    }
}

impl Peer {
    fn chain(&self) -> &[Process] {
        &self.chain[..(self.chain_length as usize).min(MAX_ANCESTORS)]
    }
    pub(super) fn opener_summary(&self) -> String {
        chain::summary(self.chain())
    }

    #[cfg(all(test, target_os = "macos"))]
    pub(super) fn test_peer() -> Self {
        Self {
            kind: -1,
            ..Self::default()
        }
    }
    pub(super) fn app(self) -> &'static str {
        match self.kind {
            1 => "Codex",
            2 => "Claude",
            _ => "Non disponibile",
        }
    }
    pub(super) fn current(self, stream: &UnixStream) -> bool {
        #[cfg(all(test, target_os = "macos"))]
        if self.kind == -1 {
            return connection_open(stream);
        }
        connection_open(stream) && capture(stream, true) == Some(self)
    }
}

pub(super) fn uid() -> u32 {
    #[cfg(target_os = "macos")]
    {
        unsafe { MFChatUid() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        u32::MAX
    }
}
fn connection_open(stream: &UnixStream) -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { MFChatConnectionOpen(stream.as_raw_fd()) != 0 }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = stream;
        false
    }
}

pub(super) fn install_lock_observer() {
    #[cfg(target_os = "macos")]
    unsafe {
        MFChatInstallLockObserver();
    }
}
pub(super) fn lock_epoch() -> u64 {
    #[cfg(target_os = "macos")]
    {
        unsafe { MFChatLockEpoch() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        u64::MAX
    }
}
pub(super) fn screen_locked() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { MFChatScreenLocked() != 0 }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}
pub(super) fn prepare_biometric(nonce: &[u8; 32]) -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { MFChatPrepareBiometric(nonce.as_ptr()) == 1 }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = nonce;
        false
    }
}
pub(super) fn cancel_biometric(nonce: &[u8; 32]) {
    #[cfg(target_os = "macos")]
    unsafe {
        MFChatCancelBiometric(nonce.as_ptr());
    }
    #[cfg(not(target_os = "macos"))]
    let _ = nonce;
}
pub(super) fn biometric(nonce: &[u8; 32]) -> Result<(), &'static str> {
    #[cfg(target_os = "macos")]
    {
        match unsafe { MFChatBiometric(nonce.as_ptr()) } {
            1 => Ok(()),
            2 => Err(
                "Touch ID non disponibile. Puoi usare il PIN di conferma nella finestra MediFlow.",
            ),
            3 => Err(
                "Touch ID bloccato dal sistema. Puoi usare il PIN di conferma nella finestra MediFlow.",
            ),
            _ => Err(
                "Touch ID non confermato. Puoi riprovare o scegliere il PIN prima della scadenza.",
            ),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = nonce;
        Err("Accesso nativo non supportato su questo sistema.")
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    unsafe extern "C" {
        fn getppid() -> i32;
    }

    #[test]
    fn kernel_snapshot_reports_the_actual_parent_in_summary_and_log() {
        let (stream, _remote) = UnixStream::pair().unwrap();
        let mut peer = Peer::default();
        assert_eq!(
            unsafe { MFChatCapturePeer(stream.as_raw_fd(), &mut peer, 1) },
            1
        );
        let chain = peer.chain();
        assert_eq!(chain.first().unwrap().pid, unsafe { getppid() });
        assert!(chain.first().unwrap().executable[0] != 0);
        let pid = format!("PID {}", unsafe { getppid() });
        assert!(peer.opener_summary().contains(&pid));
        assert!(chain::log_record(chain, &chain::evaluate(chain)).contains(&pid));
    }
    #[test]
    fn rejected_kernel_chain_never_reaches_native_confirmation() {
        use std::{
            io::Read,
            sync::{Arc, atomic::AtomicBool, mpsc},
            time::Duration,
        };
        let (stream, mut remote) = UnixStream::pair().unwrap();
        remote
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let (send, incoming) = mpsc::sync_channel(1);
        crate::chat_access::handle(stream, send, Arc::new(AtomicBool::new(true)));
        let mut response = String::new();
        remote.read_to_string(&mut response).unwrap();
        let value: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(value, serde_json::json!({"status": "withdrawn"}));
        assert!(matches!(
            incoming.try_recv(),
            Err(mpsc::TryRecvError::Disconnected)
        ));
    }
}
