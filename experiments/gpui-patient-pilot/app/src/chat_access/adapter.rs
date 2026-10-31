use super::{native, owner::OPERATION};
use serde_json::{Value, json};
use std::{
    io::{self, BufRead, BufReader, Read, Write},
    os::unix::net::UnixStream,
    path::Path,
    time::Duration,
};

const URI: &str = "ui://mediflow-native-chat-access/access";
const OPEN: &str = "mediflow_native_access_open";
const CONTROL: &str = "mediflow_native_access";
const FIXED: &str = "Apri la vista MediFlow per richiedere accesso nella finestra nativa. La scheda sintetica richiede consenso nativo sui byte finali.";
const HTML: &str = include_str!("../../../../../lib/chat-card/native-access.html");

fn call(stream: &mut UnixStream, command: &str) -> io::Result<Value> {
    if native::capture(stream, false).is_none() {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    let value = if command == "request" {
        json!({"command": command, "operation": OPERATION})
    } else if let Some(id) = command.strip_prefix("receipt-") {
        json!({"command":"receipt", "commandId":id})
    } else if let Some(target) = command.strip_prefix("therapy-") {
        json!({"command":"therapy", "target":target})
    } else {
        json!({"command": command})
    };
    writeln!(stream, "{value}")?;
    let mut bytes = Vec::new();
    BufReader::new(Read::take(&mut *stream, 65_537)).read_until(b'\n', &mut bytes)?;
    let value: Value = serde_json::from_slice(&bytes)?;
    let state = value["status"].as_str().filter(|s| {
        [
            "requested",
            "document-opened",
            "voice-opened",
            "preparing",
            "challenge",
            "approving",
            "approved",
            "consuming",
            "consumed",
            "withdrawn",
            "uncertain",
            "retired",
            "applied",
            "rejected",
            "closed",
        ]
        .contains(s)
    });
    let fields = value.as_object().map(|v| v.len());
    let has_payload = value.get("payload").is_some();
    let has_receipt = value.get("receipt").is_some();
    if bytes.len() > 65_536
        || state.is_none()
        || (!has_payload && !has_receipt && fields != Some(1))
        || (has_receipt
            && (fields != Some(2)
                || value["receipt"].as_object().map(|v| v.len()) != Some(2)
                || !value["receipt"]["commandId"].as_str().is_some_and(|id| {
                    id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
                })
                || !value["receipt"]["outcome"].as_str().is_some_and(|s| {
                    [
                        "pending", "unknown", "applied", "rejected", "closed", "retired",
                    ]
                    .contains(&s)
                })))
        || (has_payload
            && (command != "consume"
                || state != Some("consumed")
                || fields != Some(2)
                || !value["payload"].is_string()))
    {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok(value)
}

pub(crate) fn run_stdio(path: &Path) -> io::Result<()> {
    if !cfg!(target_os = "macos") {
        return Err(io::ErrorKind::Unsupported.into());
    }
    let mut socket = UnixStream::connect(path)?;
    socket.set_read_timeout(Some(Duration::from_secs(10)))?;
    socket.set_write_timeout(Some(Duration::from_secs(2)))?;
    if native::capture(&socket, false).is_none() {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    let mut issued = false;
    let mut attached = false;
    let mut reader = BufReader::new(io::stdin());
    let mut stdout = io::stdout().lock();
    loop {
        let mut bytes = Vec::new();
        let count = Read::take(&mut reader, 16_385).read_until(b'\n', &mut bytes)?;
        if count == 0 {
            break;
        }
        if count > 16_384 || bytes.last() != Some(&b'\n') {
            break;
        }
        let Ok(request) = serde_json::from_slice::<Value>(&bytes) else {
            break;
        };
        if request["jsonrpc"] != "2.0" {
            break;
        }
        let method = request["method"].as_str().unwrap_or("");
        let Some(id) = request.get("id").cloned() else {
            continue;
        };
        let params = &request["params"];
        let result = match method {
            "initialize" => {
                json!({"protocolVersion":"2025-11-25", "capabilities":{"tools":{}, "resources":{}},
                "serverInfo":{"name":"mediflow-native-chat-access", "version":"0.1.0"}})
            }
            "ping" => json!({}),
            "tools/list" => json!({"tools":[
                {"name": OPEN, "description": FIXED, "inputSchema":{"type":"object","properties":{},"additionalProperties":false},
                    "annotations":{"readOnlyHint":true,"destructiveHint":false,"openWorldHint":false},
                    "_meta":{"ui":{"resourceUri":URI,"visibility":["model"]}}},
                {"name": CONTROL, "description":"Scheda sintetica monouso dopo consenso nella GPUI; payload riservato alla vista.",
                    "inputSchema":{"type":"object","properties":{"command":{"type":"string","enum":["attach","request","status","consume","revoke","therapy-active","therapy-suspended","therapy-completed","patient-document","local-voice","receipt"]},"commandId":{"type":"string","pattern":"^[0-9a-f-]{36}$"}},"required":["command"],"additionalProperties":false},
                    "annotations":{"readOnlyHint":false,"destructiveHint":true,"openWorldHint":false},
                    "_meta":{"ui":{"resourceUri":URI,"visibility":["app"]}}}]}),
            "resources/list" => {
                json!({"resources":[{"uri":URI,"name":"MediFlow: accesso nativo","mimeType":"text/html;profile=mcp-app"}]})
            }
            "resources/templates/list" => json!({"resourceTemplates":[]}),
            "resources/read" if params["uri"] == URI && !issued => {
                issued = true;
                json!({"contents":[{"uri":URI,"mimeType":"text/html;profile=mcp-app","text":HTML,
                    "_meta":{"ui":{"csp":{"connectDomains":[],"resourceDomains":[]}},
                        "openai/ui":{"preferredDisplayMode":"inline","availableDisplayModes":["inline"]}}}]})
            }
            "tools/call"
                if params["name"] == OPEN
                    && (params["arguments"].is_null() || params["arguments"] == json!({})) =>
            {
                json!({"content":[{"type":"text","text":FIXED}]})
            }
            "tools/call" if params["name"] == CONTROL && issued => {
                let args = &params["arguments"];
                if args == &json!({"command":"attach"}) {
                    let meta = if attached {
                        call(&mut socket, "revoke")
                            .unwrap_or_else(|_| json!({"status":"uncertain"}))
                    } else {
                        attached = true;
                        json!({"status":"ready"})
                    };
                    json!({"content":[{"type":"text","text":"Stato della vista disponibile."}],"_meta":meta})
                } else if attached
                    && args["command"] == "receipt"
                    && args.as_object().map(|v| v.len()) == Some(2)
                    && args["commandId"].as_str().is_some_and(|id| {
                        id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
                    })
                {
                    match call(
                        &mut socket,
                        &format!("receipt-{}", args["commandId"].as_str().unwrap()),
                    ) {
                        Ok(status) => {
                            json!({"content":[{"type":"text","text":"Ricevuta disponibile nella vista."}],"_meta":status})
                        }
                        Err(_) => {
                            json!({"isError":true,"content":[{"type":"text","text":"Ricevuta non disponibile."}]})
                        }
                    }
                } else if attached
                    && args.as_object().map(|v| v.len()) == Some(1)
                    && args["command"].as_str().is_some_and(|s| {
                        [
                            "request",
                            "patient-document",
                            "local-voice",
                            "status",
                            "consume",
                            "revoke",
                            "therapy-active",
                            "therapy-suspended",
                            "therapy-completed",
                            "receipt",
                        ]
                        .contains(&s)
                    })
                {
                    match call(&mut socket, args["command"].as_str().unwrap()) {
                        Ok(status) => {
                            json!({"content":[{"type":"text","text":"Stato di accesso disponibile nella vista."}],"_meta":status})
                        }
                        Err(_) => {
                            json!({"isError":true,"content":[{"type":"text","text":"Accesso nativo non disponibile."}],"_meta":{"status":"uncertain"}})
                        }
                    }
                } else {
                    json!({"isError":true,"content":[{"type":"text","text":"Richiesta non ammessa."}]})
                }
            }
            _ => {
                let _ = call(&mut socket, "revoke");
                writeln!(
                    stdout,
                    "{}",
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Richiesta non ammessa."}})
                )?;
                stdout.flush()?;
                continue;
            }
        };
        writeln!(
            stdout,
            "{}",
            json!({"jsonrpc":"2.0","id":id,"result":result})
        )?;
        stdout.flush()?;
    }
    let _ = call(&mut socket, "revoke");
    Ok(())
}
