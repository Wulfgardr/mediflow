import CryptoKit
import XCTest
@testable import MediFlowCore
@testable import MediFlowAppleShared

/* @Codex */
// S7 (Wave 5): model-level coverage for the diary entry editor -- WYSIWYG via
// the transcoder (D11), attachment references validated before seal (D4), and
// the visit-draft compute/review/insert flow (D5). Payload-reale checks per
// spec trappole: assert on the real HomeBaseEntryCreatePayload/UpdatePayload
// the client actually builds, not a hand-constructed stand-in.
final class PairedPatientsWorkspaceModelS7Tests: XCTestCase {
    private let masterKey = SymmetricKey(data: Data(repeating: 5, count: 32))

    // MARK: - D11: transcoder is the only save path, 2000-char limit is gone

    func testCreateEntrySealsTranscoderRenderNotRawEditorState() async throws {
        let patient = detail(id: "p1")
        let source = S7MockDataSource(details: ["p1": patient])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        await MainActor.run {
            model.newEntryEditorDocument.appendNewBlock(kind: .paragraph)
            let id = model.newEntryEditorDocument.blocks[0].id
            model.newEntryEditorDocument.updateText(id: id, text: "Quadro stabile")
            model.newEntryEditorDocument.toggleBold(id: id)
        }
        await model.createEntryForSelectedPatient()

        let payload = await source.lastCreateEntryPayload
        let unwrapped = try XCTUnwrap(payload)
        let decryptedContent = try XCTUnwrap(CryptoService.decryptField(unwrapped.content, masterKey: masterKey))
        let decodedContent = CryptoService.jsonDecodeString(decryptedContent)
        XCTAssertEqual(decodedContent, "<p><strong>Quadro stabile</strong></p>")
        // The saved HTML must itself be a transcoder fixed point (never raw
        // operator input bypassing ClinicalRichText.render).
        let stabilized = ClinicalRichText.render(document: ClinicalRichText.parse(html: decodedContent ?? ""))
        XCTAssertEqual(stabilized, decodedContent)
    }

    func testCreateEntryAllowsContentLongerThan2000CharsWebParity() async throws {
        let patient = detail(id: "p1")
        let source = S7MockDataSource(details: ["p1": patient])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        let longText = String(repeating: "a", count: 2500)
        await MainActor.run {
            model.newEntryEditorDocument.appendNewBlock(kind: .paragraph)
            model.newEntryEditorDocument.updateText(id: model.newEntryEditorDocument.blocks[0].id, text: longText)
        }
        let canCreate = await model.canCreateEntry
        XCTAssertTrue(canCreate, "2000-char limit must be gone (D11 web parity)")

        await model.createEntryForSelectedPatient()
        let createCount = await source.createEntryCalls
        XCTAssertEqual(createCount, 1)
        let payload = await source.lastCreateEntryPayload
        let unwrapped = try XCTUnwrap(payload)
        let decryptedContent = try XCTUnwrap(CryptoService.decryptField(unwrapped.content, masterKey: masterKey))
        let decodedContent = try XCTUnwrap(CryptoService.jsonDecodeString(decryptedContent))
        XCTAssertTrue(decodedContent.count > 2000)
    }

    func testInsertNewEntrySOAPTemplateGoesThroughTranscoder() async {
        let patient = detail(id: "p1")
        let model = await makeModel(source: S7MockDataSource(details: ["p1": patient]))
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        await MainActor.run { model.insertNewEntrySOAPTemplate() }

        let document = await model.newEntryEditorDocument
        XCTAssertEqual(document.blocks.count, 4)
        XCTAssertEqual(document.renderedHTML, ClinicalSOAPTemplate.html)
    }

    // MARK: - D4/ADR 0076 Classe B: attachment references validated before seal

    func testCreateEntrySealsValidatedAttachmentReferences() async throws {
        let patient = detail(id: "p1")
        let source = S7MockDataSource(
            details: ["p1": patient],
            attachments: [attachmentSummary(id: "a1", name: "referto.pdf", type: "application/pdf")]
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)
        await model.loadSelectedPatientAttachments()

        await MainActor.run {
            model.newEntryEditorDocument.appendNewBlock(kind: .paragraph)
            model.newEntryEditorDocument.updateText(id: model.newEntryEditorDocument.blocks[0].id, text: "Vedi referto allegato")
            model.toggleNewEntryAttachmentReference("a1")
        }
        await model.createEntryForSelectedPatient()

        let lastCreateEntryPayload = await source.lastCreateEntryPayload
        let payload = try XCTUnwrap(lastCreateEntryPayload)
        let attachmentsField = try XCTUnwrap(payload.attachments)
        let decrypted = try XCTUnwrap(CryptoService.decryptField(attachmentsField, masterKey: masterKey))
        let ids = try JSONDecoder().decode([String].self, from: Data(decrypted.utf8))
        XCTAssertEqual(ids, ["a1"])
    }

