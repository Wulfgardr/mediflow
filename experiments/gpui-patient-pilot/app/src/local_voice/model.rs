//! File del modello vocale locale: dove stanno, come si verificano, come si
//! installano. Nessuno scaricamento parte da solo: l'installazione parte dal
//! pulsante «Installa» in Impostazioni, Voce locale, e ogni file si accetta
//! solo se il suo SHA-256 coincide con quello scritto qui.

use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
pub(crate) struct ModelFile {
    pub(crate) name: &'static str,
    pub(crate) url: &'static str,
    pub(crate) sha256: &'static str,
    pub(crate) size: u64,
}

/// whisper large-v3-turbo q5_0 (MIT) e Silero VAD v6.2.0 in formato ggml
/// (MIT). URL con revisione fissata; hash uguali all'oid LFS di Hugging Face e
/// a quelli registrati nel banco (`motori/INVENTARIO.md`).
pub(crate) const WHISPER: ModelFile = ModelFile {
    name: "ggml-large-v3-turbo-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin",
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    size: 574_041_195,
};
pub(crate) const VAD: ModelFile = ModelFile {
    name: "ggml-silero-v6.2.0.bin",
    url: "https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin",
    sha256: "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987",
    size: 885_098,
};
pub(crate) const FILES: [&ModelFile; 2] = [&WHISPER, &VAD];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ModelStatus {
    /// Nessun file del modello nella cartella.
    Missing,
    /// File presenti ma incompleti o con hash diverso.
    Invalid,
    Verified,
}

pub(crate) fn directory() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    home.is_absolute()
        .then(|| home.join("Library/Application Support/MediFlow GPUI/modelli-voce"))
}

pub(crate) fn sha256_file(path: &Path) -> io::Result<String> {
    hash_file(path, &AtomicBool::new(false))
}

/// Controllo rapido: presenza e dimensione. Serve a scegliere il motore senza
/// leggere 0,57 GB nel thread dell'interfaccia.
pub(crate) fn quick_status(directory: &Path, files: &[&ModelFile]) -> ModelStatus {
    let sizes: Vec<Option<u64>> = files
        .iter()
        .map(|f| fs::metadata(directory.join(f.name)).ok().map(|m| m.len()))
        .collect();
    if sizes.iter().all(Option::is_none) {
        ModelStatus::Missing
    } else if files.iter().zip(&sizes).all(|(f, s)| *s == Some(f.size)) {
        ModelStatus::Verified
    } else {
        ModelStatus::Invalid
    }
}

/// La dettatura usa whisper se nella cartella c'è almeno un file del modello;
/// a cartella vuota resta il motore di sistema.
pub(crate) fn whisper_selected(directory: &Path) -> bool {
    quick_status(directory, &FILES) != ModelStatus::Missing
}

/// Verifica completa: dimensione e SHA-256 di ogni file.
pub(crate) fn verify(directory: &Path, files: &[&ModelFile]) -> ModelStatus {
    match quick_status(directory, files) {
        ModelStatus::Verified => {}
        other => return other,
    }
    let all = files.iter().all(|f| {
        sha256_file(&directory.join(f.name)).is_ok_and(|hash| hash.eq_ignore_ascii_case(f.sha256))
    });
    if all {
        ModelStatus::Verified
    } else {
        ModelStatus::Invalid
    }
}

/// Peso complessivo dei file, in byte.
pub(crate) fn total_size(files: &[&ModelFile]) -> u64 {
    files.iter().map(|f| f.size).sum()
}

/// Host da cui si scaricano i file, letto dagli URL fissati.
pub(crate) fn source_host(files: &[&ModelFile]) -> Option<&'static str> {
    let hosts: Vec<&'static str> = files
        .iter()
        .filter_map(|f| f.url.split_once("://")?.1.split('/').next())
        .collect();
    let first = *hosts.first()?;
    hosts.iter().all(|h| *h == first).then_some(first)
}

