use mediflow_patient_client::*;

fn profile(id: &str) -> PatientProfile {
    PatientProfile {
        id: id.into(),
        first_name: "Ada".into(),
        last_name: "Esempio".into(),
        birth_date: Some("1960-01-01".into()),
        tax_code: "SINTETICO-001".into(),
        notes: Some("Contatto di prova".into()),
        version: 7,
        is_archived: false,
    }
}

fn opened() -> Workspace {
    let mut w = Workspace::default();
    let request = w.select("patient-a").unwrap();
    assert!(w.receive_read(&request, Ok(profile("patient-a"))));
    w
}

fn submitted(w: &mut Workspace) -> UpdateNotes {
    w.edit_notes("Verificare il recapito.\nCaffè, perché, 👩🏽‍⚕️.".into())
        .unwrap();
    w.review().unwrap();
    w.confirm().unwrap()
}

fn committed(command: &UpdateNotes) -> PatientProfile {
    let mut p = profile(&command.patient_id);
    p.version = command.expected_version + 1;
    p.notes = Some(command.notes.clone());
    p
}

#[test]
fn old_patient_and_old_requests_never_populate_the_new_selection() {
    let mut w = opened();
    let a = w.select("patient-a").unwrap();
    let b = w.select("patient-b").unwrap();
    assert_eq!(w.phase(), Phase::Loading);
    assert!(w.selected().is_none());
    assert_eq!(w.draft_notes(), "");
    assert!(!w.receive_read(&a, Ok(profile("patient-a"))));
    assert!(w.receive_read(&b, Ok(profile("patient-b"))));
    assert_eq!(w.selected().unwrap().id, "patient-b");
    assert!(!w.receive_read(&b, Ok(profile("patient-b"))));
}

#[test]
fn returning_to_same_patient_does_not_accept_a_previous_request() {
    let mut w = Workspace::default();
    let old = w.select("patient-a").unwrap();
    w.select("patient-b").unwrap();
    let fresh = w.select("patient-a").unwrap();
    assert!(!w.receive_read(&old, Ok(profile("patient-a"))));
    assert!(w.receive_read(&fresh, Ok(profile("patient-a"))));
}

#[test]
fn a_recreated_workspace_cannot_accept_the_previous_instances_replies() {
    let mut old = Workspace::default();
    let old_read = old.select("patient-a").unwrap();
    let mut fresh = Workspace::default();
    let fresh_read = fresh.select("patient-a").unwrap();
    assert_ne!(old_read, fresh_read);
    assert!(!fresh.receive_read(&old_read, Ok(profile("patient-a"))));
    assert!(fresh.receive_read(&fresh_read, Ok(profile("patient-a"))));
    assert!(old.receive_read(&old_read, Ok(profile("patient-a"))));
    let old_command = submitted(&mut old);
    let fresh_command = submitted(&mut fresh);
    assert_ne!(old_command, fresh_command);
    drop(old);
    assert!(
        fresh
            .receive_update(&old_command, UpdateOutcome::Acknowledged)
            .is_none()
    );
    assert_eq!(fresh.phase(), Phase::Submitting);
    assert!(
        fresh
            .receive_update(&fresh_command, UpdateOutcome::Acknowledged)
            .is_some()
    );
}

#[test]
fn wrong_row_and_invalid_versions_never_become_visible() {
    for invalid_version in [0, MAX_VERSION + 1] {
        let mut w = Workspace::default();
        let request = w.select("patient-a").unwrap();
        let mut p = profile("patient-a");
        p.version = invalid_version;
        assert!(!w.receive_read(&request, Ok(p)));
        assert_eq!(w.phase(), Phase::Unavailable);
        assert!(w.selected().is_none());
    }
    let mut w = Workspace::default();
    let request = w.select("patient-a").unwrap();
    assert!(!w.receive_read(&request, Ok(profile("patient-b"))));
    assert!(w.selected().is_none());
}

#[test]
fn missing_unavailable_and_invalid_reads_are_explicit_and_empty() {
    for error in [
        ReadFailure::NotFound,
        ReadFailure::Unavailable,
        ReadFailure::Invalid,
    ] {
        let mut w = opened();
        let request = w.select("patient-b").unwrap();
        assert!(!w.receive_read(&request, Err(error)));
        assert_eq!(w.phase(), Phase::Unavailable);
        assert!(w.selected().is_none());
        assert!(w.can_switch());
    }
}

