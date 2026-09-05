import SwiftUI

/// @Codex MF085-003: unanswered is nil, not the first option or a false toggle.
struct ClinicalScaleFormView: View {
    let definition: ClinicalScaleDefinition
    let onSubmit: ([String: Int]) -> Void
    let onCancel: () -> Void
    @State private var answers: [String: Int] = [:]

    init(
        definition: ClinicalScaleDefinition,
        onSubmit: @escaping ([String: Int]) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.definition = definition
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _answers = State(initialValue: [:])
    }

    private var result: ClinicalScaleResult? {
        try? definition.result(from: answers)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(definition.scaleDescription)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let result {
                        Text("Punteggio: \(result.score)/\(definition.maxScore)")
                            .font(.subheadline.weight(.semibold))
                            .accessibilityIdentifier("scale-score")
                        Text(result.interpretation)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Valutazione incompleta: selezionare esplicitamente tutte le risposte richieste.")
                            .font(.callout)
                            .accessibilityIdentifier("scale-incomplete")
                    }
                }
                Section("Voci") {
                    ForEach(definition.questions) { question in
                        Picker(question.text, selection: Binding<Int?>(
                            get: { answers[question.id] },
                            set: { answers[question.id] = $0 }
                        )) {
                            Text("Seleziona…").tag(nil as Int?)
                            ForEach(question.options, id: \.value) { option in
                                Text(option.label).tag(Optional(option.value))
                            }
                        }
                        .pickerStyle(.menu)
                        .accessibilityIdentifier("scale-question-\(question.id)")
                    }
                }
            }
            .navigationTitle(definition.title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla", action: onCancel)
                        .accessibilityIdentifier("cancel-scale-button")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Invia") {
                        guard result != nil else { return }
                        onSubmit(answers)
                    }
                    .disabled(result == nil)
                    .accessibilityIdentifier("submit-scale-button")
                }
            }
        }
    }
}
