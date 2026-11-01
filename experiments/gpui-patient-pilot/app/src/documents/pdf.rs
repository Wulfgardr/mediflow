use mediflow_runtime_client::RequestContext;
#[cfg(test)]
use serde_json::json;
use std::{
    io::{Read, Write},
    process::{Child, Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const MAX_PAGES: usize = 500;
const MAX_CANVAS_DIMENSION: u32 = 2048;
const MAX_CANVAS_PIXELS: u32 = 4_000_000;
const MAX_OUTPUT: usize = MAX_CANVAS_PIXELS as usize * 4 + 512;
const TIMEOUT: Duration = Duration::from_secs(15);
#[cfg(target_os = "macos")]
const MAX_WORKER_MEMORY: u64 = 256 * 1024 * 1024;
pub const VIEW_LIFETIME: Duration = Duration::from_secs(600);
pub struct Preview {
    pub source: Arc<Zeroizing<Vec<u8>>>,
    pub image: Arc<gpui::RenderImage>,
    pub pages: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    Invalid,
    Limit,
    Unsupported,
    Unavailable,
    Cancelled,
    Timeout,
    Engine,
}
impl Error {
    pub fn message(self) -> String {
        match self {
            Self::Limit => "Il PDF supera i limiti dell’anteprima. Nessuna pagina incompleta viene mostrata.",
            Self::Unavailable => "L’anteprima PDF è disponibile su macOS. Salva una copia e aprila con il tuo lettore PDF.",
            Self::Unsupported => "Il PDF contiene elementi non supportati da questa anteprima. Salva una copia e aprila con il tuo lettore PDF.",
            Self::Cancelled => "Anteprima chiusa. Il documento non è stato modificato.",
            Self::Timeout => "L’anteprima PDF non è pronta entro il tempo disponibile. Nessuna pagina incompleta viene mostrata.",
            Self::Engine => "Il lettore PDF locale non è disponibile. Nessuna pagina incompleta viene mostrata.",
            Self::Invalid => "Il PDF non è leggibile o è danneggiato. Nessuna pagina incompleta viene mostrata.",
        }.into()
    }
    #[cfg(not(target_os = "macos"))]
    fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid",
            Self::Limit => "limit",
            Self::Unsupported => "unsupported",
            Self::Unavailable => "unavailable",
            Self::Cancelled => "cancelled",
            Self::Timeout => "timeout",
            Self::Engine => "engine",
        }
    }
    fn from_code(code: &str) -> Self {
        match code {
            "invalid" => Self::Invalid,
            "limit" => Self::Limit,
            "unsupported" => Self::Unsupported,
            "unavailable" => Self::Unavailable,
            "cancelled" => Self::Cancelled,
            "timeout" => Self::Timeout,
            _ => Self::Engine,
        }
    }
}

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub fn render(
    source: Arc<Zeroizing<Vec<u8>>>,
    page: usize,
    context: &RequestContext,
) -> Result<Preview, Error> {
    if source.len() > super::MAX_DOCUMENT_BYTES
        || !source.starts_with(b"%PDF-")
        || page == 0
        || page > MAX_PAGES
    {
        return Err(Error::Invalid);
    }
    if !cfg!(target_os = "macos") {
        return Err(Error::Unavailable);
    }
    context.check().map_err(|_| Error::Cancelled)?;
    let executable = std::env::current_exe().map_err(|_| Error::Engine)?;
    let child = OwnedChild(
        Command::new(executable)
            .arg("--document-preview-worker")
            .arg(page.to_string())
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| Error::Engine)?,
    );
    collect_child(child, source, page, context, TIMEOUT)
}

