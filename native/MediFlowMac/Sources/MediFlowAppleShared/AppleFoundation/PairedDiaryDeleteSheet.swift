import SwiftUI

/* @Codex */
struct PairedDiaryDeleteSheet: View {
    @Environment(\.dismiss) private var dismiss
    let entry: HomeBaseEntrySummary
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @State private var reason = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(entry.title)
                        .font(.subheadline.weight(.semibold))
                    TextField("Motivazione (facoltativa)", text: $reason, axis: .vertical)
                        .lineLimit(2...4)
                        .accessibilityIdentifier("entry-delete-reason-field")
                }
                Section {
                    Text("La voce resta nello storico come eliminata. Nessun hard delete viene eseguito dal client paired.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Elimina voce")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Mantieni") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .destructive) {
                        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
                        Task {
                            await model.softDeleteEntry(id: entry.id, reason: trimmed)
                            dismiss()
                        }
                    } label: {
                        Label("Elimina", systemImage: "trash")
                    }
                    .disabled(model.isWorking)
                    .accessibilityIdentifier("entry-delete-confirm-button")
                }
            }
        }
    }
}
