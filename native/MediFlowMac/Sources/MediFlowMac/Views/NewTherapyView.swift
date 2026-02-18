// Codex: created 2026-02-01
import SwiftUI

struct NewTherapyView: View {
    @Environment(\.dismiss) private var dismiss

    let patientId: String
    let onCreated: () -> Void

    @State private var drugName = ""
    @State private var dosage = ""
    @State private var status = "active"
    @State private var startDate = Date()
    @State private var includeEndDate = false
    @State private var endDate = Date()
    @State private var selectedDrug: DrugSummary?
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Form {
                Section("Farmaco") {
                    TextField("Nome farmaco", text: $drugName)
                    DrugSearchField(selection: $selectedDrug)
                        .onChange(of: selectedDrug) { newValue in
                            if let newValue {
                                drugName = newValue.name
                            }
                        }
                }

                Section("Posologia") {
                    TextField("Dosaggio", text: $dosage)
                }

                Section("Stato") {
                    Picker("Stato", selection: $status) {
                        Text("Attiva").tag("active")
                        Text("Sospesa").tag("suspended")
                        Text("Terminata").tag("completed")
                    }
                    .pickerStyle(.segmented)
                }

                Section("Date") {
                    DatePicker("Inizio", selection: $startDate, displayedComponents: .date)
                    Toggle("Data fine", isOn: $includeEndDate)
                    if includeEndDate {
                        DatePicker("", selection: $endDate, displayedComponents: .date)
                            .labelsHidden()
                    }
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
                .disabled(isSaving || drugName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 520, minHeight: 540)
    }

    @MainActor
    private func save() async {
        if isSaving { return }
        isSaving = true
        defer { isSaving = false }

        let trimmedName = drugName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDosage = dosage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            errorMessage = "Nome farmaco richiesto"
            return
        }

        do {
            let payload = CreateTherapyPayload(
                drugName: trimmedName,
                /* @Codex */
                aic: selectedDrug?.aic,
                /* @Codex */
                atc: selectedDrug?.atc,
                dosage: trimmedDosage.isEmpty ? "n/d" : trimmedDosage,
                status: status,
                startDate: startDate,
                endDate: includeEndDate ? endDate : nil
            )
            _ = try await LocalAPIClient.shared.createTherapy(patientId: patientId, payload: payload)
            onCreated()
            dismiss()
        } catch {
            errorMessage = "Salvataggio fallito"
        }
    }
}
