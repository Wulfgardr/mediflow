# MediFlowSQLiteC

Vendored SQLite amalgamation (the official upstream `sqlite3.c` + `sqlite3.h` +
bundles SQLite rather than relying on a system `libsqlite3`, so it builds and
behaves identically on macOS, Windows-MSVC and Linux. Compile defines live in
`Package.swift` (THREADSAFE=1, OMIT_LOAD_EXTENSION, DQS=0, DEFAULT_FOREIGN_KEYS=1).

Source: node_modules/better-sqlite3/deps/sqlite3 (the unmodified upstream
amalgamation). To update, replace all three files from a pinned SQLite release.
