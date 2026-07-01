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
}
