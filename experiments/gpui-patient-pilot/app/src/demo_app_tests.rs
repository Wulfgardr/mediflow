use super::*;
use gpui::{Bounds, Element, Fill, Focusable, Pixels, Styled, size};

fn draw(cx: &mut gpui::VisualTestContext) {
    for _ in 0..8 {
        let pending = cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
            window.simulate_next_frame(cx)
        });
        cx.run_until_parked();
        if pending == 0 {
            return;
        }
    }
    panic!("demo rendering did not settle");
}

fn bounds(cx: &mut gpui::VisualTestContext, id: &'static str) -> Bounds<Pixels> {
    cx.debug_bounds(id)
        .unwrap_or_else(|| panic!("missing {id}"))
}

fn contains(outer: Bounds<Pixels>, inner: Bounds<Pixels>, label: &str) {
    assert!(
        inner.left() >= outer.left()
            && inner.right() <= outer.right() + px(1.)
            && inner.top() >= outer.top()
            && inner.bottom() <= outer.bottom() + px(1.),
        "{label}: {inner:?} outside {outer:?}"
    );
}

#[gpui::test]
fn hcg1_demo_confirmation_uses_current_theme_and_one_primary(cx: &mut gpui::TestAppContext) {
    let (view, cx) = cx.add_window_view(PatientApp::new);
    for dark in [false, true] {
        view.update(cx, |app, cx| {
            app.dark = dark;
            app.dark_override = Some(dark);
            app.theme = Theme::for_dark(dark);
            app.workspace
                .edit_notes("Nota sintetica cambiata".into())
                .unwrap();
            app.workspace.review().unwrap();
            let profile = app.workspace.selected().unwrap().clone();
            let mut panel = app.threshold(&profile, cx);
            assert_eq!(panel.style().background, Some(Fill::from(app.theme.paper)));
            assert_eq!(panel.text_style().color, Some(app.theme.ink));
            let mut primary = app.button(
                "test-confirm",
                "Conferma e registra",
                Command::Confirm,
                true,
                true,
                cx,
            );
            let mut secondary = app.button(
                "test-back",
                "Torna alla bozza",
                Command::Cancel,
                false,
                true,
                cx,
            );
            assert_eq!(
                primary.style().background,
                Some(Fill::from(app.theme.fresh))
            );
            assert_eq!(primary.text_style().color, Some(app.theme.paper));
            assert_eq!(
                secondary.style().background,
                Some(Fill::from(app.theme.paper))
            );
            assert_eq!(secondary.text_style().color, Some(app.theme.ink));
            let profile = app.profile(&profile, true, cx);
            let mut node = gpui::accesskit::Node::new(Role::Main);
            profile.write_a11y_info(&mut node);
            assert_eq!(node.label(), Some("Scheda di prova di Moretti Elena"));
            app.workspace.cancel_review().unwrap();
        });
    }
}

#[gpui::test]
fn hcg1_demo_geometry_keeps_list_filters_and_confirmation_reachable(cx: &mut gpui::TestAppContext) {
    let (view, cx) = cx.add_window_view(PatientApp::new);
    for dark in [false, true] {
        for width in [390., 420., 700., 760., 800., 1200.] {
            let height = if width == 390. { 640. } else { 840. };
            cx.simulate_resize(size(px(width), px(height)));
            view.update(cx, |app, cx| {
                app.dark_override = Some(dark);
                app.show_list = true;
                cx.notify();
            });
            draw(cx);
            let viewport = Bounds::new(gpui::point(px(0.), px(0.)), size(px(width), px(height)));
            let list = bounds(cx, "clinical-workspace-patient-list");
            let sidebar = bounds(cx, "clinical-workspace-worklist");
            contains(viewport, sidebar, "sidebar");
            contains(
                sidebar,
                bounds(cx, "clinical-workspace-archive"),
                "archive filter",
            );
            contains(
                sidebar,
                bounds(cx, "clinical-workspace-active"),
                "active filter",
            );
            assert!(
                list.size.height >= px(44.),
                "{width}: list collapsed: {list:?}"
            );
            contains(viewport, list, "patient list");
            let search = bounds(cx, "demo-search");
            assert!(
                search.size.height <= px(60.),
                "{width}: search wrapped: {search:?}"
            );
            view.update(cx, |app, cx| {
                app.select_patient("prova-001", cx);
                app.workspace
                    .edit_notes("Nota sintetica cambiata".into())
                    .unwrap();
                app.workspace.review().unwrap();
                cx.notify();
            });
            draw(cx);
            let bar = bounds(cx, "clinical-workspace-save-status");
            let content = bounds(cx, "clinical-workspace-profile-scroll");
            contains(viewport, bar, "confirmation");
            contains(
                bounds(cx, "demo-profile"),
                bar,
                "confirmation inside profile",
            );
            assert!(
                content.size.height >= px(72.),
                "{width}: content collapsed: {content:?}"
            );
            assert!(
                content.bottom() <= bar.top() + px(1.),
                "{width}: content overlaps threshold"
            );
            for id in [
                "clinical-workspace-cancel-review",
                "clinical-workspace-confirm-save",
            ] {
                contains(bar, bounds(cx, id), id);
            }
            if width < 1000. {
                let back = bounds(cx, "clinical-workspace-back-list");
                contains(viewport, back, "back to list");
                cx.simulate_click(back.center(), gpui::Modifiers::default());
                draw(cx);
                assert!(bounds(cx, "clinical-workspace-patient-list").size.height >= px(44.));
            }
            view.update(cx, |app, cx| {
                app.workspace.cancel_review().unwrap();
                let request = app.workspace.discard_and_reload().unwrap();
                app.read(request, cx);
            });
            eprintln!(
                "HC-G1 theme={dark} width={width} list={list:?} content={content:?} threshold={bar:?}"
            );
        }
    }
}

#[gpui::test]
fn hcg1_demo_keyboard_search_reveals_the_patient_list(cx: &mut gpui::TestAppContext) {
    cx.update(bind_keys);
    let (view, cx) = cx.add_window_view(PatientApp::new);
    cx.simulate_resize(size(px(390.), px(640.)));
    view.update(cx, |app, cx| app.select_patient("prova-001", cx));
    draw(cx);
    assert!(cx.debug_bounds("clinical-workspace-patient-list").is_none());
    cx.simulate_keystrokes(if cfg!(target_os = "macos") {
        "cmd-k"
    } else {
        "ctrl-k"
    });
    draw(cx);
    assert!(bounds(cx, "clinical-workspace-patient-list").size.height >= px(44.));
    cx.update(|window, cx| {
        assert!(
            view.read(cx)
                .search
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
    });
}
