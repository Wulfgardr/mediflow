import XCTest
@testable import MediFlowAppleShared

final class TherapyPlanDocumentTests: XCTestCase {
    private func therapy(
        _ id: String,
        drug: String,
        status: String,
        dosage: String = "1 cp",
        principle: String? = nil,
        motivation: String? = nil,
        deleted: Bool = false
    ) -> HomeBaseTherapySummary {
        let base = Date(timeIntervalSince1970: 1_750_000_000)
        return HomeBaseTherapySummary(
            id: id, patientId: "p1", drugName: drug, aic: nil, atc: nil,
            activePrinciple: principle, dosage: dosage, motivation: motivation,
            diagnosisCode: nil, diagnosisName: nil, status: status,
            startDate: base, endDate: nil, version: 1, createdAt: nil, updatedAt: nil,
            deletedAt: deleted ? base : nil, deletionReason: deleted ? "x" : nil
        )
    }

    func testHeaderAndEmptyBody() {
        let text = TherapyPlanDocument.plainText(
            patientName: "Mario Rossi", therapies: [], dateLabel: "2026-06-29"
        )
        XCTAssertTrue(text.contains("Piano terapeutico (riepilogo)"))
        XCTAssertTrue(text.contains("Paziente: Mario Rossi"))
        XCTAssertTrue(text.contains("Generato: 2026-06-29"))
        XCTAssertTrue(text.contains("Nessuna terapia registrata."))
        // Honest framing: it is a summary, never a prescription.
        XCTAssertFalse(text.lowercased().contains("ricetta"))
    }

    func testGroupsByStatusInStableOrder() {
        let text = TherapyPlanDocument.plainText(
            patientName: "P",
            therapies: [
                therapy("1", drug: "Zeta", status: "completed"),
                therapy("2", drug: "Alfa", status: "active"),
                therapy("3", drug: "Beta", status: "suspended"),
            ],
            dateLabel: "D"
        )
        let active = text.range(of: "In corso")!.lowerBound
        let suspended = text.range(of: "Sospese")!.lowerBound
        let completed = text.range(of: "Concluse")!.lowerBound
        XCTAssertTrue(active < suspended && suspended < completed)
    }

    func testTherapiesSortedByDrugNameWithinGroup() {
        let text = TherapyPlanDocument.plainText(
            patientName: "P",
            therapies: [
                therapy("1", drug: "Vitamina", status: "active"),
                therapy("2", drug: "Aspirina", status: "active"),
            ],
            dateLabel: "D"
        )
        XCTAssertTrue(text.range(of: "Aspirina")!.lowerBound < text.range(of: "Vitamina")!.lowerBound)
    }

    func testLineIncludesPrincipleDosageAndMotivation() {
        let text = TherapyPlanDocument.plainText(
            patientName: "P",
            therapies: [therapy("1", drug: "Cardioaspirin", status: "active",
                                 dosage: "100 mg", principle: "ASA", motivation: "profilassi")],
            dateLabel: "D"
        )
        XCTAssertTrue(text.contains("- Cardioaspirin (ASA) 100 mg - profilassi"))
    }

    func testDeletedTherapiesAreExcluded() {
        let text = TherapyPlanDocument.plainText(
            patientName: "P",
            therapies: [
                therapy("1", drug: "Attiva", status: "active"),
                therapy("2", drug: "Cancellata", status: "active", deleted: true),
            ],
            dateLabel: "D"
        )
        XCTAssertTrue(text.contains("Attiva"))
        XCTAssertFalse(text.contains("Cancellata"))
    }

    func testUnknownStatusGoesUnderAltro() {
        let text = TherapyPlanDocument.plainText(
            patientName: "P",
            therapies: [therapy("1", drug: "Sperimentale", status: "draft")],
            dateLabel: "D"
        )
        XCTAssertTrue(text.contains("Altro"))
        XCTAssertTrue(text.contains("Sperimentale"))
    }
}
