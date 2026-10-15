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

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                let wide = geometry.size.width >= 760 && !dynamicTypeSize.isAccessibilitySize
                Group {
                if wide {
                    HStack(alignment: .top, spacing: 0) {
                        questions
                        Divider()
                        resultPanel.padding(24).frame(width: 280, alignment: .topLeading)
                    }
                } else {
                    questions
                }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) { submissionBar(showsResult: !wide) }
            }
            .background(PlatformColors.chartCardSurface)
            .navigationTitle(definition.title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla", action: onCancel)
                        .accessibilityIdentifier("cancel-scale-button")
                }
            }
        }
    }

    private var questions: some View {
        List {
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
                    .inkRegister(weight: .semibold)
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

    private func submissionBar(showsResult: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
            if showsResult {
                VStack(alignment: .leading, spacing: 12) {
                    resultPanel
                    submitButton
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
            } else {
                HStack(alignment: .center, spacing: 20) {
                    Text("Risultato in bozza")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(PlatformColors.pencil)
                    Spacer(minLength: 8)
                    submitButton
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
            }
        }
        .background(PlatformColors.chartCardSurface)
    }

    private var submitButton: some View {
        Button("Invia") {
            guard result != nil else { return }
            onSubmit(answers)
        }
        .buttonStyle(.borderedProminent)
        .disabled(result == nil)
        .accessibilityIdentifier("submit-scale-button")
    }
}
