// @Codex - Regression tests for lifecycle and care-setting export fidelity.
import XCTest
@testable import MediFlowCore

final class FHIRBundleDTOAdapterLifecycleTests: XCTestCase {
    private func patient(archived: Bool?) -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: "review-patient", firstName: "Persona", lastName: "Sintetica",
            birthDate: nil, taxCode: "SYNTHETIC-REVIEW", address: nil, phone: nil,
            caregiver: nil, exemptions: nil, diagnoses: nil, monitoringProfile: nil,
            statusReason: nil, notes: nil, aiSummary: nil, documentInsights: nil,
            isAdi: false, isArchived: archived, version: 1, ambulatoryId: nil,
            createdAt: nil, updatedAt: nil, deletedAt: nil, deletionReason: nil
        )
    }

    private func entry(setting: String?, deleted: Bool = false, id: String = "review-entry", type: String = "visit") -> HomeBaseEntrySummary {
        HomeBaseEntrySummary(
            id: id, patientId: "review-patient", type: type,
            title: "Visita sintetica", date: Date(timeIntervalSince1970: 1_788_480_000),
            content: "Dato sintetico di revisione", setting: setting, metadata: nil,
            attachments: nil, deletedAt: deleted ? Date(timeIntervalSince1970: 1_788_480_001) : nil,
            deletionReason: nil, version: 1, createdAt: nil, updatedAt: nil
        )
    }

    private func input(archived: Bool?, setting: String?, deleted: Bool = false) -> FHIRBundleInput {
        FHIRBundleDTOAdapter.input(
            patient: patient(archived: archived), entries: [entry(setting: setting, deleted: deleted)],
            therapies: [], checkups: [], observations: [], generatedAt: "2026-09-04T12:00:00.000Z"
        )
    }

    private func resource(_ type: String, in input: FHIRBundleInput) throws -> [String: FHIRJSONValue] {
        guard case .object(let bundle) = FHIRBundleGenerator.generate(input: input),
              case .array(let entries)? = bundle["entry"] else {
            throw NSError(domain: "FHIRReview", code: 1)
        }
        return try XCTUnwrap(entries.compactMap { value -> [String: FHIRJSONValue]? in
            guard case .object(let entry) = value, case .object(let resource)? = entry["resource"],
                  resource["resourceType"] == .string(type) else { return nil }
            return resource
        }.first)
    }

    func testArchivedPatientRemainsInactiveInBundle() throws {
        let value = input(archived: true, setting: "home")
        XCTAssertEqual(value.patient.isArchived, true)
        XCTAssertEqual(try resource("Patient", in: value)["active"], .bool(false))
    }

    func testActivePatientRemainsActiveInBundle() throws {
        let value = input(archived: false, setting: "ambulatory")
        XCTAssertEqual(value.patient.isArchived, false)
        XCTAssertEqual(try resource("Patient", in: value)["active"], .bool(true))
    }

    func testHomeEncounterPreservesHomeClass() throws {
        let value = input(archived: false, setting: "home")
        XCTAssertEqual(value.entries.first?.setting, "home")
        guard case .object(let encounterClass)? = try resource("Encounter", in: value)["class"] else {
            return XCTFail("Missing encounter class")
        }
        XCTAssertEqual(encounterClass["code"], .string("HH"))
    }

    func testAmbulatoryEncounterPreservesAmbulatoryClass() throws {
        let value = input(archived: false, setting: "ambulatory")
        XCTAssertEqual(value.entries.first?.setting, "ambulatory")
        guard case .object(let encounterClass)? = try resource("Encounter", in: value)["class"] else {
            return XCTFail("Missing encounter class")
        }
        XCTAssertEqual(encounterClass["code"], .string("AMB"))
    }

    func testDeletedEncounterStillExcluded() {
        XCTAssertTrue(input(archived: false, setting: "home", deleted: true).entries.isEmpty)
    }

    // @Codex Missing values keep the v1 compatibility behavior. This does not
    // authorize the missing-setting fallback for the future v2 contract.
    func testAbsentArchiveFlagIsNotInventedByAdapter() throws {
        let value = input(archived: nil, setting: "ambulatory")
        XCTAssertNil(value.patient.isArchived)
        XCTAssertEqual(try resource("Patient", in: value)["active"], .bool(true))
    }

    func testAbsentSettingIsNotInventedByAdapter() {
        XCTAssertNil(input(archived: false, setting: nil).entries.first?.setting)
    }

    func testHospitalSettingIsForwardedWithoutReinterpretation() {
        // Only projection fidelity is tested: v1 does NOT yet implement IMP.
        XCTAssertEqual(input(archived: false, setting: "hospital").entries.first?.setting, "hospital")
    }

    func testMixedActiveAndDeletedEntriesSerializeOnlyActiveEncounter() throws {
        let value = FHIRBundleDTOAdapter.input(
            patient: patient(archived: true),
            entries: [
                entry(setting: "home", deleted: true, id: "deleted-home"),
                entry(setting: "ambulatory", id: "active-ambulatory"),
                entry(setting: "home", deleted: true, id: "deleted-scale", type: "scale"),
            ],
            therapies: [], checkups: [], observations: [], generatedAt: "2026-09-04T12:00:00.000Z"
        )
        XCTAssertEqual(value.entries.map(\.id), ["active-ambulatory"])
        let bytes = try FHIRBundleDTOAdapter.encodedBundleData(input: value)
        let bundle = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        let entries = try XCTUnwrap(bundle["entry"] as? [[String: Any]])
        let resources = try entries.map { try XCTUnwrap($0["resource"] as? [String: Any]) }
        XCTAssertEqual(resources.compactMap { $0["id"] as? String }, ["review-patient", "active-ambulatory"])
        XCTAssertEqual(resources.first?["active"] as? Bool, false)
        XCTAssertFalse(resources.contains { $0["resourceType"] as? String == "Observation" })
    }

    func testArchivedHomeExportPreservesSemanticsThroughProductionSerializer() throws {
        let value = input(archived: true, setting: "home")
        let data = try FHIRBundleDTOAdapter.encodedBundleData(input: value)
        let decoded = try JSONDecoder().decode(FHIRJSONValue.self, from: data)
        XCTAssertEqual(decoded, FHIRBundleGenerator.generate(input: value))
        let bundle = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let entries = try XCTUnwrap(bundle["entry"] as? [[String: Any]])
        let resources = try entries.map { try XCTUnwrap($0["resource"] as? [String: Any]) }
        let patientResource = try XCTUnwrap(resources.first { $0["resourceType"] as? String == "Patient" })
        let encounter = try XCTUnwrap(resources.first { $0["resourceType"] as? String == "Encounter" })
        XCTAssertEqual(patientResource["active"] as? Bool, false)
        XCTAssertEqual((encounter["class"] as? [String: Any])?["code"] as? String, "HH")
    }

    func testMapperStillGuardsDeletedEntryWhenAdapterIsBypassed() throws {
        let value = FHIRBundleInput(
            generatedAt: "2026-09-04T12:00:00.000Z",
            patient: FHIRPatientInput(
                id: "review-patient", firstName: "Persona", lastName: "Sintetica", taxCode: "SYNTHETIC-REVIEW"
            ),
            entries: [FHIRClinicalEntryInput(
                id: "deleted-direct", patientId: "review-patient", date: "2026-09-03T10:00:00.000Z",
                type: "visit", content: "Sintetico", deletedAt: "2026-09-04T10:00:00.000Z", setting: "home"
            )],
            therapies: [], checkups: [], observations: []
        )
        guard case .object(let bundle) = FHIRBundleGenerator.generate(input: value),
              case .array(let entries)? = bundle["entry"] else {
            return XCTFail("Missing bundle entries")
        }
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(try resource("Patient", in: value)["id"], .string("review-patient"))
    }
}
