use std::io::{self, BufRead, Read, Write};
use std::net::TcpStream;
use zeroize::Zeroizing;

pub const MAX_HEAD: usize = 16 * 1024;
pub const MAX_BODY: usize = 1024 * 1024;

#[cfg(test)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Zeroizing<Vec<u8>>,
}

#[cfg(test)]
impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ReadError {
    Malformed,
    TooLarge,
    Io,
}

pub struct Head {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub length: usize,
}

impl Head {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
    pub fn expects_continue(&self) -> bool {
        self.header("expect")
            .is_some_and(|v| v.eq_ignore_ascii_case("100-continue"))
    }
}

pub fn read_head(reader: &mut impl BufRead) -> Result<Head, ReadError> {
    let mut head = 0usize;
    let mut line = String::new();
    let mut next_line = |line: &mut String| -> Result<(), ReadError> {
        line.clear();
        let read = reader
            .by_ref()
            .take((MAX_HEAD - head + 1) as u64)
            .read_line(line)
            .map_err(|_| ReadError::Io)?;
        head += read;
        if head > MAX_HEAD {
            return Err(ReadError::TooLarge);
        }
        if read == 0 || !line.ends_with("\r\n") {
            return Err(ReadError::Malformed);
        }
        line.truncate(line.len() - 2);
        Ok(())
    };
    next_line(&mut line)?;
    let mut parts = line.split(' ');
    let (Some(method), Some(path), Some("HTTP/1.1" | "HTTP/1.0"), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(ReadError::Malformed);
    };
    let (method, path) = (method.to_owned(), path.to_owned());
    let mut headers = Vec::new();
    loop {
        next_line(&mut line)?;
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':').ok_or(ReadError::Malformed)?;
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
    }
    if headers.iter().any(|(name, _)| name == "transfer-encoding") {
        return Err(ReadError::Malformed);
    }
    let lengths: Vec<&str> = headers
        .iter()
        .filter(|(name, _)| name == "content-length")
        .map(|(_, value)| value.as_str())
        .collect();
    let length = match lengths.as_slice() {
        [] => 0,
        [value] => value.parse::<usize>().map_err(|_| ReadError::Malformed)?,
        _ => return Err(ReadError::Malformed),
    };
    if length > MAX_BODY {
        return Err(ReadError::TooLarge);
    }
    Ok(Head {
        method,
        path,
        headers,
        length,
    })
}

pub fn read_body(reader: &mut impl Read, length: usize) -> Result<Zeroizing<Vec<u8>>, ReadError> {
    let mut body = Zeroizing::new(vec![0u8; length]);
    reader.read_exact(&mut body).map_err(|_| ReadError::Io)?;
    Ok(body)
}

#[cfg(test)]
pub fn read_request(stream: &mut impl Read) -> Result<Request, ReadError> {
    let mut reader = std::io::BufReader::new(stream);
    let head = read_head(&mut reader)?;
    let body = read_body(&mut reader, head.length)?;
    Ok(Request {
        method: head.method,
        path: head.path,
        headers: head.headers,
        body,
    })
}

pub fn write_continue(stream: &mut impl Write, proof: &str) -> io::Result<()> {
    stream.write_all(
        format!("HTTP/1.1 100 Continue\r\nX-MediFlow-Voice-Proof: {proof}\r\n\r\n").as_bytes(),
    )?;
    stream.flush()
}

pub struct Response {
    pub status: u16,
    pub body: Zeroizing<Vec<u8>>,
    pub proof: Option<String>,
}

impl Response {
    pub fn json(status: u16, value: &serde_json::Value) -> Self {
        Self {
            status,
            body: Zeroizing::new(serde_json::to_vec(value).unwrap_or_default()),
            proof: None,
        }
    }
    pub fn empty(status: u16) -> Self {
        Self {
            status,
            body: Zeroizing::new(Vec::new()),
            proof: None,
        }
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        503 => "Service Unavailable",
        _ => "Error",
    }
}

pub fn write_response(stream: &mut TcpStream, response: &Response) -> io::Result<()> {
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
        response.status,
        reason(response.status),
        response.body.len()
    );
    if !response.body.is_empty() {
        head.push_str("Content-Type: application/json\r\n");
    }
    if let Some(proof) = &response.proof {
        head.push_str("X-MediFlow-Voice-Proof: ");
        head.push_str(proof);
        head.push_str("\r\n");
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.write_all(&response.body)?;
    stream.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_request_with_its_body() {
        let raw =
            b"POST /v1/sessions HTTP/1.1\r\nHost: 127.0.0.1:9\r\nContent-Length: 4\r\n\r\nabcd";
        let request = read_request(&mut &raw[..]).unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/v1/sessions");
        assert_eq!(request.header("host"), Some("127.0.0.1:9"));
        assert_eq!(request.body.as_slice(), b"abcd");
    }

    #[test]
    fn refuses_chunks_double_lengths_oversize_and_broken_heads() {
        let cases: [(&[u8], ReadError); 5] = [
            (
                b"POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n",
                ReadError::Malformed,
            ),
            (
                b"POST / HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nab",
                ReadError::Malformed,
            ),
            (
                b"POST / HTTP/1.1\r\nContent-Length: 99999999\r\n\r\n",
                ReadError::TooLarge,
            ),
            (b"GET /\r\n\r\n", ReadError::Malformed),
            (b"GET / HTTP/1.1\nHost: x\n\n", ReadError::Malformed),
        ];
        for (raw, expected) in cases {
            assert_eq!(read_request(&mut &raw[..]).err(), Some(expected));
        }
        let long = format!("GET / HTTP/1.1\r\nX: {}\r\n\r\n", "a".repeat(MAX_HEAD));
        assert_eq!(
            read_request(&mut long.as_bytes()).err(),
            Some(ReadError::TooLarge)
        );
    }
}