    func testCreateEntryRejectsUnownedAttachmentReferenceBeforeSealing() async throws {
        let patient = detail(id: "p1")
        // "a1" is NOT in the patient's loaded attachment list: only "a2" is.
        let source = S7MockDataSource(
            details: ["p1": patient],
            attachments: [attachmentSummary(id: "a2", name: "altro.pdf", type: "application/pdf")]
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)
        await model.loadSelectedPatientAttachments()

        await MainActor.run {
            model.newEntryEditorDocument.appendNewBlock(kind: .paragraph)
            model.newEntryEditorDocument.updateText(id: model.newEntryEditorDocument.blocks[0].id, text: "Contenuto")
            // Simulates a stale/foreign id reaching the model despite the picker
            // only listing loaded attachments (defense in depth, D4).
            model.toggleNewEntryAttachmentReference("a1")
        }
        await model.createEntryForSelectedPatient()

        let createCount = await source.createEntryCalls
        XCTAssertEqual(createCount, 0, "an unowned attachment id must block the write before it ever reaches the wire")
        let error = await model.errorMessage
        XCTAssertEqual(error, "Riferimenti allegato non appartenenti al paziente: a1")
    }

    func testChangingPatientClearsAttachmentCacheAndRejectsPreviousPatientReference() async {
        let patientA = detail(id: "p1")
        let patientB = detail(id: "p2")
        let source = S7MockDataSource(
            details: ["p1": patientA, "p2": patientB],
            attachments: [attachmentSummary(id: "a1", name: "referto-a.pdf", type: "application/pdf")]
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patientA)
        await model.loadSelectedPatientAttachments()

        await MainActor.run {
            model.toggleNewEntryAttachmentReference("a1")
            model.startEditingEntry(
                entrySummary(id: "e1", content: "<p>Voce A</p>", attachments: "[\"a1\"]", version: 1)
            )
        }

        await model.loadPatient(summary(for: patientB))

        let cachedAttachments = await model.attachments
        let cachedPatientId = await model.attachmentsPatientId
        let newSelection = await model.newEntryAttachmentIds
        let editSelection = await model.editEntryAttachmentIds
        XCTAssertTrue(cachedAttachments.isEmpty)
        XCTAssertNil(cachedPatientId)
        XCTAssertTrue(newSelection.isEmpty)
        XCTAssertTrue(editSelection.isEmpty)

        await MainActor.run {
            model.newEntryEditorDocument.appendNewBlock(kind: .paragraph)
            model.newEntryEditorDocument.updateText(
                id: model.newEntryEditorDocument.blocks[0].id,
                text: "Voce B"
            )
            model.toggleNewEntryAttachmentReference("a1")
        }
        await model.createEntryForSelectedPatient()

        let createCount = await source.createEntryCalls
        let error = await model.errorMessage
        XCTAssertEqual(createCount, 0)
        XCTAssertEqual(error, "Carica i documenti del paziente corrente prima di collegarli alla voce.")
    }

    func testSubmitScaleSealsClinicalRichTextFixedPoint() async throws {
        let patient = detail(id: "p1")
        let source = S7MockDataSource(details: ["p1": patient])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        // @Codex: retain the less-than escaping regression using a complete, valid MMSE.
        await model.submitScale(ClinicalScales.mmse, answers:
            Dictionary(uniqueKeysWithValues: ClinicalScales.mmse.questions.map { ($0.id, 0) }))

        let capturedPayload = await source.lastCreateEntryPayload
        let payload = try XCTUnwrap(capturedPayload)
        let decrypted = try XCTUnwrap(CryptoService.decryptField(payload.content, masterKey: masterKey))
        let content = try XCTUnwrap(CryptoService.jsonDecodeString(decrypted))
        let stabilized = ClinicalRichText.render(document: ClinicalRichText.parse(html: content))
        XCTAssertEqual(content, stabilized)
        XCTAssertTrue(content.contains("&lt; 10"))
        XCTAssertFalse(content.contains("(< 10)"))
    }

