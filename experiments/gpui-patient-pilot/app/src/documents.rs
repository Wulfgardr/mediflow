//! Explicit local document IO for the native picker flows. No path or URL from a
//! clinical record is opened. A download requires a path chosen by the operator.

pub(crate) mod pdf;

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
pub const TEXT_WINDOW_CHARS: usize = 65_536;

pub fn original_text(attachment: &Attachment) -> Result<Zeroizing<String>, String> {
    let bytes = decode_attachment(attachment).map_err(|error| error.to_string())?;
    if attachment.mime_type != "text/plain" {
        return Err(
            "Formato non supportato dall’anteprima locale. L’allegato non è stato modificato."
                .into(),
        );
    }
    if bytes.starts_with(b"%PDF-")
        || bytes.starts_with(b"\x89PNG")
        || bytes.starts_with(b"\xff\xd8\xff")
        || bytes.starts_with(b"GIF8")
        || bytes.starts_with(b"RIFF")
        || bytes.starts_with(b"BM")
    {
        return Err(
            "Il tipo dichiarato non corrisponde al contenuto del documento. Anteprima interrotta."
                .into(),
        );
    }
    let text = std::str::from_utf8(&bytes).map_err(
        |_| "Il testo non è un documento UTF-8 valido. L’allegato non è stato modificato.",
    )?;
    if text
        .chars()
        .any(|ch| matches!(ch, '\0'..='\u{8}' | '\u{b}' | '\u{e}'..='\u{1f}' | '\u{7f}'))
    {
        return Err(
            "Il testo non è un documento UTF-8 valido. L’allegato non è stato modificato.".into(),
        );
    }
    Ok(Zeroizing::new(text.to_owned()))
}

pub enum OriginalPreview {
    Text(Zeroizing<String>),
    Image(Arc<gpui::RenderImage>),
    Pdf(pdf::Preview),
}

pub const MAX_PREVIEW_PIXELS: u64 = 12_000_000;
pub const MAX_PREVIEW_DIMENSION: u32 = 8192;

#[cfg(test)]
pub fn original_preview(attachment: &Attachment) -> Result<OriginalPreview, String> {
    original_preview_with_context(attachment, &RequestContext::default())
}

pub fn original_preview_with_context(
    attachment: &Attachment,
    context: &RequestContext,
) -> Result<OriginalPreview, String> {
    use image::ImageDecoder;
    if attachment.mime_type == "application/pdf" {
        let bytes = decode_attachment(attachment).map_err(|error| error.to_string())?;
        return pdf::render(Arc::new(bytes), 1, context)
            .map(OriginalPreview::Pdf)
            .map_err(pdf::Error::message);
    }
    if attachment.mime_type == "text/plain" {
        return original_text(attachment).map(OriginalPreview::Text);
    }
    let expected = match attachment.mime_type.as_str() {
        "image/png" => image::ImageFormat::Png,
        "image/jpeg" => image::ImageFormat::Jpeg,
        _ => return Err("Anteprima disponibile per testo UTF-8 e immagini PNG e JPEG. L’allegato non è stato modificato.".into()),
    };
    let bytes = decode_attachment(attachment).map_err(|error| error.to_string())?;
    let invalid = || {
        "L’immagine non è leggibile o non corrisponde al formato dichiarato. Anteprima interrotta."
            .to_owned()
    };
    if image::guess_format(&bytes).map_err(|_| invalid())? != expected {
        return Err(invalid());
    }
    let reader =
        || image::ImageReader::with_format(std::io::Cursor::new(bytes.as_slice()), expected);
    let (width, height) = reader().into_dimensions().map_err(|_| invalid())?;
    admit_preview_dimensions(width, height)?;
    if expected == image::ImageFormat::Png {
        let decoder = image::codecs::png::PngDecoder::new(std::io::Cursor::new(bytes.as_slice()))
            .map_err(|_| invalid())?;
        if decoder.is_apng().map_err(|_| invalid())? {
            return Err("Le immagini animate non sono disponibili nell’anteprima. L’allegato non è stato modificato.".into());
        }
    }
    let mut configured = reader();
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_PREVIEW_DIMENSION);
    limits.max_image_height = Some(MAX_PREVIEW_DIMENSION);
    limits.max_alloc = Some(MAX_PREVIEW_PIXELS * 8);
    configured.limits(limits.clone());
    let mut decoder = configured.into_decoder().map_err(|_| invalid())?;
    limits
        .reserve(decoder.total_bytes())
        .map_err(|_| invalid())?;
    decoder.set_limits(limits).map_err(|_| invalid())?;
    let orientation = decoder.orientation().map_err(|_| invalid())?;
    let mut decoded = image::DynamicImage::from_decoder(decoder).map_err(|_| invalid())?;
    decoded.apply_orientation(orientation);
    let mut pixels = decoded.into_rgba8();
    for pixel in pixels.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
    }
    Ok(OriginalPreview::Image(Arc::new(gpui::RenderImage::new([
        image::Frame::new(pixels),
    ]))))
}

