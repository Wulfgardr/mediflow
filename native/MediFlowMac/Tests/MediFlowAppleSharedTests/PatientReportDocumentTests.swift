import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class PatientReportDocumentTests: XCTestCase {
    private let baseDate = Date(timeIntervalSince1970: 1_767_225_600)

    func testCompletePatientBuildsExpectedContentSections() {
        let patient = makePatient(
            diagnoses: DiagnosesCodec.encode([
                ClinicalDiagnosis(code: "E11.9", description: "Diabete tipo 2", system: "ICD-10", date: "2026-01-01T00:00:00.000Z")
            ], defaultDate: "2026-01-01T00:00:00.000Z"),
            exemptions: ExemptionCodesCodec.encode(["048"])
        )
        let report = PatientReportDocument.build(
            patient: patient,
            entries: [
                makeEntry(title: "Visita domiciliare", content: "<p>S: Paziente stabile</p><p>P: Controllo tra 30 giorni</p>"),
                makeEntry(id: "scale-1", type: "scale", title: "ADL", content: "Punteggio: 5\nInterpretazione: Autonomo", metadata: nil),
            ],
            therapies: [
                makeTherapy(drug: "Ramipril", aic: "012345", atc: "C09AA05", principle: "Ramipril", dosage: "5 mg al mattino")
            ],
            checkups: [
                makeCheckup(title: "Controllo pressorio", date: baseDate.addingTimeInterval(86_400))
            ],
            observations: [
                makeObservation(display: "Pressione arteriosa", value: "130/80", unit: "mmHg")
            ],
            generatedAt: baseDate,
            referenceDate: baseDate
        )

        let text = report.plainText
        XCTAssertTrue(text.contains("Report PDF paziente"))
        XCTAssertTrue(text.contains("Nome: Rossi Mario"))
        XCTAssertTrue(text.contains("Codice fiscale: RSSMRA80A01H501U"))
        XCTAssertTrue(text.contains("Ambulatorio: AMB-1"))
        XCTAssertTrue(text.contains("Diagnosi ICD"))
        XCTAssertTrue(text.contains("E11.9 - Diabete tipo 2"))
        XCTAssertTrue(text.contains("048"))
        XCTAssertTrue(text.contains("Ramipril"))
        XCTAssertTrue(text.contains("AIC: 012345"))
        XCTAssertTrue(text.contains("ATC: C09AA05"))
        XCTAssertTrue(text.contains("S: Paziente stabile"))
        XCTAssertTrue(text.contains("Controllo pressorio"))
        XCTAssertTrue(text.contains("Pressione arteriosa"))
        XCTAssertTrue(text.contains("Valore: 130/80 mmHg"))
        XCTAssertEqual(report.fileName, "report-paziente-rossi-2026-01-01.pdf")
    }

    func testEmptySectionsUseHonestEmptyRows() {
        let report = PatientReportDocument.build(
            patient: makePatient(),
            entries: [],
            therapies: [],
            checkups: [],
            observations: [],
            generatedAt: baseDate,
            referenceDate: baseDate
        )

        let text = report.plainText
        XCTAssertTrue(text.contains("Nessuna diagnosi registrata."))
        XCTAssertTrue(text.contains("Nessuna esenzione registrata."))
        XCTAssertTrue(text.contains("Nessuna terapia in corso registrata."))
        XCTAssertTrue(text.contains("Nessuna voce diario registrata."))
        XCTAssertTrue(text.contains("Nessun controllo programmato."))
        XCTAssertTrue(text.contains("Nessuna osservazione registrata."))
    }

    func testDeletedDiaryEntriesAreExcluded() {
        let report = PatientReportDocument.build(
            patient: makePatient(),
            entries: [
                makeEntry(title: "Voce attiva", content: "Contenuto attivo"),
                makeEntry(title: "Voce eliminata", content: "Contenuto eliminato", deleted: true),
            ],
            therapies: [],
            checkups: [],
            observations: [],
            generatedAt: baseDate,
            referenceDate: baseDate
        )

        let text = report.plainText
        XCTAssertTrue(text.contains("Voce attiva"))
        XCTAssertFalse(text.contains("Voce eliminata"))
        XCTAssertFalse(text.contains("Contenuto eliminato"))
    }

    func testCiphertextMarkersAreNeverRendered() {
        let report = PatientReportDocument.build(
            patient: makePatient(
                lastName: "ENC:iv:cipher",
                taxCode: "ENC:iv:cipher",
                diagnoses: #"[{"code":"E11","description":"ENC:iv:cipher","system":"ICD-10"}]"#,
                exemptions: #"["ENC:iv:cipher"]"#
            ),
            entries: [
                makeEntry(title: "ENC:iv:cipher", content: "ENC:iv:cipher")
            ],
            therapies: [
                makeTherapy(drug: "ENC:iv:cipher", dosage: "ENC:iv:cipher")
            ],
            checkups: [
                makeCheckup(title: "ENC:iv:cipher", notes: "ENC:iv:cipher", date: baseDate.addingTimeInterval(86_400))
            ],
            observations: [
                makeObservation(display: "ENC:iv:cipher", value: "ENC:iv:cipher", unit: "ENC:iv:cipher")
            ],
            generatedAt: baseDate,
            referenceDate: baseDate
        )

        XCTAssertFalse(report.plainText.contains("ENC:"))
    }

    private func makePatient(
        firstName: String = "Mario",
        lastName: String = "Rossi",
        taxCode: String = "RSSMRA80A01H501U",
        diagnoses: String? = nil,
        exemptions: String? = nil
    ) -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: "patient-1",
            firstName: firstName,
            lastName: lastName,
            birthDate: Date(timeIntervalSince1970: 315_532_800),
            taxCode: taxCode,
            address: nil,
            phone: nil,
            caregiver: nil,
            exemptions: exemptions,
            diagnoses: diagnoses,
            monitoringProfile: nil,
            statusReason: nil,
            notes: nil,
            aiSummary: nil,
            documentInsights: nil,
            isAdi: false,
            isArchived: false,
            version: 1,
            ambulatoryId: "AMB-1",
            createdAt: nil,
            updatedAt: nil
        )
    }

    private func makeEntry(
        id: String = "entry-1",
        type: String = "note",
        title: String,
        content: String,
        metadata: String? = nil,
        deleted: Bool = false
    ) -> HomeBaseEntrySummary {
        HomeBaseEntrySummary(
            id: id,
            patientId: "patient-1",
            type: type,
            title: title,
            date: baseDate,
            content: content,
            setting: nil,
            metadata: metadata,
            attachments: nil,
            deletedAt: deleted ? baseDate : nil,
            deletionReason: deleted ? "test" : nil,
            version: 1,
            createdAt: nil,
            updatedAt: nil
        )
    }

    private func makeTherapy(
        drug: String,
        aic: String? = nil,
        atc: String? = nil,
        principle: String? = nil,
        dosage: String = "1 cp",
        status: String = "active",
        deleted: Bool = false
    ) -> HomeBaseTherapySummary {
        HomeBaseTherapySummary(
            id: "therapy-1",
            patientId: "patient-1",
            drugName: drug,
            aic: aic,
            atc: atc,
            activePrinciple: principle,
            dosage: dosage,
            motivation: nil,
            diagnosisCode: nil,
            diagnosisName: nil,
            status: status,
            startDate: baseDate,
            endDate: nil,
            version: 1,
            createdAt: nil,
            updatedAt: nil,
            deletedAt: deleted ? baseDate : nil,
            deletionReason: nil
        )
    }

    private func makeCheckup(
        title: String,
        notes: String? = nil,
        date: Date
    ) -> HomeBaseCheckupSummary {
        HomeBaseCheckupSummary(
            id: "checkup-1",
            patientId: "patient-1",
            date: date,
            title: title,
            notes: notes,
            status: "pending",
            source: "manual",
            version: 1,
            createdAt: nil,
            updatedAt: nil,
            deletedAt: nil,
            deletionReason: nil
        )
    }

    private func makeObservation(
        display: String,
        value: String,
        unit: String
    ) -> HomeBaseObservationSummary {
        HomeBaseObservationSummary(
            id: "observation-1",
            patientId: "patient-1",
            codeSystem: "http://loinc.org",
            code: "8480-6",
            display: display,
            unitSystem: "http://unitsofmeasure.org",
            unitCode: unit,
            value: value,
            notes: nil,
            observedAt: baseDate,
            source: "manual",
            version: 1,
            createdAt: nil,
            updatedAt: nil,
            deletedAt: nil,
            deletionReason: nil
        )
    }
}
