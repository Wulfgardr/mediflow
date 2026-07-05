import XCTest
@testable import MediFlowCore

/// ADR 0071 Fase 2: parity tests for the write-boundary authority logic ported
/// from lib/network-*-write.ts. The status codes and copy must match the web
/// byte-for-byte, so a write the native authority rejects is rejected identically
/// on the home-base.
final class NetworkWriteBoundaryTests: XCTestCase {
    typealias B = NetworkWriteBoundary

    // MARK: Patient

    func testPatientAllowsCleanWrite() {
        XCTAssertEqual(
            B.validatePatient(presentFields: ["address", "phone"], ambulatoryIdInBody: .omit, scopeAmbulatoryId: "AMB-1"),
            .allowed)
    }

    func testPatientRejectsAIFields() {
        for field in ["aiSummary", "documentInsights"] {
            XCTAssertEqual(
                B.validatePatient(presentFields: [field], ambulatoryIdInBody: .omit, scopeAmbulatoryId: "AMB-1"),
                .rejected(status: 403, error: "Network patient write boundary excludes AI fields"),
                "field \(field)")
        }
    }

    func testPatientAmbulatoryScope() {
        // present + equal scope -> allowed
        XCTAssertEqual(
            B.validatePatient(presentFields: ["address"], ambulatoryIdInBody: .value("AMB-1"), scopeAmbulatoryId: "AMB-1"),
            .allowed)
        // present + different -> rejected
        XCTAssertEqual(
            B.validatePatient(presentFields: ["address"], ambulatoryIdInBody: .value("AMB-2"), scopeAmbulatoryId: "AMB-1"),
            .rejected(status: 403, error: "Network scope violation"))
        // present null still fails the !== scope check (matches the web)
        XCTAssertEqual(
            B.validatePatient(presentFields: ["address"], ambulatoryIdInBody: .null, scopeAmbulatoryId: "AMB-1"),
            .rejected(status: 403, error: "Network scope violation"))
    }

    // MARK: Sub-resources

    func testSubResourceRejectsAIDocumentFields() {
        for field in ["aiSummary", "documentInsights", "documentInsightId", "sourceDocumentId"] {
            XCTAssertEqual(
                B.validateSubResource(.therapy, mode: .create, presentFields: [field]),
                .rejected(status: 403, error: "Network therapy write boundary excludes AI/document-derived fields"),
                "field \(field)")
        }
    }

    func testEntryUsesDiaryLabel() {
        XCTAssertEqual(
            B.validateSubResource(.entry, mode: .create, presentFields: ["aiSummary"]),
            .rejected(status: 403, error: "Network diary write boundary excludes AI/document-derived fields"))
        XCTAssertEqual(
            B.validateSubResource(.entry, mode: .create, presentFields: ["patientId"]),
            .rejected(status: 400, error: "Network diary write boundary rejects client-controlled patientId"))
    }

    func testServerControlledFieldsRejectedWith400() {
        // create: version is forbidden everywhere
        XCTAssertEqual(
            B.validateSubResource(.observation, mode: .create, presentFields: ["version"]),
            .rejected(status: 400, error: "Network observation write boundary rejects client-controlled version"))
        // soft-delete columns forbidden on create for therapy/checkup/observation...
        XCTAssertEqual(
            B.validateSubResource(.therapy, mode: .create, presentFields: ["deletedAt"]),
            .rejected(status: 400, error: "Network therapy write boundary rejects client-controlled deletedAt"))
        // ...but NOT for an entry create (its set excludes deletedAt)
        XCTAssertEqual(
            B.validateSubResource(.entry, mode: .create, presentFields: ["deletedAt"]),
            .allowed)
    }

    func testUpdateModeForbidsFewerFields() {
        // update set is only {patientId, createdAt, updatedAt}: version is allowed on update
        XCTAssertEqual(
            B.validateSubResource(.checkup, mode: .update, presentFields: ["version"]),
            .allowed)
        XCTAssertEqual(
            B.validateSubResource(.checkup, mode: .update, presentFields: ["createdAt"]),
            .rejected(status: 400, error: "Network checkup write boundary rejects client-controlled createdAt"))
    }

    func testEntryAttachmentsBoundary() {
        // non-empty attachments rejected (diary only)
        XCTAssertEqual(
            B.validateSubResource(.entry, mode: .create, presentFields: ["title", "attachments"], attachmentsNonEmpty: true),
            .rejected(status: 403, error: "Network diary write boundary excludes attachment writes"))
        // empty attachments allowed
        XCTAssertEqual(
            B.validateSubResource(.entry, mode: .create, presentFields: ["title", "attachments"], attachmentsNonEmpty: false),
            .allowed)
    }

    func testCleanSubResourceWritesAllowed() {
        XCTAssertEqual(
            B.validateSubResource(.therapy, mode: .create, presentFields: ["drugName", "dosage", "startDate"]),
            .allowed)
        XCTAssertEqual(
            B.validateSubResource(.observation, mode: .update, presentFields: ["value", "notes"]),
            .allowed)
    }
}