fn admit_preview_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > MAX_PREVIEW_DIMENSION
        || height > MAX_PREVIEW_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_PREVIEW_PIXELS
    {
        return Err("L’immagine supera i limiti dell’anteprima: 8192 pixel per lato e 12 milioni di pixel complessivi. Anteprima interrotta.".into());
    }
    Ok(())
}

pub fn text_window(text: &str, page: usize) -> Option<(&str, usize)> {
    let count = text.chars().count().div_ceil(TEXT_WINDOW_CHARS).max(1);
    if page >= count {
        return None;
    }
    let start = text
        .char_indices()
        .nth(page * TEXT_WINDOW_CHARS)
        .map_or(text.len(), |(at, _)| at);
    let end = text[start..]
        .char_indices()
        .nth(TEXT_WINDOW_CHARS)
        .map_or(text.len(), |(at, _)| start + at);
    Some((&text[start..end], count))
}

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
    Empty,
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
            Self::Empty => "Il file scelto è vuoto. Scegli un documento con contenuto.",
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
    if bytes.is_empty() {
        return Err(DocumentError::Empty);
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

pub enum ImportAdmission {
    New(Upload),
    Duplicate { existing_id: String },
}

pub fn admit_import(
    upload: Upload,
    rows: &[Attachment],
    mut read: impl FnMut(&str) -> Result<Attachment, mediflow_runtime_client::RuntimeError>,
) -> Result<ImportAdmission, mediflow_runtime_client::RuntimeError> {
    for row in rows {
        if row.size != upload.bytes.len() as u64 || row.mime_type != upload.mime_type {
            continue;
        }
        let detail = read(&row.id)?;
        if detail.id != row.id || detail.patient_id != row.patient_id {
            return Err(mediflow_runtime_client::RuntimeError::InvalidResponse);
        }
        let bytes = decode_attachment(&detail)
            .map_err(|_| mediflow_runtime_client::RuntimeError::InvalidResponse)?;
        if bytes.as_slice() == upload.bytes.as_slice() {
            return Ok(ImportAdmission::Duplicate {
                existing_id: row.id.clone(),
            });
        }
    }
    Ok(ImportAdmission::New(upload))
}

#[cfg(test)]
mod import_tests {
    use super::*;
    use mediflow_runtime_client::RuntimeError;

    fn upload() -> Upload {
        Upload {
            name: "referto.txt".into(),
            mime_type: "text/plain".into(),
            bytes: Arc::new(Zeroizing::new(b"prova".to_vec())),
        }
    }
    fn row() -> Attachment {
        serde_json::from_value(serde_json::json!({"id":"file-a", "patientId":"patient-a", "name":"altro-nome.txt", "path":"altro-nome.txt", "type":"text/plain", "size":5, "data":"data:text/plain;base64,cHJvdmE="})).unwrap()
    }
    #[test]
    fn same_content_under_another_name_is_a_duplicate_not_a_new_import() {
        let row = row();
        let mut reads = vec![];
        let admitted = admit_import(upload(), std::slice::from_ref(&row), |id| {
            reads.push(id.to_owned());
            Ok(row.clone())
        })
        .unwrap();
        assert_eq!(reads, ["file-a"]);
        assert!(
            matches!(admitted, ImportAdmission::Duplicate { existing_id } if existing_id == "file-a")
        );
    }
    #[test]
    fn missing_unreadable_and_foreign_candidates_cannot_admit_a_new_import() {
        for error in [
            RuntimeError::Missing,
            RuntimeError::Forbidden,
            RuntimeError::Transport,
        ] {
            assert!(
                matches!(admit_import(upload(), &[row()], |_| Err(error)), Err(e) if e == error)
            );
        }
        for mode in 0..4 {
            let mut detail = row();
            match mode {
                0 => detail.data = None,
                1 => detail.locked_fields = vec!["data".into()],
                2 => detail.patient_id = "other-patient".into(),
                _ => detail.id = "other-file".into(),
            }
            assert!(matches!(
                admit_import(upload(), &[row()], |_| Ok(detail.clone())),
                Err(RuntimeError::InvalidResponse)
            ));
        }
    }
    #[test]
    fn equal_size_different_content_is_admitted_and_irrelevant_rows_are_not_read() {
        let mut detail = row();
        detail.data = Some("data:text/plain;base64,YWx0cm8=".into());
        assert!(matches!(
            admit_import(upload(), &[row()], |_| Ok(detail.clone())).unwrap(),
            ImportAdmission::New(_)
        ));
        detail.size = 6;
        assert!(matches!(
            admit_import(upload(), &[detail], |_| panic!("unrelated size")).unwrap(),
            ImportAdmission::New(_)
        ));
    }
    #[test]
    fn absent_empty_and_directory_selections_do_not_become_documents() {
        let root =
            std::env::temp_dir().join(format!("mediflow-import-negative-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let empty = root.join("empty.txt");
        std::fs::write(&empty, []).unwrap();
        assert!(matches!(
            read_selected_file(&root.join("missing.txt")),
            Err(DocumentError::NotReadable)
        ));
        assert!(matches!(
            read_selected_file(&root),
            Err(DocumentError::NotFile)
        ));
        assert!(matches!(
            read_selected_file(&empty),
            Err(DocumentError::Empty)
        ));
        std::fs::remove_file(empty).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}

#[cfg(test)]
mod original_tests {
    use super::*;
    #[test]
    fn preview_limits_reject_each_dimension_and_total_pixels_before_decode() {
        assert_eq!(admit_preview_dimensions(4000, 3000), Ok(()));
        for (width, height) in [
            (0, 10),
            (10, 0),
            (8193, 1),
            (1, 8193),
            (4000, 3001),
            (u32::MAX, u32::MAX),
        ] {
            assert!(admit_preview_dimensions(width, height).is_err());
        }
    }

    #[test]
    fn oversized_png_is_rejected_from_its_header_before_missing_pixel_data() {
        let bytes = STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAD6AAAAu5CAYAAAA+6ZRCAAAAAElEQVQ1rwYeAAAAAElFTkSuQmCC")
            .unwrap();
        let error = original_preview(&attachment("image/png", &bytes))
            .err()
            .unwrap();
        assert!(error.contains("12 milioni"));
    }

    #[test]
    fn animated_png_is_rejected_instead_of_showing_a_partial_document() {
        let bytes = STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACGFjVEwAAAACAAAAAPONk3AAAAANSURBVHicY/jPwPAfAAUAAf+JmT0dAAAAAElFTkSuQmCC").unwrap();
        let error = original_preview(&attachment("image/png", &bytes))
            .err()
            .unwrap();
        assert!(error.contains("animate"));
    }

    fn rotated_jpeg() -> Vec<u8> {
        let pixels = image::RgbImage::from_fn(8, 16, |x, y| {
            image::Rgb([(x * 30) as u8, (y * 15) as u8, 40])
        });
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 100)
            .encode_image(&pixels)
            .unwrap();
        let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let mut result = jpeg[..2].to_vec();
        result.extend_from_slice(&[0xff, 0xe1]);
        result.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        result.extend_from_slice(exif);
        result.extend_from_slice(&jpeg[2..]);
        result
    }

    #[test]
    fn jpeg_exif_orientation_is_applied_to_the_complete_decoded_raster() {
        let bytes = rotated_jpeg();
        let mut expected = image::load_from_memory(&bytes)
            .unwrap()
            .rotate90()
            .into_rgba8();
        for pixel in expected.as_chunks_mut::<4>().0 {
            pixel.swap(0, 2);
        }
        let OriginalPreview::Image(preview) =
            original_preview(&attachment("image/jpeg", &bytes)).unwrap()
        else {
            panic!("image expected")
        };
        assert_eq!(preview.size(0).width, gpui::DevicePixels(16));
        assert_eq!(preview.size(0).height, gpui::DevicePixels(8));
        assert_eq!(preview.as_bytes(0).unwrap(), expected.as_raw());
    }

    #[test]
    fn rotated_jpeg_limits_use_real_frame_dimensions_before_pixel_decode() {
        for (width, height) in [(8193u16, 1u16), (4000, 3001)] {
            let mut bytes = rotated_jpeg();
            let frame = bytes
                .windows(2)
                .position(|pair| pair == [0xff, 0xc0])
                .unwrap();
            bytes[frame + 5..frame + 7].copy_from_slice(&height.to_be_bytes());
            bytes[frame + 7..frame + 9].copy_from_slice(&width.to_be_bytes());
            let error = original_preview(&attachment("image/jpeg", &bytes))
                .err()
                .unwrap();
            assert!(error.contains("12 milioni"), "{error}");
        }
    }

    #[test]
    fn inline_image_is_decoded_only_for_matching_complete_supported_content() {
        let pixels = image::RgbaImage::from_pixel(2, 3, image::Rgba([10, 20, 30, 255]));
        let mut encoded = std::io::Cursor::new(Vec::new());
        pixels
            .write_to(&mut encoded, image::ImageFormat::Png)
            .unwrap();
        let bytes = encoded.into_inner();
        let result = original_preview(&attachment("image/png", &bytes)).unwrap();
        let OriginalPreview::Image(preview) = result else {
            panic!("image expected")
        };
        assert_eq!(preview.as_bytes(0).unwrap(), [30, 20, 10, 255].repeat(6));
        for (mime, content) in [
            ("image/jpeg", bytes.as_slice()),
            ("image/png", &bytes[..24]),
            ("image/png", b"not an image".as_slice()),
            ("application/pdf", b"%PDF-1.7".as_slice()),
        ] {
            assert!(original_preview(&attachment(mime, content)).is_err());
        }
        let mut jpeg = std::io::Cursor::new(Vec::new());
        image::RgbImage::from_pixel(2, 3, image::Rgb([10, 20, 30]))
            .write_to(&mut jpeg, image::ImageFormat::Jpeg)
            .unwrap();
        assert!(matches!(
            original_preview(&attachment("image/jpeg", &jpeg.into_inner())),
            Ok(OriginalPreview::Image(_))
        ));
        let mut locked = attachment("image/png", &bytes);
        locked.locked_fields.push("data".into());
        assert!(original_preview(&locked).is_err());
        locked.locked_fields.clear();
        locked.data = None;
        assert!(original_preview(&locked).is_err());
    }

    fn attachment(mime: &str, bytes: &[u8]) -> Attachment {
        serde_json::from_value(serde_json::json!({"id":"file-a","patientId":"patient-a","name":"sintetico.txt","path":"sintetico.txt","type":mime,"size":bytes.len(),"data":format!("data:{mime};base64,{}", STANDARD.encode(bytes))})).unwrap()
    }
    #[test]
    fn original_is_literal_utf8_and_rejects_binary_locked_and_unsupported_sources() {
        let row = attachment(
            "text/plain",
            "# Titolo <script> 🩺\nTesto originale".as_bytes(),
        );
        assert_eq!(
            original_text(&row).unwrap().as_str(),
            "# Titolo <script> 🩺\nTesto originale"
        );
        for bytes in [b"%PDF-1.7".as_slice(), b"\xff", b"testo\0nullo"] {
            assert!(original_text(&attachment("text/plain", bytes)).is_err());
        }
        assert!(
            original_text(&attachment("application/pdf", b"%PDF-1.7"))
                .unwrap_err()
                .contains("Formato non supportato")
        );
        let mut locked = row.clone();
        locked.locked_fields.push("data".into());
        assert!(original_text(&locked).is_err());
        locked = row.clone();
        locked.data = None;
        assert!(original_text(&locked).is_err());
        locked = row;
        locked.size += 1;
        assert!(original_text(&locked).is_err());
    }
    #[test]
    fn original_pages_keep_every_character_at_unicode_boundaries() {
        let text = format!("{}🩺è\nUltima pagina", "a".repeat(TEXT_WINDOW_CHARS - 1));
        let (first, count) = text_window(&text, 0).unwrap();
        let (second, _) = text_window(&text, 1).unwrap();
        assert_eq!(count, 2);
        assert!(first.ends_with('🩺'));
        assert_eq!(format!("{first}{second}"), text);
        assert!(text_window(&text, 2).is_none());
        assert_eq!(text_window("", 0), Some(("", 1)));
    }
}
