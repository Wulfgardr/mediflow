// @Codex
import Foundation
import XCTest
@testable import MediFlowMac

/* @Codex */
final class LocalAPIContractsTests: XCTestCase {
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

    private func encodeJSONObject<T: Encodable>(_ value: T) throws -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(value)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return object
    }
}
