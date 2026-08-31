#!/usr/bin/env node
/* @Codex */

import fs from 'fs';
import path from 'path';
import { webcrypto } from 'crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const PIN_ITERATIONS = 100000;

function pickColumn(columns, candidates) {
  return candidates.find((candidate) => columns.includes(candidate)) || null;
}

function applySqlMigrations(db, projectRoot) {
  const migrationsDir = path.join(projectRoot, 'drizzle');
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  db.pragma('foreign_keys = OFF');
  try {
    for (const fileName of migrationFiles) {
      const sql = fs
        .readFileSync(path.join(migrationsDir, fileName), 'utf8')
        .replace(/^-->\s+statement-breakpoint\s*$/gm, '');
      if (sql.trim().length === 0) continue;
      db.exec(sql);
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/* @Codex */
function ensureE2EDatabase(projectRoot, dbPath, legacyDbPath, allowLegacyCopy = true) {
  if (fs.existsSync(dbPath)) return;

  if (allowLegacyCopy && fs.existsSync(legacyDbPath)) {
    fs.copyFileSync(legacyDbPath, dbPath);
    return;
  }

  const bootstrapDb = new Database(dbPath);
  try {
    applySqlMigrations(bootstrapDb, projectRoot);
  } finally {
    bootstrapDb.close();
  }
}

function ensureDefaultAmbulatory(db, ambulatoryName) {
  const hasAmbulatoriesTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ambulatories'")
    .get();
  if (!hasAmbulatoriesTable) return;

  const existingDefault = db
    .prepare('SELECT id FROM ambulatories WHERE is_default = 1 LIMIT 1')
    .get();
  if (existingDefault?.id) return;

  const firstAmbulatory = db
    .prepare('SELECT id FROM ambulatories ORDER BY rowid ASC LIMIT 1')
    .get();
  if (firstAmbulatory?.id) {
    db.prepare('UPDATE ambulatories SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(
      firstAmbulatory.id
    );
    return;
  }

  db.prepare(
    `INSERT INTO ambulatories (id, name, type, is_default, created_at)
     VALUES (?, ?, 'live', 1, ?)`
  ).run(webcrypto.randomUUID(), ambulatoryName, Math.floor(Date.now() / 1000));
}

async function buildKeyArtifacts(pin) {
  const encoder = new TextEncoder();
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const kek = await webcrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PIN_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const masterKey = await webcrypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const rawMasterKey = await webcrypto.subtle.exportKey('raw', masterKey);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    kek,
    rawMasterKey
  );

  const encryptedMasterKey = Buffer.concat([
    Buffer.from(iv),
    Buffer.from(new Uint8Array(encrypted))
  ]).toString('base64');

  return {
    encryptedMasterKey,
    saltB64: Buffer.from(salt).toString('base64')
  };
}

async function main() {
  const projectRoot = process.cwd();
  const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_E2E_DATA_DIR;
  const pin = process.env.E2E_PIN || '1234';
  const username = process.env.E2E_USERNAME || 'admin';
  const displayName = process.env.E2E_DISPLAY_NAME || 'Dr. E2E Smoke';
  const ambulatoryName = process.env.E2E_AMBULATORY_NAME || 'Ambulatorio E2E';

  if (!dataDir) {
    throw new Error('MEDIFLOW_DATA_DIR or MEDIFLOW_E2E_DATA_DIR is required');
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'medical.db');
  const legacyDbPath = path.join(projectRoot, 'medical.db');
  ensureE2EDatabase(projectRoot, dbPath, legacyDbPath);

  let db = new Database(dbPath);
  try {
    let hasUsersTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get();
    if (!hasUsersTable) {
      db.close();
      fs.rmSync(dbPath, { force: true });
      // A present but non-MediFlow legacy file must not be copied a second time:
      // rebuild the isolated E2E database from the canonical SQL migrations.
      ensureE2EDatabase(projectRoot, dbPath, legacyDbPath, false);
      db = new Database(dbPath);
      hasUsersTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
        .get();
      if (!hasUsersTable) {
        throw new Error('users table is missing in E2E database');
      }
    }

    const columns = db.prepare('PRAGMA table_info(users)').all().map((row) => row.name);
    const idCol = pickColumn(columns, ['id']);
    const usernameCol = pickColumn(columns, ['username']);
    const passwordHashCol = pickColumn(columns, ['password_hash', 'passwordHash']);
    const encryptedMasterKeyCol = pickColumn(columns, ['encrypted_master_key', 'encryptedMasterKey']);
    const saltCol = pickColumn(columns, ['salt']);
    const roleCol = pickColumn(columns, ['role']);
    const displayNameCol = pickColumn(columns, ['display_name', 'displayName']);
    const ambulatoryNameCol = pickColumn(columns, ['ambulatory_name', 'ambulatoryName']);
    const createdAtCol = pickColumn(columns, ['created_at', 'createdAt']);

    if (!idCol || !usernameCol || !passwordHashCol || !encryptedMasterKeyCol || !saltCol) {
      throw new Error('users schema is missing required auth columns');
    }

    const { encryptedMasterKey, saltB64 } = await buildKeyArtifacts(pin);
    const passwordHash = bcrypt.hashSync(pin, 10);

    const adminRow = db
      .prepare(`SELECT ${idCol} AS id FROM users WHERE ${usernameCol} = ? LIMIT 1`)
      .get(username);
    const targetRow =
      adminRow ||
      db.prepare(`SELECT ${idCol} AS id FROM users ORDER BY rowid ASC LIMIT 1`).get();

    if (targetRow?.id) {
      const setClauses = [
        `${usernameCol} = @username`,
        `${passwordHashCol} = @passwordHash`,
        `${encryptedMasterKeyCol} = @encryptedMasterKey`,
        `${saltCol} = @salt`
      ];
      if (roleCol) setClauses.push(`${roleCol} = 'admin'`);
      if (displayNameCol) setClauses.push(`${displayNameCol} = @displayName`);
      if (ambulatoryNameCol) setClauses.push(`${ambulatoryNameCol} = @ambulatoryName`);

      db.prepare(
        `UPDATE users SET ${setClauses.join(', ')} WHERE ${idCol} = @id`
      ).run({
        id: targetRow.id,
        username,
        passwordHash,
        encryptedMasterKey,
        salt: saltB64,
        displayName,
        ambulatoryName
      });
    } else {
      const values = {
        id: webcrypto.randomUUID(),
        username,
        passwordHash,
        encryptedMasterKey,
        salt: saltB64,
        role: 'admin',
        displayName,
        ambulatoryName,
        createdAt: Math.floor(Date.now() / 1000)
      };

      const insertColumns = [idCol, usernameCol, passwordHashCol, encryptedMasterKeyCol, saltCol];
      const insertParams = ['@id', '@username', '@passwordHash', '@encryptedMasterKey', '@salt'];

      if (roleCol) {
        insertColumns.push(roleCol);
        insertParams.push('@role');
      }
      if (displayNameCol) {
        insertColumns.push(displayNameCol);
        insertParams.push('@displayName');
      }
      if (ambulatoryNameCol) {
        insertColumns.push(ambulatoryNameCol);
        insertParams.push('@ambulatoryName');
      }
      if (createdAtCol) {
        insertColumns.push(createdAtCol);
        insertParams.push('@createdAt');
      }

      db.prepare(
        `INSERT INTO users (${insertColumns.join(', ')}) VALUES (${insertParams.join(', ')})`
      ).run(values);
    }

    ensureDefaultAmbulatory(db, ambulatoryName);

    console.log(`[e2e-db] Prepared deterministic auth in ${dbPath} (username: ${username})`);
  } finally {
    db?.close();
  }
}

main().catch((error) => {
  console.error('[e2e-db] Bootstrap failed:', error);
  process.exit(1);
});
