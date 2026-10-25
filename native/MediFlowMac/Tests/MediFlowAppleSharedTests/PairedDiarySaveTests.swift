import CryptoKit
import Foundation
import XCTest
@testable import MediFlowCore
@testable import MediFlowAppleShared

/* Actual model/client/sealing, substituted transport; no host or UI. */
final class PairedDiarySaveTests: XCTestCase {
    @MainActor
    func testCreateAcknowledgementDoesNotEraseChangesAfterTheSubmittedSnapshot() async throws {
        let (model, transport) = try harness()
        model.newEntryTitle = "Titolo inviato"
        model.newEntryEditorDocument = .load(html: "<p>Prima <strong>versione sintetica</strong></p>")
        let sentHTML = model.newEntryEditorDocument.renderedHTML
        let started = transport.holdNext(method: "POST")
        let save = Task { await model.createEntryForSelectedPatient() }
        await fulfillment(of: [started], timeout: 3)
        defer { transport.release() }
        XCTAssertTrue(model.isWorking)
        XCTAssertFalse(model.canCreateEntry)
        // Simulate a delayed native-input callback despite the disabled UI.
        model.newEntryTitle = "Correzione successiva"
        model.newEntryEditorDocument = .load(html: "<p>Bozza <em>successiva</em> non inviata</p>")
        let retained = model.newEntryEditorDocument
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(transport.writes.count, 1, "A second Save while pending is a no-op.")
        transport.release()
        await save.value
        XCTAssertEqual(model.newEntryTitle, "Correzione successiva")
        XCTAssertEqual(model.newEntryEditorDocument, retained)
        XCTAssertTrue(model.canCreateEntry)
        XCTAssertEqual(transport.writes.count, 1, "Preservation must not auto-submit the new draft.")
        XCTAssertEqual(try decrypted(transport.writes[0], "content"), sentHTML)
        XCTAssertEqual(try decrypted(transport.writes[0], "title"), "Titolo inviato")
        XCTAssertEqual(model.entries.count, 1)
        XCTAssertEqual(model.entries.first?.content, sentHTML)
        XCTAssertTrue(model.statusMessage?.contains("non salvata") == true)
        XCTAssertEqual(transport.writes[0].request.value(forHTTPHeaderField: "Cookie"),
                       "mediflow_session=diary-synthetic; ambulatory_id=scope-a")
    }

    @MainActor
    func testUnchangedCreateClearsOnlyAfterSuccessAndFailedRetryKeepsItsStableID() async throws {
        let (model, transport) = try harness()
        model.newEntryTitle = "Bozza sintetica"
        model.newEntryEditorDocument = .load(html: "<p>Da conservare se la risposta manca</p>")
        let draft = model.newEntryEditorDocument
        transport.writeStatus = 503
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(model.newEntryEditorDocument, draft)
        XCTAssertEqual(model.newEntryTitle, "Bozza sintetica")
        XCTAssertEqual(model.entries.count, 1)
        transport.writeStatus = nil
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(transport.writes.count, 2)
        XCTAssertEqual(try json(transport.writes[0])["id"] as? String, try json(transport.writes[1])["id"] as? String)
        XCTAssertTrue(model.newEntryEditorDocument.blocks.isEmpty)
        XCTAssertEqual(model.newEntryTitle, "")
        XCTAssertFalse(model.isWorking)
    }

    @MainActor
    func testUpdateAcknowledgementPreservesLaterEditsAndRequiresExplicitVersionReview() async throws {
        let (model, transport) = try harness()
        model.startEditingEntry(DiaryFixture.entry())
        model.editEntryTitle = "Titolo inviato"
        model.editEntryEditorDocument = .load(html: "<p>Snapshot <strong>inviato</strong></p>")
        let sentHTML = model.editEntryEditorDocument.renderedHTML
        let started = transport.holdNext(method: "PUT")
        let save = Task { await model.updateEditingEntry() }
        await fulfillment(of: [started], timeout: 3)
        defer { transport.release() }
        XCTAssertTrue(model.isWorking)
        XCTAssertFalse(model.canUpdateEditingEntry)
        model.editEntryTitle = "Correzione dopo Save"
        model.editEntryEditorDocument = .load(html: "<p>Correzione <em>successiva</em></p>")
        let retained = model.editEntryEditorDocument
        await model.updateEditingEntry()
        transport.release()
        await save.value
        XCTAssertEqual(transport.writes.count, 1)
        XCTAssertEqual(try decrypted(transport.writes[0], "content"), sentHTML)
        XCTAssertEqual(model.editEntryTitle, "Correzione dopo Save")
        XCTAssertEqual(model.editEntryEditorDocument, retained)
        XCTAssertEqual(model.editingEntryVersion, 1, "The boolean ACK cannot supply a guessed version.")
        XCTAssertTrue(model.editingEntryRequiresReconciliation)
        XCTAssertFalse(model.canUpdateEditingEntry)
        XCTAssertEqual(model.editingEntryRemoteReview?.version, 2)
        model.confirmEditingEntryReconciliation()
        XCTAssertEqual(model.editingEntryVersion, 2)
        XCTAssertEqual(model.editEntryEditorDocument, retained)
        XCTAssertEqual(transport.writes.count, 1, "Review confirmation performs no write.")
        await model.updateEditingEntry()
        XCTAssertEqual(transport.writes.count, 2)
        XCTAssertEqual(try json(transport.writes[1])["version"] as? Int, 2)
        XCTAssertEqual(try decrypted(transport.writes[1], "content"), retained.renderedHTML)
        XCTAssertFalse(model.isEditingEntry)
    }

