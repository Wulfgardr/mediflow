import CryptoKit
import XCTest
@testable import MediFlowAppleShared

// S6 (Wave 5): pure-logic coverage for the documents domain helpers that do not
// need the full workspace model (decode, follow-up projection dedup, data URL
// codec, wire-size precheck, OCR queue Italian labels).
final class DocumentInsightsCodecTests: XCTestCase {
    func testDecodesEvidencePackFactsAndExtractedData() {
        let raw = """
        [{
            "id": "insight-1",
            "attachmentId": "att-1",
            "fileName": "referto.pdf",
            "date": "2026-05-01T00:00:00.000Z",
            "documentDate": "2026-05-01T00:00:00.000Z",
            "summary": "Sintesi del referto.",
            "quality": { "level": "green", "reason": "testo completo" },
            "extractedData": {
                "medications": ["metformina"],
                "diagnoses": [{ "code": "E11.9", "description": "Diabete tipo 2", "system": "ICD-10" }]
            },
            "autofill": { "appliedDiagnoses": ["E11.9"] },
            "routedClass": { "classification": "lab_report" },
            "evidencePack": {
                "schemaVersion": "mediflow.document_evidence_pack.v2",
                "source": { "documentInsightId": "insight-1", "fileName": "referto.pdf", "documentDate": "2026-05-01T00:00:00.000Z" },
                "facts": [
                    { "id": "f1", "kind": "followup", "label": "Controllo glicemia", "excerpt": "tra 3 mesi", "sourceId": "s1", "temporality": "planned", "status": "planned", "origin": "documented" },
                    { "id": "f2", "kind": "problem", "label": "Diabete tipo 2", "excerpt": "diagnosi nota", "sourceId": "s2", "temporality": "current", "status": "active", "origin": "documented" }
                ]
            }
        }]
        """
        let insights = DocumentInsightsCodec.decode(raw)
        XCTAssertEqual(insights.count, 1)
        let insight = insights[0]
        XCTAssertEqual(insight.id, "insight-1")
        XCTAssertEqual(insight.fileName, "referto.pdf")
        XCTAssertEqual(insight.qualityLevel, "green")
        XCTAssertEqual(insight.qualityReason, "testo completo")
        XCTAssertEqual(insight.extractedMedications, ["metformina"])
        XCTAssertEqual(insight.extractedDiagnoses.first?.code, "E11.9")
        XCTAssertEqual(insight.appliedDiagnoses, ["E11.9"])
        XCTAssertEqual(insight.routedClassification, "lab_report")
        XCTAssertEqual(insight.evidencePack?.facts.count, 2)
        XCTAssertEqual(insight.evidencePack?.facts.first?.kind, "followup")
    }

    func testNilEmptyAndMalformedJSONDecodeToEmpty() {
        XCTAssertTrue(DocumentInsightsCodec.decode(nil).isEmpty)
        XCTAssertTrue(DocumentInsightsCodec.decode("").isEmpty)
        XCTAssertTrue(DocumentInsightsCodec.decode("not json").isEmpty)
        XCTAssertTrue(DocumentInsightsCodec.decode("{}").isEmpty)
    }

    func testEntriesMissingIdOrFileNameAreSkipped() {
        let raw = """
        [
            { "fileName": "no-id.pdf", "date": "2026-05-01T00:00:00.000Z", "summary": "x" },
            { "id": "insight-2", "date": "2026-05-01T00:00:00.000Z", "summary": "x" },
            { "id": "insight-3", "fileName": "ok.pdf", "date": "2026-05-01T00:00:00.000Z", "summary": "x" }
        ]
        """
        let insights = DocumentInsightsCodec.decode(raw)
        XCTAssertEqual(insights.map(\.id), ["insight-3"])
    }

    func testFollowupProjectionOrdersMostRecentFirstDedupsAndCaps() {
        func insight(id: String, date: String, labels: [(String, String, String)]) -> ClinicalDocumentInsight {
            let facts = labels.enumerated().map { index, entry in
                ClinicalDocumentEvidenceFact(
                    id: "\(id)-f\(index)", kind: "followup", label: entry.0, excerpt: entry.1,
                    sourceId: "\(id)-s\(index)", temporality: entry.2, status: entry.2, origin: "documented"
                )
            }
            let pack = ClinicalDocumentEvidencePack(documentInsightId: id, fileName: "\(id).pdf", documentDate: date, facts: facts)
            return ClinicalDocumentInsight(
                id: id, fileName: "\(id).pdf", date: date, summary: "", qualityLevel: nil, qualityReason: nil,
                extractedDiagnoses: [], extractedMedications: [], appliedDiagnoses: [], routedClassification: nil,
                documentDate: date, evidencePack: pack
            )
        }

        let older = insight(id: "old", date: "2026-01-01T00:00:00.000Z", labels: [
            ("Controllo A", "vecchio", "planned"),
            ("Controllo Resolved", "escluso", "resolved"),
        ])
        let newer = insight(id: "new", date: "2026-03-01T00:00:00.000Z", labels: [
            ("controllo a", "duplicato case-insensitive", "planned"),
            ("Controllo B", "nuovo", "planned"),
            ("Controllo C", "altro", "planned"),
        ])

        let suggestions = PatientFollowupProjection.project([older, newer])
        // Most recent document processed first, so its "controllo a" claims the
        // normalized key; the older insight's "Controllo A" is therefore a
        // duplicate and dropped entirely (not just reordered). Resolved facts
        // are excluded regardless of recency.
        XCTAssertEqual(suggestions.map(\.label), ["controllo a", "Controllo B", "Controllo C"])
        XCTAssertEqual(suggestions.first?.citation.fileName, "new.pdf")

        let capped = PatientFollowupProjection.project([older, newer], max: 2)
        XCTAssertEqual(capped.map(\.label), ["controllo a", "Controllo B"])
    }

