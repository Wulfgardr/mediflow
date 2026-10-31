//! Accept for plain HTTP test fixtures on a machine where T3 Code probes every
//! open loopback port with `GET /` and a TLS handshake. Only those two are
//! discarded, so a fixture still rejects any other request the client sends.

use std::io::{self, ErrorKind};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

const PLAIN_PROBE: &[u8] = b"get / http/";
const TLS_RECORD: &[u8] = &[0x16, 0x03];

#[derive(PartialEq)]
enum Probe {
    Yes,
    No,
    Undecided,
}

fn classify(head: &[u8]) -> Probe {
    if head.starts_with(TLS_RECORD) {
        return Probe::Yes;
    }
    if TLS_RECORD.starts_with(head) {
        return Probe::Undecided;
    }
    let lower = head.to_ascii_lowercase();
    let shared = lower.len().min(PLAIN_PROBE.len());
    if lower[..shared] != PLAIN_PROBE[..shared] {
        return Probe::No;
    }
    let text = String::from_utf8_lossy(&lower);
    if text.contains("\r\nuser-agent: node\r\n") {
        Probe::Yes
    } else if text.contains("\r\n\r\n") || lower.len() == 2048 {
        Probe::No
    } else {
        Probe::Undecided
    }
}

/// Reads ahead without consuming: a fixture still receives every byte it would
/// have read. A connection that stays undecided past the deadline is kept.
fn is_port_probe(stream: &TcpStream) -> io::Result<bool> {
    let deadline = Instant::now() + Duration::from_millis(250);
    let mut head = [0; 2048];
    loop {
        let verdict = match stream.peek(&mut head) {
            Ok(0) => return Ok(false),
            Ok(read) => classify(&head[..read]),
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                Probe::Undecided
            }
            Err(error) => return Err(error),
        };
        if verdict != Probe::Undecided {
            return Ok(verdict == Probe::Yes);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

pub(crate) fn accept(listener: &TcpListener) -> io::Result<(TcpStream, SocketAddr)> {
    loop {
        let (stream, peer) = listener.accept()?;
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_millis(25)))?;
        if is_port_probe(&stream)? {
            continue;
        }
        stream.set_read_timeout(None)?;
        return Ok((stream, peer));
    }
}
