//! Small shared GPUI controls, following the existing product's words and tokens.

use crate::theme::{Theme, VOICE};
use gpui::{
    Div, FontWeight, Image, ImageFormat, Img, Role, SharedString, Stateful, div, img, prelude::*,
    px, text,
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
        .text_size(px(theme.body()))
        .font_weight(FontWeight::SEMIBOLD)
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
        .text_size(px(theme.body()))
        .font_weight(if selected {
            FontWeight::SEMIBOLD
        } else {
            FontWeight::NORMAL
        })
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
        .font_family(VOICE)
        .text_size(px(theme.size(26.)))
        .font_weight(FontWeight::NORMAL)
        .text_color(theme.ink)
        .child(text!(label))
}

pub fn section(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    theme: Theme,
) -> Stateful<Div> {
    let id = id.into();
    let label = label.into();
    div()
        .id(id.clone())
        .accessibility_id(id)
        .role(Role::Heading)
        .aria_label(label.clone())
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .text_size(px(theme.size(12.)))
        .font_weight(FontWeight::SEMIBOLD)
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
        .text_size(px(theme.body()))
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
