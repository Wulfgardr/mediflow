import XCTest
@testable import MediFlowCore

/* @Codex */
final class ServicePrescriptionParsingTests: XCTestCase {
    func testParseMultilineItemsUsesWebCodeNameShape() {
        let drafts = ServicePrescriptionParsing.parseItemDrafts(
            """
            90.44.1 Emocromo completo
            RX-TORACE Radiografia torace
            Visita cardiologica
            """,
            fallbackName: "Fallback"
        )

        XCTAssertEqual(
            drafts,
            [
                ServicePrescriptionItemDraft(serviceName: "Emocromo completo", serviceCode: "90.44.1"),
                ServicePrescriptionItemDraft(serviceName: "Radiografia torace", serviceCode: "RX-TORACE"),
                ServicePrescriptionItemDraft(serviceName: "Visita cardiologica", serviceCode: nil),
            ]
        )
    }

    func testParseItemsFallsBackToParentNameWhenBodyIsEmpty() {
        XCTAssertEqual(
            ServicePrescriptionParsing.parseItemDrafts("", fallbackName: "Ecografia addome"),
            [ServicePrescriptionItemDraft(serviceName: "Ecografia addome", serviceCode: nil)]
        )
    }

    func testCountersUseItemsForOpenAndReportCounts() {
        let now = Date(timeIntervalSince1970: 1_750_000_000)
        let prescriptions = [
            service(id: "p2", date: now.addingTimeInterval(-60), status: "booked"),
            service(id: "p1", date: now, status: "report_received"),
        ]
        let items = [
            item(id: "i1", prescriptionId: "p1", ordinal: 2, status: "report_received"),
            item(id: "i2", prescriptionId: "p1", ordinal: 1, status: "prescribed"),
            item(id: "i3", prescriptionId: "p2", ordinal: 1, status: "cancelled"),
        ]

        XCTAssertEqual(ServicePrescriptionFiltering.sorted(prescriptions).map(\.id), ["p1", "p2"])
        XCTAssertEqual(ServicePrescriptionFiltering.sortedItems(items).map(\.id), ["i2", "i3", "i1"])
        XCTAssertEqual(
            ServicePrescriptionFiltering.counters(prescriptions: prescriptions, items: items),
            ServicePrescriptionCounters(total: 2, items: 3, open: 1, reports: 1)
        )
    }

    func testProstheticCountersCountTestedRows() {
        let now = Date(timeIntervalSince1970: 1_750_000_000)
        let rows = [
            prosthetic(id: "a", date: now, status: "tested"),
            prosthetic(id: "b", date: now.addingTimeInterval(60), status: "prescribed"),
        ]

        XCTAssertEqual(ProstheticPrescriptionFiltering.sorted(rows).map(\.id), ["b", "a"])
        XCTAssertEqual(ProstheticPrescriptionFiltering.counters(rows), ProstheticPrescriptionCounters(total: 2, tests: 1))
    }

    private func service(id: String, date: Date, status: String) -> HomeBaseServicePrescriptionSummary {
        HomeBaseServicePrescriptionSummary(
            id: id,
            patientId: "patient-1",
            prescribedAt: date,
            status: status,
            category: "specialistica",
            priority: nil,
            codeSystem: nil,
            serviceCode: nil,
            serviceName: "Prestazione",
            clinicalQuestion: nil,
            provider: nil,
            scheduledAt: nil,
            performedAt: nil,
            reportReceivedAt: nil,
            outcomeNote: nil,
            requestReference: nil,
            source: "manual",
            documentRefs: nil,
            notes: nil,
            version: 1,
            createdAt: nil,
            updatedAt: nil
        )
    }

    private func item(
        id: String,
        prescriptionId: String,
        ordinal: Int,
        status: String
    ) -> HomeBaseServicePrescriptionItemSummary {
        HomeBaseServicePrescriptionItemSummary(
            id: id,
            patientId: "patient-1",
            prescriptionId: prescriptionId,
            ordinal: ordinal,
            status: status,
            category: nil,
            codeSystem: nil,
            serviceCode: nil,
            serviceName: "Voce",
            catalogEntryId: nil,
            catalogDisplayName: nil,
            matchStatus: "manual",
            confidence: nil,
            evidence: nil,
            notes: nil,
            scheduledAt: nil,
            performedAt: nil,
            reportReceivedAt: nil,
            outcomeNote: nil,
            version: 1,
            createdAt: nil,
            updatedAt: nil
        )
    }

    private func prosthetic(id: String, date: Date, status: String) -> HomeBaseProstheticPrescriptionSummary {
        HomeBaseProstheticPrescriptionSummary(
            id: id,
            patientId: "patient-1",
            prescribedAt: date,
            status: status,
            category: "ausilio",
            isoCode: nil,
            description: "Ausilio",
            measures: nil,
            clinicalReason: nil,
            regionalPrescriptionId: nil,
            supplier: nil,
            collaudoAt: nil,
            collaudoOutcome: nil,
            source: "manual",
            documentRefs: nil,
            notes: nil,
            version: 1,
            createdAt: nil,
            updatedAt: nil
        )
    }
}
