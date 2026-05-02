#!/usr/bin/env node
// @Codex
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, 'docs/apple-wide-qa-manifest.json');
const allowedStatuses = new Set(['covered', 'gap', 'blocked']);
const allowedEvidenceTypes = new Set(['command', 'runbook', 'adr', 'issue', 'pr', 'manual']);
const requiredCapabilities = [
  'macos-packaged-home-base-runtime',
  'shared-apple-core-contracts',
  'mobile-paired-bootstrap-read',
  'paired-profile-write',
  'paired-diary-write',
  'paired-therapy-write',
  'paired-checkup-write',
  'paired-observation-write',
  'mobile-core-crud-ui',
  'mobile-offline-cache-reconciliation',
  'apple-wide-click-map'
];

function fail(message) {
  console.error(`check:apple-wide-qa failed: ${message}`);
  process.exitCode = 1;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function pathExists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
const ids = new Set();

if (manifest.issue !== 'WUL-194') {
  fail('manifest.issue must be WUL-194.');
}

for (const requiredId of requiredCapabilities) {
  if (!capabilities.some((capability) => capability.id === requiredId)) {
    fail(`missing required capability ${requiredId}.`);
  }
}

for (const capability of capabilities) {
  if (!isNonEmptyString(capability.id)) fail('capability id is required.');
  if (ids.has(capability.id)) fail(`duplicate capability id ${capability.id}.`);
  ids.add(capability.id);

  if (!isNonEmptyString(capability.title)) fail(`${capability.id}: title is required.`);
  if (!Array.isArray(capability.surfaces) || capability.surfaces.length === 0) {
    fail(`${capability.id}: at least one surface is required.`);
  }
  if (!allowedStatuses.has(capability.status)) {
    fail(`${capability.id}: invalid status ${capability.status}.`);
  }
  if (!isNonEmptyString(capability.acceptance)) {
    fail(`${capability.id}: acceptance is required.`);
  }
  if (!Array.isArray(capability.evidence) || capability.evidence.length === 0) {
    fail(`${capability.id}: evidence is required.`);
  }

  if (capability.status === 'covered') {
    const hasRepeatableEvidence = capability.evidence.some((item) => item.type === 'command' || item.type === 'runbook');
    if (!hasRepeatableEvidence) {
      fail(`${capability.id}: covered capability requires command or runbook evidence.`);
    }
  }

  if ((capability.status === 'gap' || capability.status === 'blocked') && !isNonEmptyString(capability.gapIssue)) {
    fail(`${capability.id}: ${capability.status} capability requires gapIssue.`);
  }

  for (const item of capability.evidence) {
    if (!allowedEvidenceTypes.has(item.type)) {
      fail(`${capability.id}: invalid evidence type ${item.type}.`);
    }
    if (!isNonEmptyString(item.value)) {
      fail(`${capability.id}: evidence value is required.`);
    }
    if ((item.type === 'runbook' || item.type === 'adr') && !pathExists(item.value)) {
      fail(`${capability.id}: evidence path does not exist: ${item.value}.`);
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`check:apple-wide-qa passed (${capabilities.length} capabilities).`);
