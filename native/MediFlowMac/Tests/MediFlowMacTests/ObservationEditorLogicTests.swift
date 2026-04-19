// @Codex
import Foundation
import XCTest
@testable import MediFlowMac

/* @Codex */
final class ObservationEditorLogicTests: XCTestCase {
    private let loincOptions = [
        TerminologySearchItem(
            system: "LOINC",
            code: "8480-6",
            display: "Systolic blood pressure",
            version: "2.78",
            source: "catalog"
        ),
    ]

    private let ucumOptions = [
        TerminologySearchItem(
            system: "UCUM",
            code: "mm[Hg]",
            display: "Millimeter of mercury",
            version: nil,
            source: "catalog"
        ),
    ]

    func testCreatePayloadTrimsValueAndDropsBlankNotes() throws {
        let draft = ObservationEditorDraft(
            selectedCode: "8480-6",
            selectedUnitCode: "mm[Hg]",
            value: " 138 ",
            observedAt: Date(timeIntervalSince1970: 0),
            notes: "   "
        )

        let payload = try draft.makeCreatePayload(
            loincOptions: loincOptions,
            ucumOptions: ucumOptions
        )

        XCTAssertEqual(payload.codeSystem, "LOINC")
        XCTAssertEqual(payload.code, "8480-6")
        XCTAssertEqual(payload.display, "Systolic blood pressure")
        XCTAssertEqual(payload.unitSystem, "UCUM")
        XCTAssertEqual(payload.unitCode, "mm[Hg]")
        XCTAssertEqual(payload.value, "138")
        XCTAssertNil(payload.notes)
        XCTAssertEqual(payload.source, "manual")
    }

    func testUpdatePayloadKeepsExplicitEmptyNotesForClearAction() throws {
        let draft = ObservationEditorDraft(
            selectedCode: "8480-6",
            selectedUnitCode: "mm[Hg]",
            value: "120",
            observedAt: Date(timeIntervalSince1970: 10),
            notes: "   "
        )

        let payload = try draft.makeUpdatePayload(
            loincOptions: loincOptions,
            ucumOptions: ucumOptions
        )

        XCTAssertEqual(payload.codeSystem, "LOINC")
        XCTAssertEqual(payload.code, "8480-6")
        XCTAssertEqual(payload.unitCode, "mm[Hg]")
        XCTAssertEqual(payload.value, "120")
        XCTAssertEqual(payload.notes, "")
        XCTAssertEqual(payload.source, "manual")
    }

    func testMergedOptionsPreservesCurrentObservationValuesOutsideCatalog() {
        let observation = ObservationSummary(
            id: "obs-1",
            patientId: "patient-1",
            codeSystem: "LOINC",
            code: "9999-9",
            display: "Legacy parameter",
            unitSystem: "UCUM",
            unitCode: "{score}",
            value: "42",
            notes: nil,
            observedAt: Date(timeIntervalSince1970: 0),
            source: "manual",
            createdAt: nil
        )

        let merged = ObservationEditorDraft.mergedOptions(
            observation: observation,
            selectedCode: "9999-9",
            selectedUnitCode: "{score}",
            loincOptions: loincOptions,
            ucumOptions: ucumOptions
        )

        XCTAssertEqual(merged.loinc.first?.code, "9999-9")
        XCTAssertEqual(merged.loinc.first?.display, "Legacy parameter")
        XCTAssertEqual(merged.loinc.first?.source, "current-value")
        XCTAssertEqual(merged.ucum.first?.code, "{score}")
        XCTAssertEqual(merged.ucum.first?.source, "current-value")
    }

    func testMakeCreatePayloadRejectsMissingValue() {
        let draft = ObservationEditorDraft(
            selectedCode: "8480-6",
            selectedUnitCode: "mm[Hg]",
            value: "   ",
            observedAt: Date(),
            notes: ""
        )

        XCTAssertThrowsError(
            try draft.makeCreatePayload(loincOptions: loincOptions, ucumOptions: ucumOptions)
        ) { error in
            XCTAssertEqual(error as? ObservationEditorValidationError, .missingValue)
        }
    }

    func testMakeUpdatePayloadRejectsUnknownCodingSelection() {
        let draft = ObservationEditorDraft(
            selectedCode: "9999-9",
            selectedUnitCode: "kg",
            value: "88",
            observedAt: Date(),
            notes: "note"
        )

        XCTAssertThrowsError(
            try draft.makeUpdatePayload(loincOptions: loincOptions, ucumOptions: ucumOptions)
        ) { error in
            XCTAssertEqual(error as? ObservationEditorValidationError, .invalidLoinc)
        }
    }
}
