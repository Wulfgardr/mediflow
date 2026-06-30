// A10: clinical scales ported from lib/scale-definitions.ts. A completed scale is
// stored exactly as the web stores it: a diary entry of type "scale" whose
// encrypted metadata carries { title, scaleId, score, interpretation, answers }.
// Pure and unit-tested; the view drives the questions and the model submits.
import Foundation

public struct ClinicalScaleOption: Equatable, Sendable {
    public let label: String
    public let value: Int
    public init(label: String, value: Int) {
        self.label = label
        self.value = value
    }
}

public struct ClinicalScaleQuestion: Identifiable, Equatable, Sendable {
    public let id: String
    public let text: String
    public let options: [ClinicalScaleOption]
}

public struct ClinicalScaleResult: Equatable {
    public let score: Int
    public let interpretation: String
    public let answers: [String: Int]
}

public struct ClinicalScaleDefinition: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let scaleDescription: String
    public let questions: [ClinicalScaleQuestion]
    // Total points if every question is answered with its maximum option.
    public var maxScore: Int {
        questions.reduce(0) { $0 + ($1.options.map(\.value).max() ?? 0) }
    }

    private let interpret: @Sendable (Int) -> String

    public init(
        id: String,
        title: String,
        scaleDescription: String,
        questions: [ClinicalScaleQuestion],
        interpret: @escaping @Sendable (Int) -> String
    ) {
        self.id = id
        self.title = title
        self.scaleDescription = scaleDescription
        self.questions = questions
        self.interpret = interpret
    }

    public static func == (lhs: ClinicalScaleDefinition, rhs: ClinicalScaleDefinition) -> Bool {
        lhs.id == rhs.id && lhs.questions == rhs.questions
    }

    /// Sum scoring (matches every ported scale's scoringLogic), then interpret.
    public func result(from answers: [String: Int]) -> ClinicalScaleResult {
        let score = questions.reduce(0) { $0 + (answers[$1.id] ?? 0) }
        return ClinicalScaleResult(score: score, interpretation: interpret(score), answers: answers)
    }
}

public enum ClinicalScales {
    /// ADL (Indice di Katz), ported field-for-field from lib/scale-definitions.ts.
    public static let adl = ClinicalScaleDefinition(
        id: "adl",
        title: "ADL (Indice di Katz)",
        scaleDescription: "Autonomia nelle attivita della vita quotidiana (1 = Autonomo, 0 = Dipendente).",
        questions: [
            choice("bath", "Fare il bagno"),
            choice("dress", "Vestirsi"),
            choice("toilet", "Uso del Bagno"),
            choice("transfer", "Spostarsi"),
            choice("cont", "Continenza"),
            choice("feed", "Alimentarsi"),
        ],
        interpret: { score in
            if score == 6 { return "Autonomia Conservata (6/6)" }
            if score >= 4 { return "Compromissione Lieve (4-5/6)" }
            if score >= 2 { return "Compromissione Moderata (2-3/6)" }
            return "Compromissione Grave (0-1/6)"
        }
    )

    public static let all: [ClinicalScaleDefinition] = [adl]

    private static func choice(_ id: String, _ text: String) -> ClinicalScaleQuestion {
        ClinicalScaleQuestion(
            id: id, text: text,
            options: [
                ClinicalScaleOption(label: "Dipendente", value: 0),
                ClinicalScaleOption(label: "Autonomo", value: 1),
            ]
        )
    }

    /// The entry metadata JSON the web persists for a scale, byte-shape matching
    /// app/patients/[id]/scales/[scaleId]/page.tsx so the web can read it back.
    public static func metadataJSON(definition: ClinicalScaleDefinition, result: ClinicalScaleResult) -> String? {
        let payload = ScaleMetadata(
            title: definition.title,
            scaleId: definition.id,
            score: result.score,
            interpretation: result.interpretation,
            answers: result.answers
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(payload) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public static func contentSummary(definition: ClinicalScaleDefinition, result: ClinicalScaleResult) -> String {
        "Valutazione \(definition.title) completata.\nPunteggio: \(result.score)\nInterpretazione: \(result.interpretation)"
    }

    private struct ScaleMetadata: Encodable {
        let title: String
        let scaleId: String
        let score: Int
        let interpretation: String
        let answers: [String: Int]
    }
}
