#!/usr/bin/env node
/* @Codex */

import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MANIFEST_PATH = path.resolve('scripts/siss-docs-corpus-sources.json');
const DEFAULT_CORPUS_DIR = path.resolve('tmp/siss-docs-corpus');
const SERVER_NAME = 'mediflow-siss-fse-corpus';
const SERVER_VERSION = '0.1.0';
const URI_PREFIX = 'siss-fse://';

function parseArgs(argv) {
  const options = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    corpusDir: DEFAULT_CORPUS_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--manifest') {
      options.manifestPath = path.resolve(argv[index + 1] || DEFAULT_MANIFEST_PATH);
      index += 1;
      continue;
    }
    if (token === '--corpus-dir') {
      options.corpusDir = path.resolve(argv[index + 1] || DEFAULT_CORPUS_DIR);
      index += 1;
      continue;
    }
    throw new Error(`Argomento non riconosciuto: ${token}`);
  }

  return options;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function readManifest(options) {
  const manifest = await readJson(options.manifestPath);
  if (!Array.isArray(manifest)) {
    throw new Error('Manifest non valido: atteso array JSON.');
  }
  return manifest;
}

async function readIndex(options) {
  try {
    return await readJson(path.join(options.corpusDir, 'index.json'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function toIndexMap(indexData) {
  const sources = Array.isArray(indexData?.sources) ? indexData.sources : [];
  return new Map(sources.map((source) => [source.id, source]));
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripHtml(value) {
  return normalizeWhitespace(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

function corpusUri(kind, id = null) {
  return `${URI_PREFIX}${kind}${id ? `/${encodeURIComponent(id)}` : ''}`;
}

function parseCorpusUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith(URI_PREFIX)) {
    throw new Error(`URI corpus non supportato: ${uri}`);
  }
  const rest = uri.slice(URI_PREFIX.length);
  const [kind, rawId] = rest.split('/');
  return {
    kind,
    id: rawId ? decodeURIComponent(rawId) : null,
  };
}

async function loadCorpus(options) {
  const manifest = await readManifest(options);
  const index = await readIndex(options);
  const sourceMap = toIndexMap(index);
  const sources = manifest.map((entry) => ({
    ...entry,
    metadata: sourceMap.get(entry.id) || null,
  }));

  return { manifest, index, sources };
}

async function readSourceBody(options, metadata) {
  if (!metadata?.bodyPath) return null;
  const bodyPath = path.resolve(options.corpusDir, metadata.bodyPath);
  const relative = path.relative(options.corpusDir, bodyPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`bodyPath fuori corpus: ${metadata.bodyPath}`);
  }
  return readFile(bodyPath, 'utf8');
}

function freshnessOf(metadata) {
  if (!metadata?.nextSuggestedFetchAt) return 'unknown';
  const next = new Date(metadata.nextSuggestedFetchAt);
  if (Number.isNaN(next.getTime())) return 'unknown';
  return next <= new Date() ? 'stale' : 'fresh';
}

function projectSource(entry, options = {}) {
  const metadata = entry.metadata;
  return {
    id: entry.id,
    title: entry.title,
    area: entry.area,
    access: entry.access,
    captureStrategy: entry.captureStrategy,
    tags: entry.tags,
    url: entry.url,
    notes: entry.notes || null,
    version: entry.version || metadata?.version || null,
    status: metadata?.status || 'missing',
    freshness: freshnessOf(metadata),
    changeState: metadata?.changeState || null,
    fetchedAt: metadata?.fetchedAt || null,
    lastSeenAt: metadata?.lastSeenAt || metadata?.fetchedAt || null,
    lastChangedAt: metadata?.lastChangedAt || null,
    nextSuggestedFetchAt: metadata?.nextSuggestedFetchAt || null,
    httpStatus: metadata?.httpStatus || null,
    finalUrl: metadata?.finalUrl || null,
    bodyAvailable: Boolean(metadata?.bodyPath),
    body: options.includeBody ? options.body : undefined,
  };
}

function textResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: typeof payload === 'string' ? payload : `${JSON.stringify(payload, null, 2)}\n`,
      },
    ],
  };
}

