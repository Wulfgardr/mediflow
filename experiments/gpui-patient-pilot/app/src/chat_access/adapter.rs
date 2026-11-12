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

fn wire_command(command: &str) -> Value {
    if command == "request" {
        json!({"command": command, "operation": OPERATION})
    } else if let Some(query) = command.strip_prefix("prosthetics:") {
        json!({"command":"prosthetics", "query":query})
    } else if let Some(query) = command.strip_prefix("drugs:") {
        json!({"command":"drugs", "query":query})
    } else if let Some(id) = command.strip_prefix("booking-receipt-") {
        json!({"command":"booking-receipt", "commandId":id})
    } else if let Some(id) = command.strip_prefix("receipt-") {
        json!({"command":"receipt", "commandId":id})
    } else if let Some(target) = command.strip_prefix("therapy-") {
        json!({"command":"therapy", "target":target})
    } else {
        json!({"command": command})
    }
}

fn call(stream: &mut UnixStream, command: &str) -> io::Result<Value> {
    if native::capture(stream, false).is_none() {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    let value = wire_command(command);
    writeln!(stream, "{value}")?;
    let mut bytes = Vec::new();
    BufReader::new(Read::take(&mut *stream, 65_537)).read_until(b'\n', &mut bytes)?;
    checked_reply(command, &bytes)
}

fn checked_reply(command: &str, bytes: &[u8]) -> io::Result<Value> {
    let value: Value = serde_json::from_slice(bytes)?;
    let state = value["status"].as_str().filter(|s| {
        [
            "requested",
            "document-opened",
            "voice-opened",
            "insight-opened",
            "insight-unavailable",
            "insight-busy",
            "insight-closed",
            "synthesis-opened",
            "synthesis-unavailable",
            "synthesis-busy",
            "synthesis-closed",
            "import-opened",
            "import-unavailable",
            "import-busy",
            "import-closed",
            "icd-opened",
            "icd-unavailable",
            "icd-busy",
            "icd-closed",
            "loops-opened",
            "loops-unavailable",
            "loops-busy",
            "loops-closed",
            "preparing",
            "selecting",
            "challenge",
            "approving",
            "approved",
            "consuming",
            "consumed",
            "withdrawn",
            "uncertain",
            "retired",
            "applied",
            "applied-historical",
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
        || ((matches!(
            command,
            "patient-insight" | "document-synthesis" | "smart-import" | "icd-lookup" | "open-loops"
        ) || state.is_some_and(|state| {
            ["insight-", "synthesis-", "import-", "icd-", "loops-"]
                .iter()
                .any(|prefix| state.starts_with(prefix))
        })) && fields != Some(1))
        || (!has_payload && !has_receipt && fields != Some(1))
        || (has_receipt
            && (fields != Some(2)
                || value["receipt"].as_object().map(|v| v.len()) != Some(2)
                || !value["receipt"]["commandId"].as_str().is_some_and(|id| {
                    id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
                })
                || !value["receipt"]["outcome"].as_str().is_some_and(|s| {
                    [
                        "pending",
                        "unknown",
                        "applied",
                        "applied-historical",
                        "rejected",
                        "closed",
                        "retired",
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
                    "inputSchema":{"type":"object","properties":{"command":{"type":"string","enum":["attach","request","clinical-profile","status","consume","revoke","therapy-active","therapy-suspended","therapy-completed","patient-document","local-voice","patient-insight","document-synthesis","receipt","drugs","prosthetics","agenda","booking","icd-lookup","booking-receipt","smart-import","open-loops"]},"query":{"type":"string","minLength":2,"maxLength":80},"commandId":{"type":"string","pattern":"^[0-9a-f-]{36}$"}},"required":["command"],"additionalProperties":false},
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
                    && matches!(args["command"].as_str(), Some("drugs" | "prosthetics"))
                    && args.as_object().map(|v| v.len()) == Some(2)
                    && args["query"].as_str().is_some_and(|q| {
                        (2..=80).contains(&q.chars().count()) && !q.chars().any(char::is_control)
                    })
                {
                    match call(
                        &mut socket,
                        &format!(
                            "{}:{}",
                            args["command"].as_str().unwrap(),
                            args["query"].as_str().unwrap()
                        ),
                    ) {
                        Ok(status) => {
                            json!({"content":[{"type":"text","text":"Ricerca disponibile nella vista."}],"_meta":status})
                        }
                        Err(_) => {
                            json!({"isError":true,"content":[{"type":"text","text":"Ricerca non disponibile."}]})
                        }
                    }
                } else if attached
                    && matches!(
                        args["command"].as_str(),
                        Some("receipt" | "booking-receipt")
                    )
                    && args.as_object().map(|v| v.len()) == Some(2)
                    && args["commandId"].as_str().is_some_and(|id| {
                        id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
                    })
                {
                    match call(
                        &mut socket,
                        &format!(
                            "{}-{}",
                            args["command"].as_str().unwrap(),
                            args["commandId"].as_str().unwrap()
                        ),
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
                            "clinical-profile",
                            "agenda",
                            "booking",
                            "patient-document",
                            "local-voice",
                            "patient-insight",
                            "document-synthesis",
                            "smart-import",
                            "icd-lookup",
                            "open-loops",
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn booking_carries_no_chat_fields_and_each_receipt_keeps_its_route() {
        let id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        assert_eq!(wire_command("booking"), json!({"command":"booking"}));
        assert_eq!(
            wire_command(&format!("booking-receipt-{id}")),
            json!({"command":"booking-receipt", "commandId":id})
        );
        assert_eq!(
            wire_command(&format!("receipt-{id}")),
            json!({"command":"receipt", "commandId":id})
        );
    }
    #[test]
    fn insight_command_reaches_the_socket_without_arguments() {
        assert_eq!(
            wire_command("patient-insight"),
            json!({"command":"patient-insight"})
        );
    }
    #[test]
    fn synthesis_command_and_replies_have_no_clinical_fields() {
        assert_eq!(
            wire_command("document-synthesis"),
            json!({"command":"document-synthesis"})
        );
        for state in [
            "requested",
            "preparing",
            "synthesis-opened",
            "synthesis-unavailable",
            "synthesis-busy",
            "synthesis-closed",
            "withdrawn",
        ] {
            let reply = json!({"status":state});
            assert_eq!(
                checked_reply("document-synthesis", reply.to_string().as_bytes()).unwrap(),
                reply
            );
            for field in [
                "summary",
                "patientId",
                "attachmentId",
                "token",
                "payload",
                "sources",
                "receipt",
            ] {
                let mut altered = reply.clone();
                altered[field] = json!("synthetic-private");
                assert!(
                    checked_reply("document-synthesis", altered.to_string().as_bytes()).is_err(),
                    "{state}: {field}"
                );
            }
        }
        let receipt = json!({"status":"synthesis-opened", "receipt":{"commandId":"a".repeat(36),"outcome":"applied"}});
        assert!(checked_reply("status", receipt.to_string().as_bytes()).is_err());
    }

    #[test]
    fn import_command_and_replies_have_no_clinical_fields() {
        assert_eq!(
            wire_command("smart-import"),
            json!({"command":"smart-import"})
        );
        for state in [
            "requested",
            "preparing",
            "import-opened",
            "import-unavailable",
            "import-busy",
            "import-closed",
            "withdrawn",
        ] {
            let reply = json!({"status":state});
            assert_eq!(
                checked_reply("smart-import", reply.to_string().as_bytes()).unwrap(),
                reply
            );
            for field in [
                "summary",
                "candidates",
                "patientId",
                "noteId",
                "token",
                "payload",
                "sources",
                "receipt",
            ] {
                let mut altered = reply.clone();
                altered[field] = json!("synthetic-private");
                assert!(
                    checked_reply("smart-import", altered.to_string().as_bytes()).is_err(),
                    "{state}: {field}"
                );
            }
        }
        // Uno stato dell'import con una ricevuta non passa da nessun comando.
        let receipt = json!({"status":"import-closed", "receipt":{"commandId":"a".repeat(36),"outcome":"applied"}});
        assert!(checked_reply("status", receipt.to_string().as_bytes()).is_err());
    }

    #[test]
    fn catalog_query_is_data_and_cannot_choose_another_command() {
        for (prefix, expected) in [("prosthetics", "prosthetics"), ("drugs", "drugs")] {
            let query = "demo:consume\",\"command\":\"therapy-active";
            assert_eq!(
                wire_command(&format!("{prefix}:{query}")),
                json!({"command":expected, "query":query})
            );
        }
    }
    #[test]
    fn icd_replies_are_status_only_even_when_polling() {
        assert_eq!(wire_command("icd-lookup"), json!({"command":"icd-lookup"}));
        for state in ["icd-opened", "icd-unavailable", "icd-busy", "icd-closed"] {
            for command in ["icd-lookup", "status"] {
                let reply = json!({"status":state});
                assert_eq!(
                    checked_reply(command, reply.to_string().as_bytes()).unwrap(),
                    reply
                );
                for field in [
                    "patientId",
                    "query",
                    "entries",
                    "payload",
                    "receipt",
                    "sources",
                ] {
                    let mut altered = reply.clone();
                    altered[field] = json!("synthetic-private");
                    assert!(
                        checked_reply(command, altered.to_string().as_bytes()).is_err(),
                        "{command}: {field}"
                    );
                }
            }
        }
    }
}
