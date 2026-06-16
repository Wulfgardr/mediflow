// Codex: created 2026-02-01
import SwiftUI

struct NewTherapyView: View {
    @Environment(\.dismiss) private var dismiss

    let patientId: String
    let onCreated: () -> Void

    @State private var drugName = ""
    @State private var activePrinciple = ""
    @State private var dosage = ""
    @State private var motivation = ""
    @State private var status = "active"
    @State private var startDate = Date()
    @State private var includeEndDate = false
    @State private var endDate = Date()
    @State private var isManualDrug = false
    @State private var selectedDrug: DrugSummary?
    @State private var selectedICD: ICDResult?
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Form {
                Section("Farmaco") {
                    Toggle("Farmaco manuale / galenico", isOn: $isManualDrug)
                        .onChange(of: isManualDrug) { newValue in
                            if newValue {
                                selectedDrug = nil
                            }
                        }
                    TextField("Nome farmaco", text: $drugName)
                    DrugSearchField(selection: $selectedDrug)
                        .onChange(of: selectedDrug) { newValue in
                            if let newValue {
                                drugName = newValue.name
                                activePrinciple = newValue.activePrinciple ?? ""
                                isManualDrug = false
                            }
                        }
                        .disabled(isManualDrug)
                    TextField("Principio attivo", text: $activePrinciple)
                        .disabled(!isManualDrug && selectedDrug != nil)
                    if let selectedDrug {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("AIC \(selectedDrug.aic)")
                            if let atc = selectedDrug.atc {
                                Text("ATC \(atc)")
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }

                Section("Posologia") {
                    TextField("Dosaggio", text: $dosage)
                }

                Section("Indicazione") {
                    ICDSearchField(selection: $selectedICD)
                    HStack {
                        Button("Prevenzione") {
                            selectedICD = ICDResult(code: "PREV", description: "Prevenzione", system: "MediFlow")
                        }
                        Button("Nessuna indicazione") {
                            selectedICD = ICDResult(code: "NONE", description: "Nessuna indicazione", system: "MediFlow")
                        }
                        if selectedICD != nil {
                            Button("Cancella") {
                                selectedICD = nil
                            }
                        }
                    }
                    if let selectedICD {
                        Text("\(selectedICD.code) · \(selectedICD.description)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Motivazione") {
                    TextEditor(text: $motivation)
                        .frame(minHeight: 80)
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
        let trimmedActivePrinciple = activePrinciple.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedMotivation = motivation.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            errorMessage = "Nome farmaco richiesto"
            return
        }
        guard !trimmedDosage.isEmpty else {
            errorMessage = "Dosaggio richiesto"
            return
        }

        do {
            let payload = CreateTherapyPayload(
                drugName: trimmedName,
                /* @Codex */
                aic: isManualDrug ? nil : selectedDrug?.aic,
                /* @Codex */
                atc: isManualDrug ? nil : selectedDrug?.atc,
                /* @Codex */
                activePrinciple: trimmedActivePrinciple.isEmpty ? nil : trimmedActivePrinciple,
                dosage: trimmedDosage,
                /* @Codex */
                motivation: trimmedMotivation.isEmpty ? nil : trimmedMotivation,
                /* @Codex */
                diagnosisCode: selectedICD?.code,
                /* @Codex */
                diagnosisName: selectedICD?.description,
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