function listResources(corpus) {
  const resources = [
    {
      uri: corpusUri('sources'),
      name: 'SISS/FSE corpus sources',
      mimeType: 'application/json',
      description: 'Manifest delle fonti SISS/FSE approvate con stato locale.',
    },
  ];

  if (corpus.index) {
    resources.push({
      uri: corpusUri('index'),
      name: 'SISS/FSE corpus index',
      mimeType: 'application/json',
      description: 'Indice locale sincronizzato con freshness e change state.',
    });
  }

  for (const entry of corpus.sources) {
    resources.push({
      uri: corpusUri('source', entry.id),
      name: `Sorgente: ${entry.title}`,
      mimeType: 'application/json',
      description: `${entry.area} | ${entry.access} | ${entry.metadata?.status || 'missing'}`,
    });
    if (entry.metadata?.bodyPath) {
      resources.push({
        uri: corpusUri('body', entry.id),
        name: `Snapshot: ${entry.title}`,
        mimeType: entry.metadata.contentType || 'text/plain',
        description: `Snapshot locale gia acquisito per ${entry.id}`,
      });
    }
  }

  return resources;
}

async function readResource(options, corpus, uri) {
  const parsed = parseCorpusUri(uri);
  if (parsed.kind === 'sources') {
    const sources = corpus.sources.map((entry) => projectSource(entry));
    return {
      uri,
      mimeType: 'application/json',
      text: `${JSON.stringify({ count: sources.length, sources }, null, 2)}\n`,
    };
  }
  if (parsed.kind === 'index') {
    if (!corpus.index) throw new Error('index.json non presente: eseguire prima sync o fetch.');
    return {
      uri,
      mimeType: 'application/json',
      text: `${JSON.stringify(corpus.index, null, 2)}\n`,
    };
  }

  if (!parsed.id) throw new Error(`URI incompleto: ${uri}`);
  const entry = corpus.sources.find((candidate) => candidate.id === parsed.id);
  if (!entry) throw new Error(`Sorgente non trovata: ${parsed.id}`);

  if (parsed.kind === 'source') {
    return {
      uri,
      mimeType: 'application/json',
      text: `${JSON.stringify(projectSource(entry), null, 2)}\n`,
    };
  }
  if (parsed.kind === 'body') {
    const body = await readSourceBody(options, entry.metadata);
    if (body === null) throw new Error(`Snapshot non disponibile per ${entry.id}`);
    return {
      uri,
      mimeType: entry.metadata?.contentType || 'text/plain',
      text: body,
    };
  }

  throw new Error(`Risorsa non supportata: ${parsed.kind}`);
}

function filterSources(sources, args = {}) {
  return sources.filter((entry) => {
    if (args.area && entry.area !== args.area) return false;
    if (args.access && entry.access !== args.access) return false;
    if (args.freshness && freshnessOf(entry.metadata) !== args.freshness) return false;
    if (args.tag && !entry.tags.includes(args.tag)) return false;
    if (Array.isArray(args.tags) && !args.tags.every((tag) => entry.tags.includes(tag))) return false;
    if (!args.includeMissing && !entry.metadata) return false;
    return true;
  });
}

async function listSources(corpus, args = {}) {
  if (!corpus.index && !args.includeMissing) {
    throw new Error('index.json non presente: eseguire prima sync o fetch, oppure usare includeMissing=true.');
  }
  const sources = filterSources(corpus.sources, args).map((entry) => projectSource(entry));
  return textResult({ count: sources.length, sources });
}

function scoreFields(needle, fields) {
  let score = 0;
  const matchedFields = [];
  for (const [name, value] of Object.entries(fields)) {
    const normalized = String(value || '').toLowerCase();
    const count = normalized.split(needle).length - 1;
    if (count > 0) {
      matchedFields.push(name);
      score += name === 'body' ? count : count * 3;
    }
  }
  return { score, matchedFields };
}

function makeSnippet(text, query) {
  const clean = stripHtml(text);
  const lower = clean.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) return clean.slice(0, 220);
  const start = Math.max(0, index - 90);
  const end = Math.min(clean.length, index + query.length + 130);
  return clean.slice(start, end);
}

