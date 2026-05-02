#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(ROOT_DIR, 'scripts/siss-fse-corpus-mcp.mjs');
const TIMEOUT_MS = 10_000;

async function writeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mediflow-siss-fse-mcp-'));
  const corpusDir = path.join(root, 'corpus');
  await mkdir(path.join(corpusDir, 'siss-modalita-accesso'), { recursive: true });
  await mkdir(path.join(corpusDir, 'siss-manual-import'), { recursive: true });

  const manifestPath = path.join(root, 'manifest.json');
  const manifest = [
    {
      id: 'siss-modalita-accesso',
      title: 'SISS - Modalita di accesso',
      area: 'auth',
      url: 'https://example.test/modalita-accesso',
      access: 'public',
      captureStrategy: 'snapshot-html',
      refreshHours: 24,
      tags: ['siss', 'auth', 'smartcard'],
    },
    {
      id: 'siss-manual-import',
      title: 'SISS - Documento riservato',
      area: 'prescription',
      url: 'https://example.test/manuale',
      access: 'manual-import',
      captureStrategy: 'manual-placeholder',
      refreshHours: 168,
      tags: ['siss', 'manual-import'],
      notes: 'Documento disponibile solo tramite acquisizione autorizzata.',
    },
  ];

  const now = new Date().toISOString();
  const next = new Date(Date.now() + 86_400_000).toISOString();
  const body = '<html><body><h1>Accesso SISS</h1><p>SSO centrale con smartcard e contesto funzionale operatore.</p></body></html>';
  const fetchedMetadata = {
    id: 'siss-modalita-accesso',
    title: 'SISS - Modalita di accesso',
    area: 'auth',
    status: 'fetched',
    access: 'public',
    captureStrategy: 'snapshot-html',
    refreshHours: 24,
    url: 'https://example.test/modalita-accesso',
    finalUrl: 'https://example.test/modalita-accesso',
    httpStatus: 200,
    contentType: 'text/html; charset=utf-8',
    extension: 'html',
    sha256: 'fixture',
    bytes: Buffer.byteLength(body, 'utf8'),
    tags: ['siss', 'auth', 'smartcard'],
    notes: null,
    fetchedAt: now,
    fingerprint: 'fixture',
    firstFetchedAt: now,
    lastSeenAt: now,
    lastChangedAt: now,
    changeState: 'new',
    nextSuggestedFetchAt: next,
    bodyPath: 'siss-modalita-accesso/body.html',
  };
  const placeholderMetadata = {
    id: 'siss-manual-import',
    title: 'SISS - Documento riservato',
    area: 'prescription',
    status: 'placeholder',
    access: 'manual-import',
    captureStrategy: 'manual-placeholder',
    refreshHours: 168,
    url: 'https://example.test/manuale',
    tags: ['siss', 'manual-import'],
    notes: 'Documento disponibile solo tramite acquisizione autorizzata.',
    fetchedAt: now,
    fingerprint: 'placeholder',
    firstFetchedAt: now,
    lastSeenAt: now,
    lastChangedAt: now,
    changeState: 'new',
    nextSuggestedFetchAt: next,
  };
  const index = {
    generatedAt: now,
    mode: 'sync',
    manifestPath: '../manifest.json',
    previousGeneratedAt: null,
    count: 2,
    summary: {
      total: 2,
      new: 2,
      updated: 0,
      unchanged: 0,
      placeholders: 1,
      errors: 0,
    },
    sources: [fetchedMetadata, placeholderMetadata],
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(path.join(corpusDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  await writeFile(path.join(corpusDir, 'siss-modalita-accesso/body.html'), body, 'utf8');
  await writeFile(
    path.join(corpusDir, 'siss-modalita-accesso/metadata.json'),
    `${JSON.stringify(fetchedMetadata, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(corpusDir, 'siss-manual-import/metadata.json'),
    `${JSON.stringify(placeholderMetadata, null, 2)}\n`,
    'utf8',
  );

  return { root, manifestPath, corpusDir };
}

function createClient(manifestPath, corpusDir) {
  const child = spawn(process.execPath, [SERVER_PATH, '--manifest', manifestPath, '--corpus-dir', corpusDir], {
    cwd: ROOT_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let stdout = '';
  let stderr = '';
  let nextId = 1;

  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
    let newlineIndex = stdout.indexOf('\n');
    while (newlineIndex >= 0) {
      const raw = stdout.slice(0, newlineIndex).trim();
      stdout = stdout.slice(newlineIndex + 1);
      newlineIndex = stdout.indexOf('\n');
      if (!raw) continue;
      const message = JSON.parse(raw);
      const callbacks = pending.get(message.id);
      if (!callbacks) continue;
      pending.delete(message.id);
      callbacks.resolve(message);
    }
  });

  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  child.on('exit', (code, signal) => {
    if (pending.size === 0) return;
    const error = new Error(`MCP smoke server exited early: code=${code} signal=${signal} stderr=${stderr}`);
    for (const callbacks of pending.values()) callbacks.reject(error);
    pending.clear();
  });

  function request(method, params = {}) {
    const id = nextId;
    nextId += 1;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}; stderr=${stderr}`));
      }, TIMEOUT_MS);
      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  return {
    request,
    close: () => {
      child.stdin.end();
      child.kill('SIGTERM');
    },
  };
}

async function main() {
  const fixture = await writeFixture();
  const client = createClient(fixture.manifestPath, fixture.corpusDir);
  try {
    const init = await client.request('initialize', { protocolVersion: '2024-11-05' });
    assert.equal(init.result.serverInfo.name, 'mediflow-siss-fse-corpus');

    const tools = await client.request('tools/list');
    assert.deepEqual(
      tools.result.tools.map((tool) => tool.name).sort(),
      ['siss_fse_fetch', 'siss_fse_list_sources', 'siss_fse_search', 'siss_fse_source'],
    );

    const listed = await client.request('tools/call', {
      name: 'siss_fse_list_sources',
      arguments: { includeMissing: true },
    });
    const listedPayload = JSON.parse(listed.result.content[0].text);
    assert.equal(listedPayload.count, 2);

    const search = await client.request('tools/call', {
      name: 'siss_fse_search',
      arguments: { query: 'smartcard', limit: 5 },
    });
    const searchPayload = JSON.parse(search.result.content[0].text);
    assert.equal(searchPayload.count, 1);
    assert.equal(searchPayload.matches[0].id, 'siss-modalita-accesso');

    const fetched = await client.request('tools/call', {
      name: 'siss_fse_fetch',
      arguments: { id: 'siss-modalita-accesso' },
    });
    const fetchedPayload = JSON.parse(fetched.result.content[0].text);
    assert.match(fetchedPayload.body, /SSO centrale/);

    const placeholder = await client.request('tools/call', {
      name: 'siss_fse_fetch',
      arguments: { id: 'siss-manual-import' },
    });
    const placeholderPayload = JSON.parse(placeholder.result.content[0].text);
    assert.equal(placeholderPayload.body, null);
    assert.match(placeholderPayload.warning, /Snapshot locale non disponibile/);

    const resources = await client.request('resources/list');
    assert.ok(resources.result.resources.some((resource) => resource.uri === 'siss-fse://sources'));
    assert.ok(resources.result.resources.some((resource) => resource.uri === 'siss-fse://body/siss-modalita-accesso'));

    const body = await client.request('resources/read', {
      uri: 'siss-fse://body/siss-modalita-accesso',
    });
    assert.match(body.result.contents[0].text, /contesto funzionale/);

    console.log('SISS/FSE corpus MCP smoke passed.');
  } finally {
    client.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
