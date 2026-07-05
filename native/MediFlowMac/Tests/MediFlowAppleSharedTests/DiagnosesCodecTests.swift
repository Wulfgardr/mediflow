import XCTest
@testable import MediFlowAppleShared

final class DiagnosesCodecTests: XCTestCase {
    func testDecodesCanonicalObjectArray() {
        let raw = """
        [{"code":"E11.9","description":"Diabete tipo 2","system":"ICD-10","date":"2026-01-01T00:00:00.000Z"},\
        {"code":"I10","description":"Ipertensione","system":"ICD-10","date":"2026-02-01T00:00:00.000Z"}]
        """
        let result = DiagnosesCodec.decode(raw)
        XCTAssertEqual(result.count, 2)
        XCTAssertEqual(result[0].code, "E11.9")
        XCTAssertEqual(result[0].description, "Diabete tipo 2")
        XCTAssertEqual(result[0].system, "ICD-10")
        XCTAssertEqual(result[1].code, "I10")
    }

    func testNilEmptyAndWhitespaceDecodeToEmpty() {
        XCTAssertTrue(DiagnosesCodec.decode(nil).isEmpty)
        XCTAssertTrue(DiagnosesCodec.decode("").isEmpty)
        XCTAssertTrue(DiagnosesCodec.decode("   ").isEmpty)
        XCTAssertTrue(DiagnosesCodec.decode("[]").isEmpty)
    }

    func testMalformedJsonDecodesToEmpty() {
        XCTAssertTrue(DiagnosesCodec.decode("not json").isEmpty)
        XCTAssertTrue(DiagnosesCodec.decode("{\"code\":\"x\"}").isEmpty, "an object (not array) is not valid here")
    }

    func testEntryWithOnlyDescriptionIsKept() {
        let result = DiagnosesCodec.decode("[{\"description\":\"Diagnosi libera\"}]")
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].code, "")
        XCTAssertEqual(result[0].description, "Diagnosi libera")
        XCTAssertNil(result[0].system)
    }

    func testEntryWithNoCodeOrDescriptionIsDropped() {
        let result = DiagnosesCodec.decode("[{\"system\":\"ICD-10\",\"date\":\"2026-01-01T00:00:00.000Z\"}]")
        XCTAssertTrue(result.isEmpty)
    }

    func testDisplayTextFormats() {
        XCTAssertEqual(ClinicalDiagnosis(code: "E11.9", description: "Diabete", system: nil).displayText, "E11.9 - Diabete")
        XCTAssertEqual(ClinicalDiagnosis(code: "E11.9", description: "", system: nil).displayText, "E11.9")
        XCTAssertEqual(ClinicalDiagnosis(code: "", description: "Diabete", system: nil).displayText, "Diabete")
    }

    func testRoundTripPreservesAllFields() {
        let raw = """
        [{"code":"E11.9","description":"Diabete tipo 2","system":"ICD-10","date":"2026-01-01T00:00:00.000Z"},\
        {"code":"I10","description":"Ipertensione","system":"ICD-9","date":"2026-02-01T00:00:00.000Z"}]
        """
        let decoded = DiagnosesCodec.decode(raw)
        // A decode -> encode -> decode cycle must not change anything, even though
        // the operator did no edit. The original dates and systems survive.
        let reencoded = DiagnosesCodec.encode(decoded, defaultDate: "2099-12-31T00:00:00.000Z")
        let again = DiagnosesCodec.decode(reencoded)
        XCTAssertEqual(again, decoded)
        XCTAssertEqual(again[0].date, "2026-01-01T00:00:00.000Z", "an existing date must not be rewritten")
        XCTAssertEqual(again[1].system, "ICD-9")
    }

    func testEncodeStampsDefaultDateOnNewDiagnosisOnly() {
        let diagnoses = [
            ClinicalDiagnosis(code: "E11.9", description: "Esistente", system: "ICD-10", date: "2020-01-01T00:00:00.000Z"),
            ClinicalDiagnosis(code: "J45", description: "Nuova", system: "ICD-10", date: nil),
        ]
        let encoded = DiagnosesCodec.encode(diagnoses, defaultDate: "2026-06-29T00:00:00.000Z")
        let decoded = DiagnosesCodec.decode(encoded)
        XCTAssertEqual(decoded[0].date, "2020-01-01T00:00:00.000Z")
        XCTAssertEqual(decoded[1].date, "2026-06-29T00:00:00.000Z", "a new diagnosis is stamped with the default date")
    }

    func testEncodeEmptyOrBlankYieldsNilToClearTheField() {
        XCTAssertNil(DiagnosesCodec.encode([], defaultDate: "x"))
        XCTAssertNil(DiagnosesCodec.encode([ClinicalDiagnosis(code: "", description: "", system: nil)], defaultDate: "x"))
    }
}