#[test]
fn no_write_without_a_changed_draft_and_an_explicit_review() {
    let mut w = opened();
    assert_eq!(w.confirm(), Err(ClientError::WrongPhase));
    assert_eq!(w.review(), Err(ClientError::NoChanges));
    w.edit_notes("Bozza".into()).unwrap();
    assert_eq!(w.confirm(), Err(ClientError::WrongPhase));
    w.review().unwrap();
    assert_eq!(
        w.edit_notes("Modificata dopo la revisione".into()),
        Err(ClientError::WrongPhase)
    );
    w.cancel_review().unwrap();
    w.edit_notes("Nuova bozza".into()).unwrap();
    w.review().unwrap();
    let command = w.confirm().unwrap();
    assert_eq!(command.notes, "Nuova bozza");
    assert_eq!(w.confirm(), Err(ClientError::WrongPhase));
    assert_eq!(w.phase(), Phase::Submitting);
}

#[test]
fn acknowledgement_is_not_saved_until_exact_fresh_readback() {
    let mut w = opened();
    let command = submitted(&mut w);
    assert_eq!(w.phase(), Phase::Submitting);
    let read = w
        .receive_update(&command, UpdateOutcome::Acknowledged)
        .unwrap();
    assert_eq!(w.phase(), Phase::Verifying);
    assert!(w.is_dirty());
    assert!(
        w.receive_update(&command, UpdateOutcome::Acknowledged)
            .is_none()
    );
    assert!(w.receive_read(&read, Ok(committed(&command))));
    assert_eq!(w.phase(), Phase::Saved);
    assert_eq!(w.selected().unwrap().version, 8);
    assert_eq!(w.draft_notes(), command.notes);
    assert!(!w.is_dirty());
    assert!(w.can_switch());
}

#[test]
fn wire_body_preserves_the_existing_notes_only_api_shape_and_unicode() {
    let mut w = opened();
    let command = submitted(&mut w);
    assert_eq!(
        serde_json::to_value(command.http_body()).unwrap(),
        serde_json::json!({ "version": 7, "notes": "Verificare il recapito.\nCaffè, perché, 👩🏽‍⚕️." })
    );
}

#[test]
fn mismatched_newer_or_old_readback_needs_reconciliation() {
    for variant in 0..3 {
        let mut w = opened();
        let command = submitted(&mut w);
        let read = w
            .receive_update(&command, UpdateOutcome::Acknowledged)
            .unwrap();
        let mut p = committed(&command);
        match variant {
            0 => p.version = command.expected_version,
            1 => p.version += 1,
            _ => p.notes = Some("Un altro contenuto".into()),
        }
        assert!(!w.receive_read(&read, Ok(p)));
        assert_eq!(w.phase(), Phase::Conflict);
        assert_eq!(w.draft_notes(), command.notes);
        assert!(!w.can_switch());
        assert_eq!(w.confirm(), Err(ClientError::WrongPhase));
    }
}

#[test]
fn failed_readback_is_uncertain_and_never_retries_the_mutation() {
    let mut w = opened();
    let command = submitted(&mut w);
    let read = w
        .receive_update(&command, UpdateOutcome::Acknowledged)
        .unwrap();
    assert!(!w.receive_read(&read, Err(ReadFailure::Unavailable)));
    assert_eq!(w.phase(), Phase::Indeterminate);
    assert_eq!(w.review(), Err(ClientError::WrongPhase));
    assert_eq!(w.confirm(), Err(ClientError::WrongPhase));
    assert_eq!(w.draft_notes(), command.notes);
    let explicit_read = w.discard_and_reload().unwrap();
    assert!(w.receive_read(&explicit_read, Ok(committed(&command))));
    assert_eq!(
        w.phase(),
        Phase::Ready,
        "reread does not attribute an uncertain commit to this client"
    );
}

#[test]
fn update_conflict_and_lost_response_preserve_draft_until_explicit_discard() {
    for (outcome, phase) in [
        (UpdateOutcome::Conflict, Phase::Conflict),
        (UpdateOutcome::Indeterminate, Phase::Indeterminate),
    ] {
        let mut w = opened();
        let command = submitted(&mut w);
        assert!(w.receive_update(&command, outcome).is_none());
        assert_eq!(w.phase(), phase);
        assert_eq!(w.draft_notes(), command.notes);
        assert_eq!(w.select("patient-b"), Err(ClientError::UnsavedChanges));
        assert_eq!(w.confirm(), Err(ClientError::WrongPhase));
        let read = w.discard_and_reload().unwrap();
        assert!(w.receive_read(&read, Ok(profile("patient-a"))));
        assert_eq!(w.phase(), Phase::Ready);
    }
}

#[test]
fn known_rejection_requires_another_explicit_review() {
    let mut w = opened();
    let command = submitted(&mut w);
    assert!(
        w.receive_update(&command, UpdateOutcome::Rejected)
            .is_none()
    );
    assert_eq!(w.phase(), Phase::Editing);
    assert_eq!(w.confirm(), Err(ClientError::WrongPhase));
    w.review().unwrap();
    let next = w.confirm().unwrap();
    assert_ne!(next, command);
    assert!(
        w.receive_update(&command, UpdateOutcome::Acknowledged)
            .is_none()
    );
    assert_eq!(w.phase(), Phase::Submitting);
}

