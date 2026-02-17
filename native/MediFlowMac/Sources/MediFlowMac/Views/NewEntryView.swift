// Codex: created 2026-02-01
import SwiftUI

struct NewEntryView: View {
    @EnvironmentObject private var security: SecuritySession
    @Environment(\.dismiss) private var dismiss

    let patientId: String
    let onCreated: () -> Void

    @State private var entryType = "visit"
    @State private var date = Date()
    @State private var content = ""
    @State private var selectedICD: ICDResult?
    @State private var selectedDrug: DrugSummary?
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Form {
                Section("Dettagli") {
                    Picker("Tipo", selection: $entryType) {
                        ForEach(entryTypes, id: \.value) { item in
                            Text(item.label).tag(item.value)
                        }
                    }
                    DatePicker("Data", selection: $date, displayedComponents: .date)
                    TextEditor(text: $content)
                        .frame(minHeight: 120)
                }

                Section("Diagnosi ICD-11 (opzionale)") {
                    ICDSearchField(selection: $selectedICD)
                }

                Section("Farmaco correlato (opzionale)") {
                    DrugSearchField(selection: $selectedDrug)
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
                .disabled(isSaving || content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 540, minHeight: 600)
    }

    private var entryTypes: [(label: String, value: String)] {
        [
            ("Visita", "visit"),
            ("Telefonata", "phone"),
            ("Esame", "exam"),
            ("Ricovero", "hospitalization"),
            ("Accesso", "access"),
            ("Nota", "note"),
            ("Scala", "scale"),
            ("Telemedicina", "remote")
        ]
    }

    @MainActor
    private func save() async {
        if isSaving { return }
        isSaving = true
        defer { isSaving = false }

        let finalContent = composeContent()
        guard !finalContent.isEmpty else {
            errorMessage = "Contenuto richiesto"
            return
        }

        do {
            guard let encrypted = try security.encryptString(finalContent) else {
                errorMessage = "Impossibile cifrare il contenuto"
                return
            }
            let payload = CreateEntryPayload(type: entryType, date: date, content: encrypted)
            _ = try await LocalAPIClient.shared.createEntry(patientId: patientId, payload: payload)
            onCreated()
            dismiss()
        } catch {
            errorMessage = "Salvataggio fallito"
        }
    }

    private func composeContent() -> String {
        var lines: [String] = []
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            lines.append(trimmed)
        }

        if let icd = selectedICD {
            lines.append("Diagnosi ICD-11: \(icd.code) - \(icd.description)")
        }

        if let drug = selectedDrug {
            lines.append("Farmaco: \(drug.name)")
        }

        return lines.joined(separator: "\n")
    }
}
