import CryptoKit
import XCTest
@testable import MediFlowAppleShared
/* @Codex */
final class PairedPatientsWorkspaceSelectionTests: XCTestCase {
    @MainActor func testSelectionSurvivesSameVersionRefreshWhileWorkspaceIsInvalidated() {
        let model = makeModel()
        model.ambulatoryId = "scope-a"
        model.configurePairedOnlineForTests(
            patients: [summary(id: "patient-a", version: 1), summary(id: "patient-b", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1), entries: [entry(patientID: "patient-a")])
        model.ambulatoryId = " scope-a "
        model.applyPatientRefreshForSelectionTests([summary(id: "patient-b", version: 2), summary(id: "patient-a", version: 1)])
        XCTAssertEqual(model.selectedPatientID, "patient-a")
        XCTAssertNil(model.selectedPatient)
        XCTAssertTrue(model.entries.isEmpty)
    }
    @MainActor func testRevisionIdentityRefreshKeepsWorkspaceUntilReloadCommits() {
        let model = makeModel()
        model.configurePairedOnlineForTests(
            patients: [summary(id: "patient-a", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1), entries: [entry(patientID: "patient-a")])
        model.applyPatientRevisionRefreshForSelectionTests([summary(id: "patient-a", version: 1)])
        XCTAssertEqual(model.selectedPatientID, "patient-a")
        XCTAssertEqual(model.selectedPatient?.id, "patient-a")
        XCTAssertEqual(model.entries.map(\.id), ["entry-a"])
    }
    @MainActor func testFilteringDoesNotMutateStableSelection() {
        let patients = [summary(id: "patient-a", version: 1, lastName: "Rossi"), summary(id: "patient-b", version: 1, lastName: "Bianchi")]
        let model = makeModel()
        model.configurePairedOnlineForTests(patients: patients, selectedPatient: detail(id: "patient-a", version: 1))
        let filtered = PatientsFiltering.apply(patients: patients, query: "Bianchi", viewMode: .active, sortMode: .alpha)
        XCTAssertEqual(filtered.map(\.id), ["patient-b"])
        XCTAssertEqual(model.selectedPatientID, "patient-a")
    }
    @MainActor func testVersionChangeInvalidatesDetailButRetainsStableSelectionID() {
        let model = makeModel()
        model.configurePairedOnlineForTests(patients: [summary(id: "patient-a", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1), entries: [entry(patientID: "patient-a")])
        model.applyPatientRefreshForSelectionTests([summary(id: "patient-a", version: 2)])
        XCTAssertEqual(model.selectedPatientID, "patient-a")
        XCTAssertNil(model.selectedPatient)
        XCTAssertTrue(model.entries.isEmpty)
    }
    @MainActor func testClearPairingDropsRetainedSelectionIDInGlobalScope() async {
        let model = makeModel()
        model.configurePairedOnlineForTests(patients: [summary(id: "patient-a", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1))
        model.applyPatientRefreshForSelectionTests([summary(id: "patient-a", version: 2)])
        XCTAssertEqual(model.ambulatoryId, "")
        XCTAssertEqual(model.selectedPatientID, "patient-a")
        await model.clearPairing()
        XCTAssertNil(model.selectedPatientID)
    }
    @MainActor func testRefreshClearsSelectionWhenPatientDisappears() {
        let model = makeModel()
        model.configurePairedOnlineForTests(patients: [summary(id: "patient-a", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1))
        model.applyPatientRefreshForSelectionTests([summary(id: "patient-b", version: 1)])
        XCTAssertNil(model.selectedPatientID)
        XCTAssertNil(model.selectedPatient)
    }
    @MainActor func testTrashTransitionClearsSelectionDespiteActiveSummaryRemaining() {
        let model = makeModel()
        model.configurePairedOnlineForTests(
            patients: [summary(id: "patient-a", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1), entries: [entry(patientID: "patient-a")])
        model.applyPatientTrashRefreshForSelectionTests([summary(id: "patient-a", version: 1), summary(id: "patient-deleted", version: 2, deleted: true)])
        XCTAssertEqual(model.patients.map(\.id), ["patient-a", "patient-deleted"])
        XCTAssertNil(model.selectedPatientID)
        XCTAssertNil(model.selectedPatient)
        XCTAssertTrue(model.entries.isEmpty)
    }
    @MainActor func testDirectAmbulatoryScopeMutationClearsStateBeforeSamePatientVersionRefresh() {
        let patient = summary(id: "patient-a", version: 1)
        let model = makeModel()
        model.ambulatoryId = "scope-a"
        model.configurePairedOnlineForTests(
            patients: [patient], selectedPatient: detail(id: patient.id, version: 1, ambulatoryID: "scope-a"),
            entries: [entry(patientID: patient.id)], therapies: [therapy(patientID: patient.id)],
            attachments: [attachment(patientID: patient.id)])
        model.newEntryTitle = "Bozza sintetica"
        model.newEntryVisitTranscript = "Trascrizione sintetica"
        model.newEntryVisitDraftReviewed = true
        model.newEntryAttachmentIds = ["attachment-a"]
        XCTAssertTrue(model.selectedPatient != nil && !model.entries.isEmpty && !model.therapies.isEmpty && !model.attachments.isEmpty && model.newEntryVisitDraftReviewed)
        model.ambulatoryId = "scope-b"
        model.applyPatientRefreshForSelectionTests([patient])
        XCTAssertEqual(model.ambulatoryId, "scope-b")
        XCTAssertEqual(model.patients.first?.version, 1)
        XCTAssertNil(model.selectedPatientID)
        XCTAssertNil(model.selectedPatient)
        XCTAssertTrue(model.entries.isEmpty && model.therapies.isEmpty)
        XCTAssertTrue(model.attachments.isEmpty && model.newEntryAttachmentIds.isEmpty)
        XCTAssertNil(model.attachmentsPatientId)
        XCTAssertEqual(model.newEntryTitle, "")
        XCTAssertEqual(model.newEntryVisitTranscript, "")
        XCTAssertFalse(model.newEntryVisitDraftReviewed)
    }
    @MainActor private func makeModel() -> PairedPatientsWorkspaceModel {
        let defaults = UserDefaults(suiteName: "PairedPatientsWorkspaceSelectionTests.\(UUID().uuidString)")!
        let pairedStore = HomeBasePairedStore(
            userDefaults: defaults, keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) }, keychainDeleter: { _, _ in .success(()) })
        let cacheStore = HomeBasePatientCacheStore(
            cacheDirectory: FileManager.default.temporaryDirectory.appendingPathComponent("PairedPatientsWorkspaceSelectionTests-\(UUID().uuidString)"), keyProvider: { SymmetricKey(data: Data(repeating: 9, count: 32)) })
        return PairedPatientsWorkspaceModel(pairedStore: pairedStore, cacheStore: cacheStore)
    }
    private func summary(id: String, version: Int, lastName: String = "Rossi", deleted: Bool = false) -> HomeBasePatientSummary {
        HomeBasePatientSummary(
            id: id, firstName: "Mario", lastName: lastName, birthDate: nil,
            taxCode: "SYNTHETIC-\(id)", isAdi: false, isArchived: false,
            version: version, updatedAt: Date(timeIntervalSince1970: TimeInterval(version)),
            deletedAt: deleted ? Date(timeIntervalSince1970: 10) : nil, deletionReason: deleted ? "fixture sintetica" : nil)
    }
    private func entry(patientID: String) -> HomeBaseEntrySummary {
        HomeBaseEntrySummary(
            id: "entry-a", patientId: patientID, type: "note", title: "Nota sintetica",
            date: Date(timeIntervalSince1970: 1), content: "Contenuto sintetico", setting: nil, metadata: nil, attachments: nil, deletedAt: nil,
            deletionReason: nil, version: 1, createdAt: nil, updatedAt: nil)
    }
    private func therapy(patientID: String) -> HomeBaseTherapySummary {
        HomeBaseTherapySummary(
            id: "therapy-a", patientId: patientID, drugName: "Sintetico", aic: nil, atc: nil,
            activePrinciple: nil, dosage: "1", motivation: nil, diagnosisCode: nil, diagnosisName: nil,
            status: "active", startDate: Date(timeIntervalSince1970: 1), endDate: nil, version: 1, createdAt: nil, updatedAt: nil, deletedAt: nil, deletionReason: nil)
    }
    private func attachment(patientID: String) -> HomeBaseAttachmentSummary {
        HomeBaseAttachmentSummary(
            id: "attachment-a", patientId: patientID, name: "Sintetico", type: "text/plain", size: 1,
            path: "synthetic", summarySnapshot: nil, parseEvidenceArtifactSnapshot: nil, ocrQueueState: nil, ocrQueueReason: nil, ocrQueueUpdatedAt: nil,
            ocrReplayArtifactSnapshot: nil, createdAt: nil)
    }
    private func detail(id: String, version: Int, ambulatoryID: String = "synthetic") -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: id, firstName: "Mario", lastName: "Rossi", birthDate: nil,
            taxCode: "SYNTHETIC-\(id)", address: nil, phone: nil, caregiver: nil,
            exemptions: nil, diagnoses: nil, monitoringProfile: nil, statusReason: nil, notes: nil, aiSummary: nil, documentInsights: nil, isAdi: false,
            isArchived: false, version: version, ambulatoryId: ambulatoryID,
            createdAt: nil, updatedAt: nil)
    }
}
