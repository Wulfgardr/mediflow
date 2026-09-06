// @Codex
import XCTest
@testable import MediFlowAppleShared

@MainActor final class ClinicalWorkspaceReadPrivacyTests: XCTestCase {
    func testRetainedGlobalModelsClearBeforeHeldLogoutAndStayEmptyAfterLogin() async throws {
        let h = try LockReadHarness(test: self)
        let models = probes(h, observeInvalidations: true)
        for probe in models { await probe.load(); XCTAssertTrue(probe.populated(), probe.name) }
        let started = h.transport.hold(LockReadFixture.logout)
        let locking = Task { await h.model.lockSessionNow() }
        await fulfillment(of: [started], timeout: 5)
        // No view .task/load call is required for the retained models to clear.
        for probe in models { XCTAssertTrue(probe.empty(), probe.name) }
        h.model.password = LockReadFixture.pin
        await h.model.login()
        try h.transport.release(LockReadFixture.logout, status: 204)
        await locking.value
        for probe in models { XCTAssertTrue(probe.empty(), probe.name) }
        await h.model.loadPatients()
        for probe in models {
            XCTAssertTrue(probe.empty(), probe.name)
            await probe.load()
            XCTAssertTrue(probe.populated(), "Only a fresh authorized read restores " + probe.name)
        }
    }

    func testGlobalReadCannotPublishAfterScopeChangesAwayAndBack() async throws {
        for index in 0..<4 {
            let h = try LockReadHarness(test: self)
            let probe = probes(h, observeInvalidations: true)[index]
            let started = h.transport.hold(LockReadFixture.patients)
            let reading = Task { await probe.load() }
            await fulfillment(of: [started], timeout: 5)
            h.model.ambulatoryId = "scope-b"
            h.model.ambulatoryId = "scope-a"
            try h.transport.release(LockReadFixture.patients)
            await reading.value
            XCTAssertTrue(probe.empty(), probe.name)
            XCTAssertNotEqual(probe.state(), .loaded, probe.name)
        }
    }

    func testActiveGlobalFailuresStillSurface() async throws {
        for index in 0..<4 {
            let h = try LockReadHarness(test: self)
            let probe = probes(h, observeInvalidations: true)[index]
            h.transport.failPatients = true
            await probe.load()
            guard case .failed = probe.state() else { XCTFail(probe.name); continue }
            XCTAssertTrue(probe.empty(), probe.name)
        }
    }

    func testLoadedGlobalResultsAreClearedWhenConnectionIsUnavailable() async throws {
        let h = try LockReadHarness(test: self)
        let models = probes(h)
        for probe in models { await probe.load(); XCTAssertTrue(probe.populated(), probe.name) }
        await h.model.lockSessionNow()
        for probe in models {
            await probe.load()
            XCTAssertTrue(probe.empty(), probe.name)
            guard case .unavailable = probe.state() else { XCTFail(probe.name); continue }
        }
    }

    func testOldGlobalReadCannotPublishAfterLock() async throws {
        for index in 0..<4 {
            let h = try LockReadHarness(test: self)
            let probe = probes(h)[index]
            let started = h.transport.hold(LockReadFixture.patients)
            let reading = Task { await probe.load() }
            await fulfillment(of: [started], timeout: 5)
            await h.model.lockSessionNow()
            try h.transport.release(LockReadFixture.patients)
            await reading.value
            XCTAssertTrue(probe.empty(), probe.name)
            XCTAssertNotEqual(probe.state(), .loaded, probe.name)
        }
    }

    func testLateGlobalFailureCannotReplaceNewerSuccessfulRead() async throws {
        for index in 0..<4 {
            let h = try LockReadHarness(test: self)
            let probe = probes(h)[index]
            let started = h.transport.hold(LockReadFixture.patients)
            let old = Task { await probe.load() }
            await fulfillment(of: [started], timeout: 5)
            await probe.load()
            XCTAssertTrue(probe.populated(), probe.name)
            try h.transport.release(LockReadFixture.patients, status: 401)
            await old.value
            XCTAssertEqual(probe.state(), .loaded, probe.name)
            XCTAssertTrue(probe.populated(), probe.name)
        }
    }

    private struct Probe {
        let name: String
        let load: () async -> Void
        let populated: () -> Bool
        let empty: () -> Bool
        let state: () -> ClinicalWorkspaceLoadState
    }
    private func probes(_ h: LockReadHarness, observeInvalidations: Bool = false) -> [Probe] {
        let invalidations = observeInvalidations ? h.model.clinicalWorkspaceInvalidations : nil
        let diary = GlobalDiaryWorkspaceModel(connectionProvider: { h.model.clinicalWorkspaceConnection }, invalidations: invalidations)
        let analytics = PopulationAnalyticsWorkspaceModel(connectionProvider: { h.model.clinicalWorkspaceConnection }, invalidations: invalidations)
        let agenda = AgendaWorkspaceModel(connectionProvider: { h.model.clinicalWorkspaceConnection }, invalidations: invalidations)
        let scales = ClinicalScalesCatalogModel(connectionProvider: { h.model.clinicalWorkspaceConnection }, invalidations: invalidations)
        return [
            Probe(name: "diary", load: { await diary.load() }, populated: { !diary.rows.isEmpty },
                empty: { diary.rows.isEmpty && diary.activeCount == 0 && diary.patientCount == 0 }, state: { diary.state }),
            Probe(name: "analytics", load: { await analytics.load() }, populated: { analytics.statistics != nil },
                empty: { analytics.statistics == nil }, state: { analytics.state }),
            Probe(name: "agenda", load: { await agenda.load() }, populated: { !agenda.rows.isEmpty },
                empty: { agenda.rows.isEmpty && agenda.activePatientCount == 0 && agenda.todayCount == 0 && agenda.plannedCount == 0 }, state: { agenda.state }),
            Probe(name: "scales", load: { await scales.load() }, populated: { !scales.visiblePatients.isEmpty },
                empty: { scales.patients.isEmpty && scales.visiblePatients.isEmpty }, state: { scales.state })
        ]
    }
}

