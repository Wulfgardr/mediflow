//! Punto d'inchiostro, read directly from the repository's design tokens.

use gpui::{Hsla, rgb};
use serde_json::Value;

pub const VOICE: &str = "Newsreader";
pub const CODES: &str = "IBM Plex Mono";
#[cfg(target_os = "macos")]
pub const SYSTEM: &str = ".SystemUIFont";
#[cfg(target_os = "windows")]
pub const SYSTEM: &str = "Segoe UI";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub const SYSTEM: &str = "sans-serif";

#[derive(Clone, Copy)]
pub struct Theme {
    pub shade: Hsla,
    pub paper: Hsla,
    pub rule: Hsla,
    pub strong_rule: Hsla,
    pub ink: Hsla,
    pub fresh: Hsla,
    pub secondary: Hsla,
    pub draft: Hsla,
    pub draft_rule: Hsla,
    pub hover: Hsla,
    pub selected: Hsla,
    pub warning: Hsla,
    pub threshold: Hsla,
    pub threshold_text: Hsla,
    pub control_radius: f32,
    pub paper_radius: f32,
}

impl Theme {
    pub fn for_dark(dark: bool) -> Self {
        let tokens: Value = serde_json::from_str(include_str!(
            "../../../../docs/design/punto-inchiostro/tokens/punto-inchiostro.tokens.json"
        ))
        .expect("versioned Punto d'inchiostro tokens must be valid JSON");
        let colors = &tokens["colore"][if dark { "grafite" } else { "giorno" }];
        let color = |name: &str| {
            let value = colors[name]["$value"]
                .as_str()
                .expect("required Punto d'inchiostro color token");
            rgb(u32::from_str_radix(value.trim_start_matches('#'), 16)
                .expect("hexadecimal Punto d'inchiostro color"))
            .into()
        };
        Self {
            shade: color("penombra"),
            paper: color("piano"),
            rule: color("filetto"),
            strong_rule: color("filetto-forte"),
            ink: color("inchiostro-asciutto"),
            fresh: color("inchiostro-fresco"),
            secondary: color("secondario"),
            draft: color("fresco-fondo"),
            draft_rule: color("fresco-filetto"),
            hover: color("riga-passaggio"),
            selected: color("riga-selezionata"),
            warning: color("avviso"),
            threshold: color("soglia"),
            threshold_text: color("soglia-testo"),
            control_radius: if cfg!(target_os = "macos") {
                8.
            } else if cfg!(target_os = "windows") {
                4.
            } else {
                6.
            },
            paper_radius: if cfg!(target_os = "macos") {
                12.
            } else if cfg!(target_os = "windows") {
                8.
            } else {
                10.
            },
        }
    }
}
