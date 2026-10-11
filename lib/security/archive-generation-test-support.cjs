'use strict';
const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');
// Only the generation fence uses SQLite here; clinical rows remain explicit fixtures.
module.exports = function archiveGenerationFixture() {
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE archive_generation (id INTEGER PRIMARY KEY, generation TEXT NOT NULL); CREATE TABLE archive_session_generations (session_ref TEXT PRIMARY KEY, generation TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    sqlite.prepare('INSERT INTO archive_generation VALUES (1, ?)').run(randomUUID());
    return sqlite;
};
