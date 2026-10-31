use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NetworkMode {
    LocalOnly,
    HomeBase,
}
impl NetworkMode {
    pub fn wire(self) -> &'static str {
        match self {
            Self::LocalOnly => "local-only",
            Self::HomeBase => "network-home-base",
        }
    }
    pub fn title(self) -> &'static str {
        match self {
            Self::LocalOnly => "Solo locale",
            Self::HomeBase => "Nodo della rete fidata",
        }
    }
    pub fn alternative(self) -> Self {
        match self {
            Self::LocalOnly => Self::HomeBase,
            Self::HomeBase => Self::LocalOnly,
        }
    }
}
#[derive(Clone)]
pub struct NetworkModeSnapshot {
    value: Option<String>,
}
impl NetworkModeSnapshot {
    pub fn mode(&self) -> Result<NetworkMode> {
        match self.value.as_deref() {
            None | Some("local-only") => Ok(NetworkMode::LocalOnly),
            Some("network-home-base") => Ok(NetworkMode::HomeBase),
            _ => Err(RuntimeError::InvalidResponse),
        }
    }
}
pub struct PreparedNetworkMode {
    owner: Weak<()>,
    before: Option<String>,
    mode: NetworkMode,
    submitted: AtomicBool,
}
impl PreparedNetworkMode {
    pub fn mode(&self) -> NetworkMode {
        self.mode
    }
}
impl LocalHostAccess {
    pub fn read_network_mode(&self) -> Result<NetworkModeSnapshot> {
        let row = self.request(
            Method::GET,
            &["api", "settings", "network.mode"],
            None,
            false,
        )?;
        if row["key"] != "network.mode" {
            return Err(RuntimeError::InvalidResponse);
        }
        let snapshot = NetworkModeSnapshot {
            value: match row.get("value") {
                Some(Value::Null) => None,
                Some(Value::String(value)) => Some(value.clone()),
                _ => return Err(RuntimeError::InvalidResponse),
            },
        };
        snapshot.mode()?;
        Ok(snapshot)
    }
    pub fn prepare_network_mode(
        &self,
        snapshot: &NetworkModeSnapshot,
        mode: NetworkMode,
    ) -> Result<PreparedNetworkMode> {
        self.headers()?;
        if self.read_network_mode()?.value != snapshot.value {
            return Err(RuntimeError::Conflict);
        }
        Ok(PreparedNetworkMode {
            owner: Arc::downgrade(&self.owner),
            before: snapshot.value.clone(),
            mode,
            submitted: AtomicBool::new(false),
        })
    }
    pub fn apply_network_mode(&self, command: &PreparedNetworkMode) -> Result<bool> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let result = self.request(
            Method::PUT,
            &["api", "settings", "network.mode"],
            Some(&json!({"value":command.mode.wire(),"expectedValue":command.before})),
            true,
        )?;
        if result["success"] != true
            || result["key"] != "network.mode"
            || result["value"] != command.mode.wire()
        {
            return Ok(false);
        }
        match self.read_network_mode() {
            Ok(snapshot) => Ok(snapshot.value.as_deref() == Some(command.mode.wire())),
            Err(error) if error.retires_session() => Err(error),
            Err(_) => Ok(false),
        }
    }
}