@MainActor final class PairedPatientReadPrivacyTests: XCTestCase {
    func testLateFseValidationCannotReopenResultAfterLock() async throws {
        let h = try LockReadHarness(test: self)
        await h.model.validateFseTherapy(LockReadFixture.therapy)
        XCTAssertNotNil(h.model.fseDocumentValidationResult)
        let path = "/api/v1/network/fse/validate-document"
        let started = h.transport.hold(path)
        let reading = Task { await h.model.validateFseTherapy(LockReadFixture.therapy) }
        await fulfillment(of: [started], timeout: 5)
        await h.model.lockSessionNow()
        let status = h.model.statusMessage
        try h.transport.release(path)
        await reading.value
        XCTAssertNil(h.model.fseDocumentValidationResult)
        XCTAssertNil(h.model.fseDocumentValidationTargetLabel)
        XCTAssertEqual(h.model.statusMessage, status)
    }

    func testActiveReadFailureStillSurfacesAndRetrySucceeds() async throws {
        let h = try LockReadHarness(test: self)
        let path = LockReadFixture.patient + "/entries"
        let started = h.transport.hold(path)
        let reading = Task { await h.model.loadSelectedPatientEntries() }
        await fulfillment(of: [started], timeout: 5)
        try h.transport.release(path, status: 503)
        await reading.value
        XCTAssertNotNil(h.model.errorMessage)
        await h.model.loadSelectedPatientEntries()
        XCTAssertNil(h.model.errorMessage)
        XCTAssertEqual(h.model.entries.first?.id, LockReadFixture.entry.id)
    }

    func testEachDirectReadCannotRestoreRowsOrStatusAfterLock() async throws {
        for module in ["entries", "therapies", "checkups", "observations", "service-prescriptions", "service-prescription-items", "prosthetic-prescriptions", "attachments"] {
            let h = try LockReadHarness(test: self)
            let path = (module.contains("prescription") ? "/api/v1/network" : LockReadFixture.patient) + "/" + module
            await read(module, h.model)
            XCTAssertNil(h.model.errorMessage, module)
            let started = h.transport.hold(path)
            let reading = Task { await self.read(module, h.model) }
            await fulfillment(of: [started], timeout: 5)
            await h.model.lockSessionNow()
            let status = h.model.statusMessage
            try h.transport.release(path)
            await reading.value
            XCTAssertTrue(h.model.entries.isEmpty && h.model.therapies.isEmpty && h.model.checkups.isEmpty && h.model.observations.isEmpty, module)
            XCTAssertTrue(h.model.servicePrescriptions.isEmpty && h.model.servicePrescriptionItems.isEmpty && h.model.prostheticPrescriptions.isEmpty && h.model.attachments.isEmpty, module)
            XCTAssertNil(h.model.errorMessage, module)
            XCTAssertEqual(h.model.statusMessage, status, module)
        }
    }

    func testReadCannotPublishAfterScopeChangesAwayAndBack() async throws {
        let h = try LockReadHarness(test: self)
        let path = LockReadFixture.patient + "/entries"
        let started = h.transport.hold(path)
        let reading = Task { await h.model.loadSelectedPatientEntries() }
        await fulfillment(of: [started], timeout: 5)
        h.model.ambulatoryId = "scope-b"
        h.model.ambulatoryId = "scope-a"
        h.model.configurePairedOnlineForTests(credentials: HomeBasePairedCredentials(clientId: "paired-fixture", clientToken: "paired-token-fixture"), sessionCookie: "sid=fixture", selectedPatient: OfflineCacheFixture.detail())
        h.model.newEntryTitle = "Nuova bozza sintetica"
        try h.transport.release(path)
        await reading.value
        XCTAssertTrue(h.model.entries.isEmpty)
        XCTAssertEqual(h.model.newEntryTitle, "Nuova bozza sintetica")
        XCTAssertNil(h.model.errorMessage)
    }

    private func read(_ module: String, _ model: PairedPatientsWorkspaceModel) async {
        switch module {
        case "entries": await model.loadSelectedPatientEntries()
        case "therapies": await model.loadSelectedPatientTherapies()
        case "checkups": await model.loadSelectedPatientCheckups()
        case "observations": await model.loadSelectedPatientObservations()
        case "service-prescriptions", "service-prescription-items": await model.loadSelectedPatientServicePrescriptions()
        case "prosthetic-prescriptions": await model.loadSelectedPatientProstheticPrescriptions()
        case "attachments": await model.loadSelectedPatientAttachments()
        default: XCTFail("Unregistered test module")
        }
    }
}
