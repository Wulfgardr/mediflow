import SwiftUI

/// A10: fills a clinical scale and submits the result. Binary (ADL/Katz) items are
/// Toggles (on = the autonomous/higher-value option); the score updates live.
struct ClinicalScaleFormView: View {
    let definition: ClinicalScaleDefinition
    let onSubmit: ([String: Int]) -> Void
    let onCancel: () -> Void

    @State private var answers: [String: Int]

    init(
        definition: ClinicalScaleDefinition,
        onSubmit: @escaping ([String: Int]) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.definition = definition
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        // Binary scales default every item to 0 (the dependent/lower option).
        _answers = State(initialValue: Dictionary(uniqueKeysWithValues: definition.questions.map { ($0.id, 0) }))
    }

    private var result: ClinicalScaleResult { definition.result(from: answers) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(definition.scaleDescription)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    // Live score kept near the top so it stays on screen while the
                    // operator answers. Standalone leaf Text so the identifier is
                    // not merged into a combined Form-row accessibility element.
                    Text("Punteggio: \(result.score)/\(definition.maxScore)")
                        .font(.subheadline.weight(.semibold))
                        .accessibilityIdentifier("scale-score")
                    Text(result.interpretation)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section("Voci") {
                    ForEach(definition.questions) { question in
                        Toggle(question.text, isOn: Binding(
                            get: { (answers[question.id] ?? 0) > 0 },
                            set: { answers[question.id] = $0 ? 1 : 0 }
                        ))
                        .accessibilityIdentifier("scale-question-\(question.id)")
                    }
                }
            }
            .navigationTitle(definition.title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") { onCancel() }
                        .accessibilityIdentifier("cancel-scale-button")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Invia") { onSubmit(answers) }
                        .accessibilityIdentifier("submit-scale-button")
                }
            }
        }
    }
}
