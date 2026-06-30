import Foundation
import MediFlowSQLiteC

// ADR 0071 Fase 2: a thin Swift surface over the vendored SQLite C amalgamation
// (MediFlowSQLiteC). The persistence layer (read-only patient store first) is
// built on this. Keeping the raw C confined here keeps the rest of the core clean.
public enum SQLite {
    /// The vendored SQLite library version (e.g. "3.51.2"). Reading it from Swift
    /// confirms the C target links and is callable on every OS (the tri-OS gate).
    public static var libVersion: String {
        String(cString: sqlite3_libversion())
    }
}
