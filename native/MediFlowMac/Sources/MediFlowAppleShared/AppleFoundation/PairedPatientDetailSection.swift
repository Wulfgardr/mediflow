import SwiftUI

/* @Codex */
struct PairedPatientDetailSection: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let detail: HomeBasePatientDetail
    @Binding var patientLifecycleSheet: PatientLifecycleSheet?
    @Binding var icdQuery: String
    @Binding var confirmsFHIRExport: Bool

    var body: some View {
        let exemptions = ExemptionCodesCodec.decode(detail.exemptions)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Anagrafica", systemImage: "person.text.rectangle")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Button {
                    model.startEditingPatient()
                } label: {
                    Label("Modifica", systemImage: "pencil")
                }
                .font(.caption)
                .disabled(model.isEditingPatient)
                .accessibilityIdentifier("edit-patient-button")
                if detail.isArchived == true {
                    Button {
                        patientLifecycleSheet = .unarchive
                    } label: {
                        Label("Riattiva", systemImage: "archivebox")
                    }
                    .font(.caption)
                    .disabled(!model.canUnarchivePatient)
                    .accessibilityIdentifier("unarchive-patient-button")
                } else {
                    Button {
                        patientLifecycleSheet = .archive
                    } label: {
                        Label("Archivia", systemImage: "archivebox")
                    }
                    .font(.caption)
                    .disabled(!model.canArchivePatient)
                    .accessibilityIdentifier("archive-patient-button")
                }
                Button(role: .destructive) {
                    patientLifecycleSheet = .delete
                } label: {
                    Label("Elimina", systemImage: "trash")
                }
                .font(.caption)
                .disabled(!model.canSoftDeletePatient)
                .accessibilityIdentifier("soft-delete-patient-button")
                Button {
                    confirmsFHIRExport = true
                } label: {
                    Label("Esporta FHIR", systemImage: "doc.badge.arrow.up")
                }
                .font(.caption)
                .disabled(!model.canPrepareFHIRExport)
                .accessibilityIdentifier("patient-export-fhir-button")
                if let fhirURL = model.patientFHIRExportURL {
                    ShareLink(item: fhirURL) {
                        Label("Condividi FHIR", systemImage: "square.and.arrow.up")
                            .font(.caption)
                    }
                    .accessibilityIdentifier("patient-share-fhir-button")
                }
                Button {
                    Task { await model.openPrregHandoff() }
                } label: {
                    Label("Prescrittivo regionale", systemImage: "arrow.up.forward.app")
                }
                .font(.caption)
                .accessibilityIdentifier("patient-prreg-handoff-button")
            }
            Text("\(detail.lastName) \(detail.firstName)")
                .font(.title3.weight(.semibold))
                .accessibilityIdentifier("patient-detail-name")
            if detail.isAdi == true || detail.isArchived == true {
                HStack(spacing: 6) {
                    if detail.isAdi == true { PairedPatientFlagChip("ADI", tone: .info) }
                    if detail.isArchived == true { PairedPatientFlagChip("Archiviato", tone: .neutral) }
                }
            }
            patientSignals(detail, exemptionsCount: exemptions.count)
            VStack(alignment: .leading, spacing: 4) {
                InfoRow("Codice fiscale", detail.taxCode)
                    .registro()
                if let birth = detail.birthDate {
                    InfoRow("Data di nascita", PairedPatientsWorkspaceSupport.birthDateFormatter.string(from: birth))
                        .registro()
                }
                if let address = cleanedPatientWorkspaceValue(detail.address) { InfoRow("Indirizzo", address) }
                if let phone = cleanedPatientWorkspaceValue(detail.phone) { InfoRow("Telefono", phone) }
                if let caregiver = cleanedPatientWorkspaceValue(detail.caregiver) { InfoRow("Caregiver", caregiver) }
                if let ambulatory = cleanedPatientWorkspaceValue(detail.ambulatoryId) { InfoRow("Ambulatorio", ambulatory) }
                if let monitoring = cleanedPatientWorkspaceValue(detail.monitoringProfile) { InfoRow("Monitoraggio", monitoring) }
            }
            if !exemptions.isEmpty {
                InfoRow("Esenzioni", exemptions.joined(separator: " · "))
                    .registro()
                    .accessibilityIdentifier("patient-detail-exemptions")
            }
            let diagnoses = DiagnosesCodec.decode(detail.diagnoses)
            if !diagnoses.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Diagnosi")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ForEach(Array(diagnoses.enumerated()), id: \.offset) { _, diagnosis in
                        Text(diagnosis.displayText)
                            .font(.callout)
                    }
                }
                .accessibilityIdentifier("patient-detail-diagnoses")
            }
            if let aiSummary = cleanedPatientWorkspaceValue(detail.aiSummary) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Sintesi AI", systemImage: "sparkles")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(aiSummary)
                        .font(.callout)
                }
                .accessibilityIdentifier("patient-detail-ai-summary")
            }
            if let documentInsights = cleanedPatientWorkspaceValue(detail.documentInsights) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Analisi documenti", systemImage: "doc.text.magnifyingglass")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(documentInsights)
                        .font(.callout)
                }
                .accessibilityIdentifier("patient-detail-document-insights")
            }
            if let statusReason = cleanedPatientWorkspaceValue(detail.statusReason) {
                Text(statusReason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let notes = cleanedPatientWorkspaceValue(detail.notes) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Note")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(notes)
                        .font(.callout)
                }
            }
            if model.isEditingPatient {
                Divider()
                patientEditForm
            }
        }
    }

    private var patientEditForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Modifica anagrafica")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Nome", text: $model.editPatientFirstName)
                .accessibilityIdentifier("edit-patient-firstName")
            TextField("Cognome", text: $model.editPatientLastName)
                .accessibilityIdentifier("edit-patient-lastName")
            TextField("Codice fiscale", text: $model.editPatientTaxCode)
                .accessibilityIdentifier("edit-patient-taxCode")
            /* @Codex */
            TextField("Indirizzo", text: $model.editPatientAddress)
                .accessibilityIdentifier("edit-patient-address")
                .disabled(model.isPatientFieldLocked(.address))
            TextField("Telefono", text: $model.editPatientPhone)
                .accessibilityIdentifier("edit-patient-phone")
                .disabled(model.isPatientFieldLocked(.phone))
            TextField("Caregiver", text: $model.editPatientCaregiver)
                .accessibilityIdentifier("edit-patient-caregiver")
                .disabled(model.isPatientFieldLocked(.caregiver))
            TextField("Note", text: $model.editPatientNotes, axis: .vertical)
                .accessibilityIdentifier("edit-patient-notes")
                .disabled(model.isPatientFieldLocked(.notes))
            if !model.lockedPatientFields.isEmpty {
                Label("Alcuni dati cifrati non sono disponibili e non verranno modificati.", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("edit-patient-locked-fields-message")
            }
            Toggle("Archiviato", isOn: $model.editPatientIsArchived)
                .accessibilityIdentifier("edit-patient-archived")
            Toggle("ADI (assistenza domiciliare)", isOn: $model.editPatientIsAdi)
                .accessibilityIdentifier("edit-patient-adi")

            VStack(alignment: .leading, spacing: 4) {
                Text("Diagnosi")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(Array(model.editPatientDiagnoses.enumerated()), id: \.offset) { index, diagnosis in
                    HStack {
                        Text(diagnosis.displayText)
                            .font(.callout)
                        Spacer(minLength: 8)
                        Button(role: .destructive) {
                            model.removeDiagnosis(at: IndexSet(integer: index))
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .accessibilityIdentifier("remove-diagnosis-\(index)")
                    }
                }
                // A14: in-app ICD search (ADR 0070), no external proxy. Tapping a
                // result adds the coded diagnosis with its system.
                TextField("Cerca ICD (in-app)", text: $icdQuery)
                    .accessibilityIdentifier("icd-search-field")
                if !icdQuery.isEmpty {
                    ForEach(ICDCatalog.search(icdQuery, limit: 6)) { icd in
                        Button {
                            model.addDiagnosis(code: icd.code, description: icd.description, system: icd.system)
                            icdQuery = ""
                        } label: {
                            HStack(alignment: .firstTextBaseline) {
                                Text("\(icd.code)  \(icd.description)")
                                    .font(.caption)
                                    .registro()
                                    .multilineTextAlignment(.leading)
                                Spacer(minLength: 4)
                                Image(systemName: "plus.circle")
                            }
                        }
                        .accessibilityIdentifier("icd-result-\(icd.code)")
                    }
                }
                HStack(spacing: 6) {
                    TextField("Codice", text: $model.newDiagnosisCode)
                        .accessibilityIdentifier("new-diagnosis-code")
                        .frame(maxWidth: 120)
                    TextField("Descrizione", text: $model.newDiagnosisDescription)
                        .accessibilityIdentifier("new-diagnosis-description")
                    Button {
                        model.addDiagnosis()
                    } label: {
                        Image(systemName: "plus.circle")
                    }
                    .accessibilityIdentifier("add-diagnosis-button")
                }
            }
            /* @Codex */
            .disabled(model.isPatientFieldLocked(.diagnoses))

            VStack(alignment: .leading, spacing: 4) {
                Text("Esenzioni")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                if model.editPatientExemptions.isEmpty {
                    Text("Nessuna esenzione")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                ForEach(model.editPatientExemptions, id: \.self) { code in
                    HStack {
                        Text(code)
                            .font(.callout)
                            .registro()
                        Spacer(minLength: 8)
                        Button(role: .destructive) {
                            model.removeExemption(code)
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .accessibilityIdentifier("remove-exemption-\(code)")
                    }
                }
                HStack(spacing: 6) {
                    TextField("Codice esenzione", text: $model.newExemptionCode)
                        .accessibilityIdentifier("new-exemption-code")
                        .frame(maxWidth: 160)
                        .onChange(of: model.newExemptionCode) { _ in
                            model.scheduleExemptionCatalogSearch()
                        }
                    Button {
                        model.addExemption()
                    } label: {
                        Image(systemName: "plus.circle")
                    }
                    .accessibilityIdentifier("add-exemption-button")
                }
                exemptionCatalogResultsList
            }
            /* @Codex */
            .disabled(model.isPatientFieldLocked(.exemptions))

            HStack(spacing: 10) {
                Button("Salva") {
                    Task { await model.savePatient() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isWorking)
                .accessibilityIdentifier("save-patient-button")
                Button("Annulla") {
                    model.cancelEditingPatient()
                }
                .accessibilityIdentifier("cancel-patient-button")
            }
        }
        .textFieldStyle(.roundedBorder)
    }

    /* @Codex */
    @ViewBuilder
    private var exemptionCatalogResultsList: some View {
        if model.isSearchingExemptionCatalog
            || model.exemptionCatalogStatusMessage != nil
            || !model.exemptionCatalogResults.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                if model.isSearchingExemptionCatalog {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Ricerca catalogo esenzioni")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if let status = model.exemptionCatalogStatusMessage {
                    Text(status)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                ForEach(model.exemptionCatalogResults) { exemption in
                    Button {
                        model.selectExemptionCatalogResult(exemption)
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(exemption.code)
                                .font(.caption.monospaced().weight(.semibold))
                                .registro()
                            Text(exemption.description)
                                .font(.caption)
                                .lineLimit(2)
                            Spacer(minLength: 4)
                            Image(systemName: "plus.circle")
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("exemption-catalog-result-\(exemption.code)")
                }
            }
        }
    }


    private func signalTile(_ icon: String, _ signal: ClinicalSignalCount, _ label: String) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(signal.displayText)
                    .font(.callout.weight(.semibold))
                    .monospacedDigit()
            }
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    // Quadro clinical-signals strip (parity with the web "segnali clinici"): counts
    // derived from the already-loaded collections + the next upcoming follow-up.
    @ViewBuilder
    private func patientSignals(_ detail: HomeBasePatientDetail, exemptionsCount: Int) -> some View {
        let cap = PairedPatientsWorkspaceSupport.clinicalPreviewCap
        let problemi = DiagnosesCodec.decode(detail.diagnoses).count
        let terapie = model.therapies.filter { $0.deletedAt == nil && $0.status == "active" }.count
        let parametri = model.observations.filter { $0.deletedAt == nil }.count
        let diario = model.entries.filter { $0.deletedAt == nil }.count
        let scale = model.entries.filter { $0.deletedAt == nil && $0.type == "scale" }.count
        let nextCheckup = model.checkups
            .filter { $0.deletedAt == nil && $0.status == "pending" && $0.date >= Date() }
            .min(by: { $0.date < $1.date })
        VStack(alignment: .leading, spacing: 6) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 8)], spacing: 8) {
                signalTile("cross.case", .exact(problemi), "Problemi")
                signalTile(
                    "pills",
                    .fromLoadedList(count: terapie, loadedCount: model.therapies.count, limit: cap),
                    "Terapie"
                )
                signalTile(
                    "waveform.path.ecg",
                    .fromLoadedList(count: parametri, loadedCount: model.observations.count, limit: cap),
                    "Parametri"
                )
                signalTile(
                    "list.bullet.clipboard",
                    .fromLoadedList(count: diario, loadedCount: model.entries.count, limit: cap),
                    "Diario"
                )
                signalTile(
                    "checklist",
                    .fromLoadedList(count: scale, loadedCount: model.entries.count, limit: cap),
                    "Scale"
                )
                signalTile("seal", .exact(exemptionsCount), "Esenzioni")
            }
            .accessibilityIdentifier("patient-clinical-signals")
            if let next = nextCheckup {
                HStack(spacing: 6) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("Prossimo follow-up: \(PairedPatientsWorkspaceSupport.birthDateFormatter.string(from: next.date)) · \(next.title)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("patient-next-followup")
            }
        }
    }

}
