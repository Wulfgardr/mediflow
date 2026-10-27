//! Small shared GPUI controls, following the existing product's words and tokens.

use crate::theme::Theme;
use crate::theme::{TypeRole, TypeStyle};
use gpui::{
    Div, Image, ImageFormat, Img, RenderImage, Role, SharedString, Stateful, SvgRenderer, div, img,
    prelude::*, px, text,
};
use std::sync::{Arc, OnceLock};

pub fn button(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    theme: Theme,
    primary: bool,
    enabled: bool,
) -> Stateful<Div> {
    let id = id.into();
    let label = label.into();
    div()
        .id(id.clone())
        .accessibility_id(id)
        .role(Role::Button)
        .aria_label(label.clone())
        .focusable()
        .tab_stop(enabled)
        .a11y_synthetic_children(move |builder| {
            if !enabled {
                builder.parent_node().set_disabled();
            }
        })
        .min_w_0()
        .max_w_full()
        .min_h(px(44.))
        .px(px(14.))
        .py(px(8.))
        .flex()
        .items_center()
        .justify_center()
        .type_role(theme, TypeRole::Strong)
        .rounded(px(theme.control_radius))
        .border_1()
        .border_color(if primary && enabled {
            theme.fresh
        } else {
            theme.strong_rule
        })
        .bg(if primary && enabled {
            theme.fresh
        } else if !enabled {
            theme.shade
        } else {
            theme.paper
        })
        .text_color(if !enabled {
            theme.secondary
        } else if primary {
            theme.paper
        } else {
            theme.ink
        })
        .when(enabled, |el| {
            el.cursor_pointer()
                .hover(move |style| style.bg(if primary { theme.fresh } else { theme.hover }))
                .active(move |style| style.bg(if primary { theme.ink } else { theme.selected }))
                .focus(move |style| {
                    style
                        .border_color(if primary { theme.ink } else { theme.fresh })
                        .shadow(vec![theme.focus_ring(primary)])
                })
        })
        .when(!label.is_empty(), |el| el.child(control_label(label)))
}

pub fn tab(id: &'static str, label: &'static str, selected: bool, theme: Theme) -> Stateful<Div> {
    div()
        .id(id)
        .accessibility_id(id)
        .role(Role::Tab)
        .aria_label(label)
        .aria_selected(selected)
        .focusable()
        .tab_stop(true)
        .cursor_pointer()
        .min_w_0()
        .max_w_full()
        .min_h(px(44.))
        .px(px(12.))
        .py(px(8.))
        .flex()
        .items_center()
        .justify_center()
        .type_role(
            theme,
            if selected {
                TypeRole::Strong
            } else {
                TypeRole::Body
            },
        )
        .rounded(px(theme.control_radius))
        .text_color(if selected {
            theme.fresh
        } else {
            theme.secondary
        })
        .bg(if selected {
            theme.selected
        } else {
            theme.shade
        })
        .border_2()
        .border_color(if selected {
            theme.selected
        } else {
            theme.shade
        })
        .hover(move |style| {
            style.bg(if selected {
                theme.selected
            } else {
                theme.hover
            })
        })
        .focus(move |style| style.border_color(theme.fresh).bg(theme.selected))
        .child(control_label(label.into()))
}

/// Text needs an allocated flex width of its own. Limiting only its parent
/// leaves a direct Text child at intrinsic width, clipping enlarged labels.
fn control_label(label: SharedString) -> Div {
    div()
        .map(|el| {
            #[cfg(test)]
            {
                let label = label.clone();
                el.debug_selector(move || format!("control-label:{label}"))
            }
            #[cfg(not(test))]
            {
                el
            }
        })
        .flex_auto()
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .text_center()
        .child(text!(label))
}

pub fn heading(id: &'static str, label: impl Into<SharedString>, theme: Theme) -> Stateful<Div> {
    let label = label.into();
    div()
        .id(id)
        .accessibility_id(id)
        .role(Role::Heading)
        .aria_label(label.clone())
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .type_role(theme, TypeRole::PageTitle)
        .text_color(theme.ink)
        .child(text!(label))
}