/// `MEDIFLOW_NETWORK_DISABLED` presente con un valore diverso da `0` blocca le
/// uscite verso Internet, come per il catalogo AIFA (ADR 0125).
pub(crate) fn network_disabled() -> bool {
    switch_disables(std::env::var_os("MEDIFLOW_NETWORK_DISABLED").as_deref())
}
fn switch_disables(value: Option<&std::ffi::OsStr>) -> bool {
    value.is_some_and(|v| v != "0")
}

fn partial_path(directory: &Path, file: &ModelFile) -> PathBuf {
    directory.join(format!("{}.parziale", file.name))
}

/// Perché un'installazione non è riuscita.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InstallError {
    /// Uscite di rete disattivate da `MEDIFLOW_NETWORK_DISABLED`.
    NetworkDisabled,
    /// Server non raggiungibile.
    Unreachable,
    /// Connessione caduta, lenta oltre il limite o risposta incompleta.
    Interrupted,
    /// Il server ha risposto con un errore.
    Refused,
    /// Cartella o file non scrivibili, disco pieno.
    Write,
    /// Byte arrivati diversi da quelli attesi.
    HashMismatch,
    Cancelled,
}

/// Come raggiungere i file: in produzione solo HTTPS; nelle prove un server
/// HTTP sul loopback.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Transport {
    Https,
    #[cfg(test)]
    LoopbackHttp,
}

/// Che cosa installare e dove.
#[derive(Clone)]
pub(crate) struct Catalog {
    pub(crate) directory: PathBuf,
    pub(crate) files: Vec<&'static ModelFile>,
    pub(crate) transport: Transport,
    /// Interruttore delle uscite verso Internet, ricontrollato prima di ogni
    /// richiesta. In produzione [`network_disabled`].
    pub(crate) network_disabled: fn() -> bool,
}
impl Catalog {
    /// Il modello vero, nella cartella dell'app.
    pub(crate) fn installed() -> Option<Self> {
        Some(Self::pinned(directory()?))
    }
    pub(crate) fn pinned(directory: PathBuf) -> Self {
        Self {
            directory,
            files: FILES.to_vec(),
            transport: Transport::Https,
            network_disabled,
        }
    }
    pub(crate) fn quick_status(&self) -> ModelStatus {
        quick_status(&self.directory, &self.files)
    }
    pub(crate) fn verify(&self) -> ModelStatus {
        verify(&self.directory, &self.files)
    }
    pub(crate) fn total_size(&self) -> u64 {
        total_size(&self.files)
    }
    /// Toglie i file del modello e gli eventuali parziali. La dettatura torna al
    /// motore di sistema.
    pub(crate) fn remove(&self) -> io::Result<()> {
        for file in &self.files {
            for path in [
                self.directory.join(file.name),
                partial_path(&self.directory, file),
            ] {
                match fs::remove_file(&path) {
                    Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
                    _ => {}
                }
            }
        }
        let _ = fs::remove_dir(&self.directory);
        Ok(())
    }
}

/// Stato condiviso fra il thread dello scaricamento e l'interfaccia.
#[derive(Default)]
struct Shared {
    cancel: AtomicBool,
    received: AtomicU64,
    outcome: Mutex<Option<Result<(), InstallError>>>,
}

/// Un'installazione in corso su un thread suo. L'interfaccia legge avanzamento
/// ed esito e può annullare senza aspettare il thread.
pub(crate) struct Download {
    shared: Arc<Shared>,
    total: u64,
}
impl Download {
    pub(crate) fn start(catalog: Catalog) -> Self {
        let shared = Arc::new(Shared::default());
        let total = catalog.total_size();
        let worker = shared.clone();
        let spawned = std::thread::Builder::new()
            .name("mediflow-voce-installazione".into())
            .spawn(move || {
                let result = install(&catalog, &worker);
                *worker.outcome.lock().unwrap_or_else(|e| e.into_inner()) = Some(result);
            });
        if spawned.is_err() {
            *shared.outcome.lock().unwrap_or_else(|e| e.into_inner()) =
                Some(Err(InstallError::Write));
        }
        Self { shared, total }
    }
    /// Byte ricevuti e byte attesi.
    pub(crate) fn progress(&self) -> (u64, u64) {
        (
            self.shared.received.load(Ordering::Relaxed).min(self.total),
            self.total,
        )
    }
    /// Esito, quando il thread ha finito e ha già pulito.
    pub(crate) fn outcome(&self) -> Option<Result<(), InstallError>> {
        *self
            .shared
            .outcome
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }
    /// Chiede l'annullamento e torna subito: il thread ferma `curl`, cancella
    /// il parziale e pubblica `Cancelled`.
    pub(crate) fn cancel(&self) {
        self.shared.cancel.store(true, Ordering::SeqCst);
    }
}

