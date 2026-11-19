use super::*;
use crate::demo_app::ui_cli::{press, run};
use gpui::{Bounds, Pixels, VisualTestContext};
use serde_json::{Value, json};

enum Input {
    Activate(Bounds<Pixels>, Option<FocusHandle>),
    Keyboard(FocusHandle),
    Text(Entity<TextInput>),
    Scroll(Bounds<Pixels>, ScrollHandle),
    Observe,
}

struct Control {
    role: &'static str,
    name: String,
    node: gpui::accesskit::Node,
    input: Input,
}

impl Control {
    fn describe(&self) -> Value {
        use gpui::accesskit::Action;
        let operations: &[&str] = match self.input {
            Input::Activate(_, Some(_)) => &["click", "focus", "press", "expect"],
            Input::Activate(_, None) => &["click", "expect"],
            Input::Keyboard(_) => &["focus", "press", "expect"],
            Input::Text(_) => &["focus", "fill", "press", "expect", "expectValue"],
            Input::Scroll(_, _) => &["scroll", "expect"],
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
        json!({"role":self.role, "name":self.name, "id":self.node.author_id(),
               "actions": operations, "accessKitActions": ax_actions,
               "selected":self.node.is_selected(), "expanded":self.node.is_expanded(),
               "pointerClipped": matches!(self.input, Input::Keyboard(_))})
    }
}

fn frame(view: &Entity<ClinicalApp>, cx: &mut VisualTestContext) -> (Vec<Control>, Vec<Value>) {
    let painted = rendered_command::controls(|| {
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
    });
    view.read_with(cx, |app, cx| {
        let mut controls = vec![];
        let mut excluded = vec![];
        for (node, bounds) in painted {
            let role = match node.role() {
                Role::Button => "button",
                Role::Link => "link",
                Role::Tab => "tab",
                Role::Menu => "menu",
                Role::MenuItem => "menuitem",
                Role::Region => "region",
                Role::TextInput | Role::MultilineTextInput => "textbox",
                _ => "other",
            };
            let id = node.author_id().unwrap_or_default();
            let name = node.label().unwrap_or_default().to_owned();
            let focus = if id == "threshold-other-actions" {
                Some(app.threshold_menu_focus.clone())
            } else {
                PatientSection::ALL.iter().position(|section| section.id() == id)
                    .map(|index| app.ui_cli_section_focus[index].clone())
            };
            let reason = if bounds.is_empty() && focus.is_none() { Some("clipped") }
                else if name.is_empty() { Some("unnamed") }
                else if role == "other" { Some("unsupported-role") }
                else { None };
            if let Some(reason) = reason {
                excluded.push(json!({"id":id, "role":format!("{:?}",node.role()), "name":name, "reason":reason}));
                continue;
            }
            let editor = app.form.as_ref().and_then(|form| form.fields.iter().find(|field|
                field.editor.read(cx).test_accessibility_id() == id && !field.read_only));
            let input = match role {
                "textbox" => match editor {
                    Some(field) => Input::Text(field.editor.clone()),
                    None => {
                        excluded.push(json!({"id":id,"name":name,"role":role,"reason":"outside-editor"}));
                        continue;
                    }
                },
                "region" if id == "clinical-record-changed" =>
                    Input::Scroll(bounds, app.patient.record.diary_scroll_probe.clone()),
                "button" | "link" | "tab" | "menuitem" if node.supports_action(gpui::accesskit::Action::Click) => {
                    match focus {
                        Some(focus) if bounds.is_empty() => Input::Keyboard(focus),
                        focus => Input::Activate(bounds, focus),
                    }
                }
                _ => Input::Observe,
            };
            controls.push(Control { role, name, node, input });
        }
        (controls, excluded)
    })
}

fn resolve<'a>(controls: &'a [Control], target: &Value) -> Result<&'a Control, String> {
    let matches = controls
        .iter()
        .filter(|control| {
            if let Some(label) = target["label"].as_str() {
                return control.name == label;
            }
            target["role"] == control.role && target["name"] == control.name
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [control] => Ok(control),
        [] => Err(format!("Controllo assente: {target}")),
        _ => Err(format!("Controllo ambiguo: {target}")),
    }
}

pub(super) fn drive(
    action: &Value,
    view: &Entity<ClinicalApp>,
    cx: &mut VisualTestContext,
) -> Result<Value, String> {
    let op = action["op"].as_str().ok_or("Azione assente.")?;
    let key = || {
        action["key"]
            .as_str()
            .ok_or_else(|| "Tasto assente.".to_owned())
    };
    let (controls, excluded) = frame(view, cx);
    let target = &action["target"];
    if op == "discover" && target.is_null() {
        let mut by_role = BTreeMap::new();
        for control in &controls {
            by_role
                .entry(control.role)
                .and_modify(|count| *count += 1)
                .or_insert(1);
        }
        return Ok(
            json!({ "tree": controls.iter().map(Control::describe).collect::<Vec<_>>(),
                          "total": controls.len(), "byRole":by_role, "excluded": excluded }),
        );
    }
    if op == "press" && target.is_null() {
        press(key()?, cx)?;
        return Ok(json!({}));
    }
    let control = resolve(&controls, target)?;
    match (&control.input, op) {
        (Input::Activate(bounds, _), "click") => {
            cx.simulate_click(bounds.center(), gpui::Modifiers::default())
        }
        (Input::Activate(_, Some(focus)) | Input::Keyboard(focus), "press" | "focus") => {
            cx.update(|window, cx| window.focus(focus, cx));
            if op == "press" {
                press(key()?, cx)?;
            }
        }
        (Input::Scroll(bounds, scroll), "scroll") => {
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
        (Input::Text(editor), "expect") if action["state"] == "focused" => {
            if !cx.update(|window, cx| {
                gpui::Focusable::focus_handle(editor.read(cx), cx).is_focused(window)
            }) {
                return Err("Il campo non ha il focus.".into());
            }
        }
        (Input::Text(editor), "expectValue") => {
            if !editor.read_with(cx, |field, _| action["value"] == field.value()) {
                return Err("Il campo contiene un valore diverso.".into());
            }
        }
        _ => return Err(format!("Azione {op} non disponibile su {}.", control.name)),
    }
    Ok(control.describe())
}

#[gpui::test]
fn shell_ui_cli(cx: &mut gpui::TestAppContext) {
    cx.update(|cx| {
        bind_keys(cx);
        crate::text_input::bind_keys(cx);
    });
    let diary: Vec<_> = (1..=14)
        .map(|index| {
            json!({
                "id": format!("voce-{index}"), "patientId": "patient-a", "type": "visit",
                "title": format!("Voce sintetica {index}"), "date": format!("2026-10-{index:02}"),
                "content": format!("Testo della voce sintetica {index}."), "version": 1
            })
        })
        .collect();
    let host = notes_recovery_tests::Host::with_diary(json!(diary));
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
    run(
        include_str!("../../../../../e2e/ui-cli/gpui-shell.jsonl"),
        |action| {
            let result = drive(action, &view, cx)?;
            notes_recovery_tests::draw(cx);
            Ok(result)
        },
    );
}