    @MainActor
    func testConflictReloadPreservesDraftAndRebasesOnlyAfterManualComparison() async throws {
        let (model, transport) = try harness()
        let original = DiaryFixture.entry()
        model.startEditingEntry(original)
        model.editEntryTitle = "Titolo locale corretto"
        let localDocument = model.editEntryEditorDocument
        transport.entries = [DiaryFixture.entry(version: 2, content: "<p>Correzione da altro client</p>")]
        transport.writeStatus = 409
        await model.updateEditingEntry()
        XCTAssertNotNil(model.pendingConflict)
        XCTAssertTrue(model.editingEntryRequiresReconciliation)
        XCTAssertEqual(model.editEntryEditorDocument, localDocument)
        model.dismissConflict()
        await model.updateEditingEntry()
        XCTAssertEqual(transport.writes.count, 1, "Ignoring the banner cannot bypass reconciliation.")
        let started = transport.holdNext(method: "GET", suffix: "/patients/patient-a")
        let reload = Task { await model.reloadAfterConflict() }
        await fulfillment(of: [started], timeout: 3)
        defer { transport.release() }
        model.editEntryTitle = "Bozza ritoccata durante la rilettura"
        transport.release()
        await reload.value
        XCTAssertNil(model.pendingConflict)
        XCTAssertEqual(model.editingEntryVersion, 1)
        XCTAssertEqual(model.editEntryEditorDocument, localDocument)
        XCTAssertEqual(model.editEntryTitle, "Bozza ritoccata durante la rilettura")
        XCTAssertFalse(model.canUpdateEditingEntry)
        XCTAssertEqual(model.editingEntryRemoteReview?.content, "<p>Correzione da altro client</p>")
        model.startEditingEntry(try XCTUnwrap(model.entries.first))
        XCTAssertEqual(model.editEntryEditorDocument, localDocument, "Reopening the same row must not discard the draft.")
        model.confirmEditingEntryReconciliation()
        XCTAssertEqual(model.editingEntryVersion, 2)
        XCTAssertEqual(model.editEntryEditorDocument, localDocument)
        XCTAssertEqual(transport.writes.count, 1)
        transport.writeStatus = nil
        await model.updateEditingEntry()
        XCTAssertEqual(transport.writes.count, 2)
        XCTAssertEqual(try json(transport.writes[1])["version"] as? Int, 2)
        // The retained original HTML now differs from the refreshed server copy;
        // it must be included, not omitted as if the pre-conflict baseline held.
        XCTAssertEqual(try decrypted(transport.writes[1], "content"), original.content)
        XCTAssertFalse(model.isEditingEntry)
    }

    @MainActor
    func testAnotherConflictAfterReviewNeedsANewExplicitReconciliation() async throws {
        let (model, transport) = try harness()
        model.startEditingEntry(DiaryFixture.entry())
        model.editEntryTitle = "Bozza locale"
        transport.writeStatus = 409
        transport.entries = [DiaryFixture.entry(version: 2)]
        await model.updateEditingEntry()
        await model.reloadAfterConflict()
        model.confirmEditingEntryReconciliation()
        transport.entries = [DiaryFixture.entry(version: 3)]
        await model.updateEditingEntry()
        XCTAssertEqual(model.editingEntryVersion, 2)
        XCTAssertTrue(model.editingEntryRequiresReconciliation)
        XCTAssertNil(model.editingEntryRemoteReview)
        XCTAssertEqual(model.editEntryTitle, "Bozza locale")
        XCTAssertEqual(transport.writes.count, 2)
        XCTAssertEqual(try json(transport.writes[1])["version"] as? Int, 2)
    }

