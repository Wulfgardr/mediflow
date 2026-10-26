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

pub(super) fn capture(stream: &UnixStream, require_host: bool) -> Option<Peer> {
    #[cfg(target_os = "macos")]
    {
        let mut peer = Peer::default();
        if unsafe { MFChatCapturePeer(stream.as_raw_fd(), &mut peer, i32::from(require_host)) } == 1
        {
            Some(peer)
        } else {
            None
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (stream, require_host);
        None
    }
}

impl Peer {
    pub(super) fn app(self) -> &'static str {
        match self.kind {
            1 => "Codex",
            2 => "Claude",
            _ => "Non disponibile",
        }
    }
    pub(super) fn current(self, stream: &UnixStream) -> bool {
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
