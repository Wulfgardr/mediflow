//! Punto d'inchiostro, read directly from the repository's design tokens.

use gpui::{Hsla, rgb};
use serde_json::Value;

pub const VOICE: &str = "Newsreader";
pub const CODES: &str = "IBM Plex Mono";
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub const SYSTEM: &str = ".SystemUIFont";
#[cfg(target_os = "windows")]
pub const SYSTEM: &str = "Segoe UI Variable";
#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "windows")))]
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
    pub critical: Hsla,
    pub threshold: Hsla,
    pub threshold_text: Hsla,
    pub control_radius: f32,
    pub paper_radius: f32,
    pub scale: f32,
}

impl Theme {
    pub fn for_dark(dark: bool) -> Self {
        static TOKENS: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
        let tokens = TOKENS.get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../docs/design/lume/tokens/lume.tokens.json"
            ))
            .expect("versioned Punto d'inchiostro runtime tokens must be valid JSON")
        });
        let colors = &tokens["register"][if dark { "grafite" } else { "giorno" }];
        let color = |group: &str, name: &str| {
            let value = colors[group][name]["$value"]
                .as_str()
                .expect("required Punto d'inchiostro color token");
            rgb(u32::from_str_radix(value.trim_start_matches('#'), 16)
                .expect("hexadecimal Punto d'inchiostro color"))
            .into()
        };
        Self {
            shade: color("surface", "canvas"),
            paper: color("surface", "focal"),
            rule: color("rule", "default"),
            strong_rule: color("rule", "strong"),
            ink: color("ink", "primary"),
            fresh: color("ink", "fresh"),
            secondary: color("ink", "secondary"),
            draft: color("surface", "draft"),
            draft_rule: color("rule", "draft"),
            hover: color("surface", "hover"),
            selected: color("surface", "selected"),
            warning: color("signal", "warning"),
            critical: color("signal", "critical"),
            threshold: color("surface", "threshold"),
            threshold_text: color("ink", "threshold"),
            control_radius: if cfg!(target_os = "ios") {
                12.
            } else if cfg!(target_os = "macos") {
                8.
            } else if cfg!(target_os = "windows") {
                4.
            } else {
                6.
            },
            paper_radius: if cfg!(target_os = "ios") {
                18.
            } else if cfg!(target_os = "macos") {
                12.
            } else if cfg!(target_os = "windows") {
                8.
            } else {
                10.
            },
            scale: 1.,
        }
    }

    pub fn sized(mut self, scale: f32, increased_contrast: bool) -> Self {
        self.scale = scale.clamp(1., 4.);
        if increased_contrast {
            self.rule = self.strong_rule;
        }
        self
    }

    pub fn body(self) -> f32 {
        self.size(if cfg!(target_os = "ios") {
            15.5
        } else if cfg!(target_os = "macos") {
            13.5
        } else {
            14.
        })
    }

    pub fn size(self, points: f32) -> f32 {
        points * self.scale
    }
}