    @MainActor
    func testMissingDeletedOrUnreadableRefreshedEntryCannotAuthorizeSave() async throws {
        for state in 0..<3 {
            let (model, transport) = try harness()
            model.startEditingEntry(DiaryFixture.entry())
            model.editEntryTitle = "Bozza da non perdere"
            let document = model.editEntryEditorDocument
            transport.writeStatus = 409
            await model.updateEditingEntry()
            transport.entries = state == 0 ? [] : [DiaryFixture.entry(
                version: 2, content: state == 2 ? "ENC:unreadable-synthetic" : "<p>Voce eliminata</p>",
                deletedAt: state == 1 ? Date(timeIntervalSince1970: 2) : nil)]
            await model.reloadAfterConflict()
            model.confirmEditingEntryReconciliation()
            XCTAssertFalse(model.canConfirmEditingEntryReconciliation)
            XCTAssertFalse(model.canUpdateEditingEntry)
            XCTAssertEqual(model.editingEntryVersion, 1)
            XCTAssertEqual(model.editEntryTitle, "Bozza da non perdere")
            XCTAssertEqual(model.editEntryEditorDocument, document)
            XCTAssertEqual(transport.writes.count, 1)
        }
    }

    @MainActor
    func testFailedReconciliationReadKeepsDraftAndCannotAdoptAConflictPayloadVersion() async throws {
        let (model, transport) = try harness()
        model.startEditingEntry(DiaryFixture.entry())
        model.editEntryTitle = "Bozza sintetica intatta"
        transport.writeStatus = 409
        await model.updateEditingEntry()
        transport.readStatus = 503
        await model.reloadAfterConflict()
        model.confirmEditingEntryReconciliation()
        XCTAssertEqual(model.editingEntryVersion, 1)
        XCTAssertNil(model.editingEntryRemoteReview)
        XCTAssertTrue(model.editingEntryRequiresReconciliation)
        XCTAssertEqual(model.editEntryTitle, "Bozza sintetica intatta")
        XCTAssertEqual(transport.writes.count, 1)
    }

    @MainActor
    func testLateWriteAfterScopeChangeCannotResetNewDraftOrPublishOldEntries() async throws {
        for edit in [false, true] {
            let (model, transport) = try harness()
            if edit {
                model.startEditingEntry(DiaryFixture.entry())
                model.editEntryTitle = "Snapshot in invio"
            } else {
                model.newEntryEditorDocument = .load(html: "<p>Snapshot in invio</p>")
            }
            let started = transport.holdNext(method: edit ? "PUT" : "POST")
            let save = Task {
                if edit { await model.updateEditingEntry() } else { await model.createEntryForSelectedPatient() }
            }
            await fulfillment(of: [started], timeout: 3)
            defer { transport.release() }
            model.ambulatoryId = "scope-b"
            model.newEntryTitle = "Bozza del contesto successivo"
            transport.release()
            await save.value
            XCTAssertNil(model.selectedPatient)
            XCTAssertTrue(model.entries.isEmpty)
            XCTAssertEqual(model.newEntryTitle, "Bozza del contesto successivo")
            XCTAssertFalse(model.editingEntryRequiresReconciliation)
            XCTAssertNil(model.editingEntryRemoteReview)
            XCTAssertEqual(transport.requests.count, 1, "No post-ACK refresh may use the replacement scope.")
        }
    }

    @MainActor
    func testRefreshFailureAfterAcknowledgedUpdateDoesNotPretendTheWriteFailed() async throws {
        let (model, transport) = try harness()
        model.startEditingEntry(DiaryFixture.entry())
        model.editEntryTitle = "Titolo salvato"
        transport.readStatus = 503
        await model.updateEditingEntry()
        XCTAssertFalse(model.isEditingEntry)
        XCTAssertEqual(transport.writes.count, 1)
        XCTAssertTrue(model.statusMessage?.contains("aggiornata") == true)
        XCTAssertTrue(model.errorMessage?.contains("rilettura") == true)
    }

    @MainActor
    func testUnauthorizedPostSaveReadStillUsesTheOrdinarySessionExpiry() async throws {
        for edit in [false, true] {
            let (model, transport) = try harness()
            if edit {
                model.startEditingEntry(DiaryFixture.entry())
                model.editEntryTitle = "Aggiornamento sintetico"
            } else {
                model.newEntryEditorDocument = .load(html: "<p>Nuova voce sintetica</p>")
            }
            transport.readStatus = 401
            if edit { await model.updateEditingEntry() } else { await model.createEntryForSelectedPatient() }
            XCTAssertEqual(transport.writes.count, 1, "The save was acknowledged before the unauthorized read.")
            XCTAssertEqual(model.connectionState, .sessionExpired)
            XCTAssertEqual(model.navigationAvailability, .locked)
            XCTAssertFalse(model.canCreateEntry)
            XCTAssertFalse(model.canUpdateEditingEntry)
            let count = transport.requests.count
            if edit { await model.updateEditingEntry() } else { await model.createEntryForSelectedPatient() }
            XCTAssertEqual(transport.requests.count, count, "An expired session must not dispatch another write.")
        }
    }

