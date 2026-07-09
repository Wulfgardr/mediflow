import XCTest
@testable import MediFlowCore

final class AgendaPresentationTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Rome")!
        return calendar
    }

    private func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    private func checkup(_ id: String, _ date: Date, status: String? = "pending") -> AgendaCheckup {
        AgendaCheckup(id: id, patientId: "p-\(id)", date: date, status: status)
    }

    func testClassifyCheckupPillGivesStatusPrecedence() {
        let now = date(2026, 7, 9, 12)
        XCTAssertEqual(AgendaPresentation.classifyCheckupPill(date: date(2026, 7, 8), status: "completed", now: now, calendar: calendar), AgendaPillPresentation(pill: .green, label: "Completato"))
        XCTAssertEqual(AgendaPresentation.classifyCheckupPill(date: date(2026, 7, 10), status: "cancelled", now: now, calendar: calendar), AgendaPillPresentation(pill: .muted, label: "Annullato"))
    }

    func testClassifyCheckupPillTreatsEarlierTodayAsToday() {
        let now = date(2026, 7, 9, 12)
        XCTAssertEqual(AgendaPresentation.classifyCheckupPill(date: date(2026, 7, 8, 23, 59), status: "pending", now: now, calendar: calendar).pill, .coral)
        XCTAssertEqual(AgendaPresentation.classifyCheckupPill(date: date(2026, 7, 9, 8), status: "pending", now: now, calendar: calendar).pill, .yellow)
        XCTAssertEqual(AgendaPresentation.classifyCheckupPill(date: date(2026, 7, 10), status: nil, now: now, calendar: calendar).pill, .blue)
    }

    func testCountTodayCheckupsIncludesMidnightAndExcludesInactiveStatuses() {
        let now = date(2026, 7, 9, 12)
        let checkups = [
            checkup("midnight", date(2026, 7, 9)),
            checkup("later", date(2026, 7, 9, 23, 59)),
            checkup("completed", date(2026, 7, 9, 10), status: "completed"),
            checkup("cancelled", date(2026, 7, 9, 10), status: "cancelled"),
            checkup("tomorrow", date(2026, 7, 10))
        ]
        XCTAssertEqual(AgendaPresentation.countTodayCheckups(checkups, now: now, calendar: calendar), 2)
    }

    func testCountPlannedCheckupsUsesStartOfLocalDay() {
        let now = date(2026, 7, 9, 12)
        let checkups = [
            checkup("before", date(2026, 7, 8, 23, 59)),
            checkup("midnight", date(2026, 7, 9)),
            checkup("future", date(2026, 7, 10)),
            checkup("done", date(2026, 7, 10), status: "completed")
        ]
        XCTAssertEqual(AgendaPresentation.countPlannedCheckups(checkups, now: now, calendar: calendar), 2)
    }

    func testAgendaCandidatesFilterSortStablyAndLimitToSix() {
        let now = date(2026, 7, 9, 12)
        let checkups = [
            checkup("old", date(2026, 7, 8, 23, 59)),
            checkup("equal-first", date(2026, 7, 9)),
            checkup("cancelled", date(2026, 7, 9), status: "cancelled"),
            checkup("equal-second", date(2026, 7, 9)),
            checkup("three", date(2026, 7, 9, 1)),
            checkup("four", date(2026, 7, 9, 2)),
            checkup("five", date(2026, 7, 9, 3)),
            checkup("six", date(2026, 7, 9, 4)),
            checkup("seven", date(2026, 7, 9, 5))
        ]
        XCTAssertEqual(AgendaPresentation.agendaCandidates(from: checkups, now: now, calendar: calendar).map(\.id), ["equal-first", "equal-second", "three", "four", "five", "six"])
    }
}
