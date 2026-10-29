import SwiftUI

/// MF085-003: unanswered is nil, not the first option or a false toggle.
struct ClinicalScaleFormView: View {
    let patientLabel: String
    let definition: ClinicalScaleDefinition
    let onSubmit: ([String: Int]) -> Void
    let onCancel: () -> Void
    @State private var answers: [String: Int] = [:]

    init(
        definition: ClinicalScaleDefinition,
        patientLabel: String,
        onSubmit: @escaping ([String: Int]) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.patientLabel = patientLabel
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
            questions
            .background(PlatformColors.chartCardSurface)
            .navigationTitle("\(definition.id.uppercased()) · \(patientLabel)")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                #if os(iOS)
                ToolbarItem(placement: .principal) {
                    Text("\(definition.id.uppercased()) · \(patientLabel)")
                        .font(.headline)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("scale-context-title")
                }
                #endif
                ToolbarItem(placement: .confirmationAction) { submitButton }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla", action: onCancel)
                        .accessibilityIdentifier("cancel-scale-button")
                }
            }
        }
    }

    private var questions: some View {
        List {
            Section { resultPanel }
            Section {
                Text(definition.scaleDescription).chartMetadata()
                    .fixedSize(horizontal: false, vertical: true)
            }
            Section("Voci") {
                ForEach(definition.questions) { question in
                    Picker(selection: Binding<Int?>(
                        get: { answers[question.id] },
                        set: { answers[question.id] = $0 }
                    )) {
                        Text("Seleziona…").tag(nil as Int?)
                        ForEach(question.options, id: \.value) { option in
                            Text(option.label).tag(Optional(option.value))
                        }
                    } label: {
                        Text(question.text).inkRegister()
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .pickerStyle(.menu)
                    .padding(.vertical, 8)
                    .accessibilityIdentifier("scale-question-\(question.id)")
                }
            }
        }.clinicalRegisterList()
    }

    private var resultPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Risultato in bozza", systemImage: "circle")
                .font(.body.weight(.semibold)).foregroundStyle(PlatformColors.pencil)
            if let result {
                Text("\(result.score)/\(definition.maxScore)")
                    .font(.largeTitle.weight(.semibold))
                    .monospacedDigit()
                    .accessibilityIdentifier("scale-score")
                Text(result.interpretation).inkRegister()
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Valutazione incompleta: selezionare esplicitamente tutte le risposte richieste.")
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("scale-incomplete")
            }
        }
    }

    private var submitButton: some View {
        Button("Completa") {
            guard result != nil else { return }
            onSubmit(answers)
        }
        .buttonStyle(.borderedProminent)
        .tint(PlatformColors.freshInk)
        .disabled(result == nil)
        .accessibilityIdentifier("submit-scale-button")
    }
}