    @MainActor
    private func mobileScenario() async throws -> (PairedPatientsWorkspaceModel, DiarySaveTransport, UUID) {
        let (model, transport) = try harness(mobile: true)
        let coordinator = try XCTUnwrap(model.mobileVisit)
        await coordinator.prepare()
        let id = try XCTUnwrap(coordinator.vault.selected?.id)
        coordinator.vault.saveNote("Appunto clinico sintetico durevole")
        coordinator.requestOnlineReview(id)
        XCTAssertFalse(coordinator.vault.isUnlocked)
        model.password = transport.legacyPasscode
        await coordinator.authenticateAndReview()
        XCTAssertNotNil(coordinator.vault.onlineReview, coordinator.message ?? coordinator.vault.errorMessage ?? "Review assente")
        await coordinator.importNote(confirmed: true)
        XCTAssertNotNil(model.mobileVisitDraft, coordinator.vault.errorMessage ?? "Import assente")
        return (model, transport, id)
    }

    @MainActor
    func testMobileVisitRealLoginUnlockReviewImportAndOrdinaryReceipt() async throws {
        let (model, transport, id) = try await mobileScenario()
        XCTAssertTrue(model.newEntryEditorDocument.renderedHTML.contains("Appunto clinico sintetico durevole"))
        XCTAssertEqual(model.activePatientSection, .diary)
        XCTAssertEqual(transport.entryCreates.count, 0)
        let binding = try XCTUnwrap(model.mobileVisitDraft)
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(transport.entryCreates.count, 1)
        let registration = try model.mobileVisit!.vault.registration(for: binding)
        XCTAssertEqual(registration.phase, .registered)
        XCTAssertEqual(registration.entryID, try json(transport.entryCreates[0])["id"] as? String)
        XCTAssertEqual(registration.acknowledgedVersion, 1)
        XCTAssertNotNil(registration.confirmedAt)
        XCTAssertEqual(model.mobileVisit!.vault.retainedNotes.first(where: { $0.id == id })?.revision, binding.revision)
        XCTAssertNil(model.mobileVisitDraft)
        XCTAssertThrowsError(try model.mobileVisit!.vault.prepareImport(recordID: id))
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(transport.entryCreates.count, 1)
        XCTAssertEqual(transport.requests.filter { $0.request.url?.path == "/api/auth/native/login" }.count, 1,
            "Import and Registra reuse the newly authenticated session.")
    }

    @MainActor
    func testMobileVisitLostAckRestartReconcilesExactIDWithoutNewCreate() async throws {
        let (model, transport, id) = try await mobileScenario()
        let binding = try XCTUnwrap(model.mobileVisitDraft)
        transport.loseNextCreateAcknowledgement = true
        await model.createEntryForSelectedPatient()
        XCTAssertFalse(model.canCreateEntry)
        XCTAssertEqual(try model.mobileVisit!.vault.registration(for: binding).phase, .uncertain)
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(transport.entryCreates.count, 1)
        model.mobileVisit?.lock()
        let (restarted, _) = try harness(mobile: true, using: transport)
        let coordinator = try XCTUnwrap(restarted.mobileVisit)
        coordinator.requestOnlineReview(id)
        restarted.password = transport.legacyPasscode
        await coordinator.authenticateAndReview()
        await coordinator.reconcile(id)
        XCTAssertEqual(try coordinator.vault.registration(for: binding).phase, .registered)
        XCTAssertEqual(transport.entryCreates.count, 1)
        XCTAssertTrue(transport.requests.contains { $0.request.url?.lastPathComponent == binding.entryID && $0.request.httpMethod == "GET" })
    }

    @MainActor
    func testMobileVisitConfirmedAbsenceAllowsOnlyExplicitIdenticalPayloadRetry() async throws {
        let (model, transport, id) = try await mobileScenario()
        transport.writeStatus = 503
        await model.createEntryForSelectedPatient()
        XCTAssertFalse(model.canCreateEntry)
        transport.writeStatus = nil
        await model.mobileVisit!.reconcile(id)
        XCTAssertEqual(transport.entryCreates.count, 1, "404 reconciliation itself cannot write")
        XCTAssertTrue(model.canCreateEntry)
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(transport.entryCreates.count, 2)
        XCTAssertEqual(try json(transport.entryCreates[0]) as NSDictionary, try json(transport.entryCreates[1]) as NSDictionary,
            "ID, timestamp and every sealed field must stay byte-identical.")
        XCTAssertNil(model.mobileVisitDraft)
    }

