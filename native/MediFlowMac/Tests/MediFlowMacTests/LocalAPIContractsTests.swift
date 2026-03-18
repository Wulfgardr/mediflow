// @Codex
import Foundation
import XCTest
@testable import MediFlowMac

/* @Codex */
final class LocalAPIContractsTests: XCTestCase {
    func testPatientDetailDecodesInsightContextFieldsFromApiV1() throws {
        let payload = """
        {
          "id": "patient-1",
          "firstName": "Mario",
          "lastName": "Rossi",
          "birthDate": "1970-01-01T00:00:00Z",
          "taxCode": "RSSMRA70A01H501U",
          "address": null,
          "phone": null,
          "caregiver": null,
          "exemptions": "[\\"E01\\"]",
          "diagnoses": "[{\\"code\\":\\"I10\\",\\"description\\":\\"Ipertensione essenziale\\",\\"system\\":\\"ICD-10\\"}]",
          "monitoringProfile": "Controllo PA domiciliare",
          "notes": null,
          "aiSummary": null,
          "documentInsights": null,
          "isAdi": false,
          "isArchived": false,
          "version": 4,
          "ambulatoryId": null,
          "createdAt": "2026-03-01T10:00:00Z",
          "updatedAt": "2026-03-02T10:00:00Z"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let detail = try decoder.decode(PatientDetail.self, from: payload)

        XCTAssertEqual(detail.diagnoses, "[{\"code\":\"I10\",\"description\":\"Ipertensione essenziale\",\"system\":\"ICD-10\"}]")
        XCTAssertEqual(detail.monitoringProfile, "Controllo PA domiciliare")
        XCTAssertEqual(detail.version, 4)
    }

    func testUpdatePatientPayloadEncodesTriStateNullableFields() throws {
        let payload = UpdatePatientPayload(
            version: 7,
            firstName: "Mario",
            birthDate: .null,
            address: .null,
            phone: .value("ENC:phone"),
            caregiver: .omit,
            notes: .value("ENC:notes"),
            isArchived: true
        )

        let json = try encodeJSONObject(payload)

        XCTAssertEqual(json["version"] as? Int, 7)
        XCTAssertEqual(json["firstName"] as? String, "Mario")
        XCTAssertTrue(json["birthDate"] is NSNull)
        XCTAssertTrue(json["address"] is NSNull)
        XCTAssertEqual(json["phone"] as? String, "ENC:phone")
        XCTAssertEqual(json["notes"] as? String, "ENC:notes")
        XCTAssertNil(json["caregiver"])
        XCTAssertEqual(json["isArchived"] as? Bool, true)
    }

    func testUpdatePatientPayloadEncodesBirthDateValueAndOmitsUnsetNullableFields() throws {
        let payload = UpdatePatientPayload(
            version: 3,
            birthDate: .value(Date(timeIntervalSince1970: 0)),
            address: .omit,
            phone: .omit,
            caregiver: .omit
        )

        let json = try encodeJSONObject(payload)

        XCTAssertEqual(json["version"] as? Int, 3)
        XCTAssertEqual(json["birthDate"] as? String, "1970-01-01T00:00:00Z")
        XCTAssertNil(json["address"])
        XCTAssertNil(json["phone"])
        XCTAssertNil(json["caregiver"])
    }

    func testUpdatePatientPayloadEncodesEncryptedAiSummaryPatch() throws {
        let payload = UpdatePatientPayload(
            version: 9,
            notes: .omit,
            aiSummary: .value("ENC:summary"),
            documentInsights: .omit
        )

        let json = try encodeJSONObject(payload)

        XCTAssertEqual(json["version"] as? Int, 9)
        XCTAssertEqual(json["aiSummary"] as? String, "ENC:summary")
        XCTAssertNil(json["notes"])
        XCTAssertNil(json["documentInsights"])
    }

    func testUpdateTherapyPayloadEncodesNullForClearedEndDate() throws {
        let payload = UpdateTherapyPayload(
            drugName: "Aspirina",
            aic: .omit,
            atc: .value("B01AC06"),
            dosage: "1 cp",
            status: "active",
            startDate: Date(timeIntervalSince1970: 0),
            endDate: .null
        )

        let json = try encodeJSONObject(payload)

        XCTAssertEqual(json["drugName"] as? String, "Aspirina")
        XCTAssertEqual(json["atc"] as? String, "B01AC06")
        XCTAssertEqual(json["dosage"] as? String, "1 cp")
        XCTAssertEqual(json["status"] as? String, "active")
        XCTAssertTrue(json["endDate"] is NSNull)
        XCTAssertNil(json["aic"])
    }

    func testObservationSummaryDecodesLoincUcumObservationFromApiV1() throws {
        let payload = """
        {
          "id": "obs-1",
          "patientId": "patient-1",
          "codeSystem": "LOINC",
          "code": "8480-6",
          "display": "Pressione arteriosa sistolica",
          "unitSystem": "UCUM",
          "unitCode": "mm[Hg]",
          "value": "138",
          "notes": "Controllo domiciliare",
          "observedAt": "2026-03-10T08:30:00Z",
          "source": "manual",
          "createdAt": "2026-03-10T08:31:00Z"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let observation = try decoder.decode(ObservationSummary.self, from: payload)

        XCTAssertEqual(observation.id, "obs-1")
        XCTAssertEqual(observation.codeSystem, "LOINC")
        XCTAssertEqual(observation.code, "8480-6")
        XCTAssertEqual(observation.unitSystem, "UCUM")
        XCTAssertEqual(observation.unitCode, "mm[Hg]")
        XCTAssertEqual(observation.value, "138")
        XCTAssertEqual(observation.notes, "Controllo domiciliare")
        XCTAssertEqual(observation.source, "manual")
    }

    func testCreateObservationPayloadEncodesLoincUcumFields() throws {
        let payload = CreateObservationPayload(
            codeSystem: "LOINC",
            code: "8480-6",
            display: "Pressione arteriosa sistolica",
            unitSystem: "UCUM",
            unitCode: "mm[Hg]",
            value: "138",
            notes: "Controllo domiciliare",
            observedAt: Date(timeIntervalSince1970: 0),
            source: "manual"
        )

        let json = try encodeJSONObject(payload)

        XCTAssertEqual(json["codeSystem"] as? String, "LOINC")
        XCTAssertEqual(json["code"] as? String, "8480-6")
        XCTAssertEqual(json["display"] as? String, "Pressione arteriosa sistolica")
        XCTAssertEqual(json["unitSystem"] as? String, "UCUM")
        XCTAssertEqual(json["unitCode"] as? String, "mm[Hg]")
        XCTAssertEqual(json["value"] as? String, "138")
        XCTAssertEqual(json["notes"] as? String, "Controllo domiciliare")
        XCTAssertEqual(json["observedAt"] as? String, "1970-01-01T00:00:00Z")
        XCTAssertEqual(json["source"] as? String, "manual")
    }

    func testUpdateObservationPayloadOmitsUnsetFieldsAndKeepsExplicitEdits() throws {
        let payload = UpdateObservationPayload(
            codeSystem: nil,
            code: nil,
            display: nil,
            unitSystem: nil,
            unitCode: nil,
            value: "142",
            notes: "",
            observedAt: Date(timeIntervalSince1970: 60),
            source: "manual"
        )

        let json = try encodeJSONObject(payload)

        XCTAssertNil(json["codeSystem"])
        XCTAssertNil(json["code"])
        XCTAssertNil(json["display"])
        XCTAssertNil(json["unitSystem"])
        XCTAssertNil(json["unitCode"])
        XCTAssertEqual(json["value"] as? String, "142")
        XCTAssertEqual(json["notes"] as? String, "")
        XCTAssertEqual(json["observedAt"] as? String, "1970-01-01T00:01:00Z")
        XCTAssertEqual(json["source"] as? String, "manual")
    }

    private func encodeJSONObject<T: Encodable>(_ value: T) throws -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(value)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return object
    }
}
