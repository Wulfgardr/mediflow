// @Codex MF085-002/003: canonical source provenance and the production write gate. See ADR 0118.
import Foundation

public struct ClinicalScaleInstrumentProvenance: Codable, Equatable, Sendable {
    public let instrumentId: String
    public let instrumentVersion: String
    public let definitionVersion: String
    public let sourceId: String
    public let sourceUrl: String
    public let sourceDocumentVersion: String
    public let language: String
    public let translationStatus: String
    public let riskClassification: String
}

public enum ClinicalScaleValidationError: Error, LocalizedError, Equatable {
    case inactiveInstrument, invalidDefinition, foreignAnswers, inconsistentResult, metadataEncoding
    case missingAnswer(String), invalidAnswer(String)

    public var errorDescription: String? {
        "Valutazione non completa o non valida. Verificare le risposte prima di inviare."
    }
}

public struct ClinicalScaleSubmission: Sendable {
    public let definition: ClinicalScaleDefinition
    public let result: ClinicalScaleResult
    public let metadataJSON: String
}

public extension ClinicalScales {
    static func activeDefinition(matching definition: ClinicalScaleDefinition) throws -> ClinicalScaleDefinition {
        guard let canonical = all.first(where: { $0.id == definition.id }),
              !canonical.isRetired, canonical == definition else {
            throw ClinicalScaleValidationError.inactiveInstrument
        }
        return canonical // Never use a caller-supplied interpretation closure.
    }

    static func prepareSubmission(definition: ClinicalScaleDefinition, answers: [String: Int]) throws -> ClinicalScaleSubmission {
        let canonical = try activeDefinition(matching: definition)
        let result = try canonical.result(from: answers)
        return ClinicalScaleSubmission(
            definition: canonical, result: result,
            metadataJSON: try metadataJSON(definition: canonical, result: result)
        )
    }

    /// The paired model uses this exact seam before DEBUG insertion, encryption or createEntry.
    /// MainActor preserves the existing UI writer's isolation; it does not authorize a write.
    @MainActor
    static func submit(
        definition: ClinicalScaleDefinition,
        answers: [String: Int],
        write: (ClinicalScaleSubmission) async throws -> Void
    ) async throws {
        let submission = try prepareSubmission(definition: definition, answers: answers)
        try await write(submission)
    }
}
