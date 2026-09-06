// @Codex
import XCTest
@testable import MediFlowAppleShared

@MainActor final class PairedPatientsWorkspaceSessionExpiryTests: XCTestCase {
    func testCurrentEntry401ClearsLoadedChartAndDraftsWithoutRemoteLogout() async throws {
        let h = try LockReadHarness(test: self)
        seedDrafts(h.model)
        let started = h.transport.hold(LockReadFixture.patient + "/entries")
        let reading = Task { await h.model.loadSelectedPatientEntries() }
        await fulfillment(of: [started], timeout: 5)
        XCTAssertNotNil(h.model.selectedPatient)
        XCTAssertFalse(h.model.newEntryEditorDocument.isEffectivelyEmpty)
        try h.transport.release(LockReadFixture.patient + "/entries", status: 401)
        await reading.value
        assertRevoked(h.model)
        XCTAssertFalse(h.transport.requestPaths.contains(LockReadFixture.logout))
    }

    func testCurrentPatientReload401UsesSameRevocationThroughReloadFailure() async throws {
        let h = try LockReadHarness(test: self)
        seedDrafts(h.model)
        let started = h.transport.hold(LockReadFixture.patient)
        let reading = Task { await h.model.reloadAfterConflict() }
        await fulfillment(of: [started], timeout: 5)
        XCTAssertNotNil(h.model.selectedPatient, "Reload must retain the existing chart until its response")
        try h.transport.release(LockReadFixture.patient, status: 401)
        await reading.value
        assertRevoked(h.model)
        XCTAssertFalse(h.transport.requestPaths.contains(LockReadFixture.logout))
    }

    func testCurrentSecondaryScope401RevokesBeforeItsOwnClearInvalidatesFailureEpoch() async throws {
        let h = try LockReadHarness(test: self)
        let diary = GlobalDiaryWorkspaceModel(connectionProvider: { h.model.clinicalWorkspaceConnection },
            invalidations: h.model.clinicalWorkspaceInvalidations)
        await diary.load()
        XCTAssertFalse(diary.rows.isEmpty)
        let globalPath = "/api/v1/network/entries"
        let globalStarted = h.transport.hold(globalPath)
        let lateGlobal = Task { await diary.load() }
        await fulfillment(of: [globalStarted], timeout: 5)

        let scopePath = "/api/v1/network/ambulatories"
        let scopeStarted = h.transport.hold(scopePath)
        let reading = Task { await h.model.loadPatients() }
        await fulfillment(of: [scopeStarted], timeout: 5)
        XCTAssertFalse(h.model.patients.isEmpty, "The first list read succeeded before the secondary 401")
        XCTAssertNotNil(h.model.clinicalWorkspaceConnection?.masterKey)
        try h.transport.release(scopePath, status: 401)
        await reading.value
        assertRevoked(h.model)
        try h.transport.release(globalPath)
        await lateGlobal.value
        XCTAssertTrue(diary.rows.isEmpty)
        XCTAssertNotEqual(diary.state, .loaded)
        let requestCount = h.transport.requestPaths.count
        await h.model.loadPatients()
        XCTAssertEqual(h.transport.requestPaths.count, requestCount, "The revoked cookie cannot start another clinical read")
        XCTAssertFalse(h.transport.requestPaths.contains(LockReadFixture.logout))
    }

    func testLate401CannotRevokeANewerAuthenticatedSession() async throws {
        let h = try LockReadHarness(test: self)
        let path = LockReadFixture.patient + "/entries"
        let started = h.transport.hold(path)
        let reading = Task { await h.model.loadSelectedPatientEntries() }
        await fulfillment(of: [started], timeout: 5)
        await h.model.lockSessionNow()
        h.model.password = LockReadFixture.pin
        await h.model.login()
        await h.model.loadPatients()
        XCTAssertEqual(h.model.operatorIdentity?.userId, "new-operator-fixture")
        XCTAssertFalse(h.model.patients.isEmpty)
        let patients = h.model.patients
        let status = h.model.statusMessage
        try h.transport.release(path, status: 401)
        await reading.value
        XCTAssertEqual(h.model.operatorIdentity?.userId, "new-operator-fixture")
        XCTAssertEqual(h.model.patients, patients)
        XCTAssertEqual(h.model.connectionState, .pairedOnline)
        XCTAssertEqual(h.model.statusMessage, status)
        XCTAssertNil(h.model.errorMessage)
        await h.model.loadPatient(OfflineCacheFixture.summary())
        XCTAssertNotNil(h.model.selectedPatient)
    }

