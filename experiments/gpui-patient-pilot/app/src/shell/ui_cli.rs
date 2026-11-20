use super::*;
use crate::demo_app::ui_cli::{press, run};
use gpui::{Bounds, Focusable, Pixels, VisualTestContext};
use rendered_command::{InputProbe, RenderedControl};
use serde_json::{Value, json};

enum Input {
    Activate(Option<FocusHandle>),
    Keyboard(FocusHandle),
    Text(Entity<TextInput>),
    Scroll(ScrollHandle),
    Observe,
}

struct Control {
    role: &'static str,
    name: String,
    node: gpui::accesskit::Node,
    bounds: Bounds<Pixels>,
    input: Input,
    shared_name: bool,
}

impl Control {
    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        match &self.input {
            Input::Activate(focus) => focus.clone(),
            Input::Keyboard(focus) => Some(focus.clone()),
            Input::Text(editor) => Some(editor.read(cx).focus_handle(cx)),
            Input::Observe | Input::Scroll(_) => None,
        }
    }

    fn focused(&self, window: &Window, cx: &App) -> Option<bool> {
        self.focus_handle(cx).map(|focus| focus.is_focused(window))
    }

    fn describe(&self, window: &Window, cx: &App) -> Value {
        use gpui::accesskit::Action;
        let operations: &[&str] = match self.input {
            Input::Activate(Some(_)) => &["click", "focus", "press", "expect"],
            Input::Activate(None) => &["click", "expect"],
            Input::Keyboard(_) => &["focus", "press", "expect"],
            Input::Text(_) => &["click", "focus", "fill", "press", "expect", "expectValue"],
            Input::Scroll(_) => &["scroll", "expect"],
            Input::Observe => &["expect"],
        };
        let ax_actions: Vec<_> = [
            Action::Click,
            Action::Focus,
            Action::SetValue,
            Action::SetTextSelection,
        ]
        .into_iter()
        .filter(|action| self.node.supports_action(*action))
        .map(|action| format!("{action:?}"))
        .collect();
        let selection = match &self.input {
            Input::Text(editor) => {
                let selection = editor.read(cx).selection();
                Some(json!({"startByte": selection.start, "endByte": selection.end}))
            }
            _ => None,
        };
        json!({"role":self.role, "name":self.name, "id":self.node.author_id(),
               "actions": operations, "accessKitActions": ax_actions,
               "selected":self.node.is_selected(), "expanded":self.node.is_expanded(),
               "enabled": !self.node.is_disabled(),
               "nameSource": if self.shared_name { "shared-button" } else { "accesskit-node" },
               "focused":self.focused(window, cx), "selection":selection,
               "bounds": {
                   "x": f32::from(self.bounds.origin.x), "y": f32::from(self.bounds.origin.y),
                   "width": f32::from(self.bounds.size.width), "height": f32::from(self.bounds.size.height)
               },
               "pointerClipped": self.bounds.is_empty()})
    }
}