fn collect_child(
    mut child: OwnedChild,
    source: Arc<Zeroizing<Vec<u8>>>,
    page: usize,
    context: &RequestContext,
    timeout: Duration,
) -> Result<Preview, Error> {
    let mut input = child.0.stdin.take().ok_or(Error::Engine)?;
    let output = child.0.stdout.take().ok_or(Error::Engine)?;
    let bytes = source.clone();
    let writer = std::thread::spawn(move || input.write_all(bytes.as_slice()));
    let reader = std::thread::spawn(move || {
        let mut bytes = Zeroizing::new(Vec::new());
        output
            .take(MAX_OUTPUT as u64 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        if context.check().is_err() {
            return Err(Error::Cancelled);
        }
        #[cfg(target_os = "macos")]
        if worker_memory(child.0.id())? > MAX_WORKER_MEMORY {
            return Err(Error::Limit);
        }
        if Instant::now() >= deadline {
            return Err(Error::Timeout);
        }
        if let Some(status) = child.0.try_wait().map_err(|_| Error::Engine)? {
            break status;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    if status.code() == Some(3) {
        return Err(Error::Timeout);
    }
    if !status.success() || writer.join().map_err(|_| Error::Engine)?.is_err() {
        return Err(Error::Engine);
    }
    let output = reader
        .join()
        .map_err(|_| Error::Engine)?
        .map_err(|_| Error::Engine)?;
    context.check().map_err(|_| Error::Cancelled)?;
    parse_output(source, page, &output)
}

fn parse_output(
    source: Arc<Zeroizing<Vec<u8>>>,
    page: usize,
    output: &[u8],
) -> Result<Preview, Error> {
    if output.len() > MAX_OUTPUT {
        return Err(Error::Limit);
    }
    let at = output
        .iter()
        .take(512)
        .position(|byte| *byte == b'\n')
        .ok_or(Error::Engine)?;
    let header: serde_json::Value =
        serde_json::from_slice(&output[..at]).map_err(|_| Error::Engine)?;
    if let Some(error) = header["error"].as_str() {
        return Err(Error::from_code(error));
    }
    let number = |key| {
        header[key]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or(Error::Engine)
    };
    let width = number("width")?;
    let height = number("height")?;
    let pages = number("pages")?;
    if number("page")? != page
        || pages == 0
        || pages > MAX_PAGES
        || page > pages
        || width == 0
        || height == 0
        || width > MAX_CANVAS_DIMENSION as usize
        || height > MAX_CANVAS_DIMENSION as usize
        || width * height > MAX_CANVAS_PIXELS as usize
        || output.len() - at - 1 != width * height * 4
    {
        return Err(Error::Engine);
    }
    let pixels = image::RgbaImage::from_raw(width as u32, height as u32, output[at + 1..].to_vec())
        .ok_or(Error::Engine)?;
    Ok(Preview {
        source,
        image: Arc::new(gpui::RenderImage::new([image::Frame::new(pixels)])),
        pages,
    })
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn MFDocumentPreviewWorker(page: usize) -> i32;
    fn MFDocumentPreviewMemory(pid: i32) -> u64;
}

#[cfg(target_os = "macos")]
fn worker_memory(pid: u32) -> Result<u64, Error> {
    // The native bridge uses proc_pid_rusage for this owned child only. A failed
    // sample is handled after try_wait: an already exited child has no footprint.
    Ok(unsafe { MFDocumentPreviewMemory(pid as i32) })
}

pub fn worker(page: usize) -> Result<(), std::io::Error> {
    #[cfg(target_os = "macos")]
    {
        // This entry runs before GPUI/session initialization, exclusively in the
        // owned child. The bridge installs Seatbelt before reading/parsing bytes.
        if unsafe { MFDocumentPreviewWorker(page) } != 0 {
            return Err(std::io::ErrorKind::Other.into());
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = page;
        writeln!(
            std::io::stdout(),
            "{{\"error\":\"{}\"}}",
            Error::Unavailable.code()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raster_metadata_and_truncated_payload_cannot_reach_the_view() {
        let source = Arc::new(Zeroizing::new(b"%PDF-synthetic".to_vec()));
        for header in [
            json!({"page":2,"pages":2,"width":1,"height":1}),
            json!({"page":1,"pages":1,"width":2049,"height":1}),
            json!({"page":1,"pages":501,"width":1,"height":1}),
            json!({"page":1,"pages":1,"width":1,"height":1}),
        ] {
            let mut data = format!("{header}\n").into_bytes();
            data.extend_from_slice(&[1, 2, 3]);
            assert!(parse_output(source.clone(), 1, &data).is_err());
        }
    }
    #[cfg(unix)]
    fn idle_child() -> (OwnedChild, u32) {
        let node = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .map(|path| path.join("node"))
            .find(|path| path.is_file())
            .expect("Node is required by native test selection");
        let child = Command::new(node)
            .args([
                "--eval",
                "process.stdin.resume(); setTimeout(() => {}, 30000)",
            ])
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let id = child.id();
        (OwnedChild(child), id)
    }

    #[cfg(unix)]
    fn assert_reaped(id: u32) {
        assert!(
            !Command::new("/bin/kill")
                .arg("-0")
                .arg(id.to_string())
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success()
        );
    }

    #[cfg(unix)]
    #[test]
    fn timeout_and_context_retirement_kill_and_reap_the_owned_worker() {
        let source = Arc::new(Zeroizing::new(b"%PDF-synthetic-owner-test".to_vec()));
        let (child, id) = idle_child();
        let result = collect_child(
            child,
            source.clone(),
            1,
            &RequestContext::default(),
            Duration::from_millis(100),
        );
        assert_eq!(result.err(), Some(Error::Timeout));
        assert_reaped(id);
        let (child, id) = idle_child();
        let context = RequestContext::default();
        let cancel = context.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            cancel.cancel();
        });
        let result = collect_child(child, source, 1, &context, Duration::from_secs(2));
        canceller.join().unwrap();
        assert_eq!(result.err(), Some(Error::Cancelled));
        assert_reaped(id);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn memory_monitor_kills_and_reaps_a_worker_above_the_budget() {
        let node = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .map(|path| path.join("node"))
            .find(|path| path.is_file())
            .unwrap();
        let child = Command::new(node).args(["--eval", "const bytes=Buffer.alloc(320*1024*1024,1); process.stdin.resume(); setInterval(()=>bytes[0],1000)"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
        let id = child.id();
        let result = collect_child(
            OwnedChild(child),
            Arc::new(Zeroizing::new(b"%PDF-synthetic-memory-probe".to_vec())),
            1,
            &RequestContext::default(),
            Duration::from_secs(10),
        );
        assert_eq!(result.err(), Some(Error::Limit));
        assert_reaped(id);
    }
}
