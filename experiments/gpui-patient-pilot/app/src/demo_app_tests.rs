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
        for _ in 0..7 {
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
fn hcg2_theme_segments_stay_present(cx: &mut gpui::TestAppContext) {
    let (view, cx) = cx.add_window_view(PatientApp::new);
    for width in [390., 800., 1200.] {
        cx.simulate_resize(size(px(width), px(840.)));
        for appearance in [None, Some(false), Some(true)] {
            view.update(cx, |app, cx| {
                app.dark_override = appearance;
                cx.notify();
            });
            draw(cx);
            let mut right = px(0.);
            for id in [
                "clinical-workspace-system-theme",
                "clinical-workspace-day-theme",
                "clinical-workspace-night-theme",
            ] {
                let segment = bounds(cx, id);
                assert!(segment.left() >= right);
                assert!(segment.right() <= px(width));
                right = segment.right();
            }
        }
    }
}

#[gpui::test]
fn hcg2_clean_shortcut_has_no_command_or_layout_shift(cx: &mut gpui::TestAppContext) {
    cx.update(bind_keys);
    let (view, cx) = cx.add_window_view(PatientApp::new);
    for width in [390., 800., 1200.] {
        for dark in [false, true] {
            cx.simulate_resize(size(px(width), px(840.)));
            view.update(cx, |app, cx| {
                app.select_patient("prova-001", cx);
                app.dark_override = Some(dark);
                cx.notify();
            });
            draw(cx);
            let before = [
                bounds(cx, "demo-profile"),
                bounds(cx, "clinical-workspace-profile-scroll"),
                bounds(cx, "clinical-workspace-save-status"),
            ];
            cx.simulate_keystrokes(if cfg!(target_os = "macos") {
                "cmd-enter"
            } else {
                "ctrl-enter"
            });
            draw(cx);
            let after = [
                bounds(cx, "demo-profile"),
                bounds(cx, "clinical-workspace-profile-scroll"),
                bounds(cx, "clinical-workspace-save-status"),
            ];
            eprintln!("HC-G2 {width} dark={dark} before={before:?} after={after:?}");
            assert_eq!(before, after, "empty save must not move the layout");
            assert!(
                cx.debug_bounds("clinical-workspace-review-save").is_none(),
                "no save command without a draft"
            );
            view.read_with(cx, |app, _| {
                assert_eq!(
                    app.message.as_deref(),
                    Some("Nessuna modifica da registrare.")
                )
            });
        }
    }
}

#[gpui::test]
fn hcg2_container_and_text_axes_are_distinct(cx: &mut gpui::TestAppContext) {
    let (view, cx) = cx.add_window_view(PatientApp::new);
    for width in [390., 800., 1200.] {
        for dark in [false, true] {
            cx.simulate_resize(size(px(width), px(840.)));
            view.update(cx, |app, cx| {
                app.show_list = true;
                app.dark_override = Some(dark);
                cx.notify();
            });
            draw(cx);
            let search = bounds(cx, "demo-search");
            for id in [
                "demo-brand",
                "demo-list-title",
                "demo-filters",
                "demo-patient-row-0",
            ] {
                assert_eq!(
                    bounds(cx, id).left(),
                    search.left(),
                    "container {id} at {width}/{dark}"
                );
            }
            let row = bounds(cx, "demo-patient-row-0");
            assert_eq!(row.right(), search.right());
            let text = view.read_with(cx, |app, cx| app.search.read(cx).text_bounds().unwrap());
            let name = bounds(cx, "demo-patient-name-0");
            assert!(text.left() > search.left());
            assert_eq!(name.left(), text.left(), "text axis at {width}/{dark}");
            if let Some(note) = cx.debug_bounds("demo-patient-note-0") {
                assert_eq!(row.right() - note.right(), text.left() - search.left());
            }
            eprintln!(
                "HC-G2 axes {width}/{dark}: edge={:?}, text={:?}, right inset={:?}",
                search.left(),
                text.left(),
                row.right() - name.right()
            );
        }
    }
}

#[gpui::test]
fn hcg2_focus_registry_is_stable_across_starts(cx: &mut gpui::TestAppContext) {
    for _ in 0..12 {
        let (view, cx) = cx.add_window_view(PatientApp::new);
        view.read_with(cx, |app, _| {
            let order: Vec<_> = app.profile_targets.keys().copied().collect();
            let mut expected = vec![
                "clinical-workspace-reread",
                "clinical-workspace-copy-profile",
                "clinical-workspace-copy-notes",
                "clinical-workspace-show-scenarios",
                "clinical-workspace-scenario-normal",
                "clinical-workspace-scenario-conflict",
                "clinical-workspace-scenario-rejected",
                "clinical-workspace-scenario-uncertain",
                "clinical-workspace-scenario-read",
            ];
            expected.sort();
            assert_eq!(order, expected);
        });
    }
}

#[gpui::test]
fn hcg2_theme_segments_expose_selection(cx: &mut gpui::TestAppContext) {
    let (view, cx) = cx.add_window_view(PatientApp::new);
    for value in [None, Some(false), Some(true)] {
        view.update(cx, |app, cx| {
            app.dark_override = value;
            cx.notify();
        });
        draw(cx);
        view.read_with(cx, |app, _| {
            for (choice, id, label) in crate::components::APPEARANCE_CHOICES {
                let segment = crate::components::appearance_segment(
                    choice,
                    app.dark_override,
                    id,
                    label,
                    app.theme,
                );
                let mut node = gpui::accesskit::Node::new(Role::Tab);
                segment.write_a11y_info(&mut node);
                assert_eq!(node.label(), Some(label));
                assert_eq!(node.is_selected(), Some(choice == value));
            }
        });
        for (choice, id, _) in crate::components::APPEARANCE_CHOICES {
            let target = bounds(cx, id).center();
            cx.simulate_click(target, gpui::Modifiers::default());
            draw(cx);
            view.read_with(cx, |app, _| assert_eq!(app.dark_override, choice));
        }
    }
}

#[gpui::test]
fn hcg2_tab_sequence_repeats_on_fresh_windows(cx: &mut gpui::TestAppContext) {
    cx.update(bind_keys);
    for _ in 0..12 {
        let (view, cx) = cx.add_window_view(PatientApp::new);
        cx.simulate_resize(size(px(390.), px(840.)));
        view.update(cx, |app, cx| {
            app.select_patient("prova-001", cx);
            cx.notify();
        });
        cx.update(|window, cx| {
            window.activate_window();
            let focus = view.read(cx).root_focus.clone();
            window.focus(&focus, cx);
        });
        draw(cx);
        for _ in 0..6 {
            cx.simulate_keystrokes("tab");
            draw(cx);
        }
        for id in [
            "clinical-workspace-reread",
            "clinical-workspace-copy-profile",
            "clinical-workspace-copy-notes",
            "notes",
            "clinical-workspace-show-scenarios",
        ] {
            if id != "clinical-workspace-reread" {
                cx.simulate_keystrokes("tab");
                draw(cx);
            }
            cx.update(|window, cx| {
                let app = view.read(cx);
                let focus = if id == "notes" {
                    app.notes.read(cx).focus_handle(cx)
                } else {
                    app.profile_targets[id].0.clone()
                };
                assert!(focus.is_focused(window), "fresh launch Tab reaches {id}");
            });
        }
    }
}

#[gpui::test]
fn hcg2_saved_shortcut_keeps_the_reserved_status_height(cx: &mut gpui::TestAppContext) {
    cx.update(bind_keys);
    let (view, cx) = cx.add_window_view(PatientApp::new);
    for width in [390., 800., 1200.] {
        for dark in [false, true] {
            cx.simulate_resize(size(px(width), px(840.)));
            view.update(cx, |app, cx| {
                app.select_patient("prova-001", cx);
                app.dark_override = Some(dark);
                app.workspace
                    .edit_notes(format!("Nota sintetica {width} {dark}"))
                    .unwrap();
                app.workspace.review().unwrap();
            });
            cx.update(|window, cx| view.update(cx, |app, cx| app.confirm(window, cx)));
            draw(cx);
            view.read_with(cx, |app, _| assert_eq!(app.workspace.phase(), Phase::Saved));
            let before = [
                bounds(cx, "demo-profile"),
                bounds(cx, "clinical-workspace-profile-scroll"),
                bounds(cx, "clinical-workspace-save-status"),
            ];
            cx.simulate_keystrokes(if cfg!(target_os = "macos") {
                "cmd-enter"
            } else {
                "ctrl-enter"
            });
            draw(cx);
            let after = [
                bounds(cx, "demo-profile"),
                bounds(cx, "clinical-workspace-profile-scroll"),
                bounds(cx, "clinical-workspace-save-status"),
            ];
            eprintln!("HC-G2 saved {width} dark={dark} before={before:?} after={after:?}");
            assert_eq!(before, after);
            assert!(cx.debug_bounds("clinical-workspace-review-save").is_none());
        }
    }
}

#[gpui::test]
fn hcg2_hide_shares_a_header_row(cx: &mut gpui::TestAppContext) {
    let (view, cx) = cx.add_window_view(PatientApp::new);
    for width in [390., 800., 1200.] {
        for dark in [false, true] {
            for show_list in [true, false] {
                cx.simulate_resize(size(px(width), px(840.)));
                view.update(cx, |app, cx| {
                    app.show_list = show_list;
                    app.dark_override = Some(dark);
                    cx.notify();
                });
                draw(cx);
                let hide = bounds(cx, "clinical-workspace-hide");
                let brand = bounds(cx, "demo-brand");
                let theme = bounds(cx, "clinical-workspace-day-theme");
                assert!(
                    (hide.top() < brand.bottom() && hide.bottom() > brand.top())
                        || (hide.top() == theme.top() && hide.bottom() == theme.bottom()),
                    "hide must share brand or segments row at {width}/{dark}/{show_list}: {hide:?}, {brand:?}, {theme:?}"
                );
            }
        }
    }
}

struct AppearanceProbe {
    theme: Theme,
    focus: FocusHandle,
    style: std::rc::Rc<std::cell::RefCell<Option<gpui::Style>>>,
}
impl Render for AppearanceProbe {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let theme = self.theme;
        let focus = self.focus.clone();
        let result = self.style.clone();
        gpui::canvas(
            move |_, window, cx| {
                let mut segment = crate::components::appearance_segment(
                    Some(false),
                    Some(false),
                    "focus-test",
                    "Giorno",
                    theme,
                )
                .track_focus(&focus);
                *result.borrow_mut() = Some(
                    segment
                        .interactivity()
                        .compute_style(None, None, window, cx),
                );
            },
            |_, _, _, _| {},
        )
        .size_full()
    }
}