fn frame(cx: &mut VisualTestContext) -> (Vec<Control>, Vec<Value>, Vec<Value>) {
    let painted = rendered_command::controls(|| {
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
    });
    let observed_ids = painted
        .observed
        .iter()
        .filter_map(|control| control.node.author_id())
        .collect::<std::collections::BTreeSet<_>>();
    let unobserved = painted
        .shared_buttons
        .iter()
        .filter(|button| !observed_ids.contains(button.id.as_str()));
    let outside_census = unobserved
        .clone()
        .filter(|button| button.label.is_empty())
        .map(|button| {
            json!({"id":button.id,"label":button.label,"enabled":button.enabled,
                             "reason":"accessible-name-not-at-shared-component"})
        })
        .collect();
    let shared_controls = unobserved
        .filter(|button| !button.label.is_empty())
        .map(|button| {
            let mut node = gpui::accesskit::Node::new(Role::Button);
            node.set_author_id(button.id.clone());
            node.set_label(button.label.clone());
            if !button.enabled {
                node.set_disabled();
            }
            let input = if button.enabled {
                Input::Activate(None)
            } else {
                Input::Observe
            };
            Control {
                role: "button",
                name: button.label.clone(),
                node,
                bounds: button.bounds,
                input,
                shared_name: true,
            }
        });
    let mut controls = vec![];
    let mut excluded = vec![];
    for RenderedControl {
        node,
        bounds,
        input: probe,
    } in painted.observed
    {
        let role = match node.role() {
            Role::Button => "button",
            Role::Link => "link",
            Role::Tab => "tab",
            Role::Menu => "menu",
            Role::MenuItem => "menuitem",
            Role::Region => "region",
            Role::Heading => "heading",
            Role::TextInput | Role::MultilineTextInput => "textbox",
            _ => "other",
        };
        let id = node.author_id().unwrap_or_default();
        let name = node.label().unwrap_or_default().to_owned();
        let focus = match &probe {
            Some(InputProbe::Focus(focus)) => Some(focus.clone()),
            _ => None,
        };
        let reason = if bounds.is_empty() && focus.is_none() {
            Some("clipped")
        } else if name.is_empty() {
            Some("unnamed")
        } else if role == "other" {
            Some("unsupported-role")
        } else {
            None
        };
        if let Some(reason) = reason {
            excluded.push(
                json!({"id":id, "role":format!("{:?}",node.role()), "name":name, "reason":reason}),
            );
            continue;
        }
        let input = match role {
            "textbox" => match probe {
                Some(InputProbe::Editor(editor)) => Input::Text(editor),
                _ => {
                    excluded.push(
                        json!({"id":id,"name":name,"role":role,"reason":"editor-not-exposed"}),
                    );
                    continue;
                }
            },
            "region" => match probe {
                Some(InputProbe::Scroll(scroll)) => Input::Scroll(scroll),
                _ => Input::Observe,
            },
            "button" | "link" | "tab" | "menuitem"
                if node.supports_action(gpui::accesskit::Action::Click) =>
            {
                match focus {
                    Some(focus) if bounds.is_empty() => Input::Keyboard(focus),
                    focus => Input::Activate(focus),
                }
            }
            _ => Input::Observe,
        };
        controls.push(Control {
            role,
            name,
            node,
            bounds,
            input,
            shared_name: false,
        });
    }
    controls.extend(shared_controls);
    (controls, excluded, outside_census)
}

fn resolve<'a>(controls: &'a [Control], target: &Value) -> Result<&'a Control, String> {
    let matches = controls
        .iter()
        .filter(|control| {
            if let Some(label) = target["label"].as_str() {
                return control.name == label;
            }
            target["role"] == control.role
                && target["name"] == control.name
                && target["id"]
                    .as_str()
                    .is_none_or(|id| control.node.author_id() == Some(id))
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [control] => Ok(control),
        [] => Err(format!("Controllo assente: {target}")),
        _ => Err(format!("Controllo ambiguo: {target}")),
    }
}

