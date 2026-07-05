import XCTest
@testable import MediFlowAppleShared

final class ObservationTrendTests: XCTestCase {
    private let epoch = Date(timeIntervalSince1970: 1_750_000_000)

    private func obs(
        _ id: String,
        code: String = "29463-7",
        system: String = "http://loinc.org",
        value: String,
        minutesAgo: Double = 0,
        deleted: Bool = false
    ) -> HomeBaseObservationSummary {
        HomeBaseObservationSummary(
            id: id, patientId: "p1", codeSystem: system, code: code, display: "Test",
            unitSystem: "http://unitsofmeasure.org", unitCode: "kg", value: value, notes: nil,
            observedAt: epoch.addingTimeInterval(-minutesAgo * 60), source: "manual", version: 1,
            createdAt: nil, updatedAt: nil,
            deletedAt: deleted ? epoch : nil, deletionReason: deleted ? "test" : nil
        )
    }

    // MARK: numericValue

    func testNumericValueParsesPlainAndDecimal() {
        XCTAssertEqual(ObservationTrendComputer.numericValue("120"), 120)
        XCTAssertEqual(ObservationTrendComputer.numericValue("120.5"), 120.5)
        XCTAssertEqual(ObservationTrendComputer.numericValue("98.6"), 98.6)
    }

    func testNumericValueAcceptsItalianDecimalComma() {
        XCTAssertEqual(ObservationTrendComputer.numericValue("80,5"), 80.5)
    }

    func testNumericValueTakesLeadingNumberIgnoringTrailingUnit() {
        XCTAssertEqual(ObservationTrendComputer.numericValue("80 kg"), 80)
        XCTAssertEqual(ObservationTrendComputer.numericValue("36.6C"), 36.6)
    }

    func testNumericValueHandlesLeadingSign() {
        XCTAssertEqual(ObservationTrendComputer.numericValue("-1.5"), -1.5)
        XCTAssertEqual(ObservationTrendComputer.numericValue("+2"), 2)
    }

    func testNumericValueRejectsNonNumericAndMalformed() {
        XCTAssertNil(ObservationTrendComputer.numericValue("positivo"))
        XCTAssertNil(ObservationTrendComputer.numericValue(""))
        XCTAssertNil(ObservationTrendComputer.numericValue("   "))
        XCTAssertNil(ObservationTrendComputer.numericValue("."))
        XCTAssertNil(ObservationTrendComputer.numericValue("1.2.3"))
    }

    func testNumericValueRejectsCompositeRatioValues() {
        // A single arrow would misrepresent a two-component value.
        XCTAssertNil(ObservationTrendComputer.numericValue("120/80"))  // blood pressure
        XCTAssertNil(ObservationTrendComputer.numericValue("1:40"))    // antibody titer
        XCTAssertNil(ObservationTrendComputer.numericValue("1:160"))
        XCTAssertNil(ObservationTrendComputer.numericValue("5-7"))     // range (interior dash)
        XCTAssertNil(ObservationTrendComputer.numericValue("120/80 mmHg"))
    }

    func testNumericValueStaysSilentOnLocaleAmbiguousThousands() {
        // In it/IT "1.250" means 1250, not 1.25; guessing would invert the trend.
        XCTAssertNil(ObservationTrendComputer.numericValue("1.250"))
        XCTAssertNil(ObservationTrendComputer.numericValue("150.000"))
        XCTAssertNil(ObservationTrendComputer.numericValue("1.250,5"))  // mixed separators
        // But genuine decimals (1-2 fraction digits, or a leading zero) still parse.
        XCTAssertEqual(ObservationTrendComputer.numericValue("82.5"), 82.5)
        XCTAssertEqual(ObservationTrendComputer.numericValue("0.123"), 0.123)
    }

    func testNumericValueRejectsNonAsciiDigits() {
        // Arabic-Indic digits are not parseable magnitudes here; stay silent.
        XCTAssertNil(ObservationTrendComputer.numericValue("\u{0661}\u{0662}\u{0660}"))
    }

    // MARK: compute

    func testFirstReadingOfACodeHasNoTrend() {
        let trends = ObservationTrendComputer.compute([obs("a", value: "80", minutesAgo: 0)])
        XCTAssertNil(trends["a"], "the only reading of a code has no predecessor")
    }

    func testRisingFallingSteadyAcrossSameCode() {
        let trends = ObservationTrendComputer.compute([
            obs("t0", value: "80", minutesAgo: 30),
            obs("t1", value: "82", minutesAgo: 20),
            obs("t2", value: "82", minutesAgo: 10),
            obs("t3", value: "79", minutesAgo: 0)
        ])
        XCTAssertNil(trends["t0"])              // first reading
        XCTAssertEqual(trends["t1"], .rising)   // 80 -> 82
        XCTAssertEqual(trends["t2"], .steady)   // 82 -> 82
        XCTAssertEqual(trends["t3"], .falling)  // 82 -> 79
    }

