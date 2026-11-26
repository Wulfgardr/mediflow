use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use zeroize::Zeroizing;

pub const LABEL: &str = "mediflow.local-voice.v1";
const BLOCK: usize = 64;
const SKEW: Duration = Duration::from_secs(30);
const NONCE_MEMORY: Duration = Duration::from_secs(90);

pub struct Secret(Zeroizing<[u8; 32]>);

impl Secret {
    pub fn from_hex(text: &str) -> Option<Self> {
        let bytes = decode_hex(text)?;
        let key: [u8; 32] = bytes.as_slice().try_into().ok()?;
        Some(Self(Zeroizing::new(key)))
    }
    pub fn mac(&self, message: &str) -> String {
        let mut inner_key = Zeroizing::new([0x36u8; BLOCK]);
        let mut outer_key = Zeroizing::new([0x5cu8; BLOCK]);
        for (index, byte) in self.0.iter().enumerate() {
            inner_key[index] ^= byte;
            outer_key[index] ^= byte;
        }
        let inner = Sha256::new()
            .chain_update(inner_key.as_slice())
            .chain_update(message.as_bytes())
            .finalize();
        let outer = Sha256::new()
            .chain_update(outer_key.as_slice())
            .chain_update(inner)
            .finalize();
        encode_hex(&outer)
    }
}

pub fn request_message(method: &str, path: &str, timestamp: &str, nonce: &str) -> String {
    format!("{LABEL}:request:{method} {path}:{timestamp}:{nonce}")
}

pub fn continue_message(nonce: &str) -> String {
    format!("{LABEL}:continue:{nonce}")
}

pub fn response_message(nonce: &str, status: u16) -> String {
    format!("{LABEL}:response:{nonce}:{status}")
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    Malformed,
    Stale,
    Replayed,
    Forged,
}

pub struct Verifier {
    secret: Secret,
    seen: HashMap<String, Instant>,
}

impl Verifier {
    pub fn new(secret: Secret) -> Self {
        Self {
            secret,
            seen: HashMap::new(),
        }
    }
    pub fn secret(&self) -> &Secret {
        &self.secret
    }
    pub fn check(&mut self, method: &str, path: &str, header: &str) -> Result<String, Refusal> {
        self.check_at(method, path, header, SystemTime::now(), Instant::now())
    }
    pub fn check_at(
        &mut self,
        method: &str,
        path: &str,
        header: &str,
        wall: SystemTime,
        now: Instant,
    ) -> Result<String, Refusal> {
        let mut parts = header.split('.');
        let (Some(timestamp), Some(nonce), Some(mac), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err(Refusal::Malformed);
        };
        if !(timestamp.len() <= 16 && timestamp.bytes().all(|b| b.is_ascii_digit()))
            || decode_hex(nonce).is_none_or(|n| n.len() != 16)
            || decode_hex(mac).is_none_or(|m| m.len() != 32)
        {
            return Err(Refusal::Malformed);
        }
        let expected = self
            .secret
            .mac(&request_message(method, path, timestamp, nonce));
        if !same(expected.as_bytes(), mac.to_ascii_lowercase().as_bytes()) {
            return Err(Refusal::Forged);
        }
        let sent = Duration::from_millis(timestamp.parse::<u64>().map_err(|_| Refusal::Malformed)?);
        let wall = wall.duration_since(UNIX_EPOCH).unwrap_or_default();
        if wall.abs_diff(sent) > SKEW {
            return Err(Refusal::Stale);
        }
        self.seen
            .retain(|_, at| now.saturating_duration_since(*at) < NONCE_MEMORY);
        let nonce = nonce.to_ascii_lowercase();
        if self.seen.contains_key(&nonce) {
            return Err(Refusal::Replayed);
        }
        self.seen.insert(nonce.clone(), now);
        Ok(nonce)
    }
}

fn same(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

pub fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn decode_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

    fn header(secret: &Secret, method: &str, path: &str, millis: u64, nonce: &str) -> String {
        let timestamp = millis.to_string();
        let mac = secret.mac(&request_message(method, path, &timestamp, nonce));
        format!("{timestamp}.{nonce}.{mac}")
    }

    #[test]
    fn mac_matches_the_hmac_sha256_of_the_launcher() {
        let secret = Secret::from_hex(KEY).unwrap();
        assert_eq!(
            secret.mac("mediflow.local-voice.v1:probe"),
            "6c35fb09fd846a65fdf58e8eaf2f4b59dadfbad85f3d12b3191a5f414fd3e97b"
        );
    }

    #[test]
    fn requests_need_a_fresh_signed_unused_nonce() {
        let secret = Secret::from_hex(KEY).unwrap();
        let other = Secret::from_hex(&"ab".repeat(32)).unwrap();
        let mut verifier = Verifier::new(Secret::from_hex(KEY).unwrap());
        let wall = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let millis = 1_800_000_000_000;
        let now = Instant::now();
        let nonce = "11".repeat(16);
        let good = header(&secret, "GET", "/v1/status", millis, &nonce);
        assert_eq!(
            verifier.check_at("GET", "/v1/status", &good, wall, now),
            Ok(nonce.clone())
        );
        assert_eq!(
            verifier.check_at("GET", "/v1/status", &good, wall, now),
            Err(Refusal::Replayed)
        );
        let moved = header(&secret, "GET", "/v1/status", millis, &"22".repeat(16));
        assert_eq!(
            verifier.check_at("POST", "/v1/status", &moved, wall, now),
            Err(Refusal::Forged)
        );
        let forged = header(&other, "GET", "/v1/status", millis, &"33".repeat(16));
        assert_eq!(
            verifier.check_at("GET", "/v1/status", &forged, wall, now),
            Err(Refusal::Forged)
        );
        let old = header(
            &secret,
            "GET",
            "/v1/status",
            millis - 31_000,
            &"44".repeat(16),
        );
        assert_eq!(
            verifier.check_at("GET", "/v1/status", &old, wall, now),
            Err(Refusal::Stale)
        );
        for broken in ["", "1.2", "1.2.3.4", "x.11.22"] {
            assert_eq!(
                verifier.check_at("GET", "/v1/status", broken, wall, now),
                Err(Refusal::Malformed)
            );
        }
    }

    #[test]
    fn only_a_32_byte_hex_secret_is_accepted() {
        assert!(Secret::from_hex(KEY).is_some());
        assert!(Secret::from_hex(&KEY[2..]).is_none());
        assert!(Secret::from_hex(&"zz".repeat(32)).is_none());
    }
}
