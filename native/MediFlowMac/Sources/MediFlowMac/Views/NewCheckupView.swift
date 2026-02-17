// Codex: created 2026-02-01
import SwiftUI

struct NewCheckupView: View {
    @Environment(\.dismiss) private var dismiss

    let patientId: String
    let onCreated: () -> Void

    @State private var title = ""
    @State private var date = Date()
    @State private var status = "pending"
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Form {
                Section("Dettagli") {
                    TextField("Titolo", text: $title)
                    DatePicker("Data", selection: $date, displayedComponents: .date)
                    Picker("Stato", selection: $status) {
                        Text("In attesa").tag("pending")
                        Text("Completato").tag("done")
                        Text("Annullato").tag("cancelled")
                    }
                    .pickerStyle(.segmented)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }

            HStack {
                Button("Annulla") { dismiss() }
                Spacer()
                Button(isSaving ? "Salvataggio..." : "Salva") {
                    Task { await save() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSaving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 520, minHeight: 420)
    }

    @MainActor
    private func save() async {
        if isSaving { return }
        isSaving = true
        defer { isSaving = false }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            errorMessage = "Titolo richiesto"
            return
        }

        do {
            let payload = CreateCheckupPayload(date: date, title: trimmedTitle, status: status)
            _ = try await LocalAPIClient.shared.createCheckup(patientId: patientId, payload: payload)
            onCreated()
            dismiss()
        } catch {
            errorMessage = "Salvataggio fallito"
        }
    }
}
