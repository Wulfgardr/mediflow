import SwiftUI

/* @Codex */
struct PairedPatientTherapiesSection: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @Binding var therapyStatusFilter: TherapyStatusFilter
    @Binding var confirmsDeletingTherapy: Bool
    @Binding var therapyDeletionCandidateId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Terapie", systemImage: "pills")
                        .font(.subheadline.weight(.semibold))
                    Text("Ultime \(PairedPatientsWorkspaceSupport.clinicalPreviewCap) terapie")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button {
                    Task { await model.loadSelectedPatientTherapies() }
                } label: {
                    Label("Aggiorna", systemImage: "arrow.clockwise")
                }
                .font(.caption)
                .disabled(model.isWorking || model.selectedPatient == nil)
                .accessibilityIdentifier("homebase-refresh-therapies-button")

                Button {
                    model.generatePatientReportPDF()
                } label: {
                    Label("Report PDF", systemImage: "doc.richtext")
                        .font(.caption)
                }
                .disabled(model.selectedPatient == nil)
                .accessibilityIdentifier("patient-report-pdf-button")

                if let reportURL = model.patientReportURL {
                    ShareLink(item: reportURL) {
                        Label("Condividi", systemImage: "square.and.arrow.up")
                            .font(.caption)
                    }
                    .accessibilityIdentifier("share-patient-report-pdf-button")
                }

                if !model.therapies.isEmpty {
                    ShareLink(item: TherapyPlanDocument.plainText(
                        patientName: model.selectedPatient.map { "\($0.firstName) \($0.lastName)" } ?? "Paziente",
                        therapies: model.therapies,
                        dateLabel: PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: Date())
                    )) {
                        Label("Esporta", systemImage: "square.and.arrow.up")
                            .font(.caption)
                    }
                    .accessibilityIdentifier("export-therapy-plan-button")
                }

                Menu {
                    Picker("Stato terapie", selection: $therapyStatusFilter) {
                        ForEach(TherapyStatusFilter.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                } label: {
                    Label(therapyStatusFilter.title, systemImage: "line.3.horizontal.decrease.circle")
                        .font(.caption)
                }
                .accessibilityIdentifier("therapy-status-filter")
            }

            if model.therapies.isEmpty {
                Text("Nessuna terapia caricata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                let filteredTherapies = TherapyFiltering.apply(model.therapies, filter: therapyStatusFilter)
                if filteredTherapies.isEmpty {
                    Text("Nessuna terapia per questo filtro.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(filteredTherapies, id: \.id) { therapy in
                        therapyRow(therapy)
                            .accessibilityIdentifier("therapy-row-\(therapy.id)")
                    }
                }
            }

            if model.isEditingTherapy {
                Divider()
                therapyForm(
                    title: "Modifica terapia online",
                    drugName: $model.editTherapyDrugName,
                    aic: $model.editTherapyAIC,
                    atc: $model.editTherapyATC,
                    activePrinciple: $model.editTherapyActivePrinciple,
                    dosage: $model.editTherapyDosage,
                    motivation: $model.editTherapyMotivation,
                    status: $model.editTherapyStatus,
                    startDate: $model.editTherapyStartDate,
                    hasEndDate: $model.editTherapyHasEndDate,
                    endDate: $model.editTherapyEndDate,
                    diagnosisCode: $model.editTherapyDiagnosisCode,
                    diagnosisOptions: model.currentPatientDiagnoses,
                    drugCatalogResults: model.editTherapyDrugCatalogResults,
                    isSearchingDrugCatalog: model.isSearchingEditTherapyDrugCatalog,
                    drugCatalogStatusMessage: model.drugCatalogStatusMessage,
                    primaryLabel: "Salva modifiche",
                    primaryIdentifier: "homebase-update-therapy-button",
                    canSubmit: model.canUpdateEditingTherapy,
                    onDrugQueryChanged: { model.scheduleEditTherapyDrugCatalogSearch() },
                    onSelectDrug: { model.selectEditTherapyDrugCatalogResult($0) },
                    onCancel: { model.cancelEditingTherapy() },
                    onSubmit: { Task { await model.updateEditingTherapy() } }
                )
                Text("Disponibile solo online. Se la versione non coincide, ricarica le terapie prima di riprovare.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Divider()

            therapyForm(
                title: "Nuova terapia online",
                drugName: $model.newTherapyDrugName,
                aic: $model.newTherapyAIC,
                atc: $model.newTherapyATC,
                activePrinciple: $model.newTherapyActivePrinciple,
                dosage: $model.newTherapyDosage,
                motivation: $model.newTherapyMotivation,
                status: $model.newTherapyStatus,
                startDate: $model.newTherapyStartDate,
                hasEndDate: $model.newTherapyHasEndDate,
                endDate: $model.newTherapyEndDate,
                diagnosisCode: $model.newTherapyDiagnosisCode,
                diagnosisOptions: model.currentPatientDiagnoses,
                drugCatalogResults: model.newTherapyDrugCatalogResults,
                isSearchingDrugCatalog: model.isSearchingNewTherapyDrugCatalog,
                drugCatalogStatusMessage: model.drugCatalogStatusMessage,
                primaryLabel: "Salva terapia",
                primaryIdentifier: "homebase-create-therapy-button",
                canSubmit: model.canCreateTherapy,
                onDrugQueryChanged: { model.scheduleNewTherapyDrugCatalogSearch() },
                onSelectDrug: { model.selectNewTherapyDrugCatalogResult($0) },
                onCancel: nil,
                onSubmit: { Task { await model.createTherapyForSelectedPatient() } }
            )
            Text("Solo campi non-AI. Nessuna prescrizione SISS nativa o coda offline.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    // Semantic status color (Vetro Clinico tone), or attention if soft-deleted.
    // Kept as tinted text rather than a glass badge: Liquid Glass is for the
    // control/navigation layer, not every content row.
    private func therapyStatusColor(_ therapy: HomeBaseTherapySummary) -> Color {
        if therapy.deletedAt != nil { return VetroPalette.tint(for: .attention) }
        return VetroPalette.tint(for: PairedTherapyStatus(rawValue: therapy.status)?.tone ?? .neutral)
    }

    /* @Codex */
    private func therapyRow(_ therapy: HomeBaseTherapySummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(therapy.drugName)
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 8)
                Text(PairedTherapyStatus(rawValue: therapy.status)?.title ?? therapy.status)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(therapyStatusColor(therapy))
            }
            Text(therapy.dosage)
                .font(.caption)
                .foregroundStyle(therapy.deletedAt == nil ? .primary : .secondary)
                .lineLimit(2)
            if let activePrinciple = therapy.activePrinciple, !activePrinciple.isEmpty {
                Text(activePrinciple)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if therapy.aic?.trimmedOrNil != nil || therapy.atc?.trimmedOrNil != nil {
                HStack(spacing: 6) {
                    if let aic = therapy.aic?.trimmedOrNil {
                        Text("AIC \(aic)")
                            .font(.caption2.monospaced().weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    if let atc = therapy.atc?.trimmedOrNil {
                        Text("ATC \(atc)")
                            .font(.caption2.monospaced().weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if let motivation = therapy.motivation, !motivation.isEmpty {
                Text(motivation)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Text(PairedPatientsWorkspaceSupport.therapyDateLine(for: therapy))
                .font(.caption2)
                .foregroundStyle(.secondary)
            if therapy.deletedAt != nil {
                Text("Terapia annullata")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.orange)
            } else if model.canMutateTherapy(therapy) {
                HStack(spacing: 8) {
                    Button {
                        model.startEditingTherapy(therapy)
                    } label: {
                        Label("Modifica", systemImage: "pencil")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-edit-therapy-button-\(therapy.id)")

                    Button(role: .destructive) {
                        therapyDeletionCandidateId = therapy.id
                        confirmsDeletingTherapy = true
                    } label: {
                        Label("Annulla", systemImage: "xmark.circle")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-delete-therapy-button-\(therapy.id)")
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    private func therapyForm(
        title: String,
        drugName: Binding<String>,
        aic: Binding<String>,
        atc: Binding<String>,
        activePrinciple: Binding<String>,
        dosage: Binding<String>,
        motivation: Binding<String>,
        status: Binding<PairedTherapyStatus>,
        startDate: Binding<Date>,
        hasEndDate: Binding<Bool>,
        endDate: Binding<Date>,
        diagnosisCode: Binding<String>,
        diagnosisOptions: [ClinicalDiagnosis],
        drugCatalogResults: [HomeBaseDrugSummary],
        isSearchingDrugCatalog: Bool,
        drugCatalogStatusMessage: String?,
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onDrugQueryChanged: @escaping () -> Void,
        onSelectDrug: @escaping (HomeBaseDrugSummary) -> Void,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "pills")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Farmaco", text: drugName)
                .accessibilityIdentifier("\(primaryIdentifier)-drug-name")
                .onChange(of: drugName.wrappedValue) { _ in
                    onDrugQueryChanged()
                }
            drugCatalogResultsList(
                results: drugCatalogResults,
                isLoading: isSearchingDrugCatalog,
                statusMessage: drugCatalogStatusMessage,
                primaryIdentifier: primaryIdentifier,
                onSelect: onSelectDrug
            )
            TextField("Codice AIC (opzionale)", text: aic)
                .autocorrectionDisabled()
                .accessibilityIdentifier("\(primaryIdentifier)-aic")
            TextField("Codice ATC (opzionale)", text: atc)
                .autocorrectionDisabled()
                .accessibilityIdentifier("\(primaryIdentifier)-atc")
            TextField("Principio attivo (opzionale)", text: activePrinciple)
                .accessibilityIdentifier("\(primaryIdentifier)-active-principle")
            TextField("Posologia", text: dosage)
                .accessibilityIdentifier("\(primaryIdentifier)-dosage")
            TextField("Motivazione (opzionale)", text: motivation)
                .accessibilityIdentifier("\(primaryIdentifier)-motivation")
            if !diagnosisOptions.isEmpty {
                Picker("Diagnosi collegata", selection: diagnosisCode) {
                    Text("Nessuna").tag("")
                    ForEach(diagnosisOptions, id: \.code) { diagnosis in
                        Text(diagnosis.displayText).tag(diagnosis.code)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("\(primaryIdentifier)-diagnosis")
            }
            Picker("Stato", selection: status) {
                ForEach(PairedTherapyStatus.allCases) { status in
                    Text(status.title).tag(status)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("\(primaryIdentifier)-status")
            DatePicker("Inizio", selection: startDate, displayedComponents: .date)
                .accessibilityIdentifier("\(primaryIdentifier)-start-date")
            Toggle("Fine terapia", isOn: hasEndDate)
                .accessibilityIdentifier("\(primaryIdentifier)-has-end-date")
            if hasEndDate.wrappedValue {
                DatePicker("Fine", selection: endDate, displayedComponents: .date)
                    .accessibilityIdentifier("\(primaryIdentifier)-end-date")
            }
            HStack(spacing: 8) {
                if let onCancel {
                    Button("Annulla") {
                        onCancel()
                    }
                    .font(.caption)
                }
                Button {
                    onSubmit()
                } label: {
                    Label(primaryLabel, systemImage: "checkmark.circle")
                }
                .font(.caption)
                .disabled(!canSubmit)
                .accessibilityIdentifier(primaryIdentifier)
            }
        }
    }

    /* @Codex */
    @ViewBuilder
    private func drugCatalogResultsList(
        results: [HomeBaseDrugSummary],
        isLoading: Bool,
        statusMessage: String?,
        primaryIdentifier: String,
        onSelect: @escaping (HomeBaseDrugSummary) -> Void
    ) -> some View {
        if isLoading || statusMessage != nil || !results.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                if isLoading {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Ricerca catalogo AIFA")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if let statusMessage {
                    Text(statusMessage)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                ForEach(results) { drug in
                    Button {
                        onSelect(drug)
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(drug.name)
                                    .font(.caption.weight(.semibold))
                                    .lineLimit(2)
                                if let principle = drug.activePrinciple?.trimmedOrNil {
                                    Text(principle)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                HStack(spacing: 6) {
                                    Text("AIC \(drug.aic)")
                                    if let atc = drug.atc?.trimmedOrNil {
                                        Text("ATC \(atc)")
                                    }
                                }
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 4)
                            Image(systemName: "checkmark.circle")
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("\(primaryIdentifier)-drug-catalog-result-\(drug.aic)")
                }
            }
        }
    }

    /* @Codex */
}