#[gpui::test]
fn hcg2_appearance_has_track_fill_and_keyboard_only_ring(cx: &mut gpui::TestAppContext) {
    for dark in [false, true] {
        let theme = Theme::for_dark(dark);
        let result = std::rc::Rc::new(std::cell::RefCell::new(None));
        let (view, cx) = cx.add_window_view(|_, cx| AppearanceProbe {
            theme,
            focus: cx.focus_handle(),
            style: result.clone(),
        });
        cx.simulate_click(gpui::point(px(1.), px(1.)), gpui::Modifiers::default());
        cx.update(|window, cx| {
            let focus = view.read(cx).focus.clone();
            window.focus(&focus, cx);
        });
        draw(cx);
        {
            let style = result.borrow();
            let pointer = style.as_ref().unwrap();
            assert_eq!(pointer.background, Some(Fill::from(theme.paper)));
            assert_ne!(
                pointer.border_color,
                Some(theme.fresh),
                "pointer focus must not draw keyboard ring"
            );
        }
        cx.simulate_keystrokes("tab");
        cx.update(|window, cx| {
            let focus = view.read(cx).focus.clone();
            window.focus(&focus, cx);
        });
        draw(cx);
        let style = result.borrow();
        let keyboard = style.as_ref().unwrap();
        assert_eq!(
            keyboard.background,
            Some(Fill::from(theme.paper)),
            "keyboard focus keeps selection fill"
        );
        assert_eq!(keyboard.border_color, Some(theme.fresh));
    }
}

#[gpui::test]
fn hcg2_theme_track_is_visible(cx: &mut gpui::TestAppContext) {
    let (view, cx) = cx.add_window_view(PatientApp::new);
    for dark in [false, true] {
        view.update(cx, |app, cx| {
            app.theme = Theme::for_dark(dark);
            let mut track = app.appearance(cx);
            assert_eq!(track.style().border_color, Some(app.theme.strong_rule));
            assert_eq!(track.style().background, Some(Fill::from(app.theme.shade)));
        });
    }
}