async function searchCorpus(options, corpus, args = {}) {
  if (!corpus.index) throw new Error('index.json non presente: eseguire prima sync o fetch.');
  const query = normalizeWhitespace(args.query);
  if (!query) throw new Error('Parametro obbligatorio mancante: query');
  const needle = query.toLowerCase();
  const limit = Math.max(1, Math.min(Number(args.limit) || 10, 50));
  const matches = [];

  for (const entry of filterSources(corpus.sources, { ...args, includeMissing: true })) {
    const body = await readSourceBody(options, entry.metadata);
    const fields = {
      title: entry.title,
      area: entry.area,
      access: entry.access,
      tags: entry.tags.join(' '),
      notes: entry.notes || '',
      body: body ? stripHtml(body) : '',
    };
    const { score, matchedFields } = scoreFields(needle, fields);
    if (score === 0) continue;
    matches.push({
      ...projectSource(entry),
      score,
      matchedFields,
      snippet: body ? makeSnippet(body, query) : normalizeWhitespace(entry.notes || entry.title),
    });
  }

  matches.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return textResult({ query, count: matches.length, matches: matches.slice(0, limit) });
}

async function fetchSource(options, corpus, args = {}) {
  if (!corpus.index) throw new Error('index.json non presente: eseguire prima sync o fetch.');
  if (!args.id || typeof args.id !== 'string') {
    throw new Error('Parametro obbligatorio mancante: id');
  }
  const entry = corpus.sources.find((candidate) => candidate.id === args.id);
  if (!entry) throw new Error(`Sorgente non trovata: ${args.id}`);
  const body = await readSourceBody(options, entry.metadata);
  if (body === null) {
    return textResult({
      ...projectSource(entry),
      body: null,
      warning: 'Snapshot locale non disponibile: fonte mancante, auth-gated o manual-import.',
    });
  }
  return textResult(projectSource(entry, { includeBody: true, body }));
}

async function sourceMetadata(corpus, args = {}) {
  if (!args.id || typeof args.id !== 'string') {
    throw new Error('Parametro obbligatorio mancante: id');
  }
  const entry = corpus.sources.find((candidate) => candidate.id === args.id);
  if (!entry) throw new Error(`Sorgente non trovata: ${args.id}`);
  return textResult(projectSource(entry));
}

function tools() {
  return [
    {
      name: 'siss_fse_search',
      description: 'Cerca nel manifest e negli snapshot locali del corpus SISS/FSE senza fetch live.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          area: { type: 'string' },
          access: { type: 'string', enum: ['public', 'auth-gated', 'manual-import'] },
          freshness: { type: 'string', enum: ['fresh', 'stale', 'unknown'] },
          tag: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          limit: { type: 'number' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'siss_fse_fetch',
      description: 'Restituisce il body locale gia acquisito di una fonte, se disponibile.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      name: 'siss_fse_source',
      description: 'Restituisce metadata, freshness e stato locale di una fonte SISS/FSE.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      name: 'siss_fse_list_sources',
      description: 'Elenca le fonti SISS/FSE filtrabili per area, accesso, tag e freshness.',
      inputSchema: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          access: { type: 'string', enum: ['public', 'auth-gated', 'manual-import'] },
          freshness: { type: 'string', enum: ['fresh', 'stale', 'unknown'] },
          tag: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          includeMissing: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  ];
}

async function callTool(options, corpus, name, args = {}) {
  if (name === 'siss_fse_search') return searchCorpus(options, corpus, args);
  if (name === 'siss_fse_fetch') return fetchSource(options, corpus, args);
  if (name === 'siss_fse_source') return sourceMetadata(corpus, args);
  if (name === 'siss_fse_list_sources') return listSources(corpus, args);
  throw new Error(`Tool non supportato: ${name}`);
}

async function handleRequest(options, request) {
  const params = request.params || {};

  if (request.method === 'initialize') {
    return {
      protocolVersion: params.protocolVersion || '2024-11-05',
      capabilities: { resources: {}, tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }

  if (request.method === 'ping') return {};

  const corpus = await loadCorpus(options);

  if (request.method === 'resources/list') return { resources: listResources(corpus) };

  if (request.method === 'resources/read') {
    const content = await readResource(options, corpus, params.uri);
    return { contents: [content] };
  }

  if (request.method === 'tools/list') return { tools: tools() };

  if (request.method === 'tools/call') {
    return callTool(options, corpus, params.name, params.arguments || {});
  }

  throw new Error(`Metodo non supportato: ${request.method}`);
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendError(id, error) {
  send({
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

  for await (const line of input) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch (error) {
      sendError(null, error);
      continue;
    }

    if (!request.id && String(request.method || '').startsWith('notifications/')) continue;

    try {
      const result = await handleRequest(options, request);
      send({ jsonrpc: '2.0', id: request.id ?? null, result });
    } catch (error) {
      sendError(request.id, error);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
