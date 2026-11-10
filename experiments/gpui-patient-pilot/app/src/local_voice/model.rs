//! File del modello vocale locale: dove stanno, come si verificano, come si
//! installano. Nessuno scaricamento parte da solo: l'installazione è un comando
//! esplicito (`--installa-modello-voce`) e ogni file si accetta solo se il suo
//! SHA-256 coincide con quello scritto qui.

use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::Command,
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
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 1 << 20];
    loop {
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

/// Installa un file: scarica in un file temporaneo nella stessa cartella,
/// verifica lo SHA-256 e solo allora lo rinomina. Se l'hash non coincide il
/// file temporaneo si cancella.
fn install_file(
    directory: &Path,
    file: &ModelFile,
    fetch: &dyn Fn(&str, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let target = directory.join(file.name);
    if sha256_file(&target).is_ok_and(|hash| hash == file.sha256) {
        return Ok(());
    }
    let partial = directory.join(format!("{}.parziale", file.name));
    let _ = fs::remove_file(&partial);
    let result = fetch(file.url, &partial).and_then(|()| {
        let hash = sha256_file(&partial)?;
        if hash != file.sha256 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("{}: hash diverso da quello atteso.", file.name),
            ));
        }
        fs::rename(&partial, &target)
    });
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

pub(crate) fn install(
    directory: &Path,
    files: &[&ModelFile],
    fetch: &dyn Fn(&str, &Path) -> io::Result<()>,
) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    for file in files {
        install_file(directory, file, fetch)?;
    }
    Ok(())
}

/// Scaricamento con il `curl` di sistema, solo HTTPS e solo dall'URL fissato.
pub(crate) fn curl(url: &str, output: &Path) -> io::Result<()> {
    let status = Command::new("/usr/bin/curl")
        .args([
            "--fail",
            "--location",
            "--proto",
            "=https",
            "--silent",
            "--show-error",
            "--output",
        ])
        .arg(output)
        .arg(url)
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other("Scaricamento non riuscito."))
    }
}

/// Comando esplicito dell'app: `--installa-modello-voce`.
pub(crate) fn run_install_command() -> i32 {
    let Some(directory) = directory() else {
        eprintln!("Cartella dell'utente non trovata.");
        return 2;
    };
    let total: u64 = FILES.iter().map(|f| f.size).sum();
    println!(
        "Installo il modello vocale locale (whisper large-v3-turbo q5_0 e Silero VAD, licenza MIT, {} MB) in {}.",
        total / 1_000_000,
        directory.display()
    );
    match install(&directory, &FILES, &curl) {
        Ok(()) => {
            println!("Modello installato e verificato.");
            0
        }
        Err(error) => {
            eprintln!("Installazione non riuscita: {error}");
            2
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
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
    fn install_keeps_only_files_whose_hash_matches() {
        let dir = temp("install");
        let good = b"pesi inventati".to_vec();
        let file = ModelFile {
            name: "m.bin",
            url: "https://example.invalid/m.bin",
            sha256: Box::leak(hash(&good).into_boxed_str()),
            size: good.len() as u64,
        };
        let wrong = |_: &str, out: &Path| fs::write(out, b"altro contenuto");
        assert!(install(&dir, &[&file], &wrong).is_err());
        assert!(fs::read_dir(&dir).unwrap().next().is_none(), "nothing kept");
        let right = |url: &str, out: &Path| {
            assert_eq!(url, "https://example.invalid/m.bin");
            fs::write(out, b"pesi inventati")
        };
        install(&dir, &[&file], &right).unwrap();
        assert_eq!(verify(&dir, &[&file]), ModelStatus::Verified);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn pinned_files_use_fixed_revisions_and_full_hashes() {
        for file in FILES {
            assert!(file.url.starts_with("https://huggingface.co/"));
            assert!(file.url.contains("/resolve/") && !file.url.contains("/resolve/main/"));
            assert!(file.url.ends_with(file.name));
            assert_eq!(file.sha256.len(), 64);
        }
    }
}