fn install(catalog: &Catalog, shared: &Shared) -> Result<(), InstallError> {
    let created = !catalog.directory.exists();
    let result = (|| {
        fs::create_dir_all(&catalog.directory).map_err(|_| InstallError::Write)?;
        let mut done = 0;
        for file in &catalog.files {
            install_file(catalog, file, shared, done)?;
            done += file.size;
            shared.received.store(done, Ordering::Relaxed);
        }
        Ok(())
    })();
    if result.is_err() && created {
        let _ = fs::remove_dir(&catalog.directory);
    }
    result
}

/// Installa un file: scarica in un file temporaneo nella stessa cartella,
/// verifica lo SHA-256 e solo allora lo rinomina. In ogni altro caso il file
/// temporaneo si cancella.
fn install_file(
    catalog: &Catalog,
    file: &ModelFile,
    shared: &Shared,
    done: u64,
) -> Result<(), InstallError> {
    let target = catalog.directory.join(file.name);
    if hash_file(&target, &shared.cancel).is_ok_and(|hash| hash == file.sha256) {
        return Ok(());
    }
    let partial = partial_path(&catalog.directory, file);
    let _ = fs::remove_file(&partial);
    let result = fetch(catalog, file.url, &partial, shared, done).and_then(|()| {
        let hash = hash_file(&partial, &shared.cancel).map_err(|error| {
            if shared.cancel.load(Ordering::SeqCst) {
                InstallError::Cancelled
            } else if error.kind() == io::ErrorKind::NotFound {
                InstallError::Interrupted
            } else {
                InstallError::Write
            }
        })?;
        if hash != file.sha256 {
            return Err(InstallError::HashMismatch);
        }
        fs::rename(&partial, &target).map_err(|_| InstallError::Write)
    });
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

/// SHA-256 che si interrompe all'annullamento.
fn hash_file(path: &Path, cancel: &AtomicBool) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 1 << 20];
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(io::Error::from(io::ErrorKind::Interrupted));
        }
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// Scaricamento con il `curl` di sistema, solo dall'URL fissato. Il thread
/// controlla l'annullamento ogni 20 ms e, se serve, ferma `curl`.
fn fetch(
    catalog: &Catalog,
    url: &str,
    output: &Path,
    shared: &Shared,
    done: u64,
) -> Result<(), InstallError> {
    if (catalog.network_disabled)() {
        return Err(InstallError::NetworkDisabled);
    }
    if shared.cancel.load(Ordering::SeqCst) {
        return Err(InstallError::Cancelled);
    }
    let mut command = Command::new("/usr/bin/curl");
    command.args([
        "--fail",
        "--location",
        "--silent",
        "--connect-timeout",
        "30",
        "--speed-limit",
        "1024",
        "--speed-time",
        "60",
    ]);
    match catalog.transport {
        Transport::Https => command.args(["--proto", "=https", "--proto-redir", "=https"]),
        #[cfg(test)]
        Transport::LoopbackHttp => command.args(["--proto", "=http", "--noproxy", "*"]),
    };
    let mut child = command
        .arg("--output")
        .arg(output)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| InstallError::Unreachable)?;
    loop {
        if shared.cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(InstallError::Cancelled);
        }
        if let Some(received) = fs::metadata(output).ok().map(|m| m.len()) {
            shared.received.store(done + received, Ordering::Relaxed);
        }
        match child.try_wait() {
            Ok(Some(status)) => return curl_result(status.code()),
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(InstallError::Interrupted);
            }
        }
    }
}

