mod appointments;
#[cfg(unix)]
mod chat_access;
mod clinical_text;
mod components;
mod demo;
mod demo_app;
mod documents;
mod editing;
mod icons;
mod native_lock;
mod navigation;
mod patient_forms;
mod patient_text;
mod platform_integration;
mod references;
mod shell;
mod text_input;
mod theme;
mod title;

use gpui::{App, AppContext, Bounds, TitlebarOptions, WindowBounds, WindowOptions, px, size};
use std::{borrow::Cow, path::PathBuf};

const STATE_DIRECTORY_MISSING: &str = "Indica una cartella dopo --state-directory.";
const STATE_DIRECTORY_INVALID: &str = "La cartella deve essere assoluta, già esistente, privata, appartenere all’utente corrente e non contenere collegamenti simbolici nel percorso.";
#[cfg(not(windows))]
const STATE_DIRECTORY_UNSUPPORTED: &str = "L’opzione --state-directory non è supportata su questa piattaforma. Non è possibile usare la cartella indicata per le preferenze e i dati di recupero dell’interfaccia.";

#[cfg(all(windows, test))]
const STATE_DIRECTORY_UNSUPPORTED: &str = "Le ACL della cartella Windows non sono verificabili: sono ammesse solo ACE standard per l'utente corrente. La cartella non è stata usata per preferenze o recupero dell'interfaccia.";

#[cfg(any(not(windows), test))]
fn state_directory_error(kind: std::io::ErrorKind) -> &'static str {
    match kind {
        std::io::ErrorKind::Unsupported => STATE_DIRECTORY_UNSUPPORTED,
        _ => STATE_DIRECTORY_INVALID,
    }
}

const LAUNCH_USAGE: &str = "Uso: --server INDIRIZZO oppure --demo [--state-directory CARTELLA]. La cartella facoltativa contiene preferenze e dati di recupero dell’interfaccia, non l’archivio clinico.";

#[derive(Default, Debug, PartialEq, Eq)]
struct Launch {
    demo: bool,
    server: String,
    state_directory: Option<PathBuf>,
}

