/* @Codex */
#![forbid(unsafe_code)]
use std::io::{self, Read, Write};
use mediflow_rust_boundary_experiment::{decode, MAX_FRAME_BYTES};

fn response(payload: &[u8]) -> Vec<u8> {
    match decode(payload) {
        Ok(canonical) => serde_json::json!({"ok": true, "canonical": canonical}).to_string().into_bytes(),
        Err(error) => serde_json::json!({"ok": false, "error": error.code()}).to_string().into_bytes(),
    }
}
fn write_response(out: &mut impl Write, payload: &[u8]) -> io::Result<()> {
    let result = response(payload);
    out.write_all(&(result.len() as u32).to_le_bytes())?;
    out.write_all(&result)?;
    out.flush()
}
fn run(input: &mut impl Read, output: &mut impl Write) -> io::Result<()> {
    loop {
        let mut header = [0_u8; 4];
        let mut read = 0;
        while read < header.len() {
            let count = input.read(&mut header[read..])?;
            if count == 0 {
                if read == 0 { return Ok(()); }
                write_response(output, b"")?;
                return Ok(());
            }
            read += count;
        }
        let length = u32::from_le_bytes(header) as usize;
        if length > MAX_FRAME_BYTES {
            write_response(output, &vec![0; MAX_FRAME_BYTES + 1])?;
            return Ok(());
        }
        let mut payload = vec![0_u8; length];
        if input.read_exact(&mut payload).is_err() {
            write_response(output, b"")?;
            return Ok(());
        }
        write_response(output, &payload)?;
    }
}
fn main() -> std::process::ExitCode {
    let stdin = io::stdin();
    let stdout = io::stdout();
    match run(&mut stdin.lock(), &mut stdout.lock()) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(_) => std::process::ExitCode::FAILURE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing_rejects_oversize_and_partial_payload() {
        let mut oversized = Vec::new();
        oversized.extend_from_slice(&4097_u32.to_le_bytes());
        oversized.extend_from_slice(b"ignored");
        let mut result = Vec::new();
        run(&mut oversized.as_slice(), &mut result).unwrap();
        assert!(std::str::from_utf8(&result[4..]).unwrap().contains("frame_too_large"));
        let mut partial = Vec::new();
        partial.extend_from_slice(&5_u32.to_le_bytes());
        partial.extend_from_slice(b"x");
        result.clear();
        run(&mut partial.as_slice(), &mut result).unwrap();
        assert!(std::str::from_utf8(&result[4..]).unwrap().contains("frame_invalid"));
        result.clear();
        run(&mut [1_u8, 0].as_slice(), &mut result).unwrap();
        assert!(std::str::from_utf8(&result[4..]).unwrap().contains("frame_invalid"));
    }
}
