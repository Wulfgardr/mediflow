#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_VOICE_MAX_BINARY_BYTES,
  pinnedLocalVoiceEntry,
  readRegularBinaryBytes,
  sha256Buffer,
  sha256Matches,
  verifyLocalVoiceBinary,
} from './local-voice-service.mjs';

const REPOSITORY = 'Wulfgardr/mediflow';
const DEFAULT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function packageVersion(root) {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return undefined;
  try { return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version; }
  catch { return undefined; }
}

function validateDownloadUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); }
  catch { throw new Error(`Indirizzo non valido: ${rawUrl}`); }
  const isLoopback = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  if (parsed.protocol !== 'https:' && !isLoopback) {
    throw new Error('Lo scaricamento del programma della voce richiede HTTPS (oppure loopback locale per i test).');
  }
  return parsed.href;
}

async function downloadBytesFromUrl(url) {
  const validated = validateDownloadUrl(url);
  const response = await fetch(validated, { signal: AbortSignal.timeout(120_000), redirect: 'follow' });
  if (!response.ok) throw new Error(`Scaricamento non riuscito (HTTP ${response.status}).`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > LOCAL_VOICE_MAX_BINARY_BYTES) throw new Error('File scaricato oltre la dimensione ammessa.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > LOCAL_VOICE_MAX_BINARY_BYTES) throw new Error('Dimensione del file scaricato non valida.');
  return bytes;
}

function downloadBytesFromCi(entry) {
  if (!Number.isInteger(entry.runId) || entry.runId <= 0 || typeof entry.artifact !== 'string' || !entry.artifact) {
    throw new Error('Nessuna corsa CI fissata nel manifest per questo binario.');
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-voice-ci-'));
  try {
    execFileSync('gh', ['run', 'download', String(entry.runId), '--repo', REPOSITORY, '--name', entry.artifact, '--dir', scratch], { stdio: 'inherit' });
    const downloaded = path.join(scratch, 'mediflow-voice');
    const read = readRegularBinaryBytes(downloaded);
    if (!read.ok) throw new Error('Artefatto CI privo del file mediflow-voice.');
    return read.bytes;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export async function installLocalVoiceBinary({
  root = DEFAULT_ROOT,
  url,
  file,
  fromCi = false,
  platform = process.platform,
  arch = process.arch,
  version = packageVersion(root),
} = {}) {
  const pinned = pinnedLocalVoiceEntry(root, { platform, arch, version });
  if (!pinned.ok) throw new Error(`Manifest della voce non valido o piattaforma non supportata (${pinned.reason}).`);
  const { manifest, entry } = pinned;
  const target = path.join(root, manifest.relativePath);
  const existing = verifyLocalVoiceBinary(target, { expectedSha256: entry.sha256, expectedBytes: entry.bytes, platform, arch });
  if (existing.ok) return { status: 'already-installed', path: target, sha256: existing.sha256, bytes: existing.bytes.length };

  let bytes;
  if (file) {
    const read = readRegularBinaryBytes(path.resolve(file));
    if (!read.ok) throw new Error(`File locale non leggibile (${read.reason}).`);
    bytes = read.bytes;
  } else if (fromCi) {
    bytes = downloadBytesFromCi(entry);
  } else {
    const sourceUrl = url || process.env.MEDIFLOW_LOCAL_VOICE_DOWNLOAD_URL
      || `https://github.com/${REPOSITORY}/releases/download/v${manifest.version}/${entry.asset}`;
    bytes = await downloadBytesFromUrl(sourceUrl);
  }

  const actualSha256 = sha256Buffer(bytes);
  if (!sha256Matches(actualSha256, entry.sha256) || (entry.bytes !== undefined && bytes.length !== entry.bytes)) {
    throw new Error(`Impronta SHA-256 non corrispondente: atteso ${entry.sha256}, ricevuto ${actualSha256}.`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o755 });
    fs.chmodSync(temp, 0o755);
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  return { status: 'installed', path: target, sha256: actualSha256, bytes: bytes.length };
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--root') options.root = path.resolve(argv[++index] || '');
    else if (arg === '--url') options.url = argv[++index];
    else if (arg === '--file') options.file = argv[++index];
    else if (arg === '--from-ci') options.fromCi = true;
    else throw new Error(`Argomento non riconosciuto: ${arg}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await installLocalVoiceBinary(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
