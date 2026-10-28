import XCTest
import CryptoKit
@testable import MediFlowAppleShared

// G1 (ADR 0071 parity): the patient-list row now derives an age from the summary
// birthDate. Lock the boundary logic of the age helper.
final class PatientSummaryPresentationTests: XCTestCase {
    func testEntryDateIsItalianRegardlessOfDeviceLanguage() {
        let formatter = PairedPatientsWorkspaceSupport.entryDateFormatter
        XCTAssertEqual(formatter.locale.identifier, "it_IT")
        let copy = formatter.copy() as! DateFormatter
        copy.timeZone = TimeZone(secondsFromGMT: 0)
        let date = Date(timeIntervalSince1970: 1750007160)
        XCTAssertEqual(copy.string(from: date), "15 giu 2025, 17:06")
    }

    func testClinicalFieldProtectionTakesPrecedenceOverValueAndAbsence() {
        XCTAssertEqual(PatientChartFieldValue.make("synthetic protected value", isProtected: true), .protected)
        XCTAssertEqual(PatientChartFieldValue.make(nil, isProtected: true), .protected)
    }

    func testClinicalFieldDistinguishesMissingFromRecordedContent() {
        XCTAssertEqual(PatientChartFieldValue.make(nil), .missing)
        XCTAssertEqual(PatientChartFieldValue.make("  \n"), .missing)
        XCTAssertEqual(PatientChartFieldValue.make("  Via sintetica 1  "), .recorded("Via sintetica 1"))
    }

    func testValidKeyWithInvalidDiagnosisSchemaDoesNotClaimAbsence() throws {
        let key = SymmetricKey(data: Data(repeating: 17, count: 32))
        let raw = #"[{"code":"I10","description":7}]"#
        let encrypted = try XCTUnwrap(CryptoService.encryptField(raw, masterKey: key))
        let resolved = PatientFieldCrypto.resolveStructuredField(encrypted, masterKey: key)
        XCTAssertFalse(resolved.isLocked)
        guard case .plaintext(let opened) = resolved else { return XCTFail("Synthetic field must decrypt") }
        XCTAssertEqual(opened, raw)
        let read = PatientStructuredFields.diagnoses(opened)
        XCTAssertTrue(read.isUnreadable)
        XCTAssertNil(read.count)
        XCTAssertEqual(PatientStructuredFields.unreadableMessage("Diagnosi"), "Diagnosi presenti ma non leggibili su questo dispositivo.")
    }

    func testStructuredFieldsKeepAbsencePresenceAndUnreadableDistinct() {
        XCTAssertEqual(DiagnosesCodec.decodeResult(nil).count, 0)
        XCTAssertEqual(DiagnosesCodec.decodeResult("[]").count, 0)
        XCTAssertEqual(DiagnosesCodec.decodeResult(#"[{"code":"I10","description":"Test"}]"#).count, 1)
        XCTAssertNil(DiagnosesCodec.decodeResult("[{}]").count)
        XCTAssertNil(ExemptionCodesCodec.decodeResult(#"[{"code":7}]"#).count)
        XCTAssertEqual(ExemptionCodesCodec.decodeResult("048,C01").count, 2)
        XCTAssertEqual(ExemptionCodesCodec.decodeResult("[]").count, 0)
        XCTAssertNil(DocumentInsightsCodec.decodeResult(#"[{"id":"doc","fileName":7}]"#).count)
        XCTAssertNil(DocumentInsightsCodec.decodeResult("[{}]").count)
        XCTAssertEqual(DocumentInsightsCodec.decodeResult("[]").count, 0)
        XCTAssertNil(HomeBaseEntryAttachmentReferencesCodec.decodeResult("[7]").count)
        XCTAssertEqual(HomeBaseEntryAttachmentReferencesCodec.decodeResult("[]").count, 0)
        XCTAssertEqual(HomeBaseEntryAttachmentReferencesCodec.decodeResult("[\"synthetic-id\"]").count, 1)
    }

    func testBirthDateSurfacesStayOnCivilDayInLosAngeles() throws {
        let previous = NSTimeZone.default
        let previousDayZone = ClinicalDatePresentation.day.timeZone
        NSTimeZone.default = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))
        ClinicalDatePresentation.day.timeZone = NSTimeZone.default
        defer { NSTimeZone.default = previous; ClinicalDatePresentation.day.timeZone = previousDayZone }
        let birth = try XCTUnwrap(HomeBaseDateCoding.parseISO8601("1980-01-01T00:00:00.000Z"))
        XCTAssertEqual(ClinicalDatePresentation.birthDate.string(from: birth), "1 gen 1980", "Scheda and cached profile")
        XCTAssertEqual(PairedPatientsWorkspaceSupport.birthDateFormatter.string(from: birth), "1 gen 1980", "wide and compact headers")
        XCTAssertEqual(PairedPatientsWorkspaceSupport.birthYearText(from: birth), "1980")
    }

    #if os(macOS)
    func testMacTimestampUsesItalianNamedMonthAndFullYear() {
        let formatter = ClinicalDatePresentation.timestamp.copy() as! DateFormatter
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        XCTAssertEqual(formatter.string(from: Date(timeIntervalSince1970: 1750007160)), "15 giu 2025, 17:06")
    }
    #endif

    func testPatientAgeUsesCivilDaysForTheAstraCaseAcrossTimeZones() throws {
        let birth = try XCTUnwrap(HomeBaseDateCoding.parseISO8601("1986-10-28T20:00:00Z"))
        let now = try XCTUnwrap(HomeBaseDateCoding.parseISO8601("2026-10-28T19:00:00Z"))
        for zone in ["Europe/Rome", "America/Los_Angeles", "Pacific/Kiritimati"] {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = try XCTUnwrap(TimeZone(identifier: zone))
            XCTAssertEqual(PairedPatientsWorkspaceSupport.age(from: birth, at: now, calendar: calendar), 40, zone)
        }
    }

    func testAgeIsNilWhenBirthDateAbsent() {
        XCTAssertNil(PairedPatientsWorkspaceView.age(from: nil))
    }

    func testAgeFromBirthDateFortyYearsAgo() {
        let birth = HomeBaseDateCoding.parseISO8601("1986-10-28T20:00:00Z")
        let now = HomeBaseDateCoding.parseISO8601("2026-10-28T19:00:00Z")!
        XCTAssertEqual(PairedPatientsWorkspaceSupport.age(from: birth, at: now), 40)
    }

    func testAgeFromBirthDateToday() {
        let today = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        var birthCalendar = Calendar(identifier: .gregorian)
        birthCalendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let birth = birthCalendar.date(from: DateComponents(year: today.year, month: today.month, day: today.day, hour: 20))
        XCTAssertEqual(PairedPatientsWorkspaceView.age(from: birth), 0)
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
