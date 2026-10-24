//! Explicit local document IO for the native picker flows. No path or URL from a
//! clinical record is opened. A download requires a path chosen by the operator.

use base64::{Engine, engine::general_purpose::STANDARD};
use mediflow_runtime_client::{Attachment, RequestContext};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use zeroize::Zeroizing;

pub const MAX_DOCUMENT_BYTES: usize = 10 * 1024 * 1024;

#[derive(Clone)]
pub struct Upload {
    pub name: String,
    pub mime_type: String,
    pub bytes: Arc<Zeroizing<Vec<u8>>>,
}
impl Upload {
    pub fn matches(&self, attachment: &Attachment) -> bool {
        original_readable(attachment)
            && attachment.name == self.name
            && attachment.mime_type == self.mime_type
            && attachment.size == self.bytes.len() as u64
            && decode_attachment(attachment)
                .is_ok_and(|bytes| bytes.as_slice() == self.bytes.as_slice())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentError {
    NotReadable,
    NotFile,
    Name,
    TooLarge,
    Locked,
    MissingData,
    InvalidData,
    Exists,
    NotWritten,
}
impl std::fmt::Display for DocumentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::NotReadable => "Il file scelto non può essere letto. Controlla che sia disponibile e accessibile.",
            Self::NotFile => "Scegli un documento, non una cartella o un dispositivo.",
            Self::Name => "Il nome del documento non è utilizzabile. Rinomina il file prima di sceglierlo.",
            Self::TooLarge => "Il documento supera il limite di 10 MiB per questa finestra.",
            Self::Locked => "Il contenuto cifrato del documento non è leggibile con questo accesso.",
            Self::MissingData => "La lettura non include il contenuto del documento. Non è stata creata una copia.",
            Self::InvalidData => "Il contenuto, il tipo o la dimensione del documento non corrispondono. Non è stata creata una copia.",
            Self::Exists => "Un file con questo nome esiste già. Scegli un altro nome per conservare entrambe le copie.",
            Self::NotWritten => "La copia del documento non è stata completata. Controlla la destinazione prima di riprovare.",
        })
    }
}

fn usable_name(name: &str) -> bool {
    !name.trim().is_empty()
        && name != "."
        && name != ".."
        && name.len() <= 1024
        && !name
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '/' | '\\' | ':'))
}

pub fn suggested_name(name: &str) -> String {
    if usable_name(name) {
        name.to_owned()
    } else {
        "documento".to_owned()
    }
}

pub fn initial_save_directory() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn read_selected_file(path: &Path) -> Result<Upload, DocumentError> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| usable_name(name))
        .ok_or(DocumentError::Name)?
        .to_owned();
    let metadata = std::fs::metadata(path).map_err(|_| DocumentError::NotReadable)?;
    if !metadata.is_file() {
        return Err(DocumentError::NotFile);
    }
    if metadata.len() > MAX_DOCUMENT_BYTES as u64 {
        return Err(DocumentError::TooLarge);
    }
    let file = File::open(path).map_err(|_| DocumentError::NotReadable)?;
    if !file
        .metadata()
        .map_err(|_| DocumentError::NotReadable)?
        .is_file()
    {
        return Err(DocumentError::NotFile);
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(metadata.len() as usize));
    file.take(MAX_DOCUMENT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| DocumentError::NotReadable)?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(DocumentError::TooLarge);
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime_type = match extension.as_str() {
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "tif" | "tiff" => "image/tiff",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "rtf" => "application/rtf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _ => "application/octet-stream",
    }
    .to_owned();
    Ok(Upload {
        name,
        mime_type,
        bytes: Arc::new(bytes),
    })
}

pub fn original_readable(attachment: &Attachment) -> bool {
    !attachment
        .locked_fields
        .iter()
        .any(|field| matches!(field.as_str(), "name" | "path" | "data"))
}

pub fn decode_attachment(attachment: &Attachment) -> Result<Zeroizing<Vec<u8>>, DocumentError> {
    if !original_readable(attachment) {
        return Err(DocumentError::Locked);
    }
    decode_payload(
        &attachment.mime_type,
        attachment.size,
        attachment
            .data
            .as_deref()
            .ok_or(DocumentError::MissingData)?,
    )
}

