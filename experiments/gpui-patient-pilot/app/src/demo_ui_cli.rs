use super::*;
use gpui::{VisualTestContext, size};
use serde_json::{Value, json};
use std::io::{BufRead, Write};

struct Control {
    id: &'static str,
    role: &'static str,
    name: String,
}

fn controls(view: &Entity<PatientApp>, cx: &mut VisualTestContext) -> Vec<Control> {
    let mut controls = view.read_with(cx, |app, _| {
        let rows = [
            "demo-patient-row-0",
            "demo-patient-row-1",
            "demo-patient-row-2",
            "demo-patient-row-3",
            "demo-patient-row-4",
        ];
        let mut result: Vec<_> = app
            .patients()
            .iter()
            .zip(rows)
            .map(|(patient, id)| Control {
                id,
                role: "button",
                name: format!(
                    "Apri la scheda di {}",
                    crate::title::TitleText::name(patient.display_name()).text()
                ),
            })
            .collect();
        if let Some(patient) = app.workspace.selected() {
            result.push(Control {
                id: "demo-profile",
                role: "main",
                name: format!(
                    "Scheda di prova di {}",
                    crate::title::TitleText::name(patient.display_name()).text()
                ),
            });
        }
        result
    });
    controls.extend(
        [
            ("demo-search", "textbox", "Cerca pazienti di prova"),
            (
                "clinical-workspace-notes-editor-scroll",
                "textbox",
                "Note della scheda",
            ),
            (
                "clinical-workspace-review-save",
                "button",
                "Registra 1 elemento",
            ),
            (
                "clinical-workspace-cancel-review",
                "button",
                "Torna alla bozza",
            ),
        ]
        .map(|(id, role, name)| Control {
            id,
            role,
            name: name.to_owned(),
        }),
    );
    controls.retain(|item| cx.debug_bounds(item.id).is_some());
    controls
}

fn resolve<'a>(controls: &'a [Control], target: &Value) -> Result<&'a Control, String> {
    if !target.is_object() {
        return Err("Il renderer GPUI accetta un singolo ruolo/nome o label.".into());
    }
    let mut matches = controls.iter().filter(|control| {
        if let Some(label) = target["label"].as_str() {
            return control.name == label;
        }
        target["role"] == control.role
            && target["name"] == control.name
            && target["id"].as_str().is_none_or(|id| control.id == id)
    });
    let found = matches.next().ok_or("Controllo assente.")?;
    if matches.next().is_some() {
        return Err("Controllo ambiguo.".into());
    }
    Ok(found)
}

fn focus_handle(
    control: &Control,
    view: &Entity<PatientApp>,
    cx: &mut VisualTestContext,
) -> Result<FocusHandle, String> {
    view.read_with(cx, |app, cx| match control.id {
        "demo-search" => Some(app.search.read(cx).focus_handle(cx)),
        "clinical-workspace-notes-editor-scroll" => Some(app.notes.read(cx).focus_handle(cx)),
        id => app.profile_targets.get(id).map(|(focus, _)| focus.clone()),
    })
    .ok_or_else(|| "Controllo senza focus osservabile dal banco.".into())
}

fn focused(control: &Control, view: &Entity<PatientApp>, cx: &mut VisualTestContext) -> bool {
    focus_handle(control, view, cx)
        .is_ok_and(|focus| cx.update(|window, _| focus.is_focused(window)))
}

pub(crate) fn press(key: &str, cx: &mut VisualTestContext) -> Result<(), String> {
    let mut parts: Vec<_> = key.split('+').collect();
    let key = parts.pop().ok_or("Tasto assente.")?;
    let key = match key {
        "ArrowUp" => "up",
        "ArrowDown" => "down",
        "ArrowLeft" => "left",
        "ArrowRight" => "right",
        key => key,
    };
    let mut chord = Vec::new();
    for modifier in parts {
        chord.push(match modifier {
            "Shift" => "shift",
            "Alt" => "alt",
            "Meta" => "cmd",
            "Control" => "ctrl",
            "ControlOrMeta" if cfg!(target_os = "macos") => "cmd",
            "ControlOrMeta" => "ctrl",
            _ => return Err("Modificatore sconosciuto.".into()),
        });
    }
    let key = key.to_ascii_lowercase();
    chord.push(&key);
    let chord = chord.join("-");
    let keystroke = gpui::Keystroke::parse(&chord).map_err(|error| error.to_string())?;
    cx.simulate_keystrokes(&chord);
    cx.simulate_event(gpui::KeyUpEvent { keystroke });
    Ok(())
}