pub fn confirmation_heading(question: String, theme: Theme) -> Stateful<Div> {
    let words: Vec<_> = question.split_inclusive(' ').map(str::to_owned).collect();
    let last = words.len().saturating_sub(1);
    div()
        .id("clinical-workspace-confirm-question")
        .debug_selector(|| "threshold-question".into())
        .role(Role::Heading)
        .aria_label(question)
        .type_role(theme, TypeRole::Threshold)
        .flex()
        .flex_wrap()
        .children(words.into_iter().enumerate().map(|(index, word)| {
            let mut unit = div().max_w_full().flex_shrink_0();
            if index == last && word.ends_with('?') {
                let before_mark = &word[..word.len() - 1];
                let ending_start = before_mark.char_indices().next_back().map_or(0, |(i, _)| i);
                unit = unit
                    .debug_selector(|| "threshold-question-last-word".into())
                    .flex()
                    .flex_wrap()
                    .child(div().max_w_full().flex_shrink_0().child(
                        text!(&word[..ending_start]).with_id("threshold-question-last-prefix"),
                    ))
                    .child(
                        div()
                            .whitespace_nowrap()
                            .flex_shrink_0()
                            .debug_selector(|| "threshold-question-ending".into())
                            .child(
                                text!(&word[ending_start..])
                                    .with_id("threshold-question-last-ending"),
                            ),
                    );
            } else {
                unit = unit.child(text!(word).with_id(("threshold-question-word", index)));
            }
            unit
        }))
}

pub fn section(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    theme: Theme,
) -> Stateful<Div> {
    let id = id.into();
    let label: SharedString = theme.role(TypeRole::Section).label(label.into()).into();
    div()
        .id(id.clone())
        .accessibility_id(id)
        .role(Role::Heading)
        .aria_label(label.clone())
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .type_role(theme, TypeRole::Section)
        .text_color(theme.secondary)
        .pb(px(8.))
        .child(text!(label))
}

pub fn notice(
    id: impl Into<SharedString>,
    message: impl Into<SharedString>,
    theme: Theme,
    error: bool,
) -> Stateful<Div> {
    let id = id.into();
    let message = message.into();
    div()
        .id(id.clone())
        .accessibility_id(id)
        .role(if error { Role::Alert } else { Role::Status })
        .aria_label(message.clone())
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .px(px(16.))
        .py(px(12.))
        .border_1()
        .border_color(if error {
            theme.critical
        } else {
            theme.strong_rule
        })
        .bg(theme.paper)
        .rounded(px(theme.control_radius))
        .text_color(if error {
            theme.critical
        } else {
            theme.secondary
        })
        .type_role(theme, TypeRole::Body)
        .child(text!(message))
}

fn brand_render_image(dark: bool) -> &'static Arc<RenderImage> {
    static DAY: OnceLock<Arc<RenderImage>> = OnceLock::new();
    static NIGHT: OnceLock<Arc<RenderImage>> = OnceLock::new();
    let (cache, bytes): (_, &[u8]) = if dark {
        (
            &NIGHT,
            include_bytes!("../../../../public/brand/mediflow/punto-grafite.svg"),
        )
    } else {
        (
            &DAY,
            include_bytes!("../../../../public/brand/mediflow/punto-giorno.svg"),
        )
    };
    cache.get_or_init(|| {
        Image::from_bytes(ImageFormat::Svg, bytes.to_vec())
            .to_image_data(SvgRenderer::new(Arc::new(())))
            .expect("embedded MediFlow brand must decode")
    })
}

pub fn verify_bundled_brand_assets() -> serde_json::Value {
    for dark in [false, true] {
        let image = brand_render_image(dark);
        let pixels = image.as_bytes(0).expect("brand must have a frame");
        let circle = if dark {
            [239, 236, 233, 255]
        } else {
            [26, 22, 20, 255]
        };
        assert!(
            pixels.as_chunks::<4>().0.contains(&circle),
            "embedded brand must render its ink circle"
        );
    }
    serde_json::json!({"brand_assets": ["punto-giorno.svg", "punto-grafite.svg"], "decoded": true})
}

pub fn brand_icon(dark: bool, size: f32) -> Img {
    img(brand_render_image(dark).clone())
        .w(px(size))
        .h(px(size))
        .flex_shrink_0()
}

/// Copy/export uses the same clinical parser as the rich renderer. Meaningful
/// formatting is represented explicitly in plain text instead of being erased.
pub fn plain_text(source: &str) -> String {
    crate::clinical_text::plain_text(source)
}