    @MainActor
    func testMobileVisitWrongPatientOrChangedReadbackCannotConfirmOrRetry() async throws {
        for mutation in ["patient", "content", "version"] {
            let (model, transport, id) = try await mobileScenario()
            let binding = try XCTUnwrap(model.mobileVisitDraft)
            let started = transport.holdNext(method: "GET", suffix: "/entries/" + binding.entryID)
            let saving = Task { await model.createEntryForSelectedPatient() }
            await fulfillment(of: [started], timeout: 3)
            let sent = try XCTUnwrap(transport.entries.first)
            transport.entries = [DiaryFixture.entry(id: sent.id,
                version: mutation == "version" ? sent.version + 1 : sent.version,
                content: mutation == "content" ? "Contenuto successivo non riconciliato" : sent.content,
                title: sent.title, type: sent.type, attachments: sent.attachments,
                date: sent.date, patientID: mutation == "patient" ? "another-patient" : sent.patientId)]
            transport.release()
            await saving.value
            await model.mobileVisit!.reconcile(id)
            XCTAssertEqual(try model.mobileVisit!.vault.registration(for: binding).phase, .uncertain)
            XCTAssertFalse(model.canCreateEntry)
            await model.createEntryForSelectedPatient()
            XCTAssertEqual(transport.entryCreates.count, 1)
        }
    }

    @MainActor
    func testMobileVisitNoteRevisionAndWrongContextCannotWrite() async throws {
        let (model, transport, id) = try await mobileScenario()
        let binding = try XCTUnwrap(model.mobileVisitDraft)
        model.mobileVisit!.vault.open(id)
        model.mobileVisit!.vault.saveNote("Correzione locale successiva all’importazione")
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(transport.entryCreates.count, 0)
        XCTAssertEqual(try model.mobileVisit!.vault.registration(for: binding).phase, .draft)
        model.ambulatoryId = "scope-b"
        XCTAssertNil(model.mobileVisitDraft)
        XCTAssertEqual(model.newEntryEditorDocument.blocks.count, 0)
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(transport.entryCreates.count, 0)
    }

    @MainActor
    func testMobileVisitLateAckAfterScopeChangeRemainsUncertainAndCannotClearNewContext() async throws {
        let (model, transport, id) = try await mobileScenario()
        let binding = try XCTUnwrap(model.mobileVisitDraft)
        let started = transport.holdNext(method: "POST", suffix: "/entries")
        let saving = Task { await model.createEntryForSelectedPatient() }
        await fulfillment(of: [started], timeout: 3)
        model.ambulatoryId = "scope-b"
        transport.release()
        await saving.value
        XCTAssertNil(model.mobileVisitDraft)
        XCTAssertEqual(transport.entryCreates.count, 1)
        await model.mobileVisit!.vault.unlock()
        XCTAssertEqual(try model.mobileVisit!.vault.registration(for: binding).phase, .uncertain)
        XCTAssertTrue(model.mobileVisit!.vault.retainedNoteIDs.contains(id))
    }

    @MainActor
    func testMobileVisitModifiedAfterUnknownCannotAllocateAnotherIDBeforeReconciliation() async throws {
        let (model, transport, id) = try await mobileScenario()
        let original = try XCTUnwrap(model.mobileVisitDraft)
        transport.loseNextCreateAcknowledgement = true
        await model.createEntryForSelectedPatient()
        let vault = model.mobileVisit!.vault
        vault.open(id)
        vault.saveNote("Versione locale successiva, non ancora inviata")
        XCTAssertThrowsError(try vault.prepareImport(recordID: id))
        await model.mobileVisit!.reconcile(id)
        XCTAssertEqual(try vault.registration(for: original).phase, .registered)
        let next = try vault.prepareImport(recordID: id)
        XCTAssertNotEqual(next.entryID, original.entryID)
        XCTAssertGreaterThan(next.revision, original.revision)
        XCTAssertEqual(transport.entryCreates.count, 1)
    }

    @MainActor
    func testMobileVisitReceiptPersistenceFailureRetainsNoteAndBlocksAnotherSend() async throws {
        let failure = DiaryMobilePersistenceFailure()
        let (model, transport) = try harness(mobile: true, persistenceFailure: failure)
        let coordinator = try XCTUnwrap(model.mobileVisit)
        await coordinator.prepare()
        let id = try XCTUnwrap(coordinator.vault.selected?.id)
        coordinator.vault.saveNote("Conservare anche se la ricevuta non è salvabile")
        coordinator.requestOnlineReview(id)
        model.password = transport.legacyPasscode
        await coordinator.authenticateAndReview()
        await coordinator.importNote(confirmed: true)
        let binding = try XCTUnwrap(model.mobileVisitDraft)
        let started = transport.holdNext(method: "GET", suffix: "/entries/" + binding.entryID)
        let save = Task { await model.createEntryForSelectedPatient() }
        await fulfillment(of: [started], timeout: 3)
        failure.fail = true
        transport.release()
        await save.value
        XCTAssertEqual(try coordinator.vault.registration(for: binding).phase, .uncertain)
        XCTAssertFalse(model.canCreateEntry)
        XCTAssertEqual(transport.entryCreates.count, 1)
        coordinator.vault.open(id)
        XCTAssertEqual(coordinator.vault.noteText, "Conservare anche se la ricevuta non è salvabile")
        XCTAssertNil(coordinator.vault.selected, "A failed read watermark cannot authorize dossier presentation")
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(transport.entryCreates.count, 1)
    }

