//! Accept for plain HTTP test fixtures on a machine where T3 Code probes every
//! open loopback port with `GET /` and a TLS handshake. Only those two are
//! discarded, so a fixture still rejects any other request the client sends.

use std::io::{self, ErrorKind};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

fn is_port_probe(head: &[u8]) -> bool {
    if head.starts_with(&[0x16, 0x03]) {
        return true;
    }
    let head = String::from_utf8_lossy(head).to_ascii_lowercase();
    head.starts_with("get / http/") && head.contains("\r\nuser-agent: node\r\n")
}

pub(crate) fn accept(listener: &TcpListener) -> io::Result<(TcpStream, SocketAddr)> {
    loop {
        let (stream, peer) = listener.accept()?;
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_millis(250)))?;
        let mut head = [0; 512];
        let probe = match stream.peek(&mut head) {
            Ok(read) => is_port_probe(&head[..read]),
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                false
            }
            Err(error) => return Err(error),
        };
        if probe {
            continue;
        }
        stream.set_read_timeout(None)?;
        return Ok((stream, peer));
    }
}
