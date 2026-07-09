import XCTest
@testable import MediFlowCore

final class FHIRBundleGeneratorTests: XCTestCase {
    private func nativeContractsDir() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("contracts")
    }

    private func loadGoldenInput() throws -> FHIRBundleInput {
        let data = try Data(contentsOf: nativeContractsDir().appendingPathComponent("fhir-golden-input.v1.json"))
        return try JSONDecoder().decode(FHIRBundleInput.self, from: data)
    }

    private func loadGoldenBundle() throws -> FHIRJSONValue {
        let data = try Data(contentsOf: nativeContractsDir().appendingPathComponent("fhir-golden-bundle.v1.json"))
        return try JSONDecoder().decode(FHIRJSONValue.self, from: data)
    }

    func testGoldenBundleMatchesTypeScriptReference() throws {
        let input = try loadGoldenInput()
        let expected = try loadGoldenBundle()

        XCTAssertEqual(FHIRBundleGenerator.generate(input: input), expected)
    }

    func testGoldenBundleIncludesScaleObservationFromEntryMetadata() throws {
        let bundle = FHIRBundleGenerator.generate(input: try loadGoldenInput())

        guard case .object(let root) = bundle,
              case .array(let entries)? = root["entry"] else {
            XCTFail("Expected bundle entries")
            return
        }

        let scaleObservation = entries.compactMap { value -> [String: FHIRJSONValue]? in
            guard case .object(let entry) = value,
                  case .object(let resource)? = entry["resource"],
                  resource["resourceType"] == .string("Observation"),
                  resource["id"] == .string("obs-entry-scale-adl-2026-02-05") else {
                return nil
            }
            return resource
        }.first

        XCTAssertEqual(scaleObservation?["valueInteger"], .number(6))
        XCTAssertEqual(scaleObservation?["code"], .object(["text": .string("ADL (Indice di Katz)")]))
    }

    func testDTOAdapterPassesEntryMetadataIntoScaleObservation() throws {
        let date = Date(timeIntervalSince1970: 1_751_961_600)
        let patient = HomeBasePatientDetail(
            id: "patient-scale",
            firstName: "Giulia",
            lastName: "Bianchi",
            birthDate: nil,
            taxCode: "BNCGLI80A41F205X",
            address: nil,
            phone: nil,
            caregiver: nil,
            exemptions: nil,
            diagnoses: nil,
            monitoringProfile: nil,
            statusReason: nil,
            notes: nil,
            aiSummary: nil,
            documentInsights: nil,
            isAdi: false,
            isArchived: false,
            version: 1,
            ambulatoryId: nil,
            createdAt: nil,
            updatedAt: nil,
            deletedAt: nil,
            deletionReason: nil
        )
        let entry = HomeBaseEntrySummary(
            id: "entry-scale",
            patientId: "patient-scale",
            type: "scale",
            title: "Scala ADL",
            date: date,
            content: "Somministrata ADL.",
            setting: "home",
            metadata: #"{"title":"ADL (Indice di Katz)","score":6,"interpretation":"Autonomia Conservata"}"#,
            attachments: nil,
            deletedAt: nil,
            deletionReason: nil,
            version: 1,
            createdAt: nil,
            updatedAt: nil
        )

        let input = FHIRBundleDTOAdapter.input(
            patient: patient,
            entries: [entry],
            therapies: [],
            checkups: [],
            observations: [],
            generatedAt: "2026-07-08T09:00:00.000Z"
        )
        let bundle = FHIRBundleGenerator.generate(input: input)

        guard case .object(let root) = bundle,
              case .array(let entries)? = root["entry"] else {
            XCTFail("Expected bundle entries")
            return
        }
        let observationIds = entries.compactMap { value -> String? in
            guard case .object(let entry) = value,
                  case .object(let resource)? = entry["resource"],
                  resource["resourceType"] == .string("Observation"),
                  case .string(let id)? = resource["id"] else {
                return nil
            }
            return id
        }
        XCTAssertEqual(observationIds, ["obs-entry-scale"])
    }

    func testPatientWithoutExemptionsOrOptionalContactsOmitsOptionalFHIRFields() throws {
        let bundle = FHIRBundleGenerator.generate(input: FHIRBundleInput(
            generatedAt: "2026-07-08T09:00:00.000Z",
            patient: FHIRPatientInput(
                id: "patient-no-exemptions",
                firstName: "Luca",
                lastName: "Rossi",
                taxCode: "RSSLCU80A01F205X",
                birthDate: "1980-01-01T00:00:00.000Z",
                address: "",
                phone: "",
                isArchived: false,
                caregiver: nil,
                exemptions: nil,
                diagnoses: nil
            ),
            entries: [],
            therapies: [],
            checkups: [],
            observations: []
        ))

        guard case .object(let root) = bundle,
              case .array(let entries)? = root["entry"],
              case .object(let firstEntry) = entries[0],
              case .object(let patient)? = firstEntry["resource"] else {
            XCTFail("Expected patient resource")
            return
        }

        XCTAssertNil(patient["address"])
        XCTAssertNil(patient["telecom"])
        XCTAssertNil(patient["contact"])
        XCTAssertEqual(patient["active"], .bool(true))
    }

    func testEmptyObservationsDoNotAddStructuredObservationResources() throws {
        var input = try loadGoldenInput()
        input = FHIRBundleInput(
            generatedAt: input.generatedAt,
            patient: input.patient,
            entries: input.entries,
            therapies: input.therapies,
            checkups: input.checkups,
            observations: []
        )

        guard case .object(let root) = FHIRBundleGenerator.generate(input: input),
              case .array(let entries)? = root["entry"] else {
            XCTFail("Expected bundle entries")
            return
        }

        let structuredIds = entries.compactMap { value -> String? in
            guard case .object(let entry) = value,
                  case .object(let resource)? = entry["resource"],
                  case .string(let id)? = resource["id"],
                  id.hasPrefix("obs-structured-") else {
                return nil
            }
            return id
        }
        XCTAssertEqual(structuredIds, [])
    }

    func testDeletedEntriesAreSkippedButCheckupsDoNotEmitFHIRResourcesYet() throws {
        let input = FHIRBundleInput(
            generatedAt: "2026-07-08T09:00:00.000Z",
            patient: FHIRPatientInput(
                id: "patient-branches",
                firstName: "Sara",
                lastName: "Neri",
                taxCode: "NRESRA80A01F205X",
                diagnoses: []
            ),
            entries: [
                FHIRClinicalEntryInput(
                    id: "deleted-entry",
                    patientId: "patient-branches",
                    date: "2026-01-01T00:00:00.000Z",
                    type: "visit",
                    content: "Voce annullata",
                    deletedAt: "2026-01-02T00:00:00.000Z"
                )
            ],
            therapies: [],
            checkups: [
                FHIRCheckupInput(
                    id: "checkup-present-in-input",
                    patientId: "patient-branches",
                    date: "2026-01-03T00:00:00.000Z",
                    title: "Controllo presente in input",
                    status: "pending"
                )
            ],
            observations: []
        )

        guard case .object(let root) = FHIRBundleGenerator.generate(input: input),
              case .array(let entries)? = root["entry"] else {
            XCTFail("Expected bundle entries")
            return
        }

        XCTAssertEqual(entries.count, 1)
        guard case .object(let entry) = entries[0],
              case .object(let resource)? = entry["resource"] else {
            XCTFail("Expected patient resource only")
            return
        }
        XCTAssertEqual(resource["resourceType"], .string("Patient"))
    }
}
