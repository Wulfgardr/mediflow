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

    private let ageTimeZones = ["Europe/Rome", "America/Los_Angeles", "Pacific/Kiritimati"]

    private func deviceCalendar(_ zone: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone)!
        return calendar
    }

    private func instant(_ value: String) -> Date {
        HomeBaseDateCoding.parseISO8601(value)!
    }

    func testAgeUsesUTCBirthDayAndDeviceCivilDayAcrossTimeZones() {
        let birth = instant("1986-10-28T20:00:00Z")
        for zone in ageTimeZones {
            let calendar = deviceCalendar(zone)
            XCTAssertEqual(PopulationAnalytics.age(at: instant("2026-10-28T19:00:00Z"), from: birth, calendar: calendar), 40, zone)
            for (day, expected) in [(27, 39), (28, 40), (29, 40)] {
                for hour in [0, 12, 23] {
                    let today = calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: 1))!
                    XCTAssertEqual(PopulationAnalytics.age(at: today, from: birth, calendar: calendar), expected,
                        "\(zone), giorno \(day), ora \(hour)")
                }
            }
        }
    }

    func testUTCBirthDayDoesNotMoveToThePreviousDeviceDay() {
        let birth = instant("1986-10-28T00:30:00Z")
        for zone in ageTimeZones {
            let calendar = deviceCalendar(zone)
            for (day, expected) in [(27, 39), (28, 40), (29, 40)] {
                let now = calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: 12))!
                XCTAssertEqual(PopulationAnalytics.age(at: now, from: birth, calendar: calendar), expected, zone)
            }
        }
    }

    func testAgeUsesDeviceTodayWhenTimeZonesDisagreeAtTheSameInstant() {
        let birth = instant("1986-10-29T20:00:00Z")
        let now = instant("2026-10-28T19:00:00Z")
        for (zone, expected) in [("Europe/Rome", 39), ("America/Los_Angeles", 39), ("Pacific/Kiritimati", 40)] {
            XCTAssertEqual(PopulationAnalytics.age(at: now, from: birth, calendar: deviceCalendar(zone)), expected, zone)
        }
    }

    func testFebruary29BirthdayFallsOnFebruary28InNonLeapYears() {
        // Regola concordata: il 29 febbraio compie gli anni il 28 febbraio negli anni non bisestili.
        let birth = instant("2000-02-29T20:00:00Z")
        let cases = [(2025, 2, 27, 24), (2025, 2, 28, 25), (2025, 3, 1, 25),
                     (2024, 2, 28, 23), (2024, 2, 29, 24), (2024, 3, 1, 24),
                     (2100, 2, 27, 99), (2100, 2, 28, 100), (2100, 3, 1, 100)]
        for zone in ageTimeZones {
            let calendar = deviceCalendar(zone)
            for (year, month, day, expected) in cases {
                let today = calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12))!
                XCTAssertEqual(PopulationAnalytics.age(at: today, from: birth, calendar: calendar), expected,
                    "\(zone), \(year)-\(month)-\(day)")
            }
        }
    }

    func testPercentRoundsLikeMathRound() {
        XCTAssertEqual(PopulationAnalytics.percent(1, total: 3), 33)
        XCTAssertEqual(PopulationAnalytics.percent(2, total: 3), 67)
        XCTAssertEqual(PopulationAnalytics.percent(1, total: 0), 0)
    }

    func testAgeUsesGregorianCivilDaysRegardlessOfDeviceCalendar() {
        let birth = instant("1986-10-28T20:00:00Z")
        let leapBirth = instant("2000-02-29T20:00:00Z")
        for identifier in [Calendar.Identifier.buddhist, .japanese, .islamic] {
            for zone in ageTimeZones {
                let gregorian = deviceCalendar(zone)
                var preferred = Calendar(identifier: identifier)
                preferred.timeZone = gregorian.timeZone
                let cases = [(2026, 10, 27, birth, 39), (2026, 10, 28, birth, 40),
                             (2026, 10, 29, birth, 40), (2025, 2, 27, leapBirth, 24),
                             (2025, 2, 28, leapBirth, 25), (2024, 2, 28, leapBirth, 23),
                             (2024, 2, 29, leapBirth, 24)]
                for (year, month, day, birthDate, expected) in cases {
                    let now = gregorian.date(from: DateComponents(year: year, month: month, day: day, hour: 0, minute: 1))!
                    XCTAssertEqual(PopulationAnalytics.age(at: now, from: birthDate, calendar: preferred), expected,
                        "\(identifier), \(zone), \(year)-\(month)-\(day)")
                }
                XCTAssertEqual(PopulationAnalytics.age(at: instant("2026-10-28T19:00:00Z"), from: birth, calendar: preferred), 40,
                    "Astra: \(identifier), \(zone)")
            }
        }
    }

    func testStatisticsUseTheSameGregorianAgeWithNonGregorianDeviceCalendars() {
        let patient = PopulationPatient(id: "synthetic", birthDate: instant("1986-10-28T20:00:00Z"), isAdi: false, diagnoses: [])
        for identifier in [Calendar.Identifier.buddhist, .japanese, .islamic] {
            for zone in ageTimeZones {
                var preferred = Calendar(identifier: identifier)
                preferred.timeZone = TimeZone(identifier: zone)!
                let stats = PopulationAnalytics.statistics(for: [patient], ageRange: (40, 40),
                    now: instant("2026-10-28T19:00:00Z"), calendar: preferred)
                XCTAssertEqual(stats.totalInRange, 1, "\(identifier), \(zone)")
                XCTAssertEqual(stats.ageDistribution[.nineteenToSixtyFour], 1, "\(identifier), \(zone)")
            }
        }
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