    @MainActor
    func testMobileVisitAuthenticationCancelledByBackgroundCannotPublishLateSession() async throws {
        let (model, transport) = try harness(mobile: true)
        let coordinator = try XCTUnwrap(model.mobileVisit)
        await coordinator.prepare()
        let id = try XCTUnwrap(coordinator.vault.selected?.id)
        coordinator.vault.saveNote("Nota conservata durante l’accesso interrotto")
        coordinator.requestOnlineReview(id)
        model.password = transport.legacyPasscode
        let started = transport.holdNext(method: "POST", suffix: "/api/auth/native/login")
        let login = Task { await coordinator.authenticateAndReview() }
        await fulfillment(of: [started], timeout: 3)
        coordinator.lock()
        transport.release()
        await login.value
        XCTAssertFalse(coordinator.vault.isUnlocked)
        XCTAssertNil(coordinator.vault.onlineReview)
        XCTAssertNil(model.operatorIdentity)
        XCTAssertEqual(model.connectionState, .sessionExpired)
        XCTAssertEqual(model.password, "")
        XCTAssertEqual(transport.entryCreates.count, 0)
        await coordinator.vault.unlock()
        coordinator.vault.open(id)
        XCTAssertEqual(coordinator.vault.noteText, "Nota conservata durante l’accesso interrotto")
    }

    @MainActor
    private func harness(mobile: Bool = false, using existing: DiarySaveTransport? = nil, persistenceFailure: DiaryMobilePersistenceFailure? = nil) throws -> (PairedPatientsWorkspaceModel, DiarySaveTransport) {
        let id = UUID().uuidString.lowercased()
        let transport = existing ?? DiarySaveTransport()
        let endpoint = transport.endpoint ?? DiarySaveURLProtocol.register(transport)
        transport.endpoint = endpoint
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.protocolClasses = [DiarySaveURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let source = HomeBasePatientsClient(configuration: .init(serverURLString: endpoint.absoluteString), session: session)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "DiarySaveTests.\(id)"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("DiarySaveTests-\(id)")
        let store = HomeBasePairedStore(userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) }, keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) })
        let cache = HomeBasePatientCacheStore(cacheDirectory: directory, keyProvider: { DiaryFixture.key })
        let mobileDirectory = transport.mobileDirectory ?? directory.appendingPathComponent("visit")
        transport.mobileDirectory = mobileDirectory
        let model = PairedPatientsWorkspaceModel(pairedStore: store, cacheStore: cache, dataSourceFactory: { _ in source },
            mobileVisitStore: mobile ? MobileVisitStore(directory: mobileDirectory, afterSave: { url in
                try MobileVisitStore.protect(url)
                if persistenceFailure?.fail == true { throw MobileVisitError.storage }
            }) : nil,
            mobileVisitUnlocker: mobile ? DiaryMobileUnlock() : nil)
        model.mobileVisitClientFactory = { source }
        if mobile { model.tlsPin = String(repeating: "a", count: 64) }
        model.serverURL = endpoint.absoluteString
        model.ambulatoryId = "scope-a"
        model.configurePairedOnlineForTests(
            credentials: .init(clientId: "diary-synthetic", clientToken: "diary-synthetic-token"),
            sessionCookie: "mediflow_session=diary-synthetic", operatorId: "operator-synthetic",
            masterKey: DiaryFixture.key, selectedPatient: DiaryFixture.patient, entries: [DiaryFixture.entry()])
        model.updateAvailableCapabilities(["network.replica.write-clinical-diary"])
        addTeardownBlock {
            transport.release()
            session.invalidateAndCancel()
            DiarySaveURLProtocol.remove(endpoint: endpoint)
            defaults.removePersistentDomain(forName: "DiarySaveTests.\(id)")
            if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
        }
        return (model, transport)
    }

    private func json(_ captured: DiaryCapturedRequest) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: captured.body) as? [String: Any])
    }

    private func decrypted(_ captured: DiaryCapturedRequest, _ field: String) throws -> String {
        let sealed = try XCTUnwrap(try json(captured)[field] as? String)
        XCTAssertTrue(sealed.hasPrefix("ENC:"))
        return try XCTUnwrap(CryptoService.jsonDecodeString(try XCTUnwrap(CryptoService.decryptField(sealed, masterKey: DiaryFixture.key))))
    }
}