pub(super) fn drive(action: &Value, cx: &mut VisualTestContext) -> Result<Value, String> {
    let op = action["op"].as_str().ok_or("Azione assente.")?;
    let key = || {
        action["key"]
            .as_str()
            .ok_or_else(|| "Tasto assente.".to_owned())
    };
    if op == "resize" {
        return resize(action, cx);
    }
    let (controls, excluded, outside_census) = frame(cx);
    let target = &action["target"];
    if op == "discover" && target.is_null() {
        let mut by_role = BTreeMap::new();
        for control in &controls {
            by_role
                .entry(control.role)
                .and_modify(|count| *count += 1)
                .or_insert(1);
        }
        return Ok(cx.update(|window, cx| {
            json!({ "tree": controls.iter().map(|control| control.describe(window, cx)).collect::<Vec<_>>(),
                    "total": controls.len(), "byRole":by_role, "excluded": excluded,
                    "visibleSharedButtonsOutsideCensus": outside_census,
                    "visibleSharedButtonsOutsideCensusCount": outside_census.len(),
                    "focus": focused_control(&controls, window, cx), "viewport": viewport(window),
                    "accessKit": { "active": window.is_a11y_active(),
                                   "treeAvailable": window.debug_a11y_tree_json().is_some() } })
        }));
    }
    if op == "press" && target.is_null() {
        let before = cx.update(|window, cx| focused_control(&controls, window, cx));
        press(key()?, cx)?;
        notes_recovery_tests::draw(cx);
        let (controls, _, _) = frame(cx);
        let after = cx.update(|window, cx| focused_control(&controls, window, cx));
        return Ok(json!({"focusBefore":before,"focusAfter":after}));
    }
    let control = resolve(&controls, target)?;
    let before = cx.update(|window, cx| control.describe(window, cx));
    let focus_before = cx.update(|window, cx| focused_control(&controls, window, cx));
    match (&control.input, op) {
        (Input::Activate(_) | Input::Text(_), "click") => {
            cx.simulate_click(control.bounds.center(), gpui::Modifiers::default())
        }
        (Input::Activate(Some(focus)) | Input::Keyboard(focus), "press" | "focus") => {
            cx.update(|window, cx| window.focus(focus, cx));
            if op == "press" {
                press(key()?, cx)?;
            }
        }
        (Input::Scroll(scroll), "scroll") => {
            let bounds = control.bounds;
            let before = f32::from(scroll.offset().y);
            cx.simulate_event(gpui::ScrollWheelEvent {
                position: gpui::point(bounds.left() + px(4.), bounds.center().y),
                delta: gpui::ScrollDelta::Pixels(gpui::point(
                    px(0.),
                    px(-action["deltaY"].as_i64().unwrap_or(400) as f32),
                )),
                modifiers: gpui::Modifiers::default(),
                touch_phase: gpui::TouchPhase::Moved,
            });
            notes_recovery_tests::draw(cx);
            let after = f32::from(scroll.offset().y);
            return Ok(
                json!({"role":control.role,"name":control.name,"beforeY":before,"afterY":after,"moved":before!=after}),
            );
        }
        (_, "expect")
            if action["state"] == "visible" && !matches!(control.input, Input::Keyboard(_)) => {}
        (_, "expect") if action["state"] == "enabled" && !control.node.is_disabled() => {}
        (_, "expect")
            if action["state"] == "selected" && control.node.is_selected() == Some(true) => {}
        (_, "expect")
            if action["state"] == "expanded" && control.node.is_expanded() == Some(true) => {}
        (Input::Text(editor), "focus" | "fill" | "press") => {
            cx.update(|window, cx| {
                let focus = gpui::Focusable::focus_handle(editor.read(cx), cx);
                window.focus(&focus, cx);
            });
            if op == "fill" {
                press("ControlOrMeta+A", cx)?;
                cx.simulate_input(action["value"].as_str().ok_or("Testo assente.")?);
            } else if op == "press" {
                press(key()?, cx)?;
            }
        }
        (_, "expect") if action["state"] == "focused" => {
            if !cx.update(|window, cx| control.focused(window, cx) == Some(true)) {
                return Err("Il focus del controllo non è osservato.".into());
            }
        }
        (Input::Text(editor), "expectValue") => {
            if !editor.read_with(cx, |field, _| action["value"] == field.value()) {
                return Err("Il campo contiene un valore diverso.".into());
            }
        }
        _ => return Err(format!("Azione {op} non disponibile su {}.", control.name)),
    }
    if op.starts_with("expect") {
        return Ok(before);
    }
    notes_recovery_tests::draw(cx);
    let (painted, _, _) = frame(cx);
    Ok(cx.update(|window, cx| {
        let mut matching = painted.iter().filter(|other| {
            control.node.author_id().is_some()
                && other.node.author_id() == control.node.author_id()
                && other.role == control.role
        });
        let after = matching.next().filter(|_| matching.next().is_none());
        let mut result = before;
        result["after"] = json!(after.map(|node| node.describe(window, cx)));
        result["focusBefore"] = json!(focus_before);
        result["focusAfter"] = json!(focused_control(&painted, window, cx));
        result
    }))
}

