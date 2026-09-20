import SwiftUI

/* @Codex */
struct PairedPatientArchiveSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let isArchived: Bool
    @State private var saveFailed = false // @Codex: draft values stay in the lock-cleared model.

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(patientName)
                        .font(.subheadline.weight(.semibold))
                    Text(isArchived
                         ? "Il paziente passa nella lista Archiviati e può essere riattivato in ogni momento."
                         : "Il paziente torna nella lista Attivi.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if isArchived {
                    Section("Motivo dell’archiviazione") {
                        PatientArchiveFields(model: model)
                    }
                }
                if saveFailed {
                    Section {
                        Text(model.errorMessage ?? model.statusMessage ?? "Salvataggio non confermato.")
                            .font(.callout)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("patient-archive-save-error")
                    }
                }
            }
            .navigationTitle(isArchived ? "Archivia paziente" : "Riattiva paziente")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") {
                        model.cancelPatientArchive() // @Codex
                        dismiss()
                    }
                    .disabled(model.isWorking)
                    .keyboardShortcut(.cancelAction)
                    .accessibilityIdentifier("patient-archive-cancel-button")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            if await model.setSelectedPatientArchived(isArchived) {
                                dismiss()
                            } else {
                                saveFailed = true
                            }
                        }
                    } label: {
                        Label(isArchived ? "Archivia" : "Riattiva", systemImage: "archivebox")
                    }
                    .disabled((isArchived ? !model.canArchivePatient : !model.canUnarchivePatient)
                        || model.patientArchiveValidationMessage(isArchived: isArchived) != nil)
                    .accessibilityIdentifier(isArchived ? "patient-archive-confirm-button" : "patient-unarchive-confirm-button")
                }
            }
            .onAppear { model.startPatientArchive() }
            // @Codex: a picker/rotation can hide this content temporarily. Only
            // explicit cancel, confirmed save or the shared context clear ends it.
            .onChange(of: model.isEditingPatientArchive) { isEditing in
                if !isEditing { dismiss() } // @Codex: lock/revocation clears and closes both views.
            }
            .interactiveDismissDisabled()
        }
    }

    private var patientName: String {
        guard let patient = model.selectedPatient else { return "Paziente" }
        return "\(patient.lastName) \(patient.firstName)"
    }
}

/* @Codex: shared form; no default cause is inferred for an archive transition. */
struct PatientArchiveFields: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Motivo", selection: $model.editPatientArchiveReason) {
                Text("Scegli un motivo").tag("")
                ForEach(PairedPatientsWorkspaceModel.PatientArchiveReason.allCases, id: \.rawValue) { reason in
                    Text(reason.label).tag(reason.rawValue)
                }
                if !model.editPatientArchiveReason.isEmpty,
                   PairedPatientsWorkspaceModel.PatientArchiveReason(rawValue: model.editPatientArchiveReason) == nil {
                    Text("Valore esistente: \(model.editPatientArchiveReason)").tag(model.editPatientArchiveReason)
                }
            }
            .disabled(model.isPatientFieldLocked(.archiveReason))
            .accessibilityIdentifier("patient-archive-reason")
            TextField(model.editPatientArchiveReason == "other" ? "Motivazione (obbligatoria)" : "Nota (facoltativa)",
                text: $model.editPatientArchiveNote, axis: .vertical)
                .lineLimit(3...6)
                .disabled(model.isPatientFieldLocked(.archiveNote))
                .accessibilityIdentifier("patient-archive-note")
            if let validation = model.patientArchiveValidationMessage(isArchived: true) {
                Text(validation)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("patient-archive-validation")
            }
        }
        .disabled(model.isWorking)
    }
}