fn decode_payload(
    mime_type: &str,
    size: u64,
    data: &str,
) -> Result<Zeroizing<Vec<u8>>, DocumentError> {
    if size > MAX_DOCUMENT_BYTES as u64 {
        return Err(DocumentError::TooLarge);
    }
    if mime_type.is_empty()
        || mime_type.len() > 128
        || !mime_type
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'+' | b'.'))
    {
        return Err(DocumentError::InvalidData);
    }
    let header = format!("data:{mime_type};base64,");
    let encoded = data
        .strip_prefix(&header)
        .ok_or(DocumentError::InvalidData)?;
    if encoded.len() > MAX_DOCUMENT_BYTES.div_ceil(3) * 4 {
        return Err(DocumentError::TooLarge);
    }
    // STANDARD rejects nonalphabet bytes, whitespace, malformed padding and
    // noncanonical trailing bits. No external URL or alternate encoding is used.
    let bytes = Zeroizing::new(
        STANDARD
            .decode(encoded)
            .map_err(|_| DocumentError::InvalidData)?,
    );
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(DocumentError::TooLarge);
    }
    if bytes.len() as u64 != size {
        return Err(DocumentError::InvalidData);
    }
    Ok(bytes)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CopyState {
    Reading,
    Writing,
    Withdrawn,
    Finished(Result<(), DocumentError>),
}
impl CopyState {
    pub fn is_writing(self) -> bool {
        self == Self::Writing
    }

    pub fn notice(self) -> (&'static str, bool) {
        match self {
            Self::Reading => (
                "Lettura della copia. Prima dell’avvio del salvataggio puoi annullarla cambiando scheda o bloccando la sessione.",
                false,
            ),
            Self::Writing => (
                "Copia avviata nella destinazione scelta. Il salvataggio può completarsi anche se cambi scheda o blocchi la sessione.",
                false,
            ),
            Self::Withdrawn => (
                "Copia annullata prima dell’avvio del salvataggio. Nessun file è stato creato.",
                false,
            ),
            Self::Finished(Ok(())) => (
                "Copia già avviata completata nella destinazione scelta. Il documento non è stato aperto.",
                false,
            ),
            Self::Finished(Err(DocumentError::Exists)) => (
                "Copia non salvata: la destinazione esiste già e non è stata modificata. Nessun secondo salvataggio automatico.",
                true,
            ),
            Self::Finished(Err(_)) => (
                "Copia non completata. Può esserci un file parziale: controlla la destinazione. Nessun secondo salvataggio automatico.",
                true,
            ),
        }
    }
}

pub struct Download {
    path: PathBuf,
    bytes: Zeroizing<Vec<u8>>,
}

impl Download {
    pub fn write(self) -> Result<(), DocumentError> {
        write_download_inner(&self.path, &self.bytes)
    }
}

pub fn admit_download(
    context: &RequestContext,
    path: PathBuf,
    bytes: Zeroizing<Vec<u8>>,
) -> mediflow_runtime_client::Result<Download> {
    admit_download_after_check(context, path, bytes, || {})
}

fn admit_download_after_check(
    context: &RequestContext,
    path: PathBuf,
    bytes: Zeroizing<Vec<u8>>,
    before_admission: impl FnOnce(),
) -> mediflow_runtime_client::Result<Download> {
    context.check()?;
    before_admission();
    context.admit_file_effect()?;
    Ok(Download { path, bytes })
}

fn write_download_inner(path: &Path, bytes: &[u8]) -> Result<(), DocumentError> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(DocumentError::TooLarge);
    }
    write_download_to(path, bytes, |file, bytes| {
        file.write_all(bytes).and_then(|_| file.sync_all())
    })
}

