#!/usr/bin/env node
// @Codex: WUL-557 Mini parity schema and canonical-source drift gate.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const KNOWN_COMMANDS = new Map([
  [1, ['patient search', 'patient show']],
  [4, ['draft preview']],
  [11, ['open-loops']],
  [39, ['whoami']],
  [63, ['capabilities']],
]);

function typeMatches(value, expected) {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'null') return value === null;
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === expected;
}

export function validateJsonSchema(value, schema, at = '$') {
  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => typeMatches(value, type))) return [`${at}: expected ${types.join('|')}`];
  if ('const' in schema && value !== schema.const) errors.push(`${at}: expected const ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: unexpected enum value ${value}`);
  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) errors.push(`${at}: string too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: pattern mismatch`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) errors.push(`${at}: too few items`);
    if (schema.uniqueItems && new Set(value.map(JSON.stringify)).size !== value.length) errors.push(`${at}: duplicate items`);
    if (schema.items) value.forEach((item, index) => errors.push(...validateJsonSchema(item, schema.items, `${at}[${index}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) errors.push(`${at}: missing ${required}`);
    if (schema.additionalProperties === false) {
      for (const key of keys) if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push(`${at}: unexpected ${key}`);
    }
    for (const key of keys) if (schema.properties?.[key]) errors.push(...validateJsonSchema(value[key], schema.properties[key], `${at}.${key}`));
  }
  return errors;
}

export function validateMiniParity(manifest, schema, source) {
  const errors = validateJsonSchema(manifest, schema);
  const rows = source.rows ?? [];
  const capabilities = manifest.capabilities ?? [];
  if (manifest.source?.path !== 'docs/apple-parity-matrix.json') errors.push('source: unexpected path');
  if (manifest.source?.version !== source.version) errors.push('source: version drift');
  if (manifest.source?.updated !== source.updated) errors.push('source: updated drift');
  if (manifest.source?.totalRows !== rows.length || capabilities.length !== rows.length) errors.push('source: row count drift');

  const ids = new Set();
  const sourceRows = new Set();
  capabilities.forEach((capability, index) => {
    const rowNumber = index + 1;
    const row = rows[index];
    if (ids.has(capability.webCapabilityId)) errors.push(`row ${rowNumber}: duplicate id`);
    if (sourceRows.has(capability.sourceRow)) errors.push(`row ${rowNumber}: duplicate sourceRow`);
    ids.add(capability.webCapabilityId);
    sourceRows.add(capability.sourceRow);
    if (capability.sourceRow !== rowNumber) errors.push(`row ${rowNumber}: sourceRow drift`);
    if (row && (capability.area !== row.area || capability.webCapability !== row.feature || capability.webDisposition !== row.gap)) {
      errors.push(`row ${rowNumber}: canonical binding drift`);
    }

    const commands = KNOWN_COMMANDS.get(rowNumber) ?? [];
    if (JSON.stringify(capability.miniCommands) !== JSON.stringify(commands)) errors.push(`row ${rowNumber}: command drift`);
    const expectedDisposition = rowNumber === 4 ? 'proposal_only' : commands.length ? 'available' : 'manual_only';
    if (capability.miniDisposition !== expectedDisposition) errors.push(`row ${rowNumber}: disposition drift`);
    const expectedReason = expectedDisposition === 'available' ? null
      : expectedDisposition === 'proposal_only' ? 'SYNTHETIC_PREVIEW_ONLY'
        : row?.gap === 'host-only' ? 'HOST_AUTHORITY_ONLY' : 'NOT_IN_MINI_PILOT';
    if (capability.reason !== expectedReason) errors.push(`row ${rowNumber}: reason drift`);
  });

  const available = capabilities.filter(({ miniDisposition }) => miniDisposition === 'available').length;
  const percent = Number(((available / Math.max(capabilities.length, 1)) * 100).toFixed(6));
  if (manifest.metric?.availableRows !== available || manifest.metric?.totalRows !== capabilities.length || manifest.metric?.parityPercent !== percent) {
    errors.push('metric: recomputation drift');
  }
  return errors;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function main() {
  const manifest = readJson('packages/mini/contracts/mini-parity.json');
  const schema = readJson('packages/mini/contracts/mini-parity.schema.json');
  const errors = validateMiniParity(manifest, schema, readJson('docs/apple-parity-matrix.json'));
  if (errors.length) throw new Error(`Mini parity drift:\n${errors.join('\n')}`);
  console.log(`Mini parity manifest OK: ${manifest.metric.availableRows}/${manifest.metric.totalRows} (${manifest.metric.parityPercent.toFixed(6)}%).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
