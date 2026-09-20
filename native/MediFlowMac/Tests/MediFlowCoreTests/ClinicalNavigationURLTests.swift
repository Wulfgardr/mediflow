import Foundation
import XCTest
@testable import MediFlowCore

/* @Codex */
final class ClinicalNavigationURLTests: XCTestCase {
    func testEveryKnownAreaAndPatientSectionHasAnExactRoute() throws {
        for area in ClinicalNavigationArea.allCases {
            XCTAssertEqual(parse("mediflow://navigate?area=\(area.rawValue)"), .area(area))
        }
        for section in ClinicalNavigationPatientSection.allCases {
            XCTAssertEqual(
                parse("mediflow://navigate?area=patients&paziente=Patient-synthetic_01&section=\(section.rawValue)"),
                .patient(id: "Patient-synthetic_01", section: section)
            )
        }
        XCTAssertEqual(
            parse("mediflow://navigate?paziente=patient-synthetic-01&area=patients"),
            .patient(id: "patient-synthetic-01", section: .overview)
        )
    }

    func testAnUnknownOrAmbiguousDestinationNeverFallsBackToAnArea() {
        for query in [
            "", "area", "area=", "area=unknown", "area=Patients",
            "area=agenda&area=patients", "area=patients&paziente=a&paziente=b",
            "area=patients&paziente=a&section=diary&section=documents",
            "area=patients&section=diary", "area=agenda&paziente=a",
            "area=patients&paziente=", "area=patients&paziente=a&section=unknown",
            "area=patients&paziente=a&section="
        ] {
            XCTAssertNil(parse("mediflow://navigate?\(query)"))
        }
    }

    func testCredentialsConfigAndCommandsAreNotNavigationParameters() {
        for key in ["token", "PIN", "pin", "username", "host", "url", "scope", "action", "save", "clientId"] {
            XCTAssertNil(parse("mediflow://navigate?area=patients&\(key)=synthetic"))
        }
        XCTAssertNil(parse("mediflow://navigate?area=patients&%74oken=synthetic"))
    }

    func testOnlyTheLocalSchemeAndEmptyPathAreAccepted() throws {
        var wrongScheme = try XCTUnwrap(URLComponents(string: "mediflow://navigate?area=agenda"))
        wrongScheme.scheme = "https"
        XCTAssertNil(ClinicalNavigationURL.parse(try XCTUnwrap(wrongScheme.url)))
        for text in [
            "file:///navigate?area=agenda",
            "mediflow://other?area=agenda", "mediflow://navigate/?area=agenda",
            "mediflow://navigate/agenda?area=agenda", "mediflow://navigate:1234?area=agenda",
            "mediflow://synthetic@navigate?area=agenda", "mediflow://navigate?area=agenda#",
            "mediflow://navigate?area=agenda#diary"
        ] {
            XCTAssertNil(parse(text))
        }
        let relative = URL(string: "?area=agenda", relativeTo: URL(string: "mediflow://navigate")!)!
        XCTAssertNil(ClinicalNavigationURL.parse(relative))
    }

    func testPatientIdentityIsBoundedAndDecodedOnlyOnce() {
        for value in ["a", "synthetic.patient_01-ABC", String(repeating: "a", count: 512)] {
            XCTAssertEqual(
                parse("mediflow://navigate?area=patients&paziente=\(value)"),
                .patient(id: value, section: .overview)
            )
        }
        for value in [".", "..", "a%2Fb", "a%20b", "a%252Fb", "a%0Ab", String(repeating: "a", count: 513)] {
            XCTAssertNil(parse("mediflow://navigate?area=patients&paziente=\(value)"))
        }
        XCTAssertNil(parse("mediflow://navigate?area=patients&paziente=" + String(repeating: "%61", count: 700)))
    }

    func testHostAndCatalogueSurfacesDoNotAppearOnMobile() {
        for area in ClinicalNavigationArea.allCases {
            XCTAssertTrue(area.isAvailable(on: .macOS))
            XCTAssertEqual(area.isAvailable(on: .mobile), area != .host && area != .repertori)
        }
    }

    private func parse(_ text: String) -> ClinicalNavigationDestination? {
        guard let url = URL(string: text) else { return nil }
        return ClinicalNavigationURL.parse(url)
    }
}
