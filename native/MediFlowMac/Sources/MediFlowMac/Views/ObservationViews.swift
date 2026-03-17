import SwiftUI

/* @Codex */
struct ObservationRowView: View {
    let observation: ObservationSummary
    let onEdit: (() -> Void)?
    let onDelete: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "waveform.path.ecg")
                .font(.title3)
                .foregroundColor(.accentColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(observation.display)
                        .font(.headline)
                    Spacer()
                    Text(dateFormatter.string(from: observation.observedAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text("\(observation.codeSystem): \(observation.code) • \(observation.unitSystem): \(observation.unitCode)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("\(observation.value) \(observation.unitCode)")
                    .font(.callout.weight(.semibold))
                if let notes = observation.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }

            if onEdit != nil || onDelete != nil {
                Menu {
                    if let onEdit {
                        Button("Modifica", action: onEdit)
                    }
                    if let onDelete {
                        Button("Elimina", role: .destructive, action: onDelete)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
            }
        }
    }

    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }
}

/* @Codex */
struct NewObservationView: View {
    let patientId: String
    let onSaved: () -> Void

    var body: some View {
        ObservationEditorView(patientId: patientId, observation: nil, onSaved: onSaved)
    }
}

/* @Codex */
struct EditObservationView: View {
    let patientId: String
    let observation: ObservationSummary
    let onSaved: () -> Void

    var body: some View {
        ObservationEditorView(patientId: patientId, observation: observation, onSaved: onSaved)
    }
}

/* @Codex */
private struct ObservationEditorView: View {
    @Environment(\.dismiss) private var dismiss

    let patientId: String
    let observation: ObservationSummary?
    let onSaved: () -> Void

    @State private var loincOptions: [TerminologySearchItem]
    @State private var ucumOptions: [TerminologySearchItem]
    @State private var selectedCode: String
    @State private var selectedUnitCode: String
    @State private var value: String
    @State private var observedAt: Date
    @State private var notes: String
    @State private var isLoadingOptions = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(patientId: String, observation: ObservationSummary?, onSaved: @escaping () -> Void) {
        self.patientId = patientId
        self.observation = observation
        self.onSaved = onSaved
        _loincOptions = State(initialValue: [])
        _ucumOptions = State(initialValue: [])
        _selectedCode = State(initialValue: observation?.code ?? "8480-6")
        _selectedUnitCode = State(initialValue: observation?.unitCode ?? "mm[Hg]")
        _value = State(initialValue: observation?.value ?? "")
        _observedAt = State(initialValue: observation?.observedAt ?? Date())
        _notes = State(initialValue: observation?.notes ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Form {
                Section("Coding") {
                    if isLoadingOptions && loincOptions.isEmpty && ucumOptions.isEmpty {
                        ProgressView("Caricamento cataloghi...")
                    }

                    Picker("Parametro (LOINC)", selection: $selectedCode) {
                        ForEach(loincOptions) { item in
                            Text("\(item.code) - \(item.display)").tag(item.code)
                        }
                    }
                    .pickerStyle(.menu)

                    Picker("Unità (UCUM)", selection: $selectedUnitCode) {
                        ForEach(ucumOptions) { item in
                            Text("\(item.code) - \(item.display)").tag(item.code)
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section("Rilevazione") {
                    TextField("Valore", text: $value)
                    DatePicker(
                        "Data/Ora",
                        selection: $observedAt,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Note")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextEditor(text: $notes)
                            .frame(minHeight: 140)
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
                Button(isSaving ? "Salvataggio..." : saveButtonTitle) {
                    Task { await save() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSaving || isLoadingOptions || loincOptions.isEmpty || ucumOptions.isEmpty || value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 540, minHeight: 560)
        .task {
            await loadTerminologyOptions()
        }
    }

    private var saveButtonTitle: String {
        observation == nil ? "Aggiungi osservazione" : "Salva modifiche"
    }

    @MainActor
    private func loadTerminologyOptions() async {
        if isLoadingOptions { return }
        isLoadingOptions = true
        errorMessage = nil
        defer { isLoadingOptions = false }

        do {
            async let loincTask = LocalAPIClient.shared.searchTerminology(system: "LOINC", query: "", limit: 100)
            async let ucumTask = LocalAPIClient.shared.searchTerminology(system: "UCUM", query: "", limit: 100)
            loincOptions = try await loincTask
            ucumOptions = try await ucumTask
            ensureSelectedOptionsArePresent()
        } catch {
            loincOptions = []
            ucumOptions = []
            errorMessage = "Impossibile caricare i cataloghi LOINC/UCUM."
        }
    }

    @MainActor
    private func save() async {
        if isSaving { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedValue.isEmpty else {
            errorMessage = "Valore richiesto"
            return
        }

        guard let selectedLoinc = loincOptions.first(where: { $0.code == selectedCode }) else {
            errorMessage = "Seleziona un parametro LOINC valido"
            return
        }

        guard let selectedUcum = ucumOptions.first(where: { $0.code == selectedUnitCode }) else {
            errorMessage = "Seleziona una unità UCUM valida"
            return
        }

        do {
            if let observation {
                let payload = UpdateObservationPayload(
                    codeSystem: selectedLoinc.system,
                    code: selectedLoinc.code,
                    display: selectedLoinc.display,
                    unitSystem: selectedUcum.system,
                    unitCode: selectedUcum.code,
                    value: trimmedValue,
                    notes: trimmedNotes.isEmpty ? "" : trimmedNotes,
                    observedAt: observedAt,
                    source: "manual"
                )
                try await LocalAPIClient.shared.updateObservation(
                    patientId: patientId,
                    observationId: observation.id,
                    payload: payload
                )
            } else {
                let payload = CreateObservationPayload(
                    codeSystem: selectedLoinc.system,
                    code: selectedLoinc.code,
                    display: selectedLoinc.display,
                    unitSystem: selectedUcum.system,
                    unitCode: selectedUcum.code,
                    value: trimmedValue,
                    notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
                    observedAt: observedAt,
                    source: "manual"
                )
                _ = try await LocalAPIClient.shared.createObservation(
                    patientId: patientId,
                    payload: payload
                )
            }

            onSaved()
            dismiss()
        } catch {
            errorMessage = observation == nil
                ? "Creazione osservazione fallita"
                : "Aggiornamento osservazione fallito"
        }
    }

    @MainActor
    private func ensureSelectedOptionsArePresent() {
        if loincOptions.first(where: { $0.code == selectedCode }) == nil {
            loincOptions.insert(
                TerminologySearchItem(
                    system: observation?.codeSystem ?? "LOINC",
                    code: selectedCode,
                    display: observation?.display ?? selectedCode,
                    version: nil,
                    source: "current-value"
                ),
                at: 0
            )
        }

        if ucumOptions.first(where: { $0.code == selectedUnitCode }) == nil {
            ucumOptions.insert(
                TerminologySearchItem(
                    system: observation?.unitSystem ?? "UCUM",
                    code: selectedUnitCode,
                    display: selectedUnitCode,
                    version: nil,
                    source: "current-value"
                ),
                at: 0
            )
        }
    }
}