    // @Codex MF085-003: exercises the real paired model -> createEntry writer, not just the validator.
    func testInvalidScaleFormsNeverReachCreateEntry() async throws {
        let patient = detail(id: "p1")
        let source = S7MockDataSource(details: ["p1": patient])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)
        for definition in ClinicalScales.all {
            let complete = Dictionary(uniqueKeysWithValues: definition.questions.map { ($0.id, 0) })
            let first = try XCTUnwrap(definition.questions.first)
            var partial = complete
            partial.removeValue(forKey: first.id)
            var foreign = complete
            foreign["foreignQuestion"] = 0
            var invalid = complete
            invalid[first.id] = (first.options.map(\.value).max() ?? 0) + 1
            for answers in [[:], partial, foreign, invalid] {
                await model.submitScale(definition, answers: answers)
                let calls = await source.createEntryCalls
                let payload = await source.lastCreateEntryPayload
                let error = await model.errorMessage
                let entries = await model.entries
                XCTAssertEqual(calls, 0, definition.id)
                XCTAssertNil(payload)
                XCTAssertNotNil(error)
                XCTAssertTrue(entries.isEmpty)
            }
        }
        await model.submitScale(ClinicalScales.tinetti, answers: [:])
        let calls = await source.createEntryCalls
        XCTAssertEqual(calls, 0)
    }

    func testCompleteExplicitZeroScaleFormsWriteCanonicalEncryptedMetadata() async throws {
        for definition in ClinicalScales.all {
            let patient = detail(id: "p1")
            let source = S7MockDataSource(details: ["p1": patient])
            let model = await makeModel(source: source)
            await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)
            let answers = Dictionary(uniqueKeysWithValues: definition.questions.map { ($0.id, 0) })
            await model.submitScale(definition, answers: answers)
            let calls = await source.createEntryCalls
            let captured = await source.lastCreateEntryPayload
            let payload = try XCTUnwrap(captured)
            XCTAssertEqual(calls, 1)
            let sealed = try XCTUnwrap(payload.metadata)
            XCTAssertTrue(sealed.hasPrefix("ENC:"))
            let decrypted = try XCTUnwrap(CryptoService.decryptField(sealed, masterKey: masterKey))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(decrypted.utf8)) as? [String: Any])
            XCTAssertEqual(json["scaleId"] as? String, definition.id)
            XCTAssertEqual(json["score"] as? Int, 0)
            XCTAssertEqual(json["answers"] as? [String: Int], answers)
            if definition.id == ClinicalScales.tinettiPOMA28ID {
                let instrument = try XCTUnwrap(json["instrument"] as? [String: Any])
                XCTAssertEqual(instrument["definitionVersion"] as? String, "mediflow.poma28.v1")
                XCTAssertEqual(instrument["riskClassification"] as? String, "not-classified")
            }
        }
    }

    func testUpdateEditingEntryOmitsAttachmentsFieldWhenSelectionUntouched() async throws {
        // Regression: model.attachments can legitimately be empty this session
        // (Documenti section never opened). Re-saving an entry that ALREADY
        // references attachments must not fail revalidation for ids the
        // operator never touched.
        let patient = detail(id: "p1")
        let source = S7MockDataSource(details: ["p1": patient])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        let existingAttachmentIds = try encodedAttachmentIds(["a1", "a2"])
        let entry = entrySummary(id: "e1", content: "<p>Voce originale</p>", attachments: existingAttachmentIds, version: 3)

        await MainActor.run { model.startEditingEntry(entry) }
        let attachmentsLoaded = await model.attachments
        XCTAssertTrue(attachmentsLoaded.isEmpty, "attachments intentionally not loaded this session")

        await MainActor.run { model.editEntryTitle = "Titolo aggiornato" }
        await model.updateEditingEntry()

        let lastUpdateEntryPayload = await source.lastUpdateEntryPayload
        let payload = try XCTUnwrap(lastUpdateEntryPayload)
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any])
        XCTAssertFalse(encoded.keys.contains("attachments"), "attachments field must be omitted when the selection was never touched")
    }

    func testUpdateEditingEntryReselsAttachmentsWhenSelectionChanges() async throws {
        let patient = detail(id: "p1")
        let source = S7MockDataSource(
            details: ["p1": patient],
            attachments: [
                attachmentSummary(id: "a1", name: "uno.pdf", type: "application/pdf"),
                attachmentSummary(id: "a2", name: "due.pdf", type: "application/pdf"),
            ]
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)
        await model.loadSelectedPatientAttachments()

        let existingAttachmentIds = try encodedAttachmentIds(["a1"])
        let entry = entrySummary(id: "e1", content: "<p>Voce originale</p>", attachments: existingAttachmentIds, version: 3)
        await MainActor.run { model.startEditingEntry(entry) }
        await MainActor.run { model.toggleEditEntryAttachmentReference("a2") } // now {a1, a2}

        await model.updateEditingEntry()

        let lastUpdateEntryPayload = await source.lastUpdateEntryPayload
        let payload = try XCTUnwrap(lastUpdateEntryPayload)
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any])
        let sealedAttachments = try XCTUnwrap(encoded["attachments"] as? String)
        let decrypted = try XCTUnwrap(CryptoService.decryptField(sealedAttachments, masterKey: masterKey))
        let ids = Set(try JSONDecoder().decode([String].self, from: Data(decrypted.utf8)))
        XCTAssertEqual(ids, ["a1", "a2"])
    }

    func testReferencedAttachmentsResolvesIdsAgainstLoadedList() async {
        let patient = detail(id: "p1")
        let source = S7MockDataSource(
            details: ["p1": patient],
            attachments: [
                attachmentSummary(id: "a1", name: "referto.pdf", type: "application/pdf"),
                attachmentSummary(id: "a2", name: "esami.jpg", type: "image/jpeg"),
            ]
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)
        await model.loadSelectedPatientAttachments()

        let ids = try? encodedAttachmentIds(["a2", "unknown-id"])
        let entry = entrySummary(id: "e1", content: "<p>Voce</p>", attachments: ids ?? "[]", version: 1)

        let resolved = await model.referencedAttachments(for: entry)
        XCTAssertEqual(resolved.map(\.id), ["a2"], "an id that does not resolve must be omitted, not shown raw")
    }

    // MARK: - D5/ADR 0076 Classe E: visit draft, mandatory review gate

    func testInsertVisitDraftIsBlockedWithoutReview() async {
        let patient = detail(id: "p1")
        let draft = visitDraftResponse(subjective: ["Tosse persistente"])
        let source = S7MockDataSource(details: ["p1": patient], visitDraft: draft)
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        await MainActor.run { model.newEntryVisitTranscript = "Il paziente riferisce tosse persistente da tre giorni." }
        await model.computeVisitDraftForNewEntry()

        let reviewedBeforeInsert = await model.newEntryVisitDraftReviewed
        XCTAssertFalse(reviewedBeforeInsert, "a fresh draft must never be pre-reviewed")
        let canInsertBefore = await model.canInsertVisitDraftIntoNewEntry
        XCTAssertFalse(canInsertBefore)

        await MainActor.run { model.insertVisitDraftIntoNewEntry() }
        let blockCount = await model.newEntryEditorDocument.blocks.count
        XCTAssertEqual(blockCount, 0, "insertion without the review checkbox must be a no-op, like the web")
    }

    func testInsertVisitDraftAppendsSectionParagraphsAfterReview() async {
        let patient = detail(id: "p1")
        let draft = visitDraftResponse(subjective: ["Tosse persistente"], plan: ["Controllo tra 7 giorni"])
        let source = S7MockDataSource(details: ["p1": patient], visitDraft: draft)
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        await MainActor.run { model.newEntryVisitTranscript = "Trascrizione della visita di controllo." }
        await model.computeVisitDraftForNewEntry()
        await MainActor.run { model.newEntryVisitDraftReviewed = true }
        let canInsert = await model.canInsertVisitDraftIntoNewEntry
        XCTAssertTrue(canInsert)

        await MainActor.run { model.insertVisitDraftIntoNewEntry() }

        let document = await model.newEntryEditorDocument
        XCTAssertEqual(document.blocks.count, 2)
        XCTAssertEqual(document.renderedHTML, "<p>S: Tosse persistente</p><p>P: Controllo tra 7 giorni</p>")
        let reviewedAfterInsert = await model.newEntryVisitDraftReviewed
        XCTAssertFalse(reviewedAfterInsert, "inserting consumes the draft; a later recompute must require a fresh review")
        let draftAfterInsert = await model.newEntryVisitDraftResponse
        XCTAssertNil(draftAfterInsert)
    }

    func testRecomputingVisitDraftResetsReviewFlag() async {
        let patient = detail(id: "p1")
        let draft = visitDraftResponse(subjective: ["Prima bozza"])
        let source = S7MockDataSource(details: ["p1": patient], visitDraft: draft)
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        await MainActor.run { model.newEntryVisitTranscript = "Prima trascrizione." }
        await model.computeVisitDraftForNewEntry()
        await MainActor.run { model.newEntryVisitDraftReviewed = true }

        await MainActor.run { model.newEntryVisitTranscript = "Seconda trascrizione, diversa dalla prima." }
        await model.computeVisitDraftForNewEntry()

        let reviewed = await model.newEntryVisitDraftReviewed
        XCTAssertFalse(reviewed, "a stale review must never authorize a different draft's insertion")
    }

    func testTranscriptMutationInvalidatesDraftReviewAndInsertionGate() async {
        let patient = detail(id: "p1")
        let draft = visitDraftResponse(subjective: ["Bozza della versione A"])
        let source = S7MockDataSource(details: ["p1": patient], visitDraft: draft)
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        await MainActor.run { model.newEntryVisitTranscript = "Trascrizione sintetica A." }
        await model.computeVisitDraftForNewEntry()
        await MainActor.run { model.newEntryVisitDraftReviewed = true }
        let canInsertBeforeMutation = await model.canInsertVisitDraftIntoNewEntry
        XCTAssertTrue(canInsertBeforeMutation)

        await MainActor.run { model.newEntryVisitTranscript = "Trascrizione sintetica B." }

        let responseAfterMutation = await model.newEntryVisitDraftResponse
        let reviewedAfterMutation = await model.newEntryVisitDraftReviewed
        let canInsertAfterMutation = await model.canInsertVisitDraftIntoNewEntry
        XCTAssertNil(responseAfterMutation)
        XCTAssertFalse(reviewedAfterMutation)
        XCTAssertFalse(canInsertAfterMutation)
    }

    func testInFlightVisitDraftDoesNotPublishAfterTranscriptChangesAwayAndBack() async {
        let patient = detail(id: "p1")
        let draft = visitDraftResponse(subjective: ["Bozza tardiva della versione A"])
        let source = S7MockDataSource(
            details: ["p1": patient],
            visitDraft: draft,
            visitDraftDelayNanoseconds: 50_000_000
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)
        let originalTranscript = "Trascrizione sintetica A."
        await MainActor.run { model.newEntryVisitTranscript = originalTranscript }

        let computation = Task { await model.computeVisitDraftForNewEntry() }
        for _ in 0..<100 {
            if await source.computeVisitDraftCalls > 0 { break }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        let startedCalls = await source.computeVisitDraftCalls
        XCTAssertEqual(startedCalls, 1)

        await MainActor.run {
            model.newEntryVisitTranscript = "Trascrizione sintetica B."
            model.newEntryVisitTranscript = originalTranscript
        }
        await computation.value

        let transcriptAfterCompletion = await model.newEntryVisitTranscript
        let responseAfterCompletion = await model.newEntryVisitDraftResponse
        let reviewedAfterCompletion = await model.newEntryVisitDraftReviewed
        let canInsertAfterCompletion = await model.canInsertVisitDraftIntoNewEntry
        XCTAssertEqual(transcriptAfterCompletion, originalTranscript)
        XCTAssertNil(responseAfterCompletion)
        XCTAssertFalse(reviewedAfterCompletion)
        XCTAssertFalse(canInsertAfterCompletion)
    }

    func testVisitDraftRejectsUTF8OversizeBelowCharacterLimit() async {
        let patient = detail(id: "p1")
        let source = S7MockDataSource(
            details: ["p1": patient],
            visitDraft: visitDraftResponse(subjective: ["Non deve essere richiesta"])
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)
        let oversizedSingleGrapheme = "a" + String(repeating: "\u{0301}", count: 140_000)
        let maxCharacters = await PairedPatientsWorkspaceModel.maxVisitDraftTranscriptChars
        XCTAssertLessThanOrEqual(oversizedSingleGrapheme.count, maxCharacters)
        XCTAssertGreaterThan(oversizedSingleGrapheme.utf8.count, VisitRecordingLimits.standard.maxTranscriptUTF8Bytes)

        await MainActor.run { model.newEntryVisitTranscript = oversizedSingleGrapheme }
        let canCompute = await model.canComputeVisitDraft
        XCTAssertFalse(canCompute)
        await model.computeVisitDraftForNewEntry()

        let computeCalls = await source.computeVisitDraftCalls
        let response = await model.newEntryVisitDraftResponse
        XCTAssertEqual(computeCalls, 0)
        XCTAssertNil(response)
    }

    func testVisitDraftNeverPersistsAnythingByItself() async {
        let patient = detail(id: "p1")
        let draft = visitDraftResponse(subjective: ["Riga"])
        let source = S7MockDataSource(details: ["p1": patient], visitDraft: draft)
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        await MainActor.run { model.newEntryVisitTranscript = "Trascrizione qualsiasi." }
        await model.computeVisitDraftForNewEntry()
        await MainActor.run { model.newEntryVisitDraftReviewed = true }
        await MainActor.run { model.insertVisitDraftIntoNewEntry() }

        let createEntryCalls = await source.createEntryCalls
        let updateEntryCalls = await source.updateEntryCalls
        XCTAssertEqual(createEntryCalls, 0)
        XCTAssertEqual(updateEntryCalls, 0)
    }

    func testChangingPatientClearsReviewedVisitDraftAndComposer() async {
        let firstPatient = detail(id: "p1")
        let secondPatient = detail(id: "p2")
        let draft = visitDraftResponse(subjective: ["Contenuto del primo paziente"])
        let source = S7MockDataSource(details: ["p1": firstPatient, "p2": secondPatient], visitDraft: draft)
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: firstPatient)

        await MainActor.run { model.newEntryVisitTranscript = "Trascrizione del primo paziente." }
        await model.computeVisitDraftForNewEntry()
        await MainActor.run {
            model.newEntryVisitDraftReviewed = true
            model.insertVisitDraftIntoNewEntry()
        }
        let firstPatientBlockCount = await model.newEntryEditorDocument.blocks.count
        XCTAssertGreaterThan(firstPatientBlockCount, 0)

        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: secondPatient)

        let secondPatientBlockCount = await model.newEntryEditorDocument.blocks.count
        let transcript = await model.newEntryVisitTranscript
        let response = await model.newEntryVisitDraftResponse
        let reviewed = await model.newEntryVisitDraftReviewed
        let canInsert = await model.canInsertVisitDraftIntoNewEntry
        XCTAssertEqual(secondPatientBlockCount, 0)
        XCTAssertEqual(transcript, "")
        XCTAssertNil(response)
        XCTAssertFalse(reviewed)
        XCTAssertFalse(canInsert)
    }

    func testInFlightVisitDraftDoesNotPublishAfterPatientChanges() async {
        let firstPatient = detail(id: "p1")
        let secondPatient = detail(id: "p2")
        let draft = visitDraftResponse(subjective: ["Bozza tardiva"])
        let source = S7MockDataSource(
            details: ["p1": firstPatient, "p2": secondPatient],
            visitDraft: draft,
            visitDraftDelayNanoseconds: 50_000_000
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: firstPatient)
        await MainActor.run { model.newEntryVisitTranscript = "Trascrizione in elaborazione." }

        let computation = Task { await model.computeVisitDraftForNewEntry() }
        for _ in 0..<100 {
            if await source.computeVisitDraftCalls > 0 { break }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        let startedCalls = await source.computeVisitDraftCalls
        XCTAssertEqual(startedCalls, 1)

        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: secondPatient)
        await computation.value

        let response = await model.newEntryVisitDraftResponse
        let reviewed = await model.newEntryVisitDraftReviewed
        let blockCount = await model.newEntryEditorDocument.blocks.count
        XCTAssertNil(response)
        XCTAssertFalse(reviewed)
        XCTAssertEqual(blockCount, 0)
    }

    // MARK: - Helpers

    @MainActor
    private func makeModel(source: S7MockDataSource) -> PairedPatientsWorkspaceModel {
        let suiteName = "PairedPatientsWorkspaceModelS7Tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let pairedStore = HomeBasePairedStore(
            userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) }
        )
        let cacheDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PairedPatientsWorkspaceModelS7Tests-\(UUID().uuidString)", isDirectory: true)
        let cacheStore = HomeBasePatientCacheStore(
            cacheDirectory: cacheDirectory,
            keyProvider: { SymmetricKey(data: Data(repeating: 9, count: 32)) }
        )
        return PairedPatientsWorkspaceModel(
            pairedStore: pairedStore,
            cacheStore: cacheStore,
            dataSourceFactory: { _ in source }
        )
    }

    private func sealedField(_ value: String) -> String {
        guard let json = CryptoService.jsonEncode(value), let sealed = CryptoService.encryptField(json, masterKey: masterKey) else {
            fatalError("fixture sealing must not fail")
        }
        return sealed
    }

    private func encodedAttachmentIds(_ ids: [String]) throws -> String {
        String(decoding: try JSONEncoder().encode(ids), as: UTF8.self)
    }

    private func detail(id: String) -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: id, firstName: "Mario", lastName: "Rossi", birthDate: nil, taxCode: "RSSMRA80A01H501U",
            address: nil, phone: nil, caregiver: nil, exemptions: nil, diagnoses: nil, monitoringProfile: nil,
            statusReason: nil, notes: nil, aiSummary: nil, documentInsights: nil, isAdi: false, isArchived: false,
            version: 1, ambulatoryId: "AMB-1", createdAt: nil, updatedAt: Date(timeIntervalSince1970: 1_750_000_000),
            deletedAt: nil, deletionReason: nil
        )
    }

    private func summary(for detail: HomeBasePatientDetail) -> HomeBasePatientSummary {
        HomeBasePatientSummary(
            id: detail.id, firstName: detail.firstName, lastName: detail.lastName,
            birthDate: detail.birthDate, taxCode: detail.taxCode, isAdi: detail.isAdi,
            isArchived: detail.isArchived, version: detail.version, updatedAt: detail.updatedAt,
            deletedAt: detail.deletedAt, deletionReason: detail.deletionReason,
            diagnoses: detail.diagnoses
        )
    }

    private func entrySummary(id: String, content: String, attachments: String?, version: Int) -> HomeBaseEntrySummary {
        HomeBaseEntrySummary(
            id: id, patientId: "p1", type: "note", title: sealedField("Titolo"),
            date: Date(timeIntervalSince1970: 1_750_000_000), content: content, setting: nil, metadata: nil,
            attachments: attachments, deletedAt: nil, deletionReason: nil, version: version, createdAt: nil, updatedAt: nil
        )
    }

    private func attachmentSummary(id: String, name: String, type: String) -> HomeBaseAttachmentSummary {
        HomeBaseAttachmentSummary(
            id: id, patientId: "p1", name: sealedField(name), type: type, size: 1024, path: sealedField("uploads/\(id)"),
            summarySnapshot: nil, parseEvidenceArtifactSnapshot: nil, ocrQueueState: nil, ocrQueueReason: nil,
            ocrQueueUpdatedAt: nil, ocrReplayArtifactSnapshot: nil, createdAt: Date(timeIntervalSince1970: 1_750_000_000)
        )
    }

    private func visitDraftResponse(
        subjective: [String] = [], objective: [String] = [], assessment: [String] = [], plan: [String] = []
    ) -> HomeBaseVisitDraftResponse {
        HomeBaseVisitDraftResponse(
            schemaVersion: "test",
            draftText: "",
            sections: .init(subjective: subjective, objective: objective, assessment: assessment, plan: plan),
            medications: [],
            session: .init(state: "idle", eventCount: 0, pauseCount: 0, resumeCount: 0, recordedMs: 0, pausedMs: 0, warnings: []),
            safety: .init(reviewRequired: true, forbiddenAutoWriteCount: 0, rawAudioPersisted: false, writesPerformed: [])
        )
    }
}

