use crate::{Result, RuntimeError};
use serde_json::Value;

pub(crate) fn negotiate_host_ports(value: &Value) -> Result<()> {
    if value["revision"] != 1 || value["writer"] != "host" {
        return Err(RuntimeError::UnsupportedProtocol);
    }
    let ports = value["ports"]
        .as_array()
        .ok_or(RuntimeError::UnsupportedProtocol)?;
    for (id, scope, authority, state) in [
        ("clinical", "ambulatory", "paired-operator", "available"),
        (
            "account-profile",
            "operator",
            "operator-session",
            "available",
        ),
        (
            "ai-preferences",
            "operator",
            "explicit-admin-grant",
            "available",
        ),
        (
            "administrative",
            "operation",
            "explicit-admin-grant",
            "not-exposed",
        ),
        (
            "provider",
            "operation",
            "explicit-egress-consent",
            "not-exposed",
        ),
        (
            "document-derived",
            "ambulatory",
            "named-host-service",
            "not-exposed",
        ),
        (
            "voice",
            "operation",
            "explicit-microphone-permission",
            "not-exposed",
        ),
        (
            "file",
            "chosen-file",
            "explicit-file-choice",
            "client-local",
        ),
    ] {
        let mut matches = ports.iter().filter(|port| port["id"] == id);
        let port = matches.next().ok_or(RuntimeError::UnsupportedProtocol)?;
        if matches.next().is_some()
            || port["revision"] != 1
            || port["scope"] != scope
            || port["authority"] != authority
            || port["state"] != state
        {
            return Err(RuntimeError::UnsupportedProtocol);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn host() -> Value {
        serde_json::from_str(include_str!("../tests/fixtures/host-ports.json")).unwrap()
    }

    #[test]
    fn negotiates_every_existing_and_reserved_port_without_widening_scope_or_authority() {
        let contract = host();
        assert_eq!(negotiate_host_ports(&contract), Ok(()));
        for index in 0..contract["ports"].as_array().unwrap().len() {
            for field in ["revision", "scope", "authority", "state"] {
                let mut incompatible = contract.clone();
                incompatible["ports"][index][field] = if field == "revision" {
                    json!(2)
                } else {
                    json!("incompatible")
                };
                assert_eq!(
                    negotiate_host_ports(&incompatible),
                    Err(RuntimeError::UnsupportedProtocol),
                    "port {index} {field}"
                );
            }
        }
        let mut duplicated = contract.clone();
        duplicated["ports"]
            .as_array_mut()
            .unwrap()
            .push(contract["ports"][0].clone());
        assert_eq!(
            negotiate_host_ports(&duplicated),
            Err(RuntimeError::UnsupportedProtocol)
        );
        for field in ["revision", "writer", "ports"] {
            let mut incomplete = contract.clone();
            incomplete.as_object_mut().unwrap().remove(field);
            assert_eq!(
                negotiate_host_ports(&incomplete),
                Err(RuntimeError::UnsupportedProtocol)
            );
        }
    }
}
