import XCTest
@testable import MediFlowCore

/// ADR 0071 Fase 2: confirms the vendored SQLite C amalgamation links and is
/// callable from Swift, and pins the version so an accidental amalgamation swap is
/// caught. This same test runs on macOS/Linux/Windows in the tri-OS core gate.
final class SQLiteVendorTests: XCTestCase {
    func testVendoredSQLiteVersionIsPinned() {
        XCTAssertEqual(SQLite.libVersion, "3.51.2")
    }
}
