import XCTest
@testable import MediFlowCore

class SyntheticSQLiteFixtureTestCase: XCTestCase {
    private var databasePath: String!

    override func setUpWithError() throws {
        try super.setUpWithError()
        databasePath = FileManager.default.temporaryDirectory
            .appendingPathComponent("mediflow-fixture-\(UUID().uuidString).db").path
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/medical_fixture.sql")
        guard FileManager.default.createFile(atPath: databasePath, contents: Data()) else {
            throw CocoaError(.fileWriteUnknown)
        }
        let database = try SQLiteConnection(readWritePath: databasePath)
        try database.execute(String(contentsOf: source, encoding: .utf8))
    }

    override func tearDownWithError() throws {
        defer { databasePath = nil }
        if let databasePath { try FileManager.default.removeItem(atPath: databasePath) }
        try super.tearDownWithError()
    }

    func fixturePath() -> String { databasePath }
}
