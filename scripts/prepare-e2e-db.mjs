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

  if (!dataDir) {
    throw new Error('MEDIFLOW_DATA_DIR or MEDIFLOW_E2E_DATA_DIR is required');
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'medical.db');
  const legacyDbPath = path.join(projectRoot, 'medical.db');

  if (!fs.existsSync(dbPath)) {
    if (!fs.existsSync(legacyDbPath)) {
      throw new Error(`Cannot bootstrap E2E DB: missing legacy DB at ${legacyDbPath}`);
    }
    fs.copyFileSync(legacyDbPath, dbPath);
  }

  const db = new Database(dbPath);
  try {
    const hasUsersTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get();
    if (!hasUsersTable) {
      throw new Error('users table is missing in E2E database');
    }

    const columns = db.prepare('PRAGMA table_info(users)').all().map((row) => row.name);
    const idCol = pickColumn(columns, ['id']);
    const usernameCol = pickColumn(columns, ['username']);
    const passwordHashCol = pickColumn(columns, ['password_hash', 'passwordHash']);
    const encryptedMasterKeyCol = pickColumn(columns, ['encrypted_master_key', 'encryptedMasterKey']);
    const saltCol = pickColumn(columns, ['salt']);
    const roleCol = pickColumn(columns, ['role']);
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

      db.prepare(
        `UPDATE users SET ${setClauses.join(', ')} WHERE ${idCol} = @id`
      ).run({
        id: targetRow.id,
        username,
        passwordHash,
        encryptedMasterKey,
        salt: saltB64
      });
    } else {
      const values = {
        id: webcrypto.randomUUID(),
        username,
        passwordHash,
        encryptedMasterKey,
        salt: saltB64,
        role: 'admin',
        createdAt: Math.floor(Date.now() / 1000)
      };

      const insertColumns = [idCol, usernameCol, passwordHashCol, encryptedMasterKeyCol, saltCol];
      const insertParams = ['@id', '@username', '@passwordHash', '@encryptedMasterKey', '@salt'];

      if (roleCol) {
        insertColumns.push(roleCol);
        insertParams.push('@role');
      }
      if (createdAtCol) {
        insertColumns.push(createdAtCol);
        insertParams.push('@createdAt');
      }

      db.prepare(
        `INSERT INTO users (${insertColumns.join(', ')}) VALUES (${insertParams.join(', ')})`
      ).run(values);
    }

    console.log(`[e2e-db] Prepared deterministic auth in ${dbPath} (username: ${username})`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('[e2e-db] Bootstrap failed:', error);
  process.exit(1);
});