    func testAttachmentDataURLRoundTrip() {
        let bytes = Data("hello world".utf8)
        let dataURL = HomeBaseAttachmentDataURL.encode(mimeType: "text/plain", bytes: bytes)
        XCTAssertTrue(dataURL.hasPrefix("data:text/plain;base64,"))

        let decoded = HomeBaseAttachmentDataURL.decode(dataURL)
        XCTAssertEqual(decoded?.mimeType, "text/plain")
        XCTAssertEqual(decoded?.bytes, bytes)

        XCTAssertNil(HomeBaseAttachmentDataURL.decode("not-a-data-url"))
        XCTAssertNil(HomeBaseAttachmentDataURL.decode("data:text/plain,not-base64-marker"))
    }

    func testAttachmentWirePrecheckAllowsSmallFileAndBlocksOversizedFileWithHonestMessage() {
        let small = HomeBaseAttachmentWirePrecheck.check(rawByteCount: 1024)
        XCTAssertFalse(small.exceedsLimit)
        XCTAssertNil(small.message)

        // 20 MB * 1.4 = 28 MB > the 25 MB default wire limit.
        let oversized = HomeBaseAttachmentWirePrecheck.check(rawByteCount: 20 * 1024 * 1024)
        XCTAssertTrue(oversized.exceedsLimit)
        XCTAssertNotNil(oversized.message)
        XCTAssertFalse(oversized.message?.contains("\u{2014}") ?? true, "message must not use an em dash")

        // The boundary includes the complete JSON body allowance, not only data.
        let boundary = HomeBaseAttachmentWirePrecheck.maxRecommendedRawBytes()
        let boundaryResult = HomeBaseAttachmentWirePrecheck.check(rawByteCount: boundary)
        XCTAssertFalse(boundaryResult.exceedsLimit)
        XCTAssertLessThanOrEqual(
            boundaryResult.estimatedWireBytes,
            HomeBaseAttachmentWirePrecheck.defaultWireLimitBytes
        )
        XCTAssertGreaterThan(
            HomeBaseAttachmentWirePrecheck.check(rawByteCount: boundary + 4).estimatedWireBytes,
            HomeBaseAttachmentWirePrecheck.defaultWireLimitBytes
        )
    }

    func testAttachmentWirePrecheckRecommendedMaximumProducesBodyUnderHostLimit() throws {
        let rawByteCount = HomeBaseAttachmentWirePrecheck.maxRecommendedRawBytes()
        let rawData = Data(repeating: 0xff, count: rawByteCount)
        let dataURL = HomeBaseAttachmentDataURL.encode(mimeType: "application/pdf", bytes: rawData)
        let key = SymmetricKey(data: Data(repeating: 7, count: 32))
        let payload = try ClinicalFieldCrypto.sealAttachmentCreatePayload(
            name: "referto.pdf",
            path: "uploads/referto.pdf",
            data: dataURL,
            type: "application/pdf",
            size: rawByteCount,
            masterKey: key
        )

        let result = try HomeBaseAttachmentWirePrecheck.check(
            payload: payload,
            rawByteCount: rawByteCount
        )

        XCTAssertFalse(result.exceedsLimit)
        XCTAssertLessThanOrEqual(
            result.estimatedWireBytes,
            HomeBaseAttachmentWirePrecheck.defaultWireLimitBytes
        )
    }

    func testDocumentOcrQueuePresentationMatchesExistingItalianLabels() {
        XCTAssertEqual(
            HomeBaseDocumentOcrQueuePresentation.describe(state: .pending, reason: .pairedUpload),
            "in attesa \u{00B7} caricato da client di rete"
        )
        XCTAssertEqual(HomeBaseDocumentOcrQueuePresentation.describe(state: .ocrDone, reason: nil), "OCR completato")
        XCTAssertNil(HomeBaseDocumentOcrQueuePresentation.describe(state: nil, reason: nil))
    }
}
