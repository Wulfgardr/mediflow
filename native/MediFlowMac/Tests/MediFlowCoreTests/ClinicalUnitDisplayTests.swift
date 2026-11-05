import XCTest
@testable import MediFlowCore

/// Stessi casi di `lib/patient-quadro.test.ts` («mostra le unità come le legge un
/// medico»): web e app Apple devono leggere la stessa unità nello stesso modo.
final class ClinicalUnitDisplayTests: XCTestCase {
    func testCatalogUnitsReadAsClinicianWould() {
        XCTAssertEqual(ClinicalUnitDisplay.unit("mm[Hg]"), "mmHg")
        XCTAssertEqual(ClinicalUnitDisplay.unit("Cel"), "°C")
        XCTAssertEqual(ClinicalUnitDisplay.unit("10*3/uL"), "×10³/µL")
        XCTAssertEqual(ClinicalUnitDisplay.unit("/min"), "/min")
        XCTAssertEqual(ClinicalUnitDisplay.unit(""), "")
    }

    func testUnknownUnitsAreRenderedPrudently() {
        XCTAssertEqual(ClinicalUnitDisplay.unit("mL/min/{1.73_m2}"), "mL/min/1,73 m²")
        XCTAssertEqual(ClinicalUnitDisplay.unit("ug/L"), "µg/L")
    }

    func testValueWithUnit() {
        XCTAssertEqual(ClinicalUnitDisplay.value("37.5", unitCode: "Cel"), "37,5 °C")
        XCTAssertEqual(ClinicalUnitDisplay.value("130", unitCode: "mm[Hg]"), "130 mmHg")
        XCTAssertEqual(ClinicalUnitDisplay.value("non rilevabile", unitCode: "kg"), "non rilevabile")
        XCTAssertEqual(ClinicalUnitDisplay.value("130/80", unitCode: "mm[Hg]"), "130/80 mmHg")
    }
}