private enum DiaryFixture {
    static let key = SymmetricKey(data: Data(repeating: 19, count: 32))
    static let patient = HomeBasePatientDetail(
        id: "patient-a", firstName: "Paziente", lastName: "Sintetico", birthDate: nil, taxCode: "SYNTHETIC",
        address: nil, phone: nil, caregiver: nil, exemptions: nil, diagnoses: nil, monitoringProfile: nil,
        statusReason: nil, notes: nil, aiSummary: nil, documentInsights: nil, isAdi: false, isArchived: false,
        version: 1, ambulatoryId: "scope-a", createdAt: nil, updatedAt: nil)
    static func entry(id: String = "entry-a", version: Int = 1,
                      content: String = "<p>Voce <strong>sintetica</strong> iniziale</p>",
                      title: String = "Titolo sintetico", type: String = "note", attachments: String? = nil,
                      deletedAt: Date? = nil, date: Date = Date(timeIntervalSince1970: 1), patientID: String = "patient-a") -> HomeBaseEntrySummary {
        .init(id: id, patientId: patientID, type: type, title: title,
              date: date, content: content, setting: nil, metadata: nil,
              attachments: attachments, deletedAt: deletedAt, deletionReason: nil, version: version, createdAt: nil, updatedAt: nil)
    }
}

private struct DiaryCapturedRequest {
    let request: URLRequest
    let body: Data
}

