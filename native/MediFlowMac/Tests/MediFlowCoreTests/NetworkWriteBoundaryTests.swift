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

    /* @Codex */
    func testPatientLifecycleCapabilityMirror() {
        XCTAssertEqual(B.patientLifecycleCapability, "network.replica.write-patient-lifecycle")
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

    /* @Codex */
    func testPatientCreateAllowsCleanSealedPayload() {
        XCTAssertEqual(
            B.validatePatientCreate(
                presentFields: ["firstName", "lastName", "taxCode", "address", "phone", "notes"],
                sensitiveValues: [
                    "address": "ENC:addr:sealed",
                    "phone": "ENC:phone:sealed",
                    "notes": "ENC:notes:sealed",
                ]),
            .allowed)
    }

    /* @Codex */
    func testPatientCreateRejectsAIFields() {
        for field in ["aiSummary", "documentInsights"] {
            XCTAssertEqual(
                B.validatePatientCreate(presentFields: [field], sensitiveValues: [:]),
                .rejected(status: 403, error: "Network patient write boundary excludes AI fields"),
                "field \(field)")
        }
    }

    /* @Codex */
    func testPatientCreateRejectsServerControlledFields() {
        for field in ["version", "createdAt", "updatedAt", "isArchived", "deletedAt"] {
            XCTAssertEqual(
                B.validatePatientCreate(presentFields: [field], sensitiveValues: [:]),
                .rejected(status: 400, error: "Network patient create boundary rejects client-controlled \(field)"),
                "field \(field)")
        }
    }

    /* @Codex */
    func testPatientCreateRejectsPlaintextSensitiveFields() {
        for field in ["address", "phone", "caregiver", "exemptions", "diagnoses", "statusReason", "notes"] {
            XCTAssertEqual(
                B.validatePatientCreate(presentFields: [field], sensitiveValues: [field: "plaintext"]),
                .rejected(status: 400, error: "Network create requires sealed sensitive fields"),
                "field \(field)")
        }
    }

    /* @Codex */
    func testPatientCreateAllowsOmittedOrNullSensitiveFields() {
        XCTAssertEqual(
            B.validatePatientCreate(presentFields: ["address", "phone"], sensitiveValues: ["address": nil]),
            .allowed)
        XCTAssertEqual(
            B.validatePatientCreate(presentFields: ["firstName", "lastName"], sensitiveValues: [:]),
            .allowed)
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

    /* @Codex */
    func testPrescriptionCapabilityMirrors() {
        XCTAssertEqual(B.servicePrescriptionReadCapability, "network.replica.readonly-service-prescriptions")
        XCTAssertEqual(B.servicePrescriptionWriteCapability, "network.replica.write-service-prescriptions")
        XCTAssertEqual(B.prostheticPrescriptionReadCapability, "network.replica.readonly-prosthetic-prescriptions")
        XCTAssertEqual(B.prostheticPrescriptionWriteCapability, "network.replica.write-prosthetic-prescriptions")
        XCTAssertEqual(B.fseValidateCapability, "network.fse.validate")
    }

    /* @Codex */
    func testPrescriptionCreateRejectsServerControlledFields() {
        for field in ["version", "createdAt", "updatedAt"] {
            XCTAssertEqual(
                B.validatePrescription(.servicePrescription, mode: .create, presentFields: [field]),
                .rejected(status: 400, error: "Network service prescription write boundary rejects client-controlled \(field)"),
                "field \(field)")
            XCTAssertEqual(
                B.validatePrescription(.prostheticPrescription, mode: .create, presentFields: [field]),
                .rejected(status: 400, error: "Network prosthetic prescription write boundary rejects client-controlled \(field)"),
                "field \(field)")
        }
    }

    /* @Codex */
    func testPrescriptionUpdateAllowsVersionButRejectsCreatedAndUpdatedAt() {
        XCTAssertEqual(
            B.validatePrescription(.servicePrescriptionItem, mode: .update, presentFields: ["version"]),
            .allowed)
        XCTAssertEqual(
            B.validatePrescription(.servicePrescriptionItem, mode: .update, presentFields: ["createdAt"]),
            .rejected(status: 400, error: "Network service prescription item write boundary rejects client-controlled createdAt"))
        XCTAssertEqual(
            B.validatePrescription(.servicePrescriptionItem, mode: .update, presentFields: ["updatedAt"]),
            .rejected(status: 400, error: "Network service prescription item write boundary rejects client-controlled updatedAt"))
    }

    /* @Codex */
    func testPrescriptionRejectsAIDocumentFieldsAndAllowsCleanWrites() {
        for field in ["aiSummary", "documentInsights", "documentInsightId", "sourceDocumentId"] {
            XCTAssertEqual(
                B.validatePrescription(.prostheticPrescription, mode: .create, presentFields: [field]),
                .rejected(status: 403, error: "Network prosthetic prescription write boundary excludes AI/document-derived fields"),
                "field \(field)")
        }
        XCTAssertEqual(
            B.validatePrescription(.servicePrescription, mode: .create, presentFields: ["patientId", "serviceName"]),
            .allowed)
        XCTAssertEqual(
            B.validatePrescription(.prostheticPrescription, mode: .update, presentFields: ["version", "status"]),
            .allowed)
    }
}
