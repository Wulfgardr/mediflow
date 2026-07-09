import SwiftUI

/* @Codex */
struct PairedPatientArchiveSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let isArchived: Bool

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
            }
            .navigationTitle(isArchived ? "Archivia paziente" : "Riattiva paziente")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") {
                        dismiss()
                    }
                    .accessibilityIdentifier("patient-archive-cancel-button")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            await model.setSelectedPatientArchived(isArchived)
                            dismiss()
                        }
                    } label: {
                        Label(isArchived ? "Archivia" : "Riattiva", systemImage: "archivebox")
                    }
                    .disabled(isArchived ? !model.canArchivePatient : !model.canUnarchivePatient)
                    .accessibilityIdentifier(isArchived ? "patient-archive-confirm-button" : "patient-unarchive-confirm-button")
                }
            }
        }
    }

    private var patientName: String {
        guard let patient = model.selectedPatient else { return "Paziente" }
        return "\(patient.lastName) \(patient.firstName)"
    }
}