fn parse_launch(args: impl IntoIterator<Item = String>) -> Result<Launch, &'static str> {
    let mut launch = Launch::default();
    let mut args = args.into_iter();
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--demo" if !launch.demo => launch.demo = true,
            "--server" if launch.server.is_empty() => {
                launch.server = args
                    .next()
                    .filter(|value| !value.starts_with("--") && !value.is_empty())
                    .ok_or("Indica l'indirizzo dopo --server.")?;
            }
            "--state-directory" if launch.state_directory.is_none() => {
                let path = args
                    .next()
                    .filter(|value| !value.starts_with("--") && !value.is_empty())
                    .map(PathBuf::from)
                    .ok_or(STATE_DIRECTORY_MISSING)?;
                if !path.is_absolute() {
                    return Err(STATE_DIRECTORY_INVALID);
                }
                launch.state_directory = Some(path);
            }
            _ => return Err(LAUNCH_USAGE),
        }
    }
    if launch.demo && !launch.server.is_empty() {
        return Err("La prova in memoria non usa un archivio. Scegli --demo oppure --server.");
    }
    Ok(launch)
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--verify-bundled-assets") {
        println!("{}", components::verify_bundled_brand_assets());
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--chat-access-stdio") {
        #[cfg(unix)]
        if std::env::args().count() == 3 {
            let path = std::path::PathBuf::from(std::env::args_os().nth(2).unwrap());
            if chat_access::run_stdio(&path).is_err() {
                eprintln!("Accesso nativo non disponibile.");
                std::process::exit(2);
            }
            return;
        }
        eprintln!("Accesso nativo non supportato o configurazione assente.");
        std::process::exit(2);
    }
    let launch = match parse_launch(std::env::args().skip(1)) {
        Ok(launch) => launch,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    let local_preferences = match launch.state_directory.as_ref() {
        Some(directory) => {
            match shell::local_preferences::LocalPreferencesStore::from_directory(directory) {
                Ok(store) => Some(store),
                Err(error) => {
                    #[cfg(windows)]
                    eprintln!("Impossibile usare la cartella di stato: {error}");
                    #[cfg(not(windows))]
                    eprintln!("{}", state_directory_error(error.kind()));
                    std::process::exit(2);
                }
            }
        }
        None => None,
    };
    gpui_platform::application().run(move |cx: &mut App| {
        #[cfg(unix)]
        chat_access::install_lock_observer();
        native_lock::monitor_installed();
        let fonts: Vec<Cow<'static, [u8]>> = vec![
            Cow::Borrowed(include_bytes!("../../../../app/fonts/Newsreader-Native-Regular.ttf")),
            Cow::Borrowed(include_bytes!("../../../../app/fonts/Newsreader-Native-Bold.ttf")),
            Cow::Borrowed(include_bytes!("../../../../app/fonts/Newsreader-Native-Italic.ttf")),
            Cow::Borrowed(include_bytes!("../../../../app/fonts/Newsreader-Native-BoldItalic.ttf")),
            Cow::Borrowed(include_bytes!("../../../../native/MediFlowMac/Sources/MediFlowAppleShared/Resources/Fonts/IBMPlexMono-Regular.ttf")),
        ];
        if let Err(error) = cx.text_system().add_fonts(fonts) {
            eprintln!("Impossibile caricare i caratteri locali di MediFlow: {error}");
            cx.quit(); return;
        }
        text_input::bind_keys(cx);
        if launch.demo { demo_app::bind_keys(cx); } else { shell::bind_keys(cx); }
        let display = cx.primary_display();
        let available = display.as_ref().map(|display| display.visible_bounds());
        let bounds = available.map(platform_integration::initial_bounds)
            .unwrap_or_else(|| Bounds::centered(None, size(px(1200.), px(840.)), cx));
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            window_min_size: Some(size(px(390.).min((bounds.size.width - px(32.)).max(px(1.))), px(640.).min((bounds.size.height - px(80.)).max(px(1.))))),
            app_id: Some("dev.mediflow.MediFlow".into()),
            titlebar: Some(TitlebarOptions { title: Some(if launch.demo { "MediFlow · Dati di prova".into() } else { "MediFlow".into() }), ..Default::default() }),
            ..Default::default()
        };
        let result = if launch.demo {
            cx.open_window(options, |window, cx| {
                platform_integration::fit_window(window);
                cx.new(|cx| demo_app::PatientApp::with_preferences(local_preferences.unwrap_or_else(shell::local_preferences::LocalPreferencesStore::system), window, cx))
            }).map(|_| ())
        } else {
            cx.open_window(options, |window, cx| {
                platform_integration::fit_window(window);
                cx.new(|cx| match local_preferences {
                Some(store) => shell::ClinicalApp::with_local_preferences(launch.server, store, window, cx),
                None => shell::ClinicalApp::new(launch.server, window, cx),
            }) }).map(|_| ())
        };
        if let Err(error) = result {
            eprintln!("Impossibile aprire la finestra di MediFlow: {error}");
            cx.quit(); return;
        }
        cx.activate(true);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsupported_state_directory_is_distinct_from_invalid_or_nonprivate_paths() {
        assert_eq!(
            state_directory_error(std::io::ErrorKind::Unsupported),
            STATE_DIRECTORY_UNSUPPORTED
        );
        for kind in [
            std::io::ErrorKind::InvalidInput,
            std::io::ErrorKind::PermissionDenied,
            std::io::ErrorKind::NotFound,
        ] {
            assert_eq!(state_directory_error(kind), STATE_DIRECTORY_INVALID);
        }
    }

    #[test]
    fn state_directory_is_explicit_for_connected_and_demo_without_secret_flags() {
        let state_directory = if cfg!(windows) {
            r"C:\mediflow-owned"
        } else {
            "/private/tmp/mediflow-owned"
        };
        for prefix in [vec!["--demo"], vec!["--server", "http://127.0.0.1:43181"]] {
            let mut args = prefix;
            args.extend(["--state-directory", state_directory]);
            assert_eq!(
                parse_launch(args.into_iter().map(String::from))
                    .unwrap()
                    .state_directory,
                Some(PathBuf::from(state_directory))
            );
        }
        for (args, error) in [
            (vec!["--state-directory"], STATE_DIRECTORY_MISSING),
            (
                vec!["--state-directory", "relative"],
                STATE_DIRECTORY_INVALID,
            ),
            (
                vec![
                    "--state-directory",
                    state_directory,
                    "--state-directory",
                    state_directory,
                ],
                LAUNCH_USAGE,
            ),
        ] {
            assert_eq!(parse_launch(args.into_iter().map(String::from)), Err(error));
        }
    }
    #[test]
    fn launch_does_not_treat_demo_as_a_connected_archive_or_accept_secret_flags() {
        assert_eq!(parse_launch(Vec::<String>::new()), Ok(Launch::default()));
        assert!(
            parse_launch(["--demo", "--server", "http://127.0.0.1:43181"].map(String::from))
                .is_err()
        );
        assert!(parse_launch(["--passphrase", "secret"].map(String::from)).is_err());
        assert!(parse_launch(["--server"].map(String::from)).is_err());
        assert_eq!(
            parse_launch(["--server", "https://127.0.0.1:43181"].map(String::from)),
            Ok(Launch {
                demo: false,
                server: "https://127.0.0.1:43181".into(),
                ..Launch::default()
            })
        );
    }
}
