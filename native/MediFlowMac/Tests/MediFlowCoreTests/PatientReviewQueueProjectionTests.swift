// @Codex
import XCTest
@testable import MediFlowCore

final class PatientReviewQueueProjectionTests: XCTestCase {
    func testAbsentItemsProduceNoSurfaceAndNoUnreadZero() {
        for state: PatientReviewDocumentReadState in [.idle, .loading, .loaded] {
            let summary = project(state: state)
            XCTAssertTrue(summary.rows.isEmpty)
            XCTAssertNil(summary.coverageNote)
        }
    }

    func testEvidenceMatchesWebNonGreenRuleIncludingMissingQuality() {
        let summary = project(insights: [insight("green"), insight("yellow"), insight("red"), insight(nil)])
        XCTAssertEqual(summary.rows.map(\.id), [.evidence])
        XCTAssertEqual(summary.rows[0].count, 3)
        XCTAssertFalse(summary.rows[0].isLowerBound)
        XCTAssertEqual(summary.rows[0].detail, "3 referti da verificare · 1 con qualità critica")
    }

    func testGreenEvidenceDoesNotImplyAnOpenReviewOrAIReadiness() {
        XCTAssertTrue(project(insights: [insight("green")]).rows.isEmpty)
        XCTAssertTrue(project(insights: DocumentInsightsCodec.decode("ENC:unavailable")).rows.isEmpty)
        XCTAssertTrue(project(insights: DocumentInsightsCodec.decode("legacy non-JSON text")).rows.isEmpty)
    }

    func testFollowupCountRemainsBoundedAfterExistingCheckupFiltering() {
        let summary = project(followups: [followup("one"), followup("two")], followupsAtLimit: true)
        XCTAssertEqual(summary.rows.map(\.id), [.followups])
        XCTAssertEqual(summary.rows[0].count, 2)
        XCTAssertTrue(summary.rows[0].isLowerBound)
        XCTAssertEqual(summary.rows[0].detail, "2+ spunti dai documenti, da valutare")
        XCTAssertTrue(summary.coverageNote?.contains("elenco parziale") == true)
        // The caller already hides suggestions represented by existing checkups.
        XCTAssertTrue(project(followups: [], followupsAtLimit: true).rows.isEmpty)
    }

    func testUncappedFollowupIsOnlyASuggestionNotAScheduledOrRequiredAction() {
        let summary = project(followups: [followup("one")])
        XCTAssertEqual(summary.rows[0].detail, "1 spunto dai documenti, da valutare")
        XCTAssertFalse(summary.rows[0].isLowerBound)
        XCTAssertNil(summary.coverageNote)
    }

    func testUnreadOrLoadingArchiveCannotReuseEarlierRowsOrReportZero() {
        for state: PatientReviewDocumentReadState in [.idle, .loading] {
            let summary = project(insights: [insight("yellow")], state: state, attachments: [attachment(.ocrFailed)])
            XCTAssertEqual(summary.rows.map(\.id), [.evidence])
            XCTAssertNotNil(summary.coverageNote)
            XCTAssertTrue(project(state: state, attachments: [attachment(.ocrFailed)]).rows.isEmpty)
        }
    }

    func testFailedAndUnavailableReadsKeepAnActionWithoutInventingCounts() {
        for state: PatientReviewDocumentReadState in [.failed, .unavailable] {
            let summary = project(state: state, attachments: [attachment(.manualReview)])
            XCTAssertEqual(summary.rows.map(\.id), [.documents])
            XCTAssertNil(summary.rows[0].count)
            XCTAssertTrue(summary.rows[0].detail.contains("Apri Documenti"))
        }
    }

    func testOnlyExplicitArchiveReviewStatesCount() {
        let summary = project(attachments: [
            attachment(.pending), attachment(.processing), attachment(.ocrDone),
            attachment(nil), attachment(.ocrFailed), attachment(.manualReview),
        ])
        XCTAssertEqual(summary.rows.map(\.id), [.documents])
        XCTAssertEqual(summary.rows[0].count, 2)
        // Every synthetic attachment has nil snapshots. Their absence alone is
        // not evidence of missing extracted text or an OCR failure.
        XCTAssertTrue(project(attachments: [attachment(nil), attachment(.ocrDone)]).rows.isEmpty)
    }

    func testLoadedArchiveMustBelongToTheDisplayedPatient() {
        XCTAssertTrue(project(documentsPatientID: "patient-other", attachments: [attachment(.ocrFailed)]).rows.isEmpty)
        XCTAssertTrue(project(documentsPatientID: nil, attachments: [attachment(.ocrFailed)]).rows.isEmpty)
        XCTAssertTrue(project(attachments: [attachment(.manualReview, patientID: "patient-other")]).rows.isEmpty)
    }

    func testCategoriesStayDistinctAndDoNotSumOverlappingItems() {
        let summary = project(insights: [insight("red")], followups: [followup("one")], attachments: [attachment(.manualReview)])
        XCTAssertEqual(summary.rows.map(\.id), [.evidence, .followups, .documents])
        XCTAssertEqual(summary.rows.map(\.count), [1, 1, 1])
        // The same source can supply all three signals; there is deliberately
        // no misleading global "three documents to review" count.
        XCTAssertNil(summary.coverageNote)
    }

    private func project(
        insights: [ClinicalDocumentInsight] = [], followups: [FollowupSuggestion] = [],
        followupsAtLimit: Bool = false, state: PatientReviewDocumentReadState = .loaded,
        documentsPatientID: String? = "patient-synthetic", attachments: [HomeBaseAttachmentSummary] = []
    ) -> PatientReviewQueueSummary {
        PatientReviewQueueProjection.project(
            patientID: "patient-synthetic", insights: insights, followups: followups,
            followupsAtLimit: followupsAtLimit, documentReadState: state,
            documentsPatientID: documentsPatientID, attachments: attachments
        )
    }

    private func insight(_ quality: String?) -> ClinicalDocumentInsight {
        ClinicalDocumentInsight(
            id: "insight-\(quality ?? "unknown")", fileName: "synthetic.pdf", date: "2026-09-06", summary: "",
            qualityLevel: quality, qualityReason: nil, extractedDiagnoses: [], extractedMedications: [],
            appliedDiagnoses: [], routedClassification: nil, documentDate: nil, evidencePack: nil
        )
    }

    private func followup(_ id: String) -> FollowupSuggestion {
        FollowupSuggestion(
            id: id, label: "Spunto sintetico", excerpt: "Da valutare", status: "planned",
            temporality: "planned", origin: "documented",
            citation: FollowupSuggestionCitation(sourceId: id, documentInsightId: "insight", fileName: "synthetic.pdf", documentDate: nil, snippet: "")
        )
    }

    private func attachment(_ state: HomeBaseDocumentOcrQueueState?, patientID: String = "patient-synthetic") -> HomeBaseAttachmentSummary {
        HomeBaseAttachmentSummary(
            id: "attachment-\(state?.rawValue ?? "unknown")", patientId: patientID, name: "synthetic.pdf", type: "application/pdf",
            size: 1, path: "", summarySnapshot: nil, parseEvidenceArtifactSnapshot: nil,
            ocrQueueState: state, ocrQueueReason: nil, ocrQueueUpdatedAt: nil, ocrReplayArtifactSnapshot: nil, createdAt: nil
        )
    }
}
