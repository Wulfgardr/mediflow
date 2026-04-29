#!/usr/bin/env node
/* @Codex */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MANIFEST_PATH = path.resolve('scripts/siss-docs-corpus-sources.json');
const DEFAULT_OUTPUT_DIR = path.resolve('tmp/siss-docs-corpus');
const ALLOWED_ACCESS = new Set(['public', 'auth-gated', 'manual-import']);
const ALLOWED_CAPTURE_STRATEGIES = new Set([
  'snapshot-html',
  'snapshot-github-html',
  'manual-placeholder',
]);
const DEFAULT_REFRESH_HOURS = 24;

function usage() {
  console.error(
    [
      'Usage:',
      '  node scripts/siss-docs-corpus.mjs validate [--manifest <path>]',
      '  node scripts/siss-docs-corpus.mjs fetch [--manifest <path>] [--output-dir <dir>] [--only <id1,id2>] [--dry-run]',
      '  node scripts/siss-docs-corpus.mjs sync [--manifest <path>] [--output-dir <dir>] [--only <id1,id2>] [--dry-run]',
      '  node scripts/siss-docs-corpus.mjs report [--manifest <path>] [--output-dir <dir>]',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    dryRun: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    manifestPath: DEFAULT_MANIFEST_PATH,
    only: null,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (token === '--output-dir') {
      options.outputDir = path.resolve(rest[index + 1] || DEFAULT_OUTPUT_DIR);
      index += 1;
      continue;
    }
    if (token === '--manifest') {
      options.manifestPath = path.resolve(rest[index + 1] || DEFAULT_MANIFEST_PATH);
      index += 1;
      continue;
    }
    if (token === '--only') {
      const raw = rest[index + 1] || '';
      options.only = new Set(raw.split(',').map((item) => item.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    throw new Error(`Argomento non riconosciuto: ${token}`);
  }

  return options;
}

async function readManifest(manifestPath) {
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  return validateManifest(manifest);
}

function validateManifest(manifest) {
  if (!Array.isArray(manifest)) {
    throw new Error('Il manifest deve essere un array JSON.');
  }

  const seenIds = new Set();

  for (const entry of manifest) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Ogni sorgente deve essere un oggetto.');
    }
    for (const field of ['id', 'title', 'area', 'url', 'access', 'captureStrategy']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`Campo obbligatorio mancante o non valido: ${field}`);
      }
    }
    if (seenIds.has(entry.id)) {
      throw new Error(`ID duplicato nel manifest: ${entry.id}`);
    }
    seenIds.add(entry.id);

    if (!ALLOWED_ACCESS.has(entry.access)) {
      throw new Error(`Access non supportato per ${entry.id}: ${entry.access}`);
    }
    if (!ALLOWED_CAPTURE_STRATEGIES.has(entry.captureStrategy)) {
      throw new Error(`Capture strategy non supportata per ${entry.id}: ${entry.captureStrategy}`);
    }
    if (!Array.isArray(entry.tags)) {
      throw new Error(`tags deve essere un array per ${entry.id}`);
    }
    if (entry.refreshHours !== undefined) {
      if (!Number.isFinite(entry.refreshHours) || entry.refreshHours <= 0) {
        throw new Error(`refreshHours deve essere un numero positivo per ${entry.id}`);
      }
    }
    try {
      const url = new URL(entry.url);
      if (url.protocol !== 'https:') {
        throw new Error(`Protocollo non supportato per ${entry.id}: ${url.protocol}`);
      }
    } catch (error) {
      throw new Error(`URL non valido per ${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (entry.access !== 'public' && entry.captureStrategy !== 'manual-placeholder') {
      throw new Error(`Le sorgenti non pubbliche devono usare manual-placeholder: ${entry.id}`);
    }
  }

  return manifest;
}

function selectEntries(manifest, only) {
  if (!only || only.size === 0) return manifest;
  return manifest.filter((entry) => only.has(entry.id));
}

function sanitizeExtension(contentType) {
  if (contentType.includes('application/json')) return 'json';
  if (contentType.includes('text/markdown') || contentType.includes('text/plain')) return 'txt';
  return 'html';
}

function normalizeHtmlForFingerprint(body) {
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function computeFingerprintPayload(entryResult) {
  if (entryResult.status === 'placeholder') {
    return JSON.stringify({
      access: entryResult.access,
      captureStrategy: entryResult.captureStrategy,
      notes: entryResult.notes,
      url: entryResult.url,
    });
  }

  if (entryResult.extension === 'html' && typeof entryResult.body === 'string') {
    return normalizeHtmlForFingerprint(entryResult.body);
  }

  return entryResult.body || '';
}

function addHours(isoString, hours) {
  const date = new Date(isoString);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

async function readIndex(outputDir) {
  try {
    const raw = await readFile(path.join(outputDir, 'index.json'), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function toPreviousMap(indexData) {
  const sources = Array.isArray(indexData?.sources) ? indexData.sources : [];
  return new Map(sources.map((source) => [source.id, source]));
}

async function fetchEntry(entry) {
  if (entry.access !== 'public' || entry.captureStrategy === 'manual-placeholder') {
    return {
      id: entry.id,
      title: entry.title,
      area: entry.area,
      status: 'placeholder',
      access: entry.access,
      captureStrategy: entry.captureStrategy,
      refreshHours: entry.refreshHours ?? DEFAULT_REFRESH_HOURS,
      url: entry.url,
      tags: entry.tags,
      notes: entry.notes || null,
      fetchedAt: new Date().toISOString(),
    };
  }

  const response = await fetch(entry.url, {
    headers: {
      'user-agent': 'MediFlow-SissCorpusFetcher/1.0',
      accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.8',
    },
    redirect: 'follow',
  });

  const body = await response.text();
  const contentType = (response.headers.get('content-type') || 'text/html').toLowerCase();
  const sha256 = createHash('sha256').update(body).digest('hex');

  return {
    id: entry.id,
    title: entry.title,
    area: entry.area,
    status: response.ok ? 'fetched' : 'http-error',
    access: entry.access,
    captureStrategy: entry.captureStrategy,
    refreshHours: entry.refreshHours ?? DEFAULT_REFRESH_HOURS,
    url: entry.url,
    finalUrl: response.url,
    httpStatus: response.status,
    contentType,
    extension: sanitizeExtension(contentType),
    sha256,
    bytes: Buffer.byteLength(body, 'utf8'),
    body,
    tags: entry.tags,
    notes: entry.notes || null,
    fetchedAt: new Date().toISOString(),
  };
}

function buildSyncedMetadata(entryResult, previousMetadata) {
  const now = entryResult.fetchedAt;
  const wasExisting = Boolean(previousMetadata);
  const fingerprint = createHash('sha256')
    .update(computeFingerprintPayload(entryResult))
    .digest('hex');
  const previousFingerprint = previousMetadata?.fingerprint || previousMetadata?.sha256 || null;

  let changeState = 'new';
  if (wasExisting && previousFingerprint === fingerprint) {
    changeState = 'unchanged';
  } else if (wasExisting) {
    changeState = 'updated';
  }

  return {
    ...entryResult,
    fingerprint,
    firstFetchedAt: previousMetadata?.firstFetchedAt || now,
    lastSeenAt: now,
    lastChangedAt: changeState === 'unchanged'
      ? previousMetadata?.lastChangedAt || previousMetadata?.firstFetchedAt || now
      : now,
    previousFingerprint,
    changeState,
    nextSuggestedFetchAt: addHours(now, entryResult.refreshHours ?? DEFAULT_REFRESH_HOURS),
  };
}

async function writeEntry(outputDir, entryResult) {
  const entryDir = path.join(outputDir, entryResult.id);
  await mkdir(entryDir, { recursive: true });

  const metadata = { ...entryResult };
  delete metadata.body;

  if (entryResult.body !== undefined) {
    const bodyPath = path.join(entryDir, `body.${entryResult.extension}`);
    await writeFile(bodyPath, entryResult.body, 'utf8');
    metadata.bodyPath = path.relative(outputDir, bodyPath);
  }

  const metadataPath = path.join(entryDir, 'metadata.json');
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadata;
}

function summarizeSyncResults(results) {
  return results.reduce((summary, result) => {
    summary.total += 1;
    if (result.status === 'placeholder') summary.placeholders += 1;
    if (result.changeState === 'new') summary.new += 1;
    if (result.changeState === 'updated') summary.updated += 1;
    if (result.changeState === 'unchanged') summary.unchanged += 1;
    if (result.status === 'http-error') summary.errors += 1;
    return summary;
  }, {
    total: 0,
    new: 0,
    updated: 0,
    unchanged: 0,
    placeholders: 0,
    errors: 0,
  });
}

async function writeIndex(outputDir, manifestPath, results, previousIndex, mode) {
  const indexPath = path.join(outputDir, 'index.json');
  const summary = summarizeSyncResults(results);
  await writeFile(
    indexPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode,
        manifestPath: path.relative(outputDir, manifestPath),
        previousGeneratedAt: previousIndex?.generatedAt || null,
        count: results.length,
        summary,
        sources: results,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return summary;
}

async function runValidate(options) {
  const manifest = await readManifest(options.manifestPath);
  console.log(`Manifest valido: ${manifest.length} sorgenti.`);
}

async function runFetch(options) {
  const manifest = selectEntries(await readManifest(options.manifestPath), options.only);
  if (manifest.length === 0) {
    throw new Error('Nessuna sorgente selezionata.');
  }

  if (options.dryRun) {
    for (const entry of manifest) {
      console.log(`${entry.id}\t${entry.access}\t${entry.captureStrategy}\t${entry.url}`);
    }
    console.log(`Dry-run: ${manifest.length} sorgenti selezionate.`);
    return;
  }

  await mkdir(options.outputDir, { recursive: true });
  const results = [];

  for (const entry of manifest) {
    const result = await fetchEntry(entry);
    const metadata = await writeEntry(options.outputDir, result);
    results.push(metadata);
    console.log(`${entry.id}: ${metadata.status}`);
  }

  await writeIndex(options.outputDir, options.manifestPath, results, null, 'fetch');

  console.log(`Corpus scritto in ${options.outputDir}`);
}

async function runSync(options) {
  const manifest = selectEntries(await readManifest(options.manifestPath), options.only);
  if (manifest.length === 0) {
    throw new Error('Nessuna sorgente selezionata.');
  }

  if (options.dryRun) {
    for (const entry of manifest) {
      console.log(
        `${entry.id}\t${entry.access}\t${entry.captureStrategy}\trefresh=${entry.refreshHours ?? DEFAULT_REFRESH_HOURS}h\t${entry.url}`,
      );
    }
    console.log(`Dry-run sync: ${manifest.length} sorgenti selezionate.`);
    return;
  }

  await mkdir(options.outputDir, { recursive: true });
  const previousIndex = await readIndex(options.outputDir);
  const previousMap = toPreviousMap(previousIndex);
  const results = [];

  for (const entry of manifest) {
    const result = await fetchEntry(entry);
    const synced = buildSyncedMetadata(result, previousMap.get(entry.id));
    const metadata = await writeEntry(options.outputDir, synced);
    results.push(metadata);
    console.log(`${entry.id}: ${metadata.status} (${metadata.changeState})`);
  }

  const summary = await writeIndex(options.outputDir, options.manifestPath, results, previousIndex, 'sync');
  console.log(
    `Sync completata in ${options.outputDir} | new=${summary.new} updated=${summary.updated} unchanged=${summary.unchanged} placeholders=${summary.placeholders} errors=${summary.errors}`,
  );
}

function computeFreshness(metadata, now) {
  const nextFetch = metadata.nextSuggestedFetchAt ? new Date(metadata.nextSuggestedFetchAt) : null;
  if (!nextFetch || Number.isNaN(nextFetch.getTime())) return 'unknown';
  return nextFetch <= now ? 'stale' : 'fresh';
}

async function runReport(options) {
  const manifest = await readManifest(options.manifestPath);
  const selected = selectEntries(manifest, options.only);
  const indexData = await readIndex(options.outputDir);
  if (!indexData) {
    throw new Error(`Nessun index.json trovato in ${options.outputDir}. Esegui prima sync o fetch.`);
  }

  const sourceMap = toPreviousMap(indexData);
  const now = new Date();
  let fresh = 0;
  let stale = 0;
  let placeholders = 0;

  for (const entry of selected) {
    const metadata = sourceMap.get(entry.id);
    if (!metadata) {
      console.log(`${entry.id}: missing`);
      continue;
    }
    const freshness = computeFreshness(metadata, now);
    if (freshness === 'fresh') fresh += 1;
    if (freshness === 'stale') stale += 1;
    if (metadata.status === 'placeholder') placeholders += 1;
    console.log(
      `${entry.id}: status=${metadata.status} change=${metadata.changeState || 'n/a'} freshness=${freshness} lastSeen=${metadata.lastSeenAt || metadata.fetchedAt || 'n/a'} lastChanged=${metadata.lastChangedAt || 'n/a'}`,
    );
  }

  console.log(`Report: fresh=${fresh} stale=${stale} placeholders=${placeholders} selected=${selected.length}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.command) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (options.command === 'validate') {
    await runValidate(options);
    return;
  }

  if (options.command === 'fetch') {
    await runFetch(options);
    return;
  }

  if (options.command === 'sync') {
    await runSync(options);
    return;
  }

  if (options.command === 'report') {
    await runReport(options);
    return;
  }

  throw new Error(`Comando non supportato: ${options.command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
