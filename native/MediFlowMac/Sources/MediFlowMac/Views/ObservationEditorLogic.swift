import Foundation

/* @Codex */
enum ObservationEditorValidationError: LocalizedError, Equatable {
    case missingValue
    case invalidLoinc
    case invalidUcum

    var errorDescription: String? {
        switch self {
        case .missingValue:
            return "Valore richiesto"
        case .invalidLoinc:
            return "Seleziona un parametro LOINC valido"
        case .invalidUcum:
            return "Seleziona una unità UCUM valida"
        }
    }
}

/* @Codex */
struct ObservationEditorDraft {
    let selectedCode: String
    let selectedUnitCode: String
    let value: String
    let observedAt: Date
    let notes: String

    func makeCreatePayload(
        loincOptions: [TerminologySearchItem],
        ucumOptions: [TerminologySearchItem]
    ) throws -> CreateObservationPayload {
        let resolved = try resolvedCoding(loincOptions: loincOptions, ucumOptions: ucumOptions)

        return CreateObservationPayload(
            codeSystem: resolved.loinc.system,
            code: resolved.loinc.code,
            display: resolved.loinc.display,
            unitSystem: resolved.ucum.system,
            unitCode: resolved.ucum.code,
            value: resolved.value,
            notes: resolved.notes.isEmpty ? nil : resolved.notes,
            observedAt: observedAt,
            source: "manual"
        )
    }

    func makeUpdatePayload(
        loincOptions: [TerminologySearchItem],
        ucumOptions: [TerminologySearchItem]
    ) throws -> UpdateObservationPayload {
        let resolved = try resolvedCoding(loincOptions: loincOptions, ucumOptions: ucumOptions)

        return UpdateObservationPayload(
            codeSystem: resolved.loinc.system,
            code: resolved.loinc.code,
            display: resolved.loinc.display,
            unitSystem: resolved.ucum.system,
            unitCode: resolved.ucum.code,
            value: resolved.value,
            notes: resolved.notes.isEmpty ? "" : resolved.notes,
            observedAt: observedAt,
            source: "manual"
        )
    }

    private func resolvedCoding(
        loincOptions: [TerminologySearchItem],
        ucumOptions: [TerminologySearchItem]
    ) throws -> (loinc: TerminologySearchItem, ucum: TerminologySearchItem, value: String, notes: String) {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedValue.isEmpty else {
            throw ObservationEditorValidationError.missingValue
        }

        guard let loinc = loincOptions.first(where: { $0.code == selectedCode }) else {
            throw ObservationEditorValidationError.invalidLoinc
        }

        guard let ucum = ucumOptions.first(where: { $0.code == selectedUnitCode }) else {
            throw ObservationEditorValidationError.invalidUcum
        }

        return (loinc, ucum, trimmedValue, trimmedNotes)
    }

    static func mergedOptions(
        observation: ObservationSummary?,
        selectedCode: String,
        selectedUnitCode: String,
        loincOptions: [TerminologySearchItem],
        ucumOptions: [TerminologySearchItem]
    ) -> (loinc: [TerminologySearchItem], ucum: [TerminologySearchItem]) {
        var nextLoinc = loincOptions
        var nextUcum = ucumOptions

        if nextLoinc.first(where: { $0.code == selectedCode }) == nil {
            nextLoinc.insert(
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

        if nextUcum.first(where: { $0.code == selectedUnitCode }) == nil {
            nextUcum.insert(
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

        return (nextLoinc, nextUcum)
    }
}