private final class DiarySaveTransport: @unchecked Sendable {
    private let lock = NSLock()
    var endpoint: URL?
    var mobileDirectory: URL?
    let legacyPasscode = String(Int.random(in: 1000...9999))
    var loseNextCreateAcknowledgement = false
    private var loginCounter = 0
    private var captured: [DiaryCapturedRequest] = []
    var requests: [DiaryCapturedRequest] { lock.withLock { captured } }
    var entryCreates: [DiaryCapturedRequest] { requests.filter { $0.request.httpMethod == "POST" && $0.request.url?.path.hasSuffix("/entries") == true } }
    var writes: [DiaryCapturedRequest] { requests.filter { ["POST", "PUT"].contains($0.request.httpMethod ?? "") } }
    private var rows = [DiaryFixture.entry()]
    var entries: [HomeBaseEntrySummary] {
        get { lock.withLock { rows } }
        set { lock.withLock { rows = newValue } }
    }
    private var writeCode: Int?
    private var readCode: Int?
    var writeStatus: Int? {
        get { lock.withLock { writeCode } }
        set { lock.withLock { writeCode = newValue } }
    }
    var readStatus: Int? {
        get { lock.withLock { readCode } }
        set { lock.withLock { readCode = newValue } }
    }
    private var gate: (String, String?, XCTestExpectation)?
    private var held: DiarySaveURLProtocol?
    func holdNext(method: String, suffix: String? = nil) -> XCTestExpectation {
        lock.withLock {
            let started = XCTestExpectation(description: "Synthetic diary transport held")
            gate = (method, suffix, started)
            return started
        }
    }
    func release() {
        let pending = lock.withLock { let value = held; held = nil; return value }
        if let pending { respond(pending) }
    }
    func start(_ request: DiarySaveURLProtocol) {
        let shouldHold = lock.withLock {
            captured.append(.init(request: request.request, body: request.body))
            if let gate, request.request.httpMethod == gate.0,
               gate.1 == nil || request.request.url?.path.hasSuffix(gate.1!) == true {
                held = request
                self.gate = nil
                gate.2.fulfill()
                return true
            }
            return false
        }
        if !shouldHold { respond(request) }
    }
    private func respond(_ request: DiarySaveURLProtocol) {
        let method = request.request.httpMethod ?? "GET"
        let isWrite = method != "GET"
        if let status = isWrite ? writeStatus : readStatus {
            let data = status == 409 ? Data(#"{"error":"Conflict","code":"VERSION_CONFLICT","entity":"entry","recordId":"entry-a","expectedVersion":1,"currentVersion":2,"currentUpdatedAt":null,"currentState":"present","currentSnapshot":{"id":"entry-a","patientId":"patient-a","version":2,"updatedAt":null,"deletedAt":null}}"#.utf8) : Data()
            request.complete(status: status, data: data)
            return
        }
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .custom { date, encoder in
                var box = encoder.singleValueContainer()
                let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                try box.encode(formatter.string(from: date))
            }
            let path = request.request.url?.path ?? ""
            let data: Data
            if path == "/api/auth/check" {
                data = Data(#"{"status":"ok","isSetup":true,"unlock":{"credential":"pin"}}"#.utf8)
            } else if path == "/api/auth/native/login" {
                loginCounter += 1
                let salt = Data(repeating: 8, count: 16)
                let wrapped = CryptoService.wrapMasterKeyVersioned(DiaryFixture.key, pin: legacyPasscode, salt: salt, version: 2)!
                data = try JSONSerialization.data(withJSONObject: ["success": true, "id": "operator-synthetic", "username": "synthetic",
                    "encryptedMasterKey": wrapped, "salt": salt.base64EncodedString()])
                request.complete(status: 200, data: data, cookie: "mediflow_session=diary-fresh-\(loginCounter); Path=/; Secure; HttpOnly")
                return
            } else if path == "/api/auth/profile" {
                data = Data(#"{"operation":"account-profile.read.v1","contractVersion":1,"userId":"operator-synthetic","username":"synthetic","displayName":null,"ambulatoryName":null,"profileVersion":"v1","archiveGeneration":"archive-a"}"#.utf8)
            } else if path.hasSuffix("/identity") {
                data = Data(#"{"identityModel":"paired","pairingBoundary":"separate","credentialState":"session-bound","loginMode":"explicit","operator":{"userId":"operator-synthetic","role":"admin","authChannel":"paired-native"},"scope":{"policy":"session-context","effectiveAmbulatoryId":"scope-a","source":"session-context"},"audit":{"actorType":"user","actorBinding":"session-user"},"limitations":[]}"#.utf8)
            } else if path.hasSuffix("/capabilities") {
                data = try JSONSerialization.data(withJSONObject: ["nodeId": "node-a", "operatingMode": "network-home-base", "protocolVersion": "1",
                    "capabilities": ["network.replica.readonly-patients", "network.replica.write-clinical-diary"].map {
                        ["key": $0, "status": "available", "requiresPairing": true, "description": "synthetic"] as [String: Any] }])
            } else if path.hasSuffix("/patients") {
                data = try encoder.encode([HomeBasePatientSummary(id: "patient-a", firstName: "Paziente", lastName: "Sintetico", birthDate: nil,
                    taxCode: "SYNTHETIC", isAdi: false, isArchived: false, version: 1, updatedAt: nil)])
            } else if !isWrite && path.contains("/entries/") {
                guard let entry = entries.first(where: { $0.id == request.request.url?.lastPathComponent }) else {
                    request.complete(status: 404, data: Data()); return
                }
                data = try encoder.encode(entry)
            } else if isWrite {
                let body = try JSONSerialization.jsonObject(with: request.body) as! [String: Any]
                let existing = entries.first ?? DiaryFixture.entry()
                let id = method == "POST" ? (body["id"] as! String) : existing.id
                entries = [DiaryFixture.entry(id: id, version: method == "POST" ? 1 : existing.version + 1,
                    content: body["content"] as? String ?? existing.content,
                    title: body["title"] as? String ?? existing.title,
                    type: body["type"] as? String ?? existing.type,
                    attachments: body["attachments"] as? String ?? existing.attachments,
                    date: Self.date(body["date"] as? String) ?? existing.date)]
                if method == "POST", loseNextCreateAcknowledgement {
                    loseNextCreateAcknowledgement = false
                    request.client?.urlProtocol(request, didFailWithError: URLError(.networkConnectionLost))
                    return
                }
                let acknowledgement: [String: Any] = method == "POST" ? ["id": id, "version": 1] : ["success": true]
                data = try JSONSerialization.data(withJSONObject: acknowledgement)
            } else if path.hasSuffix("/patients/patient-a") {
                data = try encoder.encode(DiaryFixture.patient)
            } else if path.hasSuffix("/entries") {
                data = try encoder.encode(entries)
            } else { data = Data("[]".utf8) }
            request.complete(status: 200, data: data)
        } catch { request.client?.urlProtocol(request, didFailWithError: error) }
    }

    private static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

}

private final class DiarySaveURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var transports: [Int: DiarySaveTransport] = [:]
    private static var nextPort = 47000
    private(set) var body = Data()
    static func register(_ transport: DiarySaveTransport) -> URL {
        lock.withLock {
            let port = nextPort
            nextPort += 1
            transports[port] = transport
            var endpoint = URLComponents()
            endpoint.scheme = "https"
            endpoint.host = "127.0.0.1"
            endpoint.port = port
            return endpoint.url!
        }
    }
    static func remove(endpoint: URL) { _ = lock.withLock { transports.removeValue(forKey: endpoint.port!) } }
    // Fail closed in URLProtocol even for unregistered requests; no network fallback.
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let transport = Self.lock.withLock {
            guard request.url?.scheme == "https", request.url?.host == "127.0.0.1",
                  let port = request.url?.port else { return nil as DiarySaveTransport? }
            return Self.transports[port]
        }
        guard let transport else { client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return }
        if let data = request.httpBody { body = data }
        else if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                body.append(contentsOf: buffer.prefix(count))
            }
        }
        transport.start(self)
    }
    override func stopLoading() {}
    func complete(status: Int, data: Data, cookie: String? = nil) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                      headerFields: ["Content-Type": "application/json"].merging(cookie.map { ["Set-Cookie": $0] } ?? [:]) { _, new in new })!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

@MainActor
private final class DiaryMobileUnlock: MobileVisitUnlocking {
    func unlock(createIfMissing: Bool) async throws -> SymmetricKey { DiaryFixture.key }
    func invalidate() {}
}

private final class DiaryMobilePersistenceFailure { var fail = false }
