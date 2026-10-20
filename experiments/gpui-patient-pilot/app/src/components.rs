//! Small shared GPUI controls, following the existing product's words and tokens.

use crate::theme::Theme;
use crate::theme::{TypeRole, TypeStyle};
use gpui::{
    Div, Image, ImageFormat, Img, Role, SharedString, Stateful, div, img, prelude::*, px, text,
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
        .px(px(12.))
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
                .focus(move |style| {
                    style
                        .border_color(if primary { theme.ink } else { theme.fresh })
                        .border_2()
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
        .text_color(if selected { theme.ink } else { theme.secondary })
        .bg(if selected { theme.paper } else { theme.shade })
        .border_b_2()
        .border_color(if selected { theme.fresh } else { theme.shade })
        .focus(move |style| style.border_color(theme.fresh).bg(theme.selected))
        .child(control_label(label.into()))
}

/// Text needs an allocated flex width of its own. Limiting only its parent
/// leaves a direct Text child at intrinsic width, clipping enlarged labels.
fn control_label(label: SharedString) -> Div {
    div()
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
        .text_color(if error {
            theme.critical
        } else {
            theme.secondary
        })
        .type_role(theme, TypeRole::Body)
        .child(text!(message))
}

pub fn brand_icon(dark: bool, size: f32) -> Img {
    static DAY: OnceLock<Arc<Image>> = OnceLock::new();
    static NIGHT: OnceLock<Arc<Image>> = OnceLock::new();
    let image = if dark {
        NIGHT.get_or_init(|| {
            Arc::new(Image::from_bytes(
                ImageFormat::Svg,
                include_bytes!("../../../../public/brand/mediflow/punto-grafite.svg").to_vec(),
            ))
        })
    } else {
        DAY.get_or_init(|| {
            Arc::new(Image::from_bytes(
                ImageFormat::Svg,
                include_bytes!("../../../../public/brand/mediflow/punto-giorno.svg").to_vec(),
            ))
        })
    };
    img(image.clone()).w(px(size)).h(px(size)).flex_shrink_0()
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
impl WritingInk {
    pub fn word(self) -> &'static str {
        match self {
            Self::Pencil => "Proposta",
            Self::Fresh => "Bozza non registrata",
            Self::Dry => "Registrata",
        }
    }
    fn color(self, theme: Theme) -> gpui::Hsla {
        match self {
            Self::Pencil => theme.pencil,
            Self::Fresh => theme.fresh,
            Self::Dry => theme.ink,
        }
    }
}
pub fn writing_status(id: impl Into<SharedString>, ink: WritingInk, theme: Theme) -> Stateful<Div> {
    let id = id.into();
    let color = ink.color(theme);

    div()
        .id(id.clone())
        .accessibility_id(id)
        .role(Role::Status)
        .aria_label(ink.word())
        .flex()
        .items_center()
        .gap(px(8.))
        .type_role(theme, TypeRole::Meta)
        .text_color(color)
        .child(writing_dot(ink, theme))
        .child(writing_word(ink, theme))
}

fn writing_word(ink: WritingInk, theme: Theme) -> Stateful<Div> {
    div()
        .id("writing-ink-word")
        .child(text!(ink.word()))
        .when(ink == WritingInk::Pencil, |el| {
            el.pb(px(4.))
                .border_b_1()
                .border_dashed()
                .border_color(theme.pencil)
        })
}

fn writing_dot(ink: WritingInk, theme: Theme) -> Stateful<Div> {
    let color = ink.color(theme);
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
                    let mut status = writing_status("writing-test", ink, theme);
                    let mut node = gpui::accesskit::Node::new(Role::Status);
                    Element::write_a11y_info(&status, &mut node);
                    assert_eq!(node.label(), Some(word));
                    assert_eq!(status.text_style().color, Some(color));
                    let mut word_element = writing_word(ink, theme);
                    let word_style = word_element.style();
                    if hollow {
                        assert_eq!(word_style.border_style, Some(BorderStyle::Dashed));
                        assert_eq!(word_style.border_widths.bottom, Some(px(1.).into()));
                        assert_eq!(word_style.padding.bottom, Some(px(4.).into()));
                        assert_eq!(word_style.border_color, Some(color));
                    } else {
                        assert_eq!(word_style.border_widths.bottom, None);
                    }
                    let mut dot = writing_dot(ink, theme);
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
