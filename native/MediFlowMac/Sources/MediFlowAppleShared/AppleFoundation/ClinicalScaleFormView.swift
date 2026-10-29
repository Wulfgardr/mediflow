import SwiftUI

struct ClinicalScaleDraft: Identifiable {
    let id = UUID()
    let definition: ClinicalScaleDefinition
    let patientID: String
    let patientVersion: Int
    let patientLabel: String
    let connectionIdentity: ClinicalWorkspaceConnection.Identity?

    init(definition: ClinicalScaleDefinition, patient: HomeBasePatientDetail,
         connectionIdentity: ClinicalWorkspaceConnection.Identity?) {
        self.definition = definition
        patientID = patient.id
        patientVersion = patient.version
        patientLabel = "\(patient.lastName) \(patient.firstName)"
        self.connectionIdentity = connectionIdentity
    }

    func validate(patientID: String, version: Int, isArchived: Bool?, deletedAt: Date?) throws {
        guard patientID == self.patientID else { throw ClinicalScaleDraftError.wrongPatient }
        guard isArchived != true, deletedAt == nil else { throw ClinicalScaleDraftError.unavailable }
        guard version == patientVersion else { throw ClinicalScaleDraftError.changed }
    }

    var title: String {
        "\(definition.id == "adl" ? "ADL" : definition.title) · \(patientLabel)"
    }
}

enum ClinicalScaleDraftError: String, LocalizedError {
    case wrongPatient = "Il paziente della richiesta non coincide con quello della bozza. Punteggio non registrato."
    case unavailable = "Il paziente della bozza non è più disponibile oppure è archiviato o nel cestino. Punteggio non registrato."
    case changed = "Il paziente è stato modificato dopo l'apertura della bozza. Riapri la scala sul paziente aggiornato. Punteggio non registrato."
    case connectionChanged = "Il collegamento o l'ambulatorio è cambiato. Punteggio non registrato."
    var errorDescription: String? { rawValue }
}

/// MF085-003: unanswered is nil, not the first option or a false toggle.
struct ClinicalScaleFormView: View {
    let draft: ClinicalScaleDraft
    let onSubmit: ([String: Int]) async -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var answers: [String: Int] = [:]
    @State private var isSubmitting = false
    @State private var submissionError: String?
    private var definition: ClinicalScaleDefinition { draft.definition }

    private var result: ClinicalScaleResult? {
        try? definition.result(from: answers)
    }

    var body: some View {
        NavigationStack {
            questions
            .background(PlatformColors.chartCardSurface)
            .navigationTitle(draft.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                #if os(iOS)
                ToolbarItem(placement: .principal) {
                    Text(draft.title)
                        .font(.headline)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("scale-context-title")
                }
                #endif
                ToolbarItem(placement: .confirmationAction) { submitButton }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") { dismiss() }
                        .disabled(isSubmitting)
                        .accessibilityIdentifier("cancel-scale-button")
                }
            }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private var questions: some View {
        List {
            Section {
                resultPanel
                if let submissionError {
                    Text(submissionError)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("scale-submission-error")
                }
            }
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
                    .disabled(isSubmitting)
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
            guard result != nil, !isSubmitting else { return }
            let submittedAnswers = answers
            isSubmitting = true
            Task { @MainActor in
                submissionError = await onSubmit(submittedAnswers)
                isSubmitting = false
                if submissionError == nil { dismiss() }
            }
        }
        .buttonStyle(.borderedProminent)
        .tint(PlatformColors.freshInk)
        .disabled(result == nil || isSubmitting)
        .accessibilityIdentifier("submit-scale-button")
    }
}