    func testCurrent403KeepsTheExistingSessionSemantics() async throws {
        let h = try LockReadHarness(test: self)
        let path = LockReadFixture.patient + "/entries"
        let started = h.transport.hold(path)
        let reading = Task { await h.model.loadSelectedPatientEntries() }
        await fulfillment(of: [started], timeout: 5)
        try h.transport.release(path, status: 403)
        await reading.value
        XCTAssertEqual(h.model.connectionState, .pairedOnline)
        XCTAssertNotNil(h.model.clinicalWorkspaceConnection?.masterKey)
        XCTAssertNotNil(h.model.selectedPatient)
        XCTAssertNotNil(h.model.errorMessage)
        XCTAssertTrue(h.model.statusMessage?.contains("non autorizzata") == true)
        XCTAssertFalse(h.transport.requestPaths.contains(LockReadFixture.logout))
    }

    private func seedDrafts(_ model: PairedPatientsWorkspaceModel) {
        model.newEntryTitle = "Bozza sintetica"
        model.newEntryEditorDocument = ClinicalRichTextEditorDocument.load(html: "<p>Testo sintetico</p>")
        model.newEntryVisitTranscript = "Trascrizione sintetica"
        model.newEntryVisitDraftReviewed = true
        model.startEditingEntry(LockReadFixture.entry)
        model.startEditingPatient()
        model.editPatientNotes = "Modifica sintetica"
        model.newTherapyDosage = "Dose sintetica"
    }

    private func assertRevoked(_ model: PairedPatientsWorkspaceModel, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(model.connectionState, .sessionExpired, file: file, line: line)
        XCTAssertNil(model.clinicalWorkspaceConnection, file: file, line: line)
        XCTAssertNil(model.operatorIdentity, file: file, line: line)
        XCTAssertNil(model.selectedPatient, file: file, line: line)
        XCTAssertNil(model.selectedPatientID, file: file, line: line)
        XCTAssertTrue(model.patients.isEmpty && model.entries.isEmpty && model.attachments.isEmpty, file: file, line: line)
        XCTAssertNil(model.cachedPatientProfile, file: file, line: line)
        XCTAssertNil(model.cacheMetadata, file: file, line: line)
        XCTAssertTrue(model.newEntryEditorDocument.isEffectivelyEmpty && model.editEntryEditorDocument.isEffectivelyEmpty, file: file, line: line)
        XCTAssertEqual(model.newEntryTitle, "", file: file, line: line)
        XCTAssertEqual(model.newEntryVisitTranscript, "", file: file, line: line)
        XCTAssertFalse(model.newEntryVisitDraftReviewed, file: file, line: line)
        XCTAssertNil(model.editingEntryId, file: file, line: line)
        XCTAssertFalse(model.isEditingPatient, file: file, line: line)
        XCTAssertEqual(model.editPatientNotes, "", file: file, line: line)
        XCTAssertEqual(model.newTherapyDosage, "", file: file, line: line)
        XCTAssertFalse(model.canCreateEntry || model.canUpdateEditingEntry || model.canComputeVisitDraft, file: file, line: line)
        XCTAssertNotNil(model.errorMessage, "The active 401 remains an error, not a cancelled read", file: file, line: line)
        XCTAssertTrue(model.statusMessage?.contains("Sessione operatore scaduta") == true, file: file, line: line)
    }
}
