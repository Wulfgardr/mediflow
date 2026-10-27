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
            let question = bounds(cx, "threshold-question");
            let ending = bounds(cx, "threshold-question-ending");
            let last_word = bounds(cx, "threshold-question-last-word");
            assert_eq!(last_word.bottom(), question.bottom());
            assert_eq!(ending.bottom(), last_word.bottom());
            assert!(
                last_word.size.width > ending.size.width,
                "punctuation stays with the recipient"
            );
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

fn tabbed_profile_controls(cx: &mut gpui::TestAppContext, width: f32, height: f32) {
    cx.update(bind_keys);
    let (view, cx) = cx.add_window_view(PatientApp::new);
    cx.simulate_resize(size(px(width), px(height)));
    cx.update(|window, _| window.activate_window());
    for dark in [false, true] {
        view.update(cx, |app, cx| {
            app.select_patient("prova-001", cx);
            app.dark_override = Some(dark);
            app.workspace
                .edit_notes("Nota sintetica cambiata".into())
                .unwrap();
            app.workspace.review().unwrap();
            cx.notify();
        });
        draw(cx);
        cx.update(|window, cx| {
            let focus = view.read(cx).root_focus.clone();
            window.focus(&focus, cx);
        });
        for _ in 0..6 {
            cx.simulate_keystrokes("tab");
            draw(cx);
        }
        for id in [
            "clinical-workspace-copy-notes",
            "clinical-workspace-notes-editor-scroll",
            "clinical-workspace-show-scenarios",
        ] {
            cx.simulate_keystrokes("tab");
            draw(cx);
            cx.update(|window, cx| {
                let app = view.read(cx);
                let focus = if id == "clinical-workspace-notes-editor-scroll" {
                    app.notes.read(cx).focus_handle(cx)
                } else {
                    app.profile_targets[id].0.clone()
                };
                assert!(focus.is_focused(window), "Tab reaches {id}");
            });
            let scroll = bounds(cx, "clinical-workspace-profile-scroll");
            let control = bounds(cx, id);
            contains(scroll, control, id);
            let bar = bounds(cx, "clinical-workspace-save-status");
            assert!(control.bottom() <= bar.top());
            assert!(px(height) - control.bottom() >= bar.size.height);
            eprintln!("focus theme={dark} {width}x{height} {id}={control:?} viewport={scroll:?}");
        }
        cx.simulate_keystrokes("shift-tab");
        draw(cx);
        contains(
            bounds(cx, "clinical-workspace-profile-scroll"),
            bounds(cx, "clinical-workspace-notes-editor-scroll"),
            "reverse Tab editor",
        );
        let target = bounds(cx, "clinical-workspace-cancel-review").center();
        cx.simulate_click(target, gpui::Modifiers::default());
        draw(cx);
        cx.update(|window, cx| {
            assert!(
                view.read(cx)
                    .notes
                    .read(cx)
                    .focus_handle(cx)
                    .is_focused(window)
            )
        });
        contains(
            bounds(cx, "clinical-workspace-profile-scroll"),
            bounds(cx, "clinical-workspace-notes-editor-scroll"),
            "return to draft editor",
        );
        cx.simulate_keystrokes("tab");
        draw(cx);
        let toggle = bounds(cx, "clinical-workspace-show-scenarios").center();
        cx.simulate_click(toggle, gpui::Modifiers::default());
        draw(cx);
        for id in [
            "clinical-workspace-scenario-normal",
            "clinical-workspace-scenario-conflict",
            "clinical-workspace-scenario-rejected",
            "clinical-workspace-scenario-uncertain",
            "clinical-workspace-scenario-read",
        ] {
            cx.simulate_keystrokes("tab");
            draw(cx);
            cx.update(|window, cx| {
                assert!(
                    view.read(cx).profile_targets[id].0.is_focused(window),
                    "Tab reaches {id}"
                )
            });
            contains(
                bounds(cx, "clinical-workspace-profile-scroll"),
                bounds(cx, id),
                id,
            );
        }
        view.update(cx, |app, cx| {
            app.show_scenarios = false;
            let request = app.workspace.discard_and_reload().unwrap();
            app.read(request, cx);
            cx.notify();
        });
        draw(cx);
    }
}

#[gpui::test]
fn hcg1_focus_reveals_last_profile_controls_390(cx: &mut gpui::TestAppContext) {
    tabbed_profile_controls(cx, 390., 640.);
}

#[gpui::test]
fn hcg1_focus_reveals_last_profile_controls_760(cx: &mut gpui::TestAppContext) {
    tabbed_profile_controls(cx, 760., 840.);
}

#[gpui::test]
fn hcg1_theme_names_current_state_and_preserves_toggle(cx: &mut gpui::TestAppContext) {
    let (view, cx) = cx.add_window_view(PatientApp::new);
    for (dark, label) in [
        (false, "Tema Giorno, passa a Grafite"),
        (true, "Tema Grafite, passa a Giorno"),
    ] {
        view.update(cx, |app, cx| {
            app.dark_override = Some(dark);
            cx.notify();
        });
        draw(cx);
        view.update(cx, |app, cx| {
            assert_eq!(
                app.theme_label(),
                if dark {
                    "Tema: Grafite"
                } else {
                    "Tema: Giorno"
                }
            );
            let button = app.theme_button(cx);
            let mut node = gpui::accesskit::Node::new(Role::Button);
            button.write_a11y_info(&mut node);
            assert_eq!(node.label(), Some(label));
        });
        let target = bounds(cx, "clinical-workspace-theme").center();
        cx.simulate_click(target, gpui::Modifiers::default());
        draw(cx);
        view.read_with(cx, |app, _| {
            assert_eq!(app.dark, !dark);
            assert_eq!(app.dark_override, Some(!dark));
        });
    }
}