#[test]
fn changed_commands_and_read_requests_cannot_match_pending_operations() {
    let mut w = opened();
    let command = submitted(&mut w);
    let mut altered = command.clone();
    altered.expected_version += 1;
    assert!(
        w.receive_update(&altered, UpdateOutcome::Acknowledged)
            .is_none()
    );
    let mut read = w
        .receive_update(&command, UpdateOutcome::Acknowledged)
        .unwrap();
    read.patient_id = "patient-b".into();
    assert!(!w.receive_read(&read, Ok(profile("patient-b"))));
    assert_eq!(w.phase(), Phase::Verifying);
}

#[test]
fn selection_and_refresh_do_not_silently_drop_dirty_or_inflight_work() {
    let mut w = opened();
    w.edit_notes("Bozza da conservare".into()).unwrap();
    assert_eq!(w.select("patient-b"), Err(ClientError::UnsavedChanges));
    w.review().unwrap();
    let command = w.confirm().unwrap();
    assert!(w.discard_and_reload().is_none());
    w.receive_update(&command, UpdateOutcome::Acknowledged)
        .unwrap();
    assert!(w.discard_and_reload().is_none());
    assert_eq!(w.draft_notes(), "Bozza da conservare");
}

#[test]
fn lock_invalidates_old_reads_and_updates_even_after_reopening_same_patient() {
    let mut w = opened();
    let command = submitted(&mut w);
    let old_read = w
        .receive_update(&command, UpdateOutcome::Acknowledged)
        .unwrap();
    w.lock();
    assert!(w.selected().is_none());
    assert!(w.selected_id().is_none());
    assert_eq!(w.draft_notes(), "");
    assert_eq!(w.phase(), Phase::Locked);
    assert!(
        w.receive_update(&command, UpdateOutcome::Acknowledged)
            .is_none()
    );
    assert!(!w.receive_read(&old_read, Ok(committed(&command))));
    let fresh = w.select("patient-a").unwrap();
    assert!(!w.receive_read(&old_read, Ok(committed(&command))));
    assert!(w.receive_read(&fresh, Ok(profile("patient-a"))));
    assert_eq!(w.phase(), Phase::Ready);
}

#[test]
fn null_and_empty_notes_do_not_create_an_implicit_clear_command() {
    for notes in [None, Some(String::new())] {
        let mut w = Workspace::default();
        let read = w.select("patient-a").unwrap();
        let mut p = profile("patient-a");
        p.notes = notes.clone();
        assert!(w.receive_read(&read, Ok(p)));
        w.edit_notes(String::new()).unwrap();
        assert!(!w.is_dirty());
        assert_eq!(w.review(), Err(ClientError::NoChanges));
        assert_eq!(w.selected().unwrap().notes, notes);
    }
}

#[test]
fn archived_profiles_remain_readable_without_inventing_new_domain_policy() {
    let mut p = profile("patient-a");
    p.is_archived = true;
    let mut w = Workspace::default();
    let read = w.select("patient-a").unwrap();
    assert!(w.receive_read(&read, Ok(p)));
    assert!(w.selected().unwrap().is_archived);
    let command = submitted(&mut w);
    assert_eq!(command.patient_id, "patient-a");
}

#[test]
fn notes_bounds_use_utf16_and_reject_nul_without_changing_draft() {
    let mut w = opened();
    let valid = "🙂".repeat(MAX_NOTES_UTF16 / 2);
    w.edit_notes(valid.clone()).unwrap();
    assert_eq!(
        w.edit_notes(format!("{valid}x")),
        Err(ClientError::InvalidInput)
    );
    assert_eq!(
        w.edit_notes("invalido\0".into()),
        Err(ClientError::InvalidInput)
    );
    assert_eq!(w.draft_notes(), valid);
}

#[test]
fn exhausted_version_can_be_read_but_never_incremented() {
    let mut w = Workspace::default();
    let read = w.select("patient-a").unwrap();
    let mut p = profile("patient-a");
    p.version = MAX_VERSION;
    assert!(w.receive_read(&read, Ok(p)));
    w.edit_notes("Modifica".into()).unwrap();
    assert_eq!(w.review(), Err(ClientError::VersionExhausted));
    assert_eq!(w.confirm(), Err(ClientError::WrongPhase));
}

#[test]
fn worklist_search_is_unicode_aware_and_does_not_merge_distinct_ids() {
    let mut a = profile("a");
    a.first_name = "Élia".into();
    let mut b = a.clone();
    b.id = "b".into();
    assert!(a.matches_query("  ÉLIA "));
    assert!(a.matches_query("sintetico-001"));
    assert!(a.matches_query(""));
    assert!(!a.matches_query("non presente"));
    assert_ne!(a.id, b.id);
}
