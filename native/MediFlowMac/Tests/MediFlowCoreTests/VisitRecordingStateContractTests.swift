/* @Codex */
import XCTest
@testable import MediFlowCore

final class VisitRecordingStateContractTests: XCTestCase {
    func testConsentAndReadinessAdvanceThroughExpectedStates() throws {
        var session = VisitRecordingSession(binding: .init(patientRef: "synthetic-patient", revision: 7))
        XCTAssertEqual(session.phase, .unavailable)
        let steps: [(VisitRecordingEvent, VisitRecordingPhase)] = [
            (.presentDisclosure, .disclosure), (.acceptDisclosure, .permissionRequired),
            (.permissionGranted, .preparingAssets), (.assetsReady, .ready),
            (.start, .recording), (.stop, .finalizing),
        ]
        for (event, phase) in steps {
            try session.apply(event)
            XCTAssertEqual(session.phase, phase)
        }
    }
    func testPermissionDenialIsTerminal() throws {
        var session = VisitRecordingSession(binding: .init(patientRef: "synthetic-patient", revision: 7))
        try session.apply(.presentDisclosure)
        try session.apply(.acceptDisclosure)
        try session.apply(.permissionDenied)
        XCTAssertEqual(session.phase, .denied(.permissionDenied))
        XCTAssertThrowsError(try session.apply(.permissionGranted)) { error in
            XCTAssertEqual(error as? VisitRecordingContractError, .invalidTransition)
        }
    }
    func testNonFinalTranscriptCannotEnterReview() throws {
        var session = try makeFinalizingSession()
        XCTAssertThrowsError(
            try session.apply(.publishTranscript(
                text: "Colloquio sintetico.", isFinal: false, currentBinding: session.binding
            ))
        ) { error in
            XCTAssertEqual(error as? VisitRecordingContractError, .nonFinalTranscript)
        }
        XCTAssertEqual(session.phase, .finalizing)
        XCTAssertNil(session.transcript)
    }
    func testStalePatientBindingDeniesFinalTranscript() throws {
        var session = try makeFinalizingSession()
        let stale = VisitRecordingBinding(patientRef: "synthetic-patient", revision: 8)
        try session.apply(.publishTranscript(
            text: "Colloquio sintetico.", isFinal: true, currentBinding: stale
        ))
        XCTAssertEqual(session.phase, .denied(.staleBinding))
        XCTAssertNil(session.transcript)
    }
    func testDefaultLimitsAdmitExactCapsAndDenyOverflow() {
        let limits = VisitRecordingLimits.standard
        XCTAssertNil(limits.denial(for: usage(4, 8 * 1_024 * 1_024, 90 * 60, 256 * 1_024)))
        XCTAssertEqual(limits.denial(for: usage(4.001)), .bufferExceeded)
        XCTAssertEqual(limits.denial(for: usage(1, 8 * 1_024 * 1_024 + 1)), .bufferExceeded)
        XCTAssertEqual(limits.denial(for: usage(1, 1, 90 * 60 + 0.001)), .sessionDurationExceeded)
        XCTAssertEqual(limits.denial(for: usage(1, 1, 1, 256 * 1_024 + 1)), .transcriptExceeded)
        XCTAssertEqual(limits.denial(for: usage(.nan)), .invalidUsage)
        XCTAssertEqual(limits.denial(for: usage(-1, -1, -1, -1)), .invalidUsage)
    }
    func testTranscriptEditInvalidatesDraftAndReview() throws {
        var session = try makeFinalizingSession()
        try session.apply(.publishTranscript(
            text: "Prima versione sintetica.", isFinal: true, currentBinding: session.binding
        ))
        XCTAssertEqual(session.transcriptDigest, "0c6c86fc8d01ab1504af5b75053fc8b6b0527bbfd85ad512ca266527400effcf")
        try session.apply(.deriveDraft)
        try session.apply(.reviewDraft)
        XCTAssertTrue(session.hasCurrentDraft)
        XCTAssertTrue(session.isCurrentDraftReviewed)
        XCTAssertEqual(session.draftTranscriptDigest, session.transcriptDigest)
        try session.apply(.editTranscript("Versione sintetica corretta."))
        XCTAssertEqual(session.phase, .transcriptReview)
        XCTAssertEqual(session.transcript, "Versione sintetica corretta.")
        XCTAssertFalse(session.hasCurrentDraft)
        XCTAssertFalse(session.isCurrentDraftReviewed)
        XCTAssertNil(session.draftTranscriptDigest)
    }
    func testCleanupIsIdempotentAndClearsClinicalText() throws {
        var session = try makeFinalizingSession()
        try session.apply(.publishTranscript(
            text: "Testo sintetico effimero.", isFinal: true, currentBinding: session.binding
        ))
        for denial in VisitRecordingDenial.allCases {
            var copy = session
            copy.cleanup(as: denial)
            let cleaned = copy
            copy.cleanup(as: denial)
            XCTAssertEqual(copy, cleaned)
            XCTAssertEqual(copy.phase, .denied(denial))
            XCTAssertNil(copy.transcript)
            XCTAssertFalse(copy.hasCurrentDraft)
            XCTAssertFalse(copy.isCurrentDraftReviewed)
            XCTAssertThrowsError(try copy.apply(.presentDisclosure)) { error in
                XCTAssertEqual(error as? VisitRecordingContractError, .invalidTransition)
            }
        }
    }
    func testCleanupPreservesFirstTerminalDenial() throws {
        var session = try makeFinalizingSession()
        try session.apply(.publishTranscript(
            text: "Testo sintetico effimero.", isFinal: true, currentBinding: session.binding
        ))
        session.cleanup(as: .interrupted)
        session.cleanup(as: .failed)
        XCTAssertEqual(session.phase, .denied(.interrupted))
        XCTAssertNil(session.transcript)
    }
    func testReviewedCurrentDraftCompletesAndBecomesTerminal() throws {
        var session = try makeFinalizingSession()
        try session.apply(.publishTranscript(
            text: "Versione sintetica finale.", isFinal: true, currentBinding: session.binding
        ))
        try session.apply(.deriveDraft)
        XCTAssertThrowsError(try session.apply(.complete(currentBinding: session.binding))) { error in
            XCTAssertEqual(error as? VisitRecordingContractError, .reviewRequired)
        }
        try session.apply(.reviewDraft)
        try session.apply(.complete(currentBinding: session.binding))
        XCTAssertEqual(session.phase, .completed)
        XCTAssertThrowsError(try session.apply(.editTranscript("Troppo tardi.")))
    }
    func testCompletionClearsEphemeralReviewContent() throws {
        var session = try makeFinalizingSession()
        try session.apply(.publishTranscript(
            text: "Versione sintetica finale.", isFinal: true, currentBinding: session.binding
        ))
        try session.apply(.deriveDraft)
        try session.apply(.reviewDraft)
        try session.apply(.complete(currentBinding: session.binding))
        XCTAssertEqual(session.phase, .completed)
        XCTAssertNil(session.transcript)
        XCTAssertNil(session.transcriptDigest)
        XCTAssertNil(session.draftTranscriptDigest)
        XCTAssertFalse(session.isCurrentDraftReviewed)
        session.cleanup(as: .failed)
        XCTAssertEqual(session.phase, .completed)
    }

    private func makeFinalizingSession() throws -> VisitRecordingSession {
        var session = VisitRecordingSession(binding: .init(patientRef: "synthetic-patient", revision: 7))
        for event in [
            VisitRecordingEvent.presentDisclosure, .acceptDisclosure, .permissionGranted,
            .assetsReady, .start, .stop,
        ] {
            try session.apply(event)
        }
        return session
    }

    private func usage(_ bufferedSeconds: Double = 1, _ bufferedBytes: Int = 1,
                       _ elapsedSeconds: Double = 1, _ transcriptBytes: Int = 1) -> VisitRecordingUsage {
        .init(bufferedAudioSeconds: bufferedSeconds, bufferedAudioBytes: bufferedBytes,
              elapsedSeconds: elapsedSeconds, transcriptUTF8Bytes: transcriptBytes)
    }
}