fn write_download_to(
    path: &Path,
    bytes: &[u8],
    write_and_sync: impl FnOnce(&mut File, &[u8]) -> std::io::Result<()>,
) -> Result<(), DocumentError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            DocumentError::Exists
        } else {
            DocumentError::NotWritten
        }
    })?;
    write_and_sync(&mut file, bytes).map_err(|_| DocumentError::NotWritten)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_destination(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("g1a2-{label}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn g1a2_admitted_copy_finishes_exact_payload_after_withdrawal_without_retry() {
        let context = RequestContext::default();
        let path = synthetic_destination("admitted");
        let download = admit_download(
            &context,
            path.clone(),
            Zeroizing::new(b"synthetic exact payload".to_vec()),
        )
        .unwrap();
        context.cancel();
        assert!(context.check().is_err());
        download.write().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"synthetic exact payload");
        assert!(
            admit_download(
                &context,
                path.clone(),
                Zeroizing::new(b"second automatic copy".to_vec())
            )
            .is_err()
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn g1a2_io_failure_leaves_observable_partial_file_and_preserves_existing_destination() {
        let path = synthetic_destination("partial");
        let context = RequestContext::default();
        let download = admit_download(
            &context,
            path.clone(),
            Zeroizing::new(b"synthetic exact payload".to_vec()),
        )
        .unwrap();
        let result = write_download_to(&download.path, &download.bytes, |file, bytes| {
            file.write_all(&bytes[..3])?;
            context.cancel();
            Err(std::io::Error::other("synthetic storage failure"))
        });
        assert_eq!(result, Err(DocumentError::NotWritten));
        assert_eq!(std::fs::read(&path).unwrap(), b"syn");
        let replacement = admit_download(
            &RequestContext::default(),
            path.clone(),
            Zeroizing::new(b"replacement".to_vec()),
        )
        .unwrap();
        assert_eq!(replacement.write(), Err(DocumentError::Exists));
        assert_eq!(std::fs::read(&path).unwrap(), b"syn");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn g1a2_withdrawal_between_check_and_admission_creates_no_file() {
        let context = RequestContext::default();
        let path = synthetic_destination("withdrawn");
        assert!(!path.exists());
        let result = admit_download_after_check(
            &context,
            path.clone(),
            Zeroizing::new(b"synthetic exact payload".to_vec()),
            || context.cancel(),
        )
        .map(Download::write);
        let exists = path.exists();
        if exists {
            std::fs::remove_file(&path).unwrap();
        }
        assert!(
            matches!(
                result,
                Err(mediflow_runtime_client::RuntimeError::ReadRequired)
            ),
            "withdrawal after preliminary check admitted an effect: {result:?}"
        );
        assert!(!exists, "withdrawn copy reached the chosen destination");
    }

    #[test]
    fn unreadable_optional_snapshots_do_not_hide_a_readable_original() {
        let mut attachment: Attachment = serde_json::from_value(serde_json::json!({
            "id":"synthetic-document", "patientId":"synthetic-patient",
            "name":"Documento sintetico.txt", "path":"Documento sintetico.txt",
            "type":"text/plain", "size":4, "data":"data:text/plain;base64,w6jDqQ=="
        }))
        .unwrap();
        attachment.locked_fields = vec![
            "summarySnapshot".into(),
            "parseEvidenceArtifactSnapshot".into(),
        ];
        let upload = Upload {
            name: attachment.name.clone(),
            mime_type: attachment.mime_type.clone(),
            bytes: Arc::new(Zeroizing::new("èé".as_bytes().to_vec())),
        };
        assert_eq!(
            decode_attachment(&attachment).unwrap().as_slice(),
            "èé".as_bytes()
        );
        assert!(upload.matches(&attachment));
        attachment.locked_fields.push("data".into());
        assert_eq!(
            decode_attachment(&attachment).unwrap_err(),
            DocumentError::Locked
        );
        assert!(!upload.matches(&attachment));
    }

    #[test]
    fn data_url_requires_exact_type_size_canonical_base64_and_raw_limit() {
        assert_eq!(
            decode_payload("text/plain", 4, "data:text/plain;base64,w6jDqQ==")
                .unwrap()
                .as_slice(),
            "èé".as_bytes()
        );
        for data in [
            "https://example.invalid/file",
            "file:///tmp/file",
            "data:text/html;base64,w6jDqQ==",
            "data:text/plain;charset=utf-8;base64,w6jDqQ==",
            "data:text/plain,èé",
            "data:text/plain;base64,w6jDqQ==\n",
            "data:text/plain;base64,w6jDqR==",
        ] {
            assert_eq!(
                decode_payload("text/plain", 4, data).unwrap_err(),
                DocumentError::InvalidData,
                "{data}"
            );
        }
        assert_eq!(
            decode_payload("text/plain", 3, "data:text/plain;base64,w6jDqQ==").unwrap_err(),
            DocumentError::InvalidData
        );
        assert_eq!(
            decode_payload(
                "text/plain",
                MAX_DOCUMENT_BYTES as u64 + 1,
                "data:text/plain;base64,"
            )
            .unwrap_err(),
            DocumentError::TooLarge
        );
        assert!(
            decode_payload("text/plain", 0, "data:text/plain;base64,")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn remote_metadata_cannot_supply_a_download_path() {
        for name in [
            "../segreto",
            "a/b.pdf",
            "a\\b.pdf",
            ".",
            "..",
            "C:private.pdf",
            "bad\nname",
        ] {
            assert_eq!(suggested_name(name), "documento");
        }
        assert_eq!(
            suggested_name("Referto – città 🩺.pdf"),
            "Referto – città 🩺.pdf"
        );
    }

    #[test]
    fn a_copy_never_overwrites_an_existing_file_and_round_trips_exact_bytes() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "mediflow-document-test-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("Documento.txt");
        let bytes = "Città 🩺\n".as_bytes();
        let context = RequestContext::default();
        admit_download(&context, path.clone(), Zeroizing::new(bytes.to_vec()))
            .unwrap()
            .write()
            .unwrap();
        assert_eq!(
            admit_download(
                &context,
                path.clone(),
                Zeroizing::new(b"replacement".to_vec())
            )
            .unwrap()
            .write(),
            Err(DocumentError::Exists)
        );
        let read = read_selected_file(&path).unwrap();
        assert_eq!(read.bytes.as_slice(), bytes);
        assert_eq!(read.mime_type, "text/plain");
        assert_eq!(
            read_selected_file(&directory).err(),
            Some(DocumentError::NotFile)
        );
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
