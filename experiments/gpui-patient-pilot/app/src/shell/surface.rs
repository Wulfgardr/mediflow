use super::*;
use gpui::Hsla;
#[cfg(test)]
macro_rules! text {
    ($($args:tt)*) => { crate::shell::rendered_command::observe_ink(gpui::text!($($args)*)) };
}

pub(super) const TRAY_INSET: f32 = 10.;
pub(super) const ISLAND_RADIUS: f32 = 14.;
pub(super) const SEGMENT_RADIUS: f32 = 12.;
pub(super) const PILL_RADIUS: f32 = 8.;
pub(super) const GLYPH_SIZE: f32 = 28.;

fn column(gap: f32) -> Div {
    div().min_w_0().max_w_full().flex().flex_col().gap(px(gap))
}

pub(super) fn tray(theme: Theme) -> Div {
    column(TRAY_INSET)
        .p(px(TRAY_INSET))
        .bg(theme.record.tray)
        .border_1()
        .border_color(theme.record.tray_rule)
        .rounded_t(px(ISLAND_RADIUS + TRAY_INSET))
        .rounded_b(px(ISLAND_RADIUS - 4.))
        .shadow(vec![
            gpui::BoxShadow::new(px(0.), px(1.), theme.record.tray_light).inset(),
            gpui::BoxShadow::new(px(0.), px(-1.), theme.record.tray_shadow)
                .blur_radius(px(2.))
                .inset(),
        ])
}

pub(super) fn island(theme: Theme, compact: bool) -> Div {
    column(10.)
        .p(px(16.))
        .bg(if compact {
            theme.record.compact_island
        } else {
            theme.record.island
        })
        .border_1()
        .border_color(theme.record.island_rule)
        .rounded(px(ISLAND_RADIUS))
}

pub(super) fn island_highlight(theme: Theme, compact: bool) -> Div {
    island(theme, compact)
        .bg(theme.record.change)
        .border_color(theme.record.change_rule)
}

pub(super) fn island_proposal(theme: Theme) -> Div {
    column(10.)
        .p(px(16.))
        .border_1()
        .border_dashed()
        .border_color(theme.record.proposal_rule)
        .rounded(px(ISLAND_RADIUS))
}

pub(super) fn record_heading(
    id: impl Into<SharedString>,
    label: &str,
    count: Option<String>,
    theme: Theme,
    role: crate::theme::TitleRole,
) -> Stateful<Div> {
    let id = id.into();
    div()
        .id(SharedString::from(format!("{id}-row")))
        .min_w_0()
        .flex()
        .flex_wrap()
        .items_baseline()
        .justify_between()
        .gap(px(8.))
        .child(
            div()
                .id(id.clone())
                .accessibility_id(id)
                .role(Role::Heading)
                .aria_label(SharedString::from(label.to_owned()))
                .min_w_0()
                .text_color(theme.ink)
                .child(crate::title::title(label.to_owned(), theme).with_role(role)),
        )
        .when_some(count, |el, count| {
            el.child(
                div()
                    .type_role(theme, crate::theme::TextRole::Meta)
                    .text_color(theme.secondary)
                    .child(text!(count)),
            )
        })
}

pub(super) fn island_title(
    id: &'static str,
    label: &str,
    count: Option<String>,
    theme: Theme,
) -> Stateful<Div> {
    record_heading(
        id,
        label,
        count,
        theme,
        crate::theme::TitleRole::RecordIsland,
    )
}

pub(super) fn glyph(kind: Icon, tint: Option<Hsla>, theme: Theme) -> Div {
    div()
        .size(px(GLYPH_SIZE))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(PILL_RADIUS))
        .bg(tint.map_or(theme.paper, |color| Theme::tint(color, 0.12)))
        .border_1()
        .border_color(tint.map_or(theme.rule, |color| Theme::tint(color, 0.35)))
        .child(icon(kind, tint.unwrap_or(theme.secondary), 15.))
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "testata delle viste GPUI non-Riepilogo, adottata nell'ondata GPUI"
    )
)]
pub(super) fn page_header(
    id: &'static str,
    title: &str,
    meta: Option<String>,
    actions: Div,
    theme: Theme,
) -> Div {
    div()
        .min_w_0()
        .max_w_full()
        .flex()
        .flex_wrap()
        .items_start()
        .justify_between()
        .gap(px(12.))
        .when(theme.scale >= 2.5, |el| el.flex_col().items_stretch())
        .child(
            column(6.)
                .flex_1()
                .child(crate::components::heading_with_role(
                    id,
                    title.to_owned(),
                    theme,
                    crate::theme::TitleRole::RecordPerson,
                ))
                .when_some(meta, |el, meta| {
                    el.child(
                        div()
                            .min_w_0()
                            .whitespace_normal()
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(meta)),
                    )
                }),
        )
        .child(
            actions
                .flex()
                .flex_wrap()
                .items_center()
                .justify_end()
                .gap(px(8.)),
        )
}

pub(super) fn segmented_bar(id: &'static str, label: &'static str, theme: Theme) -> Stateful<Div> {
    div()
        .id(id)
        .accessibility_id(id)
        .role(Role::TabList)
        .aria_label(label)
        .flex()
        .flex_wrap()
        .p(px(4.))
        .gap(px(2.))
        .bg(theme.record.compact_island)
        .border_1()
        .border_color(theme.record.island_rule)
        .rounded(px(SEGMENT_RADIUS))
}

pub(super) fn status_pill(text: impl Into<SharedString>, color: Hsla, theme: Theme) -> Div {
    div()
        .flex_none()
        .px(px(8.))
        .py(px(1.))
        .rounded(px(PILL_RADIUS))
        .bg(theme.sheet.blend(Theme::tint(color, 0.14)))
        .text_color(color)
        .type_role(theme, crate::theme::TextRole::Meta)
        .font_weight(gpui::FontWeight::MEDIUM)
        .child(text!(text.into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geometria_condivisa_con_la_cartella_web() {
        assert_eq!(ISLAND_RADIUS + TRAY_INSET, 24.);
        assert_eq!(SEGMENT_RADIUS, 12.);
        assert_eq!(PILL_RADIUS, 8.);
        assert_eq!(GLYPH_SIZE, 28.);
    }

    #[test]
    fn primitive_costruite_con_i_token_della_cartella() {
        for dark in [false, true] {
            let theme = Theme::for_dark(dark);
            assert_ne!(theme.record.tray, theme.record.island);
            assert_ne!(theme.record.change, theme.record.island);
            let _ = tray(theme).child(island(theme, false).child(island_title(
                "superficie-prova",
                "Isola",
                Some("2".into()),
                theme,
            )));
            let _ = island_highlight(theme, true);
            let _ = island_proposal(theme).child(glyph(
                Icon::Proposal,
                Some(theme.record.proposal_rule),
                theme,
            ));
            let _ = page_header(
                "superficie-prova-titolo",
                "Pagina",
                Some("Dettaglio".into()),
                div(),
                theme,
            );
            let _ = segmented_bar("superficie-prova-schede", "Schede", theme);
            let _ = status_pill("Stato", theme.warning, theme);
        }
    }
}