/// Codici d'uscita di `curl` (pagina `curl(1)`, EXIT CODES).
fn curl_result(code: Option<i32>) -> Result<(), InstallError> {
    match code {
        Some(0) => Ok(()),
        Some(5 | 6 | 7 | 35 | 60) => Err(InstallError::Unreachable),
        Some(22) => Err(InstallError::Refused),
        Some(23) => Err(InstallError::Write),
        _ => Err(InstallError::Interrupted),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::{
        collections::HashMap,
        io::Write,
        net::{TcpListener, TcpStream},
        sync::atomic::AtomicUsize,
        time::Instant,
    };

    pub(crate) fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mediflow-voce-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn hash(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    /// Che cosa risponde il server di prova a una richiesta.
    #[derive(Clone)]
    pub(crate) enum Reply {
        Serve(Vec<u8>),
        /// Dichiara tutti i byte, ne manda `usize` e chiude.
        Truncate(Vec<u8>, usize),
        /// Manda i primi byte e poi resta fermo finché il client non chiude.
        Stall(Vec<u8>),
    }

    /// Server HTTP sul loopback, porta scelta dal sistema. Per ogni percorso
    /// una coda di risposte; l'ultima si ripete. Conta le connessioni.
    pub(crate) struct LoopbackServer {
        pub(crate) port: u16,
        connections: Arc<AtomicUsize>,
        stop: Arc<AtomicBool>,
        replies: Arc<Mutex<HashMap<String, Vec<Reply>>>>,
        thread: Option<std::thread::JoinHandle<()>>,
    }
    impl LoopbackServer {
        pub(crate) fn start() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let port = listener.local_addr().unwrap().port();
            let connections = Arc::new(AtomicUsize::new(0));
            let stop = Arc::new(AtomicBool::new(false));
            let replies: Arc<Mutex<HashMap<String, Vec<Reply>>>> = Arc::default();
            let thread = {
                let (connections, stop, replies) =
                    (connections.clone(), stop.clone(), replies.clone());
                std::thread::spawn(move || {
                    while !stop.load(Ordering::SeqCst) {
                        match listener.accept() {
                            Ok((stream, _)) => {
                                connections.fetch_add(1, Ordering::SeqCst);
                                let (replies, stop) = (replies.clone(), stop.clone());
                                std::thread::spawn(move || serve(stream, &replies, &stop));
                            }
                            Err(_) => std::thread::sleep(Duration::from_millis(5)),
                        }
                    }
                })
            };
            Self {
                port,
                connections,
                stop,
                replies,
                thread: Some(thread),
            }
        }
        pub(crate) fn set(&self, path: &str, replies: Vec<Reply>) {
            self.replies.lock().unwrap().insert(path.into(), replies);
        }
        pub(crate) fn connections(&self) -> usize {
            self.connections.load(Ordering::SeqCst)
        }
        /// Un file inventato servito da questo server.
        pub(crate) fn file(&self, name: &str, content: &[u8]) -> &'static ModelFile {
            self.set(&format!("/{name}"), vec![Reply::Serve(content.to_vec())]);
            Box::leak(Box::new(ModelFile {
                name: Box::leak(name.to_owned().into_boxed_str()),
                url: Box::leak(format!("http://127.0.0.1:{}/{name}", self.port).into_boxed_str()),
                sha256: Box::leak(hash(content).into_boxed_str()),
                size: content.len() as u64,
            }))
        }
    }
    impl Drop for LoopbackServer {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
    fn serve(
        mut stream: TcpStream,
        replies: &Mutex<HashMap<String, Vec<Reply>>>,
        stop: &AtomicBool,
    ) {
        let _ = stream.set_nonblocking(false);
        let mut request = Vec::new();
        let mut byte = [0u8; 1];
        while !request.ends_with(b"\r\n\r\n") && stream.read(&mut byte).is_ok_and(|n| n == 1) {
            request.push(byte[0]);
        }
        let request = String::from_utf8_lossy(&request);
        let path = request.split(' ').nth(1).unwrap_or("/").to_owned();
        let reply = {
            let mut replies = replies.lock().unwrap();
            match replies.get_mut(&path) {
                Some(queue) if queue.len() > 1 => Some(queue.remove(0)),
                Some(queue) => queue.first().cloned(),
                None => None,
            }
        };
        let header = |len: usize| {
            format!("HTTP/1.1 200 OK\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n")
        };
        match reply {
            None => {
                let _ = stream.write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
            Some(Reply::Serve(bytes)) => {
                let _ = stream.write_all(header(bytes.len()).as_bytes());
                let _ = stream.write_all(&bytes);
            }
            Some(Reply::Truncate(bytes, at)) => {
                let _ = stream.write_all(header(bytes.len()).as_bytes());
                let _ = stream.write_all(&bytes[..at]);
            }
            Some(Reply::Stall(bytes)) => {
                let _ = stream.write_all(header(bytes.len()).as_bytes());
                let _ = stream.write_all(&bytes[..bytes.len() / 4]);
                let _ = stream.flush();
                let started = Instant::now();
                while !stop.load(Ordering::SeqCst) && started.elapsed() < Duration::from_secs(20) {
                    std::thread::sleep(Duration::from_millis(10));
                    if stream.write_all(&[]).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = stream.flush();
    }

    pub(crate) fn loopback_catalog(directory: PathBuf, files: Vec<&'static ModelFile>) -> Catalog {
        Catalog {
            directory,
            files,
            transport: Transport::LoopbackHttp,
            network_disabled: || false,
        }
    }
    pub(crate) fn wait(download: &Download) -> Result<(), InstallError> {
        let started = Instant::now();
        loop {
            if let Some(outcome) = download.outcome() {
                return outcome;
            }
            assert!(
                started.elapsed() < Duration::from_secs(30),
                "download never ended"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    fn names(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .map(|entries| {
                let mut names: Vec<String> = entries
                    .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                    .collect();
                names.sort();
                names
            })
            .unwrap_or_default()
    }
    pub(crate) fn invented(len: usize, seed: u8) -> Vec<u8> {
        (0..len)
            .map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed))
            .collect()
    }

    #[test]
    fn missing_and_tampered_models_are_never_verified() {
        let dir = temp("verify");
        let content = b"modello inventato".to_vec();
        let sha = hash(&content);
        let file = ModelFile {
            name: "m.bin",
            url: "https://example.invalid/m.bin",
            sha256: Box::leak(sha.into_boxed_str()),
            size: content.len() as u64,
        };
        assert_eq!(verify(&dir, &[&file]), ModelStatus::Missing);
        fs::write(dir.join("m.bin"), &content[..5]).unwrap();
        assert_eq!(verify(&dir, &[&file]), ModelStatus::Invalid, "truncated");
        let mut tampered = content.clone();
        tampered[0] ^= 1;
        fs::write(dir.join("m.bin"), &tampered).unwrap();
        assert_eq!(quick_status(&dir, &[&file]), ModelStatus::Verified);
        assert_eq!(
            verify(&dir, &[&file]),
            ModelStatus::Invalid,
            "same size, other hash"
        );
        fs::write(dir.join("m.bin"), &content).unwrap();
        assert_eq!(verify(&dir, &[&file]), ModelStatus::Verified);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn install_puts_verified_files_in_place_with_one_request_each() {
        let server = LoopbackServer::start();
        let model = server.file("modello.bin", &invented(300_000, 1));
        let vad = server.file("vad.bin", &invented(4_000, 2));
        let dir = temp("install-ok").join("modelli-voce");
        let catalog = loopback_catalog(dir.clone(), vec![model, vad]);
        assert_eq!(catalog.quick_status(), ModelStatus::Missing);
        let download = Download::start(catalog.clone());
        assert_eq!(wait(&download), Ok(()));
        assert_eq!(download.progress(), (304_000, 304_000));
        assert_eq!(catalog.verify(), ModelStatus::Verified);
        assert_eq!(names(&dir), ["modello.bin", "vad.bin"]);
        assert_eq!(server.connections(), 2);
        fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[test]
    fn wrong_hash_is_refused_and_leaves_nothing_on_disk() {
        let server = LoopbackServer::start();
        let model = server.file("modello.bin", &invented(50_000, 3));
        let mut altered = invented(50_000, 3);
        altered[49_999] ^= 1;
        server.set("/modello.bin", vec![Reply::Serve(altered)]);
        let root = temp("install-hash");
        let dir = root.join("modelli-voce");
        let download = Download::start(loopback_catalog(dir.clone(), vec![model]));
        assert_eq!(wait(&download), Err(InstallError::HashMismatch));
        assert!(!dir.exists(), "{:?}", names(&dir));
        assert!(names(&root).is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancelling_midway_returns_within_200_ms_and_leaves_no_partial_file() {
        let server = LoopbackServer::start();
        let content = invented(2_000_000, 4);
        let model = server.file("modello.bin", &content);
        server.set("/modello.bin", vec![Reply::Stall(content)]);
        let root = temp("install-cancel");
        let dir = root.join("modelli-voce");
        let download = Download::start(loopback_catalog(dir.clone(), vec![model]));
        let started = Instant::now();
        while download.progress().0 == 0 {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "no bytes arrived"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
        assert!(download.outcome().is_none(), "still downloading");
        let cancelled = Instant::now();
        download.cancel();
        assert!(
            cancelled.elapsed() < Duration::from_millis(5),
            "cancel must not wait"
        );
        assert_eq!(wait(&download), Err(InstallError::Cancelled));
        let elapsed = cancelled.elapsed();
        assert!(elapsed < Duration::from_millis(200), "{elapsed:?}");
        assert!(!dir.exists(), "{:?}", names(&dir));
        eprintln!("annullamento chiuso in {elapsed:?}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interrupted_connection_fails_cleanly_and_a_new_attempt_succeeds() {
        let server = LoopbackServer::start();
        let content = invented(100_000, 5);
        let model = server.file("modello.bin", &content);
        server.set(
            "/modello.bin",
            vec![
                Reply::Truncate(content.clone(), 30_000),
                Reply::Serve(content),
            ],
        );
        let root = temp("install-retry");
        let dir = root.join("modelli-voce");
        let catalog = loopback_catalog(dir.clone(), vec![model]);
        assert_eq!(
            wait(&Download::start(catalog.clone())),
            Err(InstallError::Interrupted)
        );
        assert!(!dir.exists(), "{:?}", names(&dir));
        assert_eq!(wait(&Download::start(catalog.clone())), Ok(()));
        assert_eq!(catalog.verify(), ModelStatus::Verified);
        assert_eq!(server.connections(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unreachable_server_and_http_errors_are_told_apart() {
        let server = LoopbackServer::start();
        let model = server.file("modello.bin", b"pesi");
        server.replies.lock().unwrap().clear();
        let root = temp("install-refused");
        let refused = Download::start(loopback_catalog(root.join("a"), vec![model]));
        assert_eq!(wait(&refused), Err(InstallError::Refused));
        let closed = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = closed.local_addr().unwrap().port();
        drop(closed);
        let nowhere: &'static ModelFile = Box::leak(Box::new(ModelFile {
            name: "modello.bin",
            url: Box::leak(format!("http://127.0.0.1:{port}/modello.bin").into_boxed_str()),
            sha256: model.sha256,
            size: model.size,
        }));
        let unreachable = Download::start(loopback_catalog(root.join("b"), vec![nowhere]));
        assert_eq!(wait(&unreachable), Err(InstallError::Unreachable));
        assert!(names(&root).is_empty(), "{:?}", names(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn disabled_network_blocks_the_request_before_any_connection() {
        let server = LoopbackServer::start();
        let model = server.file("modello.bin", b"pesi");
        let root = temp("install-offline");
        let mut catalog = loopback_catalog(root.join("modelli-voce"), vec![model]);
        catalog.network_disabled = || true;
        assert_eq!(
            wait(&Download::start(catalog)),
            Err(InstallError::NetworkDisabled)
        );
        assert_eq!(server.connections(), 0);
        assert!(names(&root).is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn network_switch_follows_the_aifa_rule() {
        // Solo la funzione pura: la variabile d'ambiente non si tocca nei test
        // paralleli.
        for (value, disabled) in [
            (None, false),
            (Some("0"), false),
            (Some("1"), true),
            (Some("si"), true),
        ] {
            assert_eq!(
                switch_disables(value.map(std::ffi::OsStr::new)),
                disabled,
                "{value:?}"
            );
        }
    }

    #[test]
    fn unwritable_folder_gives_a_write_error() {
        use std::os::unix::fs::PermissionsExt;
        let server = LoopbackServer::start();
        let model = server.file("modello.bin", &invented(10_000, 6));
        let root = temp("install-readonly");
        let dir = root.join("modelli-voce");
        fs::create_dir_all(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        let outcome = wait(&Download::start(loopback_catalog(dir.clone(), vec![model])));
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(outcome, Err(InstallError::Write));
        assert!(names(&dir).is_empty());
        let blocked = root.join("file-al-posto-della-cartella");
        fs::write(&blocked, b"x").unwrap();
        let outcome = wait(&Download::start(loopback_catalog(
            blocked.join("modelli-voce"),
            vec![model],
        )));
        assert_eq!(outcome, Err(InstallError::Write));
        assert_eq!(
            server.connections(),
            1,
            "no request without a place to write"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn remove_takes_the_model_away_and_dictation_falls_back_to_the_system_engine() {
        let root = temp("remove");
        let catalog = Catalog::pinned(root.join("modelli-voce"));
        fs::create_dir_all(&catalog.directory).unwrap();
        for file in &catalog.files {
            fs::write(catalog.directory.join(file.name), b"pesi inventati").unwrap();
        }
        fs::write(partial_path(&catalog.directory, &WHISPER), b"mezzo").unwrap();
        assert!(whisper_selected(&catalog.directory));
        catalog.remove().unwrap();
        assert!(!whisper_selected(&catalog.directory));
        assert_eq!(catalog.quick_status(), ModelStatus::Missing);
        assert!(!catalog.directory.exists());
        catalog.remove().unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pinned_files_use_fixed_revisions_and_full_hashes() {
        for file in FILES {
            assert!(file.url.starts_with("https://huggingface.co/"));
            assert!(file.url.contains("/resolve/") && !file.url.contains("/resolve/main/"));
            assert!(file.url.ends_with(file.name));
            assert_eq!(file.sha256.len(), 64);
        }
        assert_eq!(source_host(&FILES), Some("huggingface.co"));
        assert_eq!(total_size(&FILES), 574_926_293);
        assert_eq!(
            Catalog::pinned(PathBuf::from("/x")).transport,
            Transport::Https
        );
    }

    /// P3: uno scaricamento vero, con la stessa funzione del pulsante, in una
    /// cartella temporanea. Parte solo con `MEDIFLOW_VOCE_SCARICAMENTO_REALE=1`.
    #[test]
    #[ignore = "scarica 0,57 GB da huggingface.co"]
    fn real_download_from_pinned_urls_matches_pinned_hashes() {
        if std::env::var_os("MEDIFLOW_VOCE_SCARICAMENTO_REALE").is_none_or(|v| v != "1") {
            eprintln!("MEDIFLOW_VOCE_SCARICAMENTO_REALE=1 non impostata: nessuno scaricamento.");
            return;
        }
        let root = temp("reale");
        let catalog = Catalog::pinned(root.join("modelli-voce"));
        assert!(!catalog.directory.starts_with(directory().unwrap()));
        let started = Instant::now();
        let download = Download::start(catalog.clone());
        let outcome = loop {
            if let Some(outcome) = download.outcome() {
                break outcome;
            }
            std::thread::sleep(Duration::from_millis(200));
        };
        let elapsed = started.elapsed();
        assert_eq!(outcome, Ok(()));
        assert_eq!(catalog.verify(), ModelStatus::Verified);
        for file in &catalog.files {
            let path = catalog.directory.join(file.name);
            assert_eq!(fs::metadata(&path).unwrap().len(), file.size);
            assert_eq!(sha256_file(&path).unwrap(), file.sha256);
            eprintln!("{}: {} byte, sha256 {}", file.name, file.size, file.sha256);
        }
        eprintln!(
            "totale {} byte in {:.1} s",
            catalog.total_size(),
            elapsed.as_secs_f64()
        );
        fs::remove_dir_all(&root).unwrap();
        assert!(!root.exists());
    }
}
