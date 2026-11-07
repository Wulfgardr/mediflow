use super::*;

const SCHEMA: &str = "mediflow.territorial-packs.v1";

/// Assetto territoriale dell'host (ADR 0177). Il cambio passa dalla sessione Web
/// del nodo home-base che GPUI apre sul computer dell'archivio.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerritorialPreset {
    Core,
    CoreIt,
    CoreItLom,
}
impl TerritorialPreset {
    pub const ALL: [Self; 3] = [Self::Core, Self::CoreIt, Self::CoreItLom];
    pub fn wire(self) -> &'static str {
        match self {
            Self::Core => "core",
            Self::CoreIt => "core+it",
            Self::CoreItLom => "core+it+lom",
        }
    }
    fn from_wire(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|preset| preset.wire() == value)
    }
    pub fn title(self) -> &'static str {
        match self {
            Self::Core => "Nucleo internazionale",
            Self::CoreIt => "Italia",
            Self::CoreItLom => "Italia e Lombardia",
        }
    }
    pub fn detail(self) -> &'static str {
        match self {
            Self::Core => {
                "Cartella clinica, ICD, cataloghi caricati da file. Nessuna funzione regionale."
            }
            Self::CoreIt => "Aggiunge codice fiscale, esenzioni e catalogo AIFA.",
            Self::CoreItLom => {
                "Aggiunge SISS e portali regionali, PRREG e protesica con le codifiche lombarde."
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TerritorialSnapshot {
    Ready {
        revision: u64,
        preset: TerritorialPreset,
    },
    /// L'host non riesce a leggere la propria configurazione: valgono solo le funzioni del nucleo.
    Unreadable,
}
impl TerritorialSnapshot {
    pub fn preset(&self) -> Option<TerritorialPreset> {
        match self {
            Self::Ready { preset, .. } => Some(*preset),
            Self::Unreadable => None,
        }
    }
}

fn parse_snapshot(value: &Value) -> Result<TerritorialSnapshot> {
    if value["schemaVersion"] != SCHEMA {
        return Err(RuntimeError::InvalidResponse);
    }
    match value["status"].as_str() {
        Some("ready") => {
            let revision = value["revision"]
                .as_u64()
                .ok_or(RuntimeError::InvalidResponse)?;
            let preset = value["preset"]
                .as_str()
                .and_then(TerritorialPreset::from_wire)
                .ok_or(RuntimeError::InvalidResponse)?;
            Ok(TerritorialSnapshot::Ready { revision, preset })
        }
        Some("configuration_error") => Ok(TerritorialSnapshot::Unreadable),
        _ => Err(RuntimeError::InvalidResponse),
    }
}

pub struct PreparedTerritorialPacks {
    owner: Weak<()>,
    revision: u64,
    before: TerritorialPreset,
    preset: TerritorialPreset,
    submitted: AtomicBool,
}
impl PreparedTerritorialPacks {
    pub fn before(&self) -> TerritorialPreset {
        self.before
    }
    pub fn preset(&self) -> TerritorialPreset {
        self.preset
    }
    /// Togliere la Lombardia ferma SISS, portali e PRREG: la conferma lo dice prima.
    pub fn turns_off_lombardy(&self) -> bool {
        self.before == TerritorialPreset::CoreItLom && self.preset != TerritorialPreset::CoreItLom
    }
}

impl LocalHostAccess {
    pub fn read_territorial_packs(&self) -> Result<TerritorialSnapshot> {
        let value = self.request(
            Method::GET,
            &["api", "system", "territorial-packs"],
            None,
            false,
        )?;
        parse_snapshot(&value)
    }
    pub fn prepare_territorial_packs(
        &self,
        snapshot: &TerritorialSnapshot,
        preset: TerritorialPreset,
    ) -> Result<PreparedTerritorialPacks> {
        self.headers()?;
        let TerritorialSnapshot::Ready {
            revision,
            preset: before,
        } = *snapshot
        else {
            return Err(RuntimeError::InvalidInput);
        };
        if preset == before {
            return Err(RuntimeError::InvalidInput);
        }
        if self.read_territorial_packs()? != *snapshot {
            return Err(RuntimeError::Conflict);
        }
        Ok(PreparedTerritorialPacks {
            owner: Arc::downgrade(&self.owner),
            revision,
            before,
            preset,
            submitted: AtomicBool::new(false),
        })
    }
    pub fn apply_territorial_packs(&self, command: &PreparedTerritorialPacks) -> Result<bool> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let written = self.request(
            Method::PUT,
            &["api", "system", "territorial-packs"],
            Some(&json!({
                "schemaVersion": SCHEMA,
                "expectedRevision": command.revision,
                "preset": command.preset.wire(),
                "confirmed": true,
            })),
            true,
        )?;
        let expected = TerritorialSnapshot::Ready {
            revision: command.revision + 1,
            preset: command.preset,
        };
        if parse_snapshot(&written).ok().as_ref() != Some(&expected) {
            return Ok(false);
        }
        let confirmed = match self.read_territorial_packs() {
            Ok(observed) => observed == expected,
            Err(error) if error.retires_session() => return Err(error),
            Err(_) => false,
        };
        if confirmed {
            // Le sezioni lombarde della sessione nativa seguono l'assetto appena riletto.
            match self.native.refresh_capabilities() {
                Err(error) if error.retires_session() => return Err(error),
                _ => {}
            }
        }
        Ok(confirmed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_accepts_only_the_v1_contract() {
        assert_eq!(
            parse_snapshot(
                &json!({"schemaVersion":SCHEMA,"revision":4,"status":"ready","preset":"core+it"})
            )
            .unwrap(),
            TerritorialSnapshot::Ready {
                revision: 4,
                preset: TerritorialPreset::CoreIt
            }
        );
        assert_eq!(
            parse_snapshot(&json!({"schemaVersion":SCHEMA,"revision":null,"status":"configuration_error","preset":"core"})).unwrap(),
            TerritorialSnapshot::Unreadable
        );
        for invalid in [
            json!({"schemaVersion":"other","revision":1,"status":"ready","preset":"core"}),
            json!({"schemaVersion":SCHEMA,"revision":1,"status":"ready","preset":"core+fr"}),
            json!({"schemaVersion":SCHEMA,"revision":null,"status":"ready","preset":"core"}),
            json!({"code":"channel_denied"}),
        ] {
            assert_eq!(
                parse_snapshot(&invalid),
                Err(RuntimeError::InvalidResponse),
                "{invalid}"
            );
        }
    }
}
