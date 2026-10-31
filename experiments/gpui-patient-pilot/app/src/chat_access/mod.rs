mod adapter;
mod card;
mod clinical;
mod native;
pub(crate) mod owner;
pub(crate) mod references;

use owner::{Pending, Request, State};
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::unix::{
        fs::{MetadataExt, PermissionsExt},
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    time::Duration,
};

pub(crate) use adapter::run_stdio;

pub(crate) struct Listener {
    path: PathBuf,
    active: Arc<AtomicBool>,
    inode: u64,
    device: u64,
    pub(crate) incoming: Receiver<Pending>,
}

impl Listener {
    pub(crate) fn configured() -> Option<Self> {
        let path = PathBuf::from(std::env::var_os("MEDIFLOW_CHAT_ACCESS_SOCKET")?);
        Self::bind(&path).ok()
    }
    fn bind(path: &Path) -> std::io::Result<Self> {
        if !cfg!(target_os = "macos") || !path.is_absolute() {
            return Err(std::io::ErrorKind::PermissionDenied.into());
        }
        let parent = path.parent().ok_or(std::io::ErrorKind::PermissionDenied)?;
        let metadata = fs::symlink_metadata(parent)?;
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || fs::canonicalize(parent)? != parent
            || metadata.uid() != native::uid()
            || metadata.mode() & 0o077 != 0
        {
            return Err(std::io::ErrorKind::PermissionDenied.into());
        }
        let socket = UnixListener::bind(path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        socket.set_nonblocking(true)?;
        let (send, incoming) = mpsc::sync_channel(1);
        let active = Arc::new(AtomicBool::new(true));
        let metadata = fs::symlink_metadata(path)?;
        let inode = metadata.ino();
        let device = metadata.dev();
        let connections = Arc::new(AtomicUsize::new(0));
        let alive = active.clone();
        std::thread::spawn(move || {
            while alive.load(Ordering::Acquire) {
                match socket.accept() {
                    Ok((stream, _)) => {
                        if connections.load(Ordering::Acquire) >= 4 {
                            continue;
                        }
                        connections.fetch_add(1, Ordering::AcqRel);
                        let send = send.clone();
                        let alive = alive.clone();
                        let connections = connections.clone();
                        std::thread::spawn(move || {
                            handle(stream, send, alive);
                            connections.fetch_sub(1, Ordering::AcqRel);
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(100))
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            path: path.into(),
            active,
            inode,
            device,
            incoming,
        })
    }
}
impl Drop for Listener {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
        if fs::symlink_metadata(&self.path)
            .is_ok_and(|m| m.ino() == self.inode && m.dev() == self.device)
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn handle(mut stream: UnixStream, incoming: SyncSender<Pending>, active: Arc<AtomicBool>) {
    let Some(peer) = native::capture(&stream, true) else {
        return;
    };
    let Ok(reader) = stream.try_clone() else {
        return;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let mut reader = BufReader::new(reader);
    let mut pending: Option<Pending> = None;
    let mut bytes = Vec::new();
    let mut last_activity = std::time::Instant::now();
    while last_activity.elapsed() < Duration::from_secs(300)
        && active.load(Ordering::Acquire)
        && peer.current(&stream)
        && !native::screen_locked()
    {
        if pending
            .as_ref()
            .is_some_and(|p| p.lock().is_ok_and(|mut p| p.status() == State::Withdrawn))
        {
            break;
        }
        match std::io::Read::take(&mut reader, (513 - bytes.len()) as u64)
            .read_until(b'\n', &mut bytes)
        {
            Ok(0) => break,
            Ok(_) if bytes.len() > 512 => break,
            Ok(_) if bytes.last() != Some(&b'\n') => break,
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                if bytes.len() > 512 {
                    break;
                }
                continue;
            }
            Err(_) => break,
        }
        let mut payload = None;
        let status = match serde_json::from_slice::<Value>(&bytes) {
            Ok(value)
                if (value == json!({"command": "request", "operation": owner::OPERATION})
                    || value == json!({"command":"clinical-profile"}))
                    && pending.is_none() =>
            {
                let Ok(copy) = stream.try_clone() else {
                    break;
                };
                let Some(request) = Request::new(peer, copy) else {
                    break;
                };
                if value["command"] == "clinical-profile" {
                    request.lock().unwrap().request_clinical();
                }
                if incoming.try_send(request.clone()).is_err() {
                    break;
                }
                pending = Some(request);
                State::Requested
            }
            Ok(value)
                if pending.is_none()
                    && value.as_object().is_some_and(|v| v.len() == 2)
                    && matches!(value["command"].as_str(), Some("drugs" | "prosthetics")) =>
            {
                let Ok(copy) = stream.try_clone() else {
                    break;
                };
                let Some(query) = value["query"].as_str() else {
                    break;
                };
                let Some(request) = (if value["command"] == "prosthetics" {
                    Request::for_prosthetics(peer, copy, query)
                } else {
                    Request::for_drugs(peer, copy, query)
                }) else {
                    break;
                };
                if incoming.try_send(request.clone()).is_err() {
                    break;
                }
                pending = Some(request);
                State::Requested
            }
            Ok(value) if pending.is_none() && value == json!({"command":"agenda"}) => {
                let Ok(copy) = stream.try_clone() else {
                    break;
                };
                let Some(request) = Request::for_agenda(peer, copy) else {
                    break;
                };
                if incoming.try_send(request.clone()).is_err() {
                    break;
                }
                pending = Some(request);
                State::Requested
            }
            Ok(value) if pending.is_none() && value == json!({"command":"local-voice"}) => {
                let Ok(copy) = stream.try_clone() else {
                    break;
                };
                let Some(request) = Request::for_voice(peer, copy) else {
                    break;
                };
                if incoming.try_send(request.clone()).is_err() {
                    break;
                }
                pending = Some(request);
                State::Requested
            }
            Ok(value) if pending.is_none() && value == json!({"command":"patient-document"}) => {
                let Ok(copy) = stream.try_clone() else {
                    break;
                };
                let Some(request) = Request::for_document(peer, copy) else {
                    break;
                };
                if incoming.try_send(request.clone()).is_err() {
                    break;
                }
                pending = Some(request);
                State::Requested
            }
            Ok(value)
                if pending.is_none()
                    && value.as_object().is_some_and(|v| v.len() == 2)
                    && value["command"] == "therapy"
                    && value["target"]
                        .as_str()
                        .is_some_and(|s| ["active", "suspended", "completed"].contains(&s)) =>
            {
                let Ok(copy) = stream.try_clone() else {
                    break;
                };
                let Some(request) =
                    Request::for_therapy(peer, copy, value["target"].as_str().unwrap())
                else {
                    break;
                };
                if incoming.try_send(request.clone()).is_err() {
                    break;
                }
                pending = Some(request);
                State::Requested
            }
            Ok(value)
                if pending.is_none()
                    && value.as_object().is_some_and(|v| v.len() == 2)
                    && value["command"] == "receipt"
                    && value["commandId"].as_str().is_some_and(|id| {
                        id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
                    }) =>
            {
                let Ok(copy) = stream.try_clone() else {
                    break;
                };
                let Some(request) =
                    Request::for_receipt(peer, copy, value["commandId"].as_str().unwrap())
                else {
                    break;
                };
                if incoming.try_send(request.clone()).is_err() {
                    break;
                }
                pending = Some(request);
                State::Requested
            }
            Ok(value) if value == json!({"command": "status"}) => pending
                .as_ref()
                .and_then(|p| p.lock().ok().map(|mut p| p.status()))
                .unwrap_or(State::Withdrawn),
            Ok(value) if value == json!({"command": "consume"}) => pending
                .as_ref()
                .map(|p| {
                    let result = owner::consume_card(p);
                    payload = result.1;
                    result.0
                })
                .unwrap_or(State::Withdrawn),
            Ok(value) if value == json!({"command": "revoke"}) => {
                if let Some(p) = &pending
                    && let Ok(mut p) = p.lock()
                {
                    p.revoke();
                    p.status()
                } else {
                    State::Write(mediflow_runtime_client::ChatWriteResolution::Uncertain)
                }
            }
            _ => break,
        };
        if !matches!(status, State::Withdrawn)
            && serde_json::from_slice::<Value>(&bytes).is_ok_and(|v| v["command"] != "status")
        {
            last_activity = std::time::Instant::now();
        }
        bytes.clear();
        let response = if let Some(receipt) = pending
            .as_ref()
            .and_then(|p| p.lock().ok().and_then(|p| p.safe_result()))
        {
            json!({"status":status.wire(), "receipt":receipt})
        } else if let Some(payload) = payload {
            json!({"status":status.wire(), "payload":payload})
        } else {
            json!({"status": status.wire()})
        };
        if writeln!(stream, "{response}").is_err() {
            break;
        }
    }
    if let Some(pending) = pending
        && let Ok(mut pending) = pending.lock()
    {
        pending.withdraw();
    }
}

pub(crate) fn install_lock_observer() {
    native::install_lock_observer();
}