fn focused_control(controls: &[Control], window: &Window, cx: &App) -> Option<Value> {
    controls
        .iter()
        .find(|control| control.focused(window, cx) == Some(true))
        .map(|control| json!({"role":control.role,"name":control.name,"id":control.node.author_id()}))
}

fn viewport(window: &Window) -> Value {
    let size = window.viewport_size();
    json!({"width":f32::from(size.width),"height":f32::from(size.height)})
}

fn resize(action: &Value, cx: &mut VisualTestContext) -> Result<Value, String> {
    let dimension = |name, range: std::ops::RangeInclusive<u64>| {
        action[name]
            .as_u64()
            .filter(|value| range.contains(value))
            .map(|value| value as f32)
            .ok_or_else(|| format!("Dimensione {name} fuori intervallo."))
    };
    let requested = gpui::size(
        px(dimension("width", 280..=3840)?),
        px(dimension("height", 240..=2160)?),
    );
    let (id, before) =
        cx.update(|window, _| (window.window_handle().window_id(), viewport(window)));
    cx.simulate_resize(requested);
    notes_recovery_tests::draw(cx);
    cx.update(|window, _| {
        if window.window_handle().window_id() != id || window.viewport_size() != requested {
            return Err("La finestra di test non ha recepito il ridimensionamento.".into());
        }
        Ok(json!({"windowId":format!("{id:?}"),"previousViewport":before,"viewport":viewport(window)}))
    })
}

const HISTORY_ROUTE: &str = "GET /api/v1/network/patients/patient-a/entries/synthetic-gpui-legacy-entry/revisions?afterVersion=0";

fn shell_fixture(
    cx: &mut gpui::TestAppContext,
) -> (notes_recovery_tests::Host, &mut VisualTestContext) {
    cx.update(|cx| {
        bind_keys(cx);
        crate::text_input::bind_keys(cx);
    });
    let revisions: Value = serde_json::from_str(include_str!(
        "../../../../../e2e/ui-cli/fixtures/gpui-diary-revisions.json"
    ))
    .unwrap();
    let mut diary: Vec<_> = (1..14)
        .map(|index| {
            json!({
                "id": format!("voce-{index}"), "patientId": "patient-a", "type": "visit",
                "title": format!("Voce sintetica {index}"), "date": format!("2026-10-{index:02}"),
                "content": format!("Testo della voce sintetica {index}."), "version": 1
            })
        })
        .collect();
    diary.push(revisions["current"].clone());
    let document = json!({
        "id": "documento-sintetico",
        "patientId": "patient-a",
        "name": "Referto sintetico.txt",
        "path": "referto-sintetico.txt",
        "type": "text/plain",
        "size": 20,
        "summarySnapshot": "Sintesi di collaudo del documento.",
        "data": "data:text/plain;base64,T3JpZ2luYWxlIHNpbnRldGljby4="
    });
    let host =
        notes_recovery_tests::Host::with_diary_and_documents(json!(diary), json!([document]));
    host.plan(HISTORY_ROUTE)
        .send((200, revisions["history"].clone()))
        .unwrap();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    cx.simulate_resize(gpui::size(px(1360.), px(900.)));
    view.update(cx, |app, cx| {
        app.session = Some(host.session.clone());
        app.scope = Some("scope-a".into());
        app.area = Area::Patients;
        app.select_patient("patient-a", true, cx);
    });
    cx.update(|window, _| window.activate_window());
    notes_recovery_tests::draw(cx);
    view.read_with(cx, |app, _| {
        assert_eq!(app.patient.detail.ready().unwrap().last_name, "Sintetica");
        assert_eq!(app.patient.entries.ready().map(Vec::len), Some(14));
    });
    (host, cx)
}

