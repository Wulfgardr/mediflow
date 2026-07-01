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
        // Seed every item to its FIRST option value (0 for all ported scales, incl.
        // GDS positive items whose first option is the non-depressive Si=0), so the
        // picker shows a concrete selection and an untouched item contributes 0.
        _answers = State(initialValue: Dictionary(uniqueKeysWithValues: definition.questions.map { ($0.id, $0.options.first?.value ?? 0) }))
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
                        // Menu picker over the question's options so 3/4-way scales
                        // (Tinetti/MMSE) and inverted-order scales (GDS) score right.
                        Picker(question.text, selection: Binding(
                            get: { answers[question.id] ?? question.options.first?.value ?? 0 },
                            set: { answers[question.id] = $0 }
                        )) {
                            ForEach(question.options, id: \.value) { option in
                                Text(option.label).tag(option.value)
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
