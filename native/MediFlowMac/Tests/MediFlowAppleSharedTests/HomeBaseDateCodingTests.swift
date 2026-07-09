import XCTest
@testable import MediFlowAppleShared

final class HomeBaseDateCodingTests: XCTestCase {
    private struct Payload: Decodable {
        let at: Date
    }

    private func decode(_ raw: String) throws -> Date {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = HomeBaseDateCoding.tolerantISO8601Strategy
        let data = "{\"at\":\"\(raw)\"}".data(using: .utf8)!
        return try decoder.decode(Payload.self, from: data).at
    }

    private var expectedInstant: Date {
        var components = DateComponents()
        components.year = 2026
        components.month = 7
        components.day = 8
        components.hour = 10
        components.timeZone = TimeZone(identifier: "UTC")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar.date(from: components)!
    }

    func testDecodesFractionalSecondsAsEmittedByJavaScriptToISOString() throws {
        // Il boundary usa Date.toISOString(): i millisecondi ci sono SEMPRE.
        let date = try decode("2026-07-08T10:00:00.000Z")
        XCTAssertEqual(date.timeIntervalSince1970, expectedInstant.timeIntervalSince1970, accuracy: 0.001)
    }

    func testDecodesNonZeroMilliseconds() throws {
        let date = try decode("2026-07-08T10:00:00.123Z")
        XCTAssertEqual(date.timeIntervalSince1970, expectedInstant.timeIntervalSince1970 + 0.123, accuracy: 0.001)
    }

    func testDecodesPlainISO8601WithoutFractionalSeconds() throws {
        // Forma emessa dall'encoder Swift .iso8601 (cache locale, payload client).
        let date = try decode("2026-07-08T10:00:00Z")
        XCTAssertEqual(date.timeIntervalSince1970, expectedInstant.timeIntervalSince1970, accuracy: 0.001)
    }

    func testRejectsMalformedDateWithDecodingError() {
        XCTAssertThrowsError(try decode("non-una-data")) { error in
            XCTAssertTrue(error is DecodingError)
        }
    }

    func testParseISO8601AcceptsBothFormsDirectly() {
        XCTAssertNotNil(HomeBaseDateCoding.parseISO8601("2026-07-08T10:00:00.000Z"))
        XCTAssertNotNil(HomeBaseDateCoding.parseISO8601("2026-07-08T10:00:00Z"))
        XCTAssertNil(HomeBaseDateCoding.parseISO8601(""))
    }
}