#[gpui::test]
fn shell_ui_cli(cx: &mut gpui::TestAppContext) {
    let (host, cx) = shell_fixture(cx);
    let original_route = "GET /api/v1/network/patients/patient-a/attachments/documento-sintetico";
    let terminal = std::env::var_os("MEDIFLOW_UI_CLI").is_some();
    if !terminal {
        let invalid = json!({"op":"resize", "width":640.5, "height":880});
        assert!(drive(&invalid, cx).is_err());
        assert_eq!(
            cx.update(|window, _| viewport(window)),
            json!({"width":1360.0,"height":900.0})
        );
    }
    run(
        include_str!("../../../../../e2e/ui-cli/gpui-shell.jsonl"),
        |action| {
            let receipt = drive(action, cx)?;
            if !terminal && action["key"] == "Shift+ArrowLeft" {
                assert_eq!(receipt["after"]["focused"], true);
                let selection = &receipt["selection"];
                let end = selection["endByte"].as_u64().unwrap();
                assert_eq!(selection["startByte"], end);
                assert_eq!(
                    receipt["after"]["selection"],
                    json!({"startByte":end-1,"endByte":end})
                );
            }
            Ok(receipt)
        },
    );
    if !terminal {
        assert_eq!(
            host.routes()
                .iter()
                .filter(|route| *route == original_route)
                .count(),
            1
        );
    }
}

#[gpui::test]
fn shell_ui_cli_shared_therapy_button(cx: &mut gpui::TestAppContext) {
    let (_host, cx) = shell_fixture(cx);
    run(
        include_str!("../../../../../e2e/ui-cli/gpui-shell-therapy.jsonl"),
        |action| {
            let receipt = drive(action, cx)?;
            if action["op"] == "click" {
                assert_eq!(receipt["nameSource"], "shared-button");
            }
            Ok(receipt)
        },
    );
}

#[gpui::test]
fn shell_ui_cli_shared_observation_button(cx: &mut gpui::TestAppContext) {
    let (_host, cx) = shell_fixture(cx);
    run(
        include_str!("../../../../../e2e/ui-cli/gpui-shell-observation.jsonl"),
        |action| {
            let receipt = drive(action, cx)?;
            if action["op"] == "click" {
                assert_eq!(receipt["nameSource"], "shared-button");
            }
            Ok(receipt)
        },
    );
}

#[gpui::test]
fn shell_ui_cli_review_returns_without_registering(cx: &mut gpui::TestAppContext) {
    let (host, cx) = shell_fixture(cx);
    run(
        include_str!("../../../../../e2e/ui-cli/gpui-shell-review.jsonl"),
        |action| drive(action, cx),
    );
    assert!(host.routes().iter().all(|route| route.starts_with("GET ")));
}

#[gpui::test]
fn shell_ui_cli_requires_an_id_for_homonymous_buttons(cx: &mut gpui::TestAppContext) {
    let (_host, cx) = shell_fixture(cx);
    drive(
        &json!({"op":"press","target":{"role":"tab","name":"Diario"},"key":"Enter"}),
        cx,
    )
    .unwrap();
    let ambiguous = json!({"op":"click","target":{"role":"button","name":"Copia voce"}});
    assert!(
        drive(&ambiguous, cx)
            .unwrap_err()
            .starts_with("Controllo ambiguo:")
    );
    let copy = json!({"op":"click","target":{"role":"button","name":"Copia voce",
        "id":"clinical-workspace-copy-entry-synthetic-gpui-legacy-entry"}});
    let receipt = drive(&copy, cx).unwrap();
    assert_eq!(receipt["nameSource"], "shared-button");
    let copied = cx.update(|_, cx| cx.read_from_clipboard().and_then(|item| item.text()));
    assert!(copied.unwrap().contains("Nota sintetica con rettifiche"));
}

#[gpui::test]
fn shell_ui_cli_selects_history_in_diary(cx: &mut gpui::TestAppContext) {
    let (_host, cx) = shell_fixture(cx);
    run(
        include_str!("../../../../../e2e/ui-cli/gpui-shell-diary.jsonl"),
        |action| drive(action, cx),
    );
}

#[gpui::test]
fn shell_ui_cli_selects_history_and_returns_to_draft(cx: &mut gpui::TestAppContext) {
    let (_host, cx) = shell_fixture(cx);
    run(
        include_str!("../../../../../e2e/ui-cli/gpui-shell-diary-draft.jsonl"),
        |action| drive(action, cx),
    );
}