pub fn display_date(value: Option<&str>) -> String {
    match value {
        Some(value)
            if value.len() >= 10
                && value.is_ascii()
                && value.as_bytes()[4] == b'-'
                && value.as_bytes()[7] == b'-' =>
        {
            format!("{}/{}/{}", &value[8..10], &value[5..7], &value[..4])
        }
        Some(value) if !value.trim().is_empty() => value.to_owned(),
        _ => "Non indicata".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_brand_assets_decode_in_both_themes() {
        assert_eq!(verify_bundled_brand_assets()["decoded"], true);
    }

    #[gpui::test]
    fn brand_is_painted_on_first_frame(cx: &mut gpui::TestAppContext) {
        struct BrandView(bool);
        impl gpui::Render for BrandView {
            fn render(
                &mut self,
                _: &mut gpui::Window,
                _: &mut gpui::Context<Self>,
            ) -> impl IntoElement {
                brand_icon(self.0, 28.)
            }
        }
        for dark in [false, true] {
            let window = cx.add_empty_window();
            let view = window.update(|_, cx| cx.new(|_| BrandView(dark)));
            window.draw(
                gpui::point(px(0.), px(0.)),
                gpui::size(px(64.), px(64.)),
                |_, _| view.into_any_element(),
            );
            window.update(|window, _| {
                assert!(
                    window.has_image_atlas_entry(brand_render_image(dark)),
                    "brand must be painted without waiting for async asset loading"
                );
            });
        }
    }

    #[test]
    fn clinical_reading_keeps_paragraphs_and_does_not_render_markup() {
        assert_eq!(
            plain_text("<p>È già qui &amp; sta bene.</p><p>Seconda riga<br>Terza.</p>"),
            "È già qui & sta bene.\nSeconda riga\nTerza."
        );
        assert_eq!(plain_text("Nota in chiaro"), "Nota in chiaro");
        assert_eq!(
            plain_text("PCR <5; 4 < x > 2; saturazione >95%"),
            "PCR <5; 4 < x > 2; saturazione >95%"
        );
        assert_eq!(
            plain_text("<p>Pressione <140/90.</p>"),
            "Pressione <140/90."
        );
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WritingInk {
    Pencil,
    Fresh,
    Dry,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WritingSurface {
    Plane,
    Threshold,
}

impl WritingInk {
    pub fn word(self) -> &'static str {
        match self {
            Self::Pencil => "Proposta",
            Self::Fresh => "Bozza non registrata",
            Self::Dry => "Registrata",
        }
    }
    pub fn color(self, surface: WritingSurface, theme: Theme) -> gpui::Hsla {
        if surface == WritingSurface::Threshold {
            return theme.threshold_text;
        }
        match self {
            Self::Pencil => theme.pencil,
            Self::Fresh => theme.fresh,
            Self::Dry => theme.ink,
        }
    }
}
pub fn writing_status(
    id: impl Into<SharedString>,
    ink: WritingInk,
    surface: WritingSurface,
    theme: Theme,
) -> Stateful<Div> {
    let id = id.into();
    let color = ink.color(surface, theme);

    div()
        .id(id.clone())
        .accessibility_id(id)
        .role(Role::Status)
        .aria_label(ink.word())
        .min_w_0()
        .max_w_full()
        .flex()
        .items_center()
        .gap(px(8.))
        .type_role(theme, TypeRole::Meta)
        .text_color(color)
        .child(writing_dot(ink, surface, theme))
        .child(writing_word(ink, surface, theme))
}

pub trait WritingStyle: Styled + Sized {
    fn writing_ink(self, ink: WritingInk, surface: WritingSurface, theme: Theme) -> Self {
        let element = self.text_color(ink.color(surface, theme));
        if ink == WritingInk::Pencil {
            element
                .w_auto()
                .flex_none()
                .max_w_full()
                .pb(px(4.))
                .border_b_1()
                .border_dashed()
                .border_color(ink.color(surface, theme))
        } else {
            element
        }
    }
}
impl<T: Styled> WritingStyle for T {}

pub fn number_line(
    id: &'static str,
    prefix: &str,
    number: impl Into<SharedString>,
    suffix: &str,
    theme: Theme,
) -> Stateful<Div> {
    let number = number.into();
    div()
        .id(id)
        .accessibility_id(id)
        .role(Role::Status)
        .aria_label(format!("{prefix}{number}{suffix}"))
        .debug_selector(move || id.to_owned())
        .min_w_0()
        .flex()
        .flex_row()
        .items_baseline()
        .gap(px(4.))
        .type_role(theme, TypeRole::Body)
        .text_color(theme.ink)
        .when(!prefix.is_empty(), |element| {
            element.child(
                div()
                    .debug_selector(move || format!("{id}-meaning"))
                    .child(text!(prefix.trim().to_owned())),
            )
        })
        .child(
            div()
                .debug_selector(move || format!("{id}-number"))
                .flex_shrink_0()
                .type_role(theme, TypeRole::Threshold)
                .child(text!(number)),
        )
        .when(!suffix.is_empty(), |element| {
            element.child(
                div()
                    .min_w_0()
                    .debug_selector(move || format!("{id}-meaning"))
                    .child(text!(suffix.trim().to_owned())),
            )
        })
}

fn writing_word(ink: WritingInk, surface: WritingSurface, theme: Theme) -> Stateful<Div> {
    div()
        .id("writing-ink-word")
        .flex_1()
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .text_color(ink.color(surface, theme))
        .child(text!(ink.word()))
        .when(ink == WritingInk::Pencil, |el| {
            el.pb(px(4.))
                .border_b_1()
                .border_dashed()
                .border_color(ink.color(surface, theme))
        })
}

fn writing_dot(ink: WritingInk, surface: WritingSurface, theme: Theme) -> Stateful<Div> {
    let color = ink.color(surface, theme);
    let diameter = theme.role(TypeRole::Meta).size * 0.44;
    div()
        .id("writing-ink-dot")
        .w(px(diameter))
        .h(px(diameter))
        .flex_shrink_0()
        .rounded_full()
        .when(ink == WritingInk::Pencil, |el| {
            el.border(px(1.5)).border_color(color)
        })
        .when(ink != WritingInk::Pencil, |el| el.bg(color))
}

#[cfg(test)]
mod writing_tests {
    use super::*;
    use gpui::{BorderStyle, Element, Fill};

    #[test]
    fn number_and_meaning_share_a_body_row_and_accessible_sentence() {
        for dark in [false, true] {
            let theme = Theme::for_dark(dark);
            for (id, prefix, number, suffix, sentence) in [
                (
                    "population-test",
                    "",
                    "142",
                    " schede attive tra 0 e 120 anni",
                    "142 schede attive tra 0 e 120 anni",
                ),
                ("score-test", "Punteggio ", "4", "", "Punteggio 4"),
            ] {
                let mut row = number_line(id, prefix, number, suffix, theme);
                let mut node = gpui::accesskit::Node::new(Role::Status);
                Element::write_a11y_info(&row, &mut node);
                assert_eq!(node.label(), Some(sentence));
                assert_eq!(row.text_style().font_weight, Some(gpui::FontWeight::NORMAL));
                assert_eq!(
                    row.text_style().color,
                    Some(gpui::rgb(if dark { 0xe9ecef } else { 0x14161a }).into())
                );
                assert_eq!(row.style().flex_direction, Some(gpui::FlexDirection::Row));
            }
        }
    }

    #[test]
    fn threshold_inks_keep_readable_words_dots_and_content_with_distinct_shapes() {
        fn luminance(hex: u32) -> f64 {
            let linear = |shift: u32| {
                let channel = f64::from((hex >> shift) & 0xff_u32) / 255.;
                if channel <= 0.04045 {
                    channel / 12.92
                } else {
                    ((channel + 0.055) / 1.055).powf(2.4)
                }
            };
            0.2126 * linear(16) + 0.7152 * linear(8) + 0.0722 * linear(0)
        }
        for (dark, foreground, background) in
            [(false, 0xffffff, 0x14161a), (true, 0x14161a, 0xe9ecef)]
        {
            for scale in [1., 2.] {
                let theme = Theme::for_dark(dark).sized(scale, false);
                let color = gpui::rgb(foreground).into();
                assert_eq!(theme.threshold_text, color);
                let first = luminance(foreground);
                let second = luminance(background);
                let contrast = (first.max(second) + 0.05) / (first.min(second) + 0.05);
                assert!(contrast >= 4.5, "threshold contrast: {contrast}");
                for (ink, word, hollow) in [
                    (WritingInk::Pencil, "Proposta", true),
                    (WritingInk::Fresh, "Bozza non registrata", false),
                    (WritingInk::Dry, "Registrata", false),
                ] {
                    let surface = WritingSurface::Threshold;
                    let mut status = writing_status("threshold-test", ink, surface, theme);
                    let mut node = gpui::accesskit::Node::new(Role::Status);
                    Element::write_a11y_info(&status, &mut node);
                    assert_eq!(node.label(), Some(word));
                    assert_eq!(status.text_style().color, Some(color));
                    let mut word_element = writing_word(ink, surface, theme);
                    assert_eq!(word_element.text_style().color, Some(color));
                    let mut content = div().writing_ink(ink, surface, theme);
                    assert_eq!(content.text_style().color, Some(color));
                    for style in [word_element.style(), content.style()] {
                        if hollow {
                            assert_eq!(style.border_style, Some(BorderStyle::Dashed));
                            assert_eq!(style.border_widths.bottom, Some(px(1.).into()));
                            assert_eq!(style.border_color, Some(color));
                            assert_eq!(style.padding.bottom, Some(px(4.).into()));
                        } else {
                            assert_eq!(style.border_style, None);
                            assert_eq!(style.border_widths.bottom, None);
                        }
                    }
                    let mut dot = writing_dot(ink, surface, theme);
                    assert_eq!(Element::a11y_role(&dot), None);
                    let style = dot.style();
                    assert_eq!(style.size.width, style.size.height);
                    assert_eq!(style.corner_radii.top_left, Some(px(9999.).into()));
                    assert_eq!(style.corner_radii.top_right, Some(px(9999.).into()));
                    assert_eq!(style.corner_radii.bottom_left, Some(px(9999.).into()));
                    assert_eq!(style.corner_radii.bottom_right, Some(px(9999.).into()));
                    if hollow {
                        assert_eq!(style.background, None);
                        assert_eq!(style.border_color, Some(color));
                        assert_eq!(style.border_widths.top, Some(px(1.5).into()));
                        assert_eq!(style.border_widths.right, Some(px(1.5).into()));
                        assert_eq!(style.border_widths.bottom, Some(px(1.5).into()));
                        assert_eq!(style.border_widths.left, Some(px(1.5).into()));
                    } else {
                        assert_eq!(style.background, Some(Fill::from(color)));
                        assert_eq!(style.border_widths.top, None);
                        assert_eq!(style.border_widths.right, None);
                        assert_eq!(style.border_widths.bottom, None);
                        assert_eq!(style.border_widths.left, None);
                    }
                }
            }
        }
    }

    #[test]
    fn words_and_dot_shapes_are_explicit_in_both_registers_at_both_scales() {
        for dark in [false, true] {
            for scale in [1., 2.] {
                let theme = Theme::for_dark(dark).sized(scale, false);
                for (ink, word, hollow, color) in [
                    (WritingInk::Pencil, "Proposta", true, theme.pencil),
                    (
                        WritingInk::Fresh,
                        "Bozza non registrata",
                        false,
                        theme.fresh,
                    ),
                    (WritingInk::Dry, "Registrata", false, theme.ink),
                ] {
                    let surface = WritingSurface::Plane;
                    let mut status = writing_status("writing-test", ink, surface, theme);
                    let mut node = gpui::accesskit::Node::new(Role::Status);
                    Element::write_a11y_info(&status, &mut node);
                    assert_eq!(node.label(), Some(word));
                    assert_eq!(status.text_style().color, Some(color));
                    let mut word_element = writing_word(ink, surface, theme);
                    let word_style = word_element.style();
                    if hollow {
                        assert_eq!(word_style.border_style, Some(BorderStyle::Dashed));
                        assert_eq!(word_style.border_widths.bottom, Some(px(1.).into()));
                        assert_eq!(word_style.padding.bottom, Some(px(4.).into()));
                        assert_eq!(word_style.border_color, Some(color));
                    } else {
                        assert_eq!(word_style.border_widths.bottom, None);
                    }
                    let mut dot = writing_dot(ink, surface, theme);
                    assert_eq!(Element::a11y_role(&dot), None, "the dot is decorative");
                    let style = dot.style();
                    assert_eq!(style.corner_radii.top_left, Some(px(9999.).into()));
                    assert_eq!(style.corner_radii.top_right, Some(px(9999.).into()));
                    assert_eq!(style.corner_radii.bottom_left, Some(px(9999.).into()));
                    assert_eq!(style.corner_radii.bottom_right, Some(px(9999.).into()));
                    assert_eq!(style.size.width, style.size.height);
                    if hollow {
                        assert_eq!(style.background, None);
                        assert_eq!(style.border_widths.top, Some(px(1.5).into()));
                        assert_eq!(style.border_widths.right, Some(px(1.5).into()));
                        assert_eq!(style.border_widths.bottom, Some(px(1.5).into()));
                        assert_eq!(style.border_widths.left, Some(px(1.5).into()));
                        assert_eq!(style.border_color, Some(color));
                    } else {
                        assert_eq!(style.background, Some(Fill::from(color)));
                        assert_eq!(style.border_widths.top, None);
                    }
                }
            }
        }
    }
}
