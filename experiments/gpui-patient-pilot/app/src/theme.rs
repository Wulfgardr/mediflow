//! Punto d'inchiostro, read directly from the repository's design tokens.

use gpui::{FontFeatures, FontWeight, Hsla, Styled, px, rgb};
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
    pub pencil: Hsla,
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
            pencil: color("ink", "pencil"),
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

    fn size(self, points: f32) -> f32 {
        points * self.scale
    }

    pub fn role(self, role: TypeRole) -> Typography {
        let native_body = self.body() / self.scale;
        let (family, points, weight, leading, register) = match role {
            TypeRole::Person { compact } => (
                VOICE,
                if compact { 26. } else { 28. },
                FontWeight::NORMAL,
                1.1,
                false,
            ),
            TypeRole::PageTitle => (VOICE, 26., FontWeight::NORMAL, 1.2, false),
            TypeRole::PersonPreview => (VOICE, 22., FontWeight::NORMAL, 1.2, false),
            TypeRole::Prose => (VOICE, 17., FontWeight::NORMAL, 1.5, false),
            TypeRole::Brand => (VOICE, 21., FontWeight::MEDIUM, 1.2, false),
            TypeRole::Body => (SYSTEM, 14., FontWeight::NORMAL, 1.5, true),
            TypeRole::Strong => (SYSTEM, 14., FontWeight::SEMIBOLD, 1.5, true),
            TypeRole::Threshold => (SYSTEM, 15., FontWeight::SEMIBOLD, 1.5, true),
            TypeRole::Meta => (SYSTEM, 13., FontWeight::NORMAL, 1.5, true),
            TypeRole::Section => (SYSTEM, 12., FontWeight::SEMIBOLD, 1.5, true),
            TypeRole::Code => (CODES, 12., FontWeight::NORMAL, 1.5, false),
        };
        let size = self.size(points * if register { native_body / 14. } else { 1. });
        Typography {
            family,
            size,
            weight,
            line_height: size * leading,
            uppercase: role == TypeRole::Section,
            tracking_em: if role == TypeRole::Section { 0.05 } else { 0. },
            tabular: register,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TypeRole {
    Person { compact: bool },
    PageTitle,
    PersonPreview,
    Prose,
    Brand,
    Body,
    Strong,
    Threshold,
    Meta,
    Section,
    Code,
}

#[derive(Clone, Copy, Debug)]
pub struct Typography {
    pub family: &'static str,
    pub size: f32,
    pub weight: FontWeight,
    pub line_height: f32,
    pub uppercase: bool,
    /// GPUI's text shaper does not expose letter spacing; retained as the role contract.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "GPUI does not expose tracking; role metadata remains available to tests and future shaping"
        )
    )]
    pub tracking_em: f32,
    pub tabular: bool,
}

impl Typography {
    pub fn label(self, text: impl AsRef<str>) -> String {
        if self.uppercase {
            text.as_ref().to_uppercase()
        } else {
            text.as_ref().to_owned()
        }
    }
}

