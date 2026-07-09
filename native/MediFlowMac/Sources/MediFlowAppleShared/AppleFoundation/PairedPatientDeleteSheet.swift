import SwiftUI

/* @Codex */
struct PairedPatientDeleteSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @State private var reason = ""
    @State private var validationMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(patientName)
                        .font(.subheadline.weight(.semibold))
                    TextField("Motivazione (facoltativa)", text: $reason, axis: .vertical)
                        .lineLimit(2...4)
                        .accessibilityIdentifier("patient-delete-reason-field")
                    if let validationMessage {
                        Text(validationMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("patient-delete-validation-message")
                    }
                }
                Section {
                    Text("Il paziente verrà spostato nel Cestino e potrà essere ripristinato da lì. Nessuna eliminazione definitiva dal client paired.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Elimina paziente")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") {
                        dismiss()
                    }
                    .accessibilityIdentifier("patient-delete-cancel-button")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .destructive) {
                        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard trimmed.isEmpty || model.isFieldCryptoUnlocked else {
                            validationMessage = "Riaccedi con il PIN operatore oppure lascia vuota la motivazione."
                            return
                        }
                        Task {
                            await model.softDeleteSelectedPatient(reason: trimmed)
                            dismiss()
                        }
                    } label: {
                        Label("Elimina", systemImage: "trash")
                    }
                    .disabled(!model.canSoftDeletePatient)
                    .accessibilityIdentifier("patient-delete-confirm-button")
                }
            }
        }
    }

    private var patientName: String {
        guard let patient = model.selectedPatient else { return "Paziente" }
        return "\(patient.lastName) \(patient.firstName)"
    }
}