fn drive(
    action: &Value,
    view: &Entity<PatientApp>,
    cx: &mut VisualTestContext,
) -> Result<Value, String> {
    let op = action["op"].as_str().ok_or("Azione assente.")?;
    let available = controls(view, cx);
    let target = &action["target"];
    if op == "discover" && target.is_null() {
        return Ok(json!({ "tree": available.iter().map(|control|
            json!({"role": control.role, "name": control.name, "id": control.id, "focused": focused(control, view, cx)})
        ).collect::<Vec<_>>() }));
    }
    if op == "press" && target.is_null() {
        press(action["key"].as_str().ok_or("Tasto assente.")?, cx)?;
        return Ok(json!({}));
    }
    let control = resolve(&available, target)?;
    match op {
        "click" if control.role == "button" => {
            let point = cx
                .debug_bounds(control.id)
                .ok_or("Controllo assente.")?
                .center();
            let viewport = cx.update(|window, _| window.visual_viewport_bounds());
            if !viewport.contains(&point) {
                return Err("Controllo fuori dalla finestra simulata.".into());
            }
            cx.simulate_click(point, gpui::Modifiers::default());
        }
        "focus" | "fill" | "press" => {
            let focus = focus_handle(control, view, cx)?;
            cx.update(|window, cx| window.focus(&focus, cx));
            if op == "fill" {
                if control.role != "textbox" {
                    return Err("Il controllo non è un campo di testo.".into());
                }
                press("ControlOrMeta+A", cx)?;
                cx.simulate_input(action["value"].as_str().ok_or("Testo assente.")?);
            } else if op == "press" {
                press(action["key"].as_str().ok_or("Tasto assente.")?, cx)?;
            }
        }
        "expect" if action["state"] == "visible" => {}
        "expect" if action["state"] == "focused" && focused(control, view, cx) => {}
        "expectValue" | "expectText" => {
            let matched = view.read_with(cx, |app, cx| {
                let field = match control.id {
                    "demo-search" => &app.search,
                    "clinical-workspace-notes-editor-scroll" => &app.notes,
                    _ => return false,
                };
                action["value"] == field.read(cx).value()
            });
            if !matched {
                return Err("Il contenuto atteso non corrisponde.".into());
            }
        }
        _ => {
            return Err(format!(
                "Azione {op} non disponibile per questo controllo del renderer GPUI."
            ));
        }
    }
    Ok(json!({"role": control.role, "name": control.name}))
}

fn emit(message: Value) {
    println!("MEDIFLOW_UI_CLI {message}");
    std::io::stdout().flush().unwrap();
}

pub(crate) fn run(fixture: &'static str, mut action: impl FnMut(&Value) -> Result<Value, String>) {
    let cli = std::env::var_os("MEDIFLOW_UI_CLI").is_some();
    let stdin = std::io::stdin();
    let input: Box<dyn BufRead> = if cli {
        emit(json!({"ok": true, "revision": option_env!("MEDIFLOW_UI_CLI_REVISION")}));
        Box::new(stdin.lock())
    } else {
        Box::new(fixture.as_bytes())
    };
    for line in input.lines() {
        let action_json = serde_json::from_str::<Value>(&line.unwrap()).expect("Riga JSON valida");
        match action(&action_json) {
            Ok(result) => {
                if cli {
                    emit(json!({"ok": true, "data": result}));
                }
            }
            Err(error) => {
                if cli {
                    emit(json!({"ok": false, "error": error}));
                }
                panic!("{error}");
            }
        }
    }
}

#[gpui::test]
fn demo_ui_cli(cx: &mut gpui::TestAppContext) {
    cx.update(|cx| {
        bind_keys(cx);
        crate::text_input::bind_keys(cx);
    });
    let (view, cx) = cx.add_window_view(PatientApp::new);
    cx.simulate_resize(size(px(1280.), px(900.)));
    cx.update(|window, _| window.activate_window());
    super::tests::draw(cx);
    run(
        include_str!("../../../../e2e/ui-cli/gpui-demo.jsonl"),
        |action| {
            let result = drive(action, &view, cx)?;
            super::tests::draw(cx);
            Ok(result)
        },
    );
}
