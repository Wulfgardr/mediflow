import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class CatalogSelectionTests: XCTestCase {
    func testDrugSelectionPopulatesTherapyDraftFields() {
        let drug = HomeBaseDrugSummary(
            aic: "012345678",
            name: "Amoxicillina 1g compresse",
            activePrinciple: "Amoxicillina",
            atc: "J01CA04"
        )
        let draft = TherapyCatalogDraft(
            drugName: "Amo",
            aic: "",
            atc: "",
            activePrinciple: ""
        )

        let selected = CatalogSelection.applying(drug, to: draft)

        XCTAssertEqual(selected.drugName, "Amoxicillina 1g compresse")
        XCTAssertEqual(selected.aic, "012345678")
        XCTAssertEqual(selected.atc, "J01CA04")
        XCTAssertEqual(selected.activePrinciple, "Amoxicillina")
    }

    func testDrugSelectionKeepsManualFlowPossibleForMissingOptionalFields() {
        let drug = HomeBaseDrugSummary(aic: "999999999", name: "Farmaco senza ATC")

        let selected = CatalogSelection.applying(drug, to: TherapyCatalogDraft())

        XCTAssertEqual(selected.drugName, "Farmaco senza ATC")
        XCTAssertEqual(selected.aic, "999999999")
        XCTAssertEqual(selected.atc, "")
        XCTAssertEqual(selected.activePrinciple, "")
    }

    func testExemptionSelectionAddsNormalizedUniqueChip() {
        let exemption = HomeBaseExemptionSummary(code: " c01 ", description: "Invalidi civili totali")

        let selected = CatalogSelection.adding(exemption, to: ["048", "C01"])

        XCTAssertEqual(selected, ["048", "C01"])
    }
}