actor S7MockDataSource: HomeBasePatientsDataSource {
    private let details: [String: HomeBasePatientDetail]
    private let attachments: [HomeBaseAttachmentSummary]
    private let visitDraft: HomeBaseVisitDraftResponse?
    private let visitDraftDelayNanoseconds: UInt64
    private(set) var lastCreateEntryPayload: HomeBaseEntryCreatePayload?
    private(set) var lastUpdateEntryPayload: HomeBaseEntryUpdatePayload?
    private(set) var createEntryCalls = 0
    private(set) var updateEntryCalls = 0
    private(set) var computeVisitDraftCalls = 0

    init(
        details: [String: HomeBasePatientDetail],
        attachments: [HomeBaseAttachmentSummary] = [],
        visitDraft: HomeBaseVisitDraftResponse? = nil,
        visitDraftDelayNanoseconds: UInt64 = 0
    ) {
        self.details = details
        self.attachments = attachments
        self.visitDraft = visitDraft
        self.visitDraftDelayNanoseconds = visitDraftDelayNanoseconds
    }

    func login(username: String?, password: String, credentials: HomeBasePairedCredentials) async throws -> HomeBaseLoginResult {
        HomeBaseLoginResult(sessionCookie: "sid=test", encryptedMasterKey: nil, salt: nil)
    }

    func changePin(currentPin: String, newPin: String, encryptedMasterKey: String, salt: String, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func logout(credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func updateProfile(userId: String, displayName: String, ambulatoryName: String, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func createAmbulatory(payload: HomeBaseAmbulatoryCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true, id: payload.id ?? "amb", version: 1)
    }

    func updateAmbulatory(id: String, payload: HomeBaseAmbulatoryUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true, version: payload.expectedVersion + 1)
    }

    func deleteAmbulatory(id: String, expectedVersion: Int, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true)
    }

    func clearAmbulatory(id: String, expectedVersion: Int, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true, version: expectedVersion + 1)
    }

    func fetchPatients(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, includeDeleted: Bool) async throws -> [HomeBasePatientSummary] {
        details.values.map {
            HomeBasePatientSummary(
                id: $0.id, firstName: $0.firstName, lastName: $0.lastName, birthDate: $0.birthDate, taxCode: $0.taxCode,
                isAdi: $0.isAdi, isArchived: $0.isArchived, version: $0.version, updatedAt: $0.updatedAt,
                deletedAt: $0.deletedAt, deletionReason: $0.deletionReason, diagnoses: $0.diagnoses
            )
        }
    }

    func fetchPatients(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, includeDiagnoses: Bool) async throws -> [HomeBasePatientSummary] {
        try await fetchPatients(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId, includeDeleted: false)
    }

    func fetchNetworkAmbulatories(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [NetworkAmbulatorySummary] {
        []
    }

    func searchDrugs(query: String, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseDrugSummary] {
        []
    }

    func searchExemptions(query: String, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseExemptionSummary] {
        []
    }

    func searchTerminology(system: String, query: String, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseTerminologyItem] {
        []
    }

    func resolveTerminology(system: String, code: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseTerminologyItem {
        throw HomeBaseClientError.httpStatus(404, "Not found")
    }

    func fetchTerminologySystems(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseTerminologyRegistryEntry] {
        []
    }

    func fetchPatient(id: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBasePatientDetail {
        guard let detail = details[id] else { throw HomeBaseClientError.httpStatus(404, "Not found") }
        return detail
    }

    func updatePatient(patientId: String, payload: HomeBasePatientUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func createPatient(payload: HomeBasePatientCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "created", version: 1)
    }

    func softDeletePatient(id: String, version: Int, sealedReason: String?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: id, version: version + 1)
    }

    func restorePatient(id: String, version: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: id, version: version + 1)
    }

    func fetchEntries(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int) async throws -> [HomeBaseEntrySummary] {
        []
    }

    func createEntry(patientId: String, payload: HomeBaseEntryCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        createEntryCalls += 1
        lastCreateEntryPayload = payload
        return HomeBaseCreatedResource(id: payload.id, version: 1)
    }

    func updateEntry(patientId: String, entryId: String, payload: HomeBaseEntryUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        updateEntryCalls += 1
        lastUpdateEntryPayload = payload
        return HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchAttachments(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseAttachmentSummary] {
        attachments
    }

    func fetchAttachment(patientId: String, attachmentId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseAttachmentDetail {
        throw HomeBaseClientError.httpStatus(404, "Not found")
    }

    func createAttachment(patientId: String, payload: HomeBaseAttachmentCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "attachment", version: nil)
    }

    func computeVisitDraft(input: HomeBaseVisitDraftInput, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseVisitDraftResponse {
        computeVisitDraftCalls += 1
        if visitDraftDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: visitDraftDelayNanoseconds)
        }
        guard let visitDraft else { throw HomeBaseClientError.contract }
        return visitDraft
    }

    func fetchAiRuntimeStatus(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseNetworkAiRuntimeSummary {
        throw HomeBaseClientError.contract
    }

    func fetchTherapies(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int) async throws -> [HomeBaseTherapySummary] {
        []
    }

    func createTherapy(patientId: String, payload: HomeBaseTherapyCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "therapy", version: 1)
    }

    func updateTherapy(patientId: String, therapyId: String, payload: HomeBaseTherapyUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchCheckups(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int) async throws -> [HomeBaseCheckupSummary] {
        []
    }

    func fetchScopedCheckups(dateFrom: Date?, dateTo: Date?, status: [String], limit: Int?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseCheckupSummary] { [] }
    func fetchScopedEntries(type: String?, dateFrom: Date?, dateTo: Date?, limit: Int?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseEntrySummary] { [] }

    func createCheckup(patientId: String, payload: HomeBaseCheckupCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "checkup", version: 1)
    }

    func updateCheckup(patientId: String, checkupId: String, payload: HomeBaseCheckupUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchObservations(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int) async throws -> [HomeBaseObservationSummary] {
        []
    }

    func createObservation(patientId: String, payload: HomeBaseObservationCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "observation", version: 1)
    }

    func updateObservation(patientId: String, observationId: String, payload: HomeBaseObservationUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchServicePrescriptions(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseServicePrescriptionSummary] {
        []
    }

    func createServicePrescription(payload: HomeBaseServicePrescriptionCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "service", version: 1)
    }

    func updateServicePrescription(prescriptionId: String, payload: HomeBaseServicePrescriptionUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchServicePrescriptionItems(patientId: String?, prescriptionId: String?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseServicePrescriptionItemSummary] {
        []
    }

    func createServicePrescriptionItem(payload: HomeBaseServicePrescriptionItemCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "service-item", version: 1)
    }

    func updateServicePrescriptionItem(itemId: String, payload: HomeBaseServicePrescriptionItemUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchServiceCatalog(query: String?, code: String?, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseServiceCatalogEntrySummary] {
        []
    }

    func fetchServiceCatalogCount(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCatalogCountResponse {
        HomeBaseCatalogCountResponse(count: 0)
    }

    func fetchProstheticPrescriptions(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseProstheticPrescriptionSummary] {
        []
    }

    func createProstheticPrescription(payload: HomeBaseProstheticPrescriptionCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "prosthetic", version: 1)
    }

    func updateProstheticPrescription(prescriptionId: String, payload: HomeBaseProstheticPrescriptionUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchNetworkCapabilities(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> NetworkCapabilitiesResponse {
        NetworkCapabilitiesResponse(nodeId: "node", operatingMode: "network-home-base", protocolVersion: "1", capabilities: [])
    }

    func fetchNetworkIdentity(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> NetworkIdentitySummary {
        throw HomeBaseClientError.contract
    }

    func fetchNetworkNode(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> NetworkNodeSummary {
        NetworkNodeSummary(
            nodeId: "node", displayName: "Mac", role: "home-base-candidate", operatingMode: "network-home-base",
            protocolVersion: "1", transport: NetworkNodeSummary.Transport(apiBasePath: "/api/v1", tlsRequired: true, localTlsPort: 3443)
        )
    }

    func fetchNetworkRevision(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> NetworkRevisionSummary {
        NetworkRevisionSummary(revision: "1", sourceFingerprint: "src", fingerprint: "stable")
    }

    func fetchFseValidatePatient(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseValidatePatientExportResponse {
        HomeBaseValidatePatientExportResponse(
            patientId: patientId, hasErrors: false, hasWarnings: false,
            therapyMedication: HomeBaseFseValidationSummary(total: 0, ok: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, items: []),
            observationVitals: HomeBaseFseValidationSummary(total: 0, ok: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, items: [])
        )
    }

    func validateFseDocument(payload: HomeBaseFseDocumentValidationPayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseFseDocumentValidationResponse {
        HomeBaseFseDocumentValidationResponse(ok: true, profile: payload.profile, errors: [], warnings: [])
    }
}
