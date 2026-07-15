import XCTest
@testable import MediFlowAppleShared

// G1 (ADR 0071 parity): the patient-list row now derives an age from the summary
// birthDate. Lock the boundary logic of the age helper.
final class PatientSummaryPresentationTests: XCTestCase {
    func testAgeIsNilWhenBirthDateAbsent() {
        XCTAssertNil(PairedPatientsWorkspaceView.age(from: nil))
    }

    func testAgeFromBirthDateFortyYearsAgo() {
        let birth = Calendar.current.date(byAdding: .year, value: -40, to: Date())
        XCTAssertEqual(PairedPatientsWorkspaceView.age(from: birth), 40)
    }

    func testAgeFromBirthDateToday() {
        XCTAssertEqual(PairedPatientsWorkspaceView.age(from: Date()), 0)
    }

    func testAgeIsNilForFutureBirthDate() {
        let future = Calendar.current.date(byAdding: .year, value: 3, to: Date())
        XCTAssertNil(PairedPatientsWorkspaceView.age(from: future))
    }

    func testAgeIsNilForImplausiblyOldBirthDate() {
        let ancient = Calendar.current.date(byAdding: .year, value: -200, to: Date())
        XCTAssertNil(PairedPatientsWorkspaceView.age(from: ancient))
    }

    /* @Codex */
    func testCompactTaxCodeKeepsOnlyLastSixCharacters() {
        XCTAssertEqual(PairedPatientsWorkspaceSupport.compactTaxCode("RSSMRA80A01H501U"), "…1H501U")
    }

    /* @Codex */
    func testCompactTaxCodeDoesNotExpandShortValues() {
        XCTAssertEqual(PairedPatientsWorkspaceSupport.compactTaxCode("ABC123"), "ABC123")
    }

    /* @Codex */
    func testBirthYearTextIsVerbatimWithoutGroupingSeparator() {
        var components = DateComponents()
        components.calendar = Calendar(identifier: .gregorian)
        components.timeZone = TimeZone(secondsFromGMT: 0)
        components.year = 1980
        components.month = 1
        components.day = 1

        let birthDate = try! XCTUnwrap(components.date)
        let birthYear = PairedPatientsWorkspaceSupport.birthYearText(from: birthDate)

        XCTAssertEqual(birthYear, "1980")
        XCTAssertNotEqual(birthYear, "1.980")
    }

    // G3 (observations sparkline): only scalar numeric values feed the chart.
    func testParseObservationValueAcceptsNumbersAndComma() {
        XCTAssertEqual(PairedPatientsWorkspaceView.parseObservationValue("120"), 120)
        XCTAssertEqual(PairedPatientsWorkspaceView.parseObservationValue(" 98.6 "), 98.6)
        XCTAssertEqual(PairedPatientsWorkspaceView.parseObservationValue("36,5"), 36.5)
    }

    func testParseObservationValueRejectsNonScalar() {
        XCTAssertNil(PairedPatientsWorkspaceView.parseObservationValue("120/80"))
        XCTAssertNil(PairedPatientsWorkspaceView.parseObservationValue("positivo"))
        XCTAssertNil(PairedPatientsWorkspaceView.parseObservationValue(""))
    }
}