    func testTrendIsIndependentOfArrayOrder() {
        // Same data as above but shuffled: order must not change the result.
        let trends = ObservationTrendComputer.compute([
            obs("t3", value: "79", minutesAgo: 0),
            obs("t1", value: "82", minutesAgo: 20),
            obs("t0", value: "80", minutesAgo: 30),
            obs("t2", value: "82", minutesAgo: 10)
        ])
        XCTAssertNil(trends["t0"])
        XCTAssertEqual(trends["t1"], .rising)
        XCTAssertEqual(trends["t2"], .steady)
        XCTAssertEqual(trends["t3"], .falling)
    }

    func testNonNumericReadingHasNoTrendAndDoesNotBreakHistory() {
        let trends = ObservationTrendComputer.compute([
            obs("t0", value: "80", minutesAgo: 30),
            obs("t1", value: "positivo", minutesAgo: 20),
            obs("t2", value: "85", minutesAgo: 10)
        ])
        XCTAssertNil(trends["t0"])              // first
        XCTAssertNil(trends["t1"], "non-numeric reading has no trend")
        XCTAssertEqual(trends["t2"], .rising, "the next numeric reading compares to the last numeric one (80)")
    }

    func testDifferentCodesAreComparedIndependently() {
        let trends = ObservationTrendComputer.compute([
            obs("w0", code: "29463-7", value: "80", minutesAgo: 20),
            obs("w1", code: "29463-7", value: "82", minutesAgo: 0),
            obs("g0", code: "2339-0", value: "100", minutesAgo: 20),
            obs("g1", code: "2339-0", value: "90", minutesAgo: 0)
        ])
        XCTAssertEqual(trends["w1"], .rising)
        XCTAssertEqual(trends["g1"], .falling)
        XCTAssertNil(trends["w0"])
        XCTAssertNil(trends["g0"])
    }

    func testSameCodeDifferentSystemsAreNotCompared() {
        let trends = ObservationTrendComputer.compute([
            obs("a", system: "http://loinc.org", value: "80", minutesAgo: 10),
            obs("b", system: "http://snomed.info/sct", value: "90", minutesAgo: 0)
        ])
        XCTAssertNil(trends["a"])
        XCTAssertNil(trends["b"], "same code under a different system is a different series")
    }

    func testDeletedObservationsAreExcludedFromTheSeries() {
        let trends = ObservationTrendComputer.compute([
            obs("t0", value: "80", minutesAgo: 30),
            obs("t1", value: "999", minutesAgo: 20, deleted: true),
            obs("t2", value: "82", minutesAgo: 10)
        ])
        XCTAssertNil(trends["t1"], "a deleted reading gets no trend")
        XCTAssertEqual(trends["t2"], .rising, "deleted readings are not a baseline (80 -> 82, not 999 -> 82)")
    }

    func testEqualTimestampsAreOrderedDeterministicallyById() {
        let trends = ObservationTrendComputer.compute([
            obs("b", value: "90", minutesAgo: 0),
            obs("a", value: "80", minutesAgo: 0)
        ])
        // Tie-break by id: "a" sorts first (baseline), "b" rises.
        XCTAssertNil(trends["a"])
        XCTAssertEqual(trends["b"], .rising)
    }

    func testEmptyInputProducesEmptyMap() {
        XCTAssertTrue(ObservationTrendComputer.compute([]).isEmpty)
    }

    func testUnitSuffixedValuesStillTrend() {
        let trends = ObservationTrendComputer.compute([
            obs("t0", value: "80 kg", minutesAgo: 10),
            obs("t1", value: "82 kg", minutesAgo: 0)
        ])
        XCTAssertEqual(trends["t1"], .rising)
    }

    func testAllNonNumericSeriesHasNoTrends() {
        let trends = ObservationTrendComputer.compute([
            obs("t0", value: "positivo", minutesAgo: 10),
            obs("t1", value: "negativo", minutesAgo: 0)
        ])
        XCTAssertTrue(trends.isEmpty)
    }

    func testCompositeReadingsNeverTrend() {
        // Two blood-pressure readings: even though one is "higher", a single arrow
        // would misrepresent it, so neither gets a trend.
        let trends = ObservationTrendComputer.compute([
            obs("t0", value: "120/80", minutesAgo: 10),
            obs("t1", value: "140/90", minutesAgo: 0)
        ])
        XCTAssertTrue(trends.isEmpty)
    }
}
