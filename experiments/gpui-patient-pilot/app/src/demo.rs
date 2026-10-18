//! Synthetic process-local service. No file, database, network or credential IO.

use mediflow_patient_client::{
    MAX_VERSION, PatientProfile, ReadFailure, UpdateNotes, UpdateOutcome,
};

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum Scenario {
    #[default]
    Normal,
    Conflict,
    Rejected,
    Indeterminate,
    ReadUnavailable,
}

impl Scenario {
    pub fn label(self) -> &'static str {
        match self {
            Self::Normal => "Percorso ordinario",
            Self::Conflict => "Altra postazione modifica le note",
            Self::Rejected => "Registrazione rifiutata",
            Self::Indeterminate => "Esito della registrazione incerto",
            Self::ReadUnavailable => "Rilettura non disponibile",
        }
    }
}

pub struct DemoService {
    patients: Vec<PatientProfile>,
    fail_next_read: bool,
}

impl Default for DemoService {
    fn default() -> Self {
        let rows = [
            (
                "prova-001",
                "Elena",
                "Moretti",
                "1961-04-12",
                "PROVA-ELENA-001",
                Some(
                    "Contatto di prova: concordare il prossimo colloquio.\nVerificare i recapiti e annotare le preferenze espresse.",
                ),
                false,
            ),
            (
                "prova-002",
                "Luca",
                "Conti",
                "1954-11-08",
                "PROVA-LUCA-002",
                Some("Promemoria di prova: rivedere insieme gli appuntamenti già concordati."),
                false,
            ),
            (
                "prova-003",
                "Sofia",
                "Riva",
                "1988-02-23",
                "PROVA-SOFIA-003",
                None,
                false,
            ),
            (
                "prova-004",
                "Paolo",
                "Serra",
                "1947-09-06",
                "PROVA-PAOLO-004",
                Some(
                    "Esempio di nota: è già disponibile il riepilogo dell'ultimo incontro.\nIl testo contiene accenti, apostrofi e più righe per provare la scrittura.",
                ),
                false,
            ),
            (
                "prova-005",
                "Anna",
                "Rossi",
                "1973-07-19",
                "PROVA-ANNA-005",
                Some("Scheda di prova archiviata. Nessuna attività aperta in questo esempio."),
                true,
            ),
        ];
        Self {
            patients: rows
                .into_iter()
                .map(
                    |(id, first, last, birth, code, notes, archived)| PatientProfile {
                        id: id.into(),
                        first_name: first.into(),
                        last_name: last.into(),
                        birth_date: Some(birth.into()),
                        tax_code: code.into(),
                        notes: notes.map(str::to_owned),
                        version: 1,
                        is_archived: archived,
                    },
                )
                .collect(),
            fail_next_read: false,
        }
    }
}

impl DemoService {
    pub fn patients(&self) -> &[PatientProfile] {
        &self.patients
    }

    pub fn read(&mut self, patient_id: &str) -> Result<PatientProfile, ReadFailure> {
        if std::mem::take(&mut self.fail_next_read) {
            return Err(ReadFailure::Unavailable);
        }
        self.patients
            .iter()
            .find(|p| p.id == patient_id)
            .cloned()
            .ok_or(ReadFailure::NotFound)
    }

    pub fn update(&mut self, command: &UpdateNotes, scenario: Scenario) -> UpdateOutcome {
        let Some(patient) = self
            .patients
            .iter_mut()
            .find(|p| p.id == command.patient_id)
        else {
            return UpdateOutcome::Rejected;
        };
        if scenario == Scenario::Rejected || patient.is_archived || patient.version >= MAX_VERSION {
            return UpdateOutcome::Rejected;
        }
        if scenario == Scenario::Conflict {
            patient.version += 1;
            patient.notes = Some("Nota cambiata da un'altra postazione di prova. Riconciliare il contenuto prima di riprovare.".into());
        }
        if patient.version != command.expected_version {
            return UpdateOutcome::Conflict;
        }
        patient.notes = Some(command.notes.clone());
        patient.version += 1;
        if scenario == Scenario::Indeterminate {
            return UpdateOutcome::Indeterminate;
        }
        self.fail_next_read = scenario == Scenario::ReadUnavailable;
        UpdateOutcome::Acknowledged
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mediflow_patient_client::{Phase, Workspace};

    fn edited(service: &mut DemoService) -> (Workspace, UpdateNotes) {
        let mut workspace = Workspace::default();
        let request = workspace.select("prova-001").unwrap();
        workspace.receive_read(&request, service.read(&request.patient_id));
        workspace
            .edit_notes("È una nuova nota di prova.\nSeconda riga.".into())
            .unwrap();
        workspace.review().unwrap();
        let command = workspace.confirm().unwrap();
        (workspace, command)
    }

    #[test]
    fn ordinary_save_is_only_saved_after_independent_service_reread() {
        let mut service = DemoService::default();
        let (mut workspace, command) = edited(&mut service);
        let outcome = service.update(&command, Scenario::Normal);
        let request = workspace.receive_update(&command, outcome).unwrap();
        assert_eq!(workspace.phase(), Phase::Verifying);
        assert!(workspace.receive_read(&request, service.read(&request.patient_id)));
        assert_eq!(workspace.phase(), Phase::Saved);
        assert_eq!(
            workspace.selected().unwrap().notes.as_deref(),
            Some(command.notes.as_str())
        );
    }

    #[test]
    fn uncertain_commit_and_failed_reread_do_not_report_success() {
        for scenario in [Scenario::Indeterminate, Scenario::ReadUnavailable] {
            let mut service = DemoService::default();
            let (mut workspace, command) = edited(&mut service);
            let outcome = service.update(&command, scenario);
            if let Some(request) = workspace.receive_update(&command, outcome) {
                workspace.receive_read(&request, service.read(&request.patient_id));
            }
            assert_eq!(workspace.phase(), Phase::Indeterminate);
            assert_eq!(workspace.draft_notes(), command.notes);
            assert_eq!(
                service.read(&command.patient_id).unwrap().notes,
                Some(command.notes)
            );
        }
    }

    #[test]
    fn conflict_preserves_other_postation_and_local_draft() {
        let mut service = DemoService::default();
        let (mut workspace, command) = edited(&mut service);
        let outcome = service.update(&command, Scenario::Conflict);
        assert_eq!(outcome, UpdateOutcome::Conflict);
        assert!(workspace.receive_update(&command, outcome).is_none());
        assert_eq!(workspace.phase(), Phase::Conflict);
        assert_eq!(workspace.draft_notes(), command.notes);
        assert_ne!(
            service.read(&command.patient_id).unwrap().notes,
            Some(command.notes)
        );
    }
}