pub trait TypeStyle: Styled + Sized {
    fn type_role(self, theme: Theme, role: TypeRole) -> Self {
        let typography = theme.role(role);
        self.font_family(typography.family)
            .text_size(px(typography.size))
            .font_weight(typography.weight)
            .line_height(px(typography.line_height))
            .font_features(if typography.tabular {
                FontFeatures(std::sync::Arc::new(vec![("tnum".into(), 1)]))
            } else {
                FontFeatures::default()
            })
    }
}
impl<T: Styled> TypeStyle for T {}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(
        role: TypeRole,
        family: &str,
        sizes: [f32; 2],
        weight: FontWeight,
        heights: [f32; 2],
        attributes: (bool, f32, bool),
    ) {
        let (uppercase, tracking, tabular) = attributes;
        for dark in [false, true] {
            for (index, scale) in [1., 2.].into_iter().enumerate() {
                let actual = Theme::for_dark(dark).sized(scale, false).role(role);
                assert_eq!(actual.family, family);
                assert!(
                    (actual.size - sizes[index]).abs() < 0.0001,
                    "{role:?}: {}",
                    actual.size
                );
                assert_eq!(actual.weight, weight);
                assert!(
                    (actual.line_height - heights[index]).abs() < 0.0001,
                    "{role:?}: {}",
                    actual.line_height
                );
                assert_eq!(actual.uppercase, uppercase);
                assert_eq!(actual.tracking_em, tracking);
                assert_eq!(actual.tabular, tabular);
            }
        }
    }
    macro_rules! voice {
        ($test:ident, $role:expr, $family:expr, $s1:expr, $s2:expr, $weight:expr, $h1:expr, $h2:expr) => {
            #[test]
            fn $test() {
                check(
                    $role,
                    $family,
                    [$s1, $s2],
                    $weight,
                    [$h1, $h2],
                    (false, 0., false),
                );
            }
        };
    }
    voice!(
        person,
        TypeRole::Person { compact: false },
        "Newsreader",
        28.,
        56.,
        FontWeight::NORMAL,
        30.8,
        61.6
    );
    voice!(
        person_compact,
        TypeRole::Person { compact: true },
        "Newsreader",
        26.,
        52.,
        FontWeight::NORMAL,
        28.6,
        57.2
    );
    voice!(
        page_title,
        TypeRole::PageTitle,
        "Newsreader",
        26.,
        52.,
        FontWeight::NORMAL,
        31.2,
        62.4
    );
    voice!(
        person_preview,
        TypeRole::PersonPreview,
        "Newsreader",
        22.,
        44.,
        FontWeight::NORMAL,
        26.4,
        52.8
    );
    voice!(
        prose,
        TypeRole::Prose,
        "Newsreader",
        17.,
        34.,
        FontWeight::NORMAL,
        25.5,
        51.
    );
    voice!(
        brand,
        TypeRole::Brand,
        "Newsreader",
        21.,
        42.,
        FontWeight::MEDIUM,
        25.2,
        50.4
    );
    voice!(
        code,
        TypeRole::Code,
        "IBM Plex Mono",
        12.,
        24.,
        FontWeight::NORMAL,
        18.,
        36.
    );

    macro_rules! register {
        ($test:ident, $role:expr, $weight:expr, $mac:expr, $ios:expr, $other:expr, $upper:expr, $tracking:expr) => {
            #[test]
            fn $test() {
                let expected: [f32; 4] = if cfg!(target_os = "macos") {
                    $mac
                } else if cfg!(target_os = "ios") {
                    $ios
                } else {
                    $other
                };
                let family = if cfg!(any(target_os = "macos", target_os = "ios")) {
                    ".SystemUIFont"
                } else if cfg!(target_os = "windows") {
                    "Segoe UI Variable"
                } else {
                    "sans-serif"
                };
                check(
                    $role,
                    family,
                    [expected[0], expected[1]],
                    $weight,
                    [expected[2], expected[3]],
                    ($upper, $tracking, true),
                );
            }
        };
    }
    register!(
        body,
        TypeRole::Body,
        FontWeight::NORMAL,
        [13.5, 27., 20.25, 40.5],
        [15.5, 31., 23.25, 46.5],
        [14., 28., 21., 42.],
        false,
        0.
    );
    register!(
        strong,
        TypeRole::Strong,
        FontWeight::SEMIBOLD,
        [13.5, 27., 20.25, 40.5],
        [15.5, 31., 23.25, 46.5],
        [14., 28., 21., 42.],
        false,
        0.
    );
    register!(
        threshold,
        TypeRole::Threshold,
        FontWeight::SEMIBOLD,
        [14.464286, 28.928572, 21.696428, 43.392856],
        [16.607143, 33.214286, 24.910715, 49.82143],
        [15., 30., 22.5, 45.],
        false,
        0.
    );
    register!(
        meta,
        TypeRole::Meta,
        FontWeight::NORMAL,
        [12.535714, 25.071428, 18.803572, 37.607144],
        [14.392857, 28.785714, 21.589285, 43.17857],
        [13., 26., 19.5, 39.],
        false,
        0.
    );
    register!(
        section,
        TypeRole::Section,
        FontWeight::SEMIBOLD,
        [11.571428, 23.142856, 17.357143, 34.714286],
        [13.285714, 26.571428, 19.928572, 39.857144],
        [12., 24., 18., 36.],
        true,
        0.05
    );

    #[test]
    fn section_transforms_the_actual_label() {
        assert_eq!(
            Theme::for_dark(false)
                .role(TypeRole::Section)
                .label("Risultato e limiti"),
            "RISULTATO E LIMITI"
        );
        assert_eq!(
            Theme::for_dark(true).role(TypeRole::Meta).label("Nascita"),
            "Nascita"
        );
    }

    #[test]
    fn pencil_matches_the_destination_tokens_in_both_registers() {
        let tokens: Value = serde_json::from_str(include_str!(
            "../../../../docs/design/punto-inchiostro/tokens/punto-inchiostro.tokens.json"
        ))
        .unwrap();
        for (dark, register, expected) in [(false, "giorno", 0x5f6878), (true, "grafite", 0x9aa3b0)]
        {
            assert_eq!(Theme::for_dark(dark).pencil, rgb(expected).into());
            assert_eq!(
                tokens["colore"][register]["matita"]["$value"],
                format!("#{expected:06x}")
            );
        }
    }
}
