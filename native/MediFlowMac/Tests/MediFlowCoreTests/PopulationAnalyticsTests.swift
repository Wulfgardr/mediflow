import XCTest
@testable import MediFlowCore

final class PopulationAnalyticsTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Rome")!
        return calendar
    }

    private func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12))!
    }

    private func diagnosis(_ code: String, _ description: String, system: String? = "ICD-10") -> ClinicalDiagnosis {
        ClinicalDiagnosis(code: code, description: description, system: system)
    }

    func testAgeBucketsMatchWebThresholds() {
        XCTAssertEqual(PopulationAnalytics.getAgeBucket(18), .zeroToEighteen)
        XCTAssertEqual(PopulationAnalytics.getAgeBucket(19), .nineteenToSixtyFour)
        XCTAssertEqual(PopulationAnalytics.getAgeBucket(64), .nineteenToSixtyFour)
        XCTAssertEqual(PopulationAnalytics.getAgeBucket(65), .sixtyFiveToEighty)
        XCTAssertEqual(PopulationAnalytics.getAgeBucket(80), .sixtyFiveToEighty)
        XCTAssertEqual(PopulationAnalytics.getAgeBucket(81), .eightyPlus)
    }

    func testNormalizeAgeRangeOnlyOrdersSliderBounds() {
        XCTAssertEqual(PopulationAnalytics.normalizeAgeRange((120, 0)).0, 0)
        XCTAssertEqual(PopulationAnalytics.normalizeAgeRange((120, 0)).1, 120)
        XCTAssertEqual(PopulationAnalytics.normalizeAgeRange((30, 30)).0, 30)
    }

    func testAgeCountsCompletedYearsAtToday() {
        let now = date(2026, 7, 9)
        XCTAssertEqual(PopulationAnalytics.age(at: now, from: date(2008, 7, 9), calendar: calendar), 18)
        XCTAssertEqual(PopulationAnalytics.age(at: now, from: date(2008, 7, 10), calendar: calendar), 17)
    }

    func testPercentRoundsLikeMathRound() {
        XCTAssertEqual(PopulationAnalytics.percent(1, total: 3), 33)
        XCTAssertEqual(PopulationAnalytics.percent(2, total: 3), 67)
        XCTAssertEqual(PopulationAnalytics.percent(1, total: 0), 0)
    }

    func testStatisticsExcludeMissingBirthDatesFromRangesButCountThem() {
        let now = date(2026, 7, 9)
        let patients = [
            PopulationPatient(id: "minor", birthDate: date(2008, 7, 9), isAdi: false, diagnoses: [diagnosis("J45", "Asma")]),
            PopulationPatient(id: "adult", birthDate: date(1980, 7, 9), isAdi: true, diagnoses: [diagnosis("I10", "Ipertensione")]),
            PopulationPatient(id: "older", birthDate: date(1940, 7, 9), isAdi: true, diagnoses: []),
            PopulationPatient(id: "missing", birthDate: nil, isAdi: true, diagnoses: [diagnosis("E11", "Diabete")])
        ]
        let stats = PopulationAnalytics.statistics(for: patients, ageRange: (64, 18), now: now, calendar: calendar)
        XCTAssertEqual(stats.totalInRange, 2)
        XCTAssertEqual(stats.withBirthDate, 3)
        XCTAssertEqual(stats.withoutBirthDate, 1)
        XCTAssertEqual(stats.adiCount, 1)
        XCTAssertEqual(stats.withDiagnoses, 2)
        XCTAssertEqual(stats.ageDistribution[.zeroToEighteen], 1)
        XCTAssertEqual(stats.ageDistribution[.nineteenToSixtyFour], 1)
        XCTAssertEqual(stats.ageDistribution[.eightyPlus], 0)
    }

    func testDiagnosisKeyDeduplicatesOnlyDescriptionCaseUsingItalianLocale() {
        let now = date(2026, 7, 9)
        let patients = [
            PopulationPatient(id: "one", birthDate: date(1970, 1, 1), isAdi: false, diagnoses: [diagnosis("I10", "Ipertensione Arteriosa")]),
            PopulationPatient(id: "two", birthDate: date(1971, 1, 1), isAdi: false, diagnoses: [diagnosis("I10", "IPERTENSIONE ARTERIOSA")]),
            PopulationPatient(id: "three", birthDate: date(1972, 1, 1), isAdi: false, diagnoses: [diagnosis("I10", "Ipertensione arteriosa", system: "SNOMED")])
        ]
        let stats = PopulationAnalytics.statistics(for: patients, ageRange: (0, 120), now: now, calendar: calendar)
        XCTAssertEqual(stats.topDiagnoses.count, 2)
        XCTAssertEqual(stats.topDiagnoses[0].key, "ICD-10:I10:ipertensione arteriosa")
        XCTAssertEqual(stats.topDiagnoses[0].count, 2)
        XCTAssertEqual(stats.topDiagnoses[1].count, 1)
    }

    func testTopDiagnosesIsLimitedToTen() {
        let now = date(2026, 7, 9)
        let diagnoses = (1...11).map { diagnosis("C\($0)", "Diagnosi \($0)") }
        let patient = PopulationPatient(id: "one", birthDate: date(1980, 1, 1), isAdi: false, diagnoses: diagnoses)
        XCTAssertEqual(PopulationAnalytics.statistics(for: [patient], ageRange: (0, 120), now: now, calendar: calendar).topDiagnoses.count, 10)
    }
}
