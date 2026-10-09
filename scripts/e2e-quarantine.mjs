import { readFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { relative, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
export const manifestPath = resolve(root, 'e2e/quarantine.json');
export const sourcePath = file => relative(root, resolve(file)).replaceAll('\\', '/');

export function loadQuarantine(path = manifestPath) {
  const entries = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(entries)) throw new Error('E2E_QUARANTINE_INVALID: expected a list');
  const ids = new Set();
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id) || !entry.owner?.trim()
      || !/^https:\/\//u.test(entry.diagnosis ?? '')
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(entry.expiresAt ?? '')
      || !Number.isFinite(Date.parse(entry.expiresAt))
      || new Date(entry.expiresAt).toISOString() !== entry.expiresAt.replace('Z', '.000Z')
      || !Array.isArray(entry.tests) || !entry.tests.length) {
      throw new Error('E2E_QUARANTINE_INVALID: id, owner, diagnosis, expiry and tests are required');
    }
    ids.add(entry.id);
    for (const test of entry.tests) {
      if (!['playwright', 'node'].includes(test.runner) || !test.file || !test.title
        || !test.signature?.startsWith('^') || !test.signature.endsWith('$')
        || !Array.isArray(test.errors) || !test.errors.length || test.errors.some(error => !error.startsWith('^') || !error.endsWith('$'))) {
        throw new Error(`E2E_QUARANTINE_INVALID: ${entry.id} requires exact test identities and anchored error patterns`);
      }
      [test.signature, ...test.errors].forEach(error => new RegExp(error, 'u'));
    }
  }
  return entries;
}

// node:test wraps the actual failure in ERR_TEST_FAILURE. Keep every aggregate
// member: a known browser abort must not swallow a separate cleanup/assertion error.
export function errorMessages(error) {
  if (Array.isArray(error?.errors)) return error.errors.flatMap(errorMessages);
  if (error?.code === 'ERR_TEST_FAILURE' && error.cause) return errorMessages(error.cause);
  return [stripVTControlCharacters(String(error?.message ?? error))];
}

export function quarantineFor(result, entries, now = Date.now()) {
  if (!result.errors?.length) return null;
  return entries.find(entry => now < Date.parse(entry.expiresAt) && entry.tests.some(test =>
    test.runner === result.runner && test.file === result.file && test.title === result.title
    && result.errors.some(error => new RegExp(test.signature, 'u').test(stripVTControlCharacters(error)))
    && result.errors.every(error => test.errors.some(pattern => new RegExp(pattern, 'u').test(stripVTControlCharacters(error)))))) ?? null;
}

export function reportQuarantine(result, entry) {
  console.log(`[E2E QUARANTINED FAILURE] ${result.file} :: ${result.title}\n  ${entry.id}; owner=${entry.owner}; expires=${entry.expiresAt}; diagnosis=${entry.diagnosis}`);
}
