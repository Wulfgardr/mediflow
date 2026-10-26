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
mod references;
mod shell;
mod text_input;
mod theme;

use gpui::{App, AppContext, Bounds, TitlebarOptions, WindowBounds, WindowOptions, px, size};
use std::borrow::Cow;

#[derive(Default, Debug, PartialEq, Eq)]
struct Launch {
    demo: bool,
    server: String,
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
            _ => return Err("Argomento non riconosciuto. Usa --server INDIRIZZO oppure --demo."),
        }
    }
    if launch.demo && !launch.server.is_empty() {
        return Err("La prova in memoria non usa un archivio. Scegli --demo oppure --server.");
    }
    Ok(launch)
}

fn main() {
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
            return;
        }
    };
    gpui_platform::application().run(move |cx: &mut App| {
        #[cfg(unix)]
        chat_access::install_lock_observer();
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
        let bounds = Bounds::centered(None, size(px(1200.), px(840.)), cx);
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            window_min_size: Some(size(px(390.), px(640.))),
            titlebar: Some(TitlebarOptions { title: Some(if launch.demo { "MediFlow · Dati di prova".into() } else { "MediFlow".into() }), ..Default::default() }),
            ..Default::default()
        };
        let result = if launch.demo {
            cx.open_window(options, |window, cx| cx.new(|cx| demo_app::PatientApp::new(window, cx))).map(|_| ())
        } else {
            cx.open_window(options, |window, cx| cx.new(|cx| shell::ClinicalApp::new(launch.server, window, cx))).map(|_| ())
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
                server: "https://127.0.0.1:43181".into()
            })
        );
    }
}
