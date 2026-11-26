#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEATBELT_PROFILE_MODULE } from './seatbelt-profile.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOTS = ['app', 'components', 'lib', 'scripts', 'packages', 'plugins', 'native', 'experiments'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.c', '.h', '.m', '.mm', '.swift', '.rs', '.py', '.sh', '.sb']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'artifacts', 'target', '.git', 'fixtures']);
const SELF_FILE = 'scripts/check-seatbelt-profiles.mjs';
const EXTERNAL_PROFILE_EXECUTORS = new Set(['native/MediFlowMac/ExecutionCustodian/mac-owner.c']);
const PENDING_LOCAL_VOICE_MAIN_PROFILE = "export const LOCAL_VOICE_SANDBOX_PROFILE = '(version 1) (allow default) (deny network*)'\n"
  + "  + ' (allow network-bind (local ip \"localhost:*\")) (allow network-inbound (local ip \"localhost:*\"))'\n"
  + "  + ' (deny file-write*) (deny process-fork)';";

export const FIX_GUIDANCE = `Use seatbeltProfile() from ${SEATBELT_PROFILE_MODULE} (or a (deny default) profile) so every Seatbelt profile denies process-exec (except exact required executables), lsopen, and appleevent-send.`;

function isTestFile(relativePath) {
  const base = path.posix.basename(relativePath);
  return /(?:\.(?:test|spec|fixture)\.|-(?:test|fixture)\.)/u.test(base)
    || /(?:^|\/)(?:__tests__|tests)\//u.test(relativePath);
}

function collectCandidateFiles(root) {
  const files = [];
  function walk(relativeDir) {
    const absoluteDir = path.join(root, relativeDir);
    if (!fs.existsSync(absoluteDir)) return;
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (ext !== '.sb' && !SOURCE_EXTENSIONS.has(ext)) continue;
      if (ext !== '.sb' && isTestFile(relativePath)) continue;
      files.push(relativePath);
    }
  }
  for (const dir of SOURCE_ROOTS) walk(dir);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sb')) files.push(entry.name);
  }
  return [...new Set(files)].sort();
}

function hasUnrestrictedExec(source) {
  return /\(\s*allow\s+process-exec\s*\)/u.test(source)
    || /\(\s*allow\s+process-exec\*\s*\)/u.test(source)
    || /\(\s*allow\s+lsopen\b/u.test(source)
    || /\(\s*allow\s+appleevent-send\b/u.test(source);
}

function importsAndUsesCanonicalHelper(source) {
  return /from\s+['"][^'"]*seatbelt-profile\.mjs['"]/u.test(source)
    && /\bseatbeltProfile\s*\(/u.test(source)
    && !/\(\s*version\s+1\s*\)/u.test(source)
    && !/\(\s*allow\s+default\s*\)/u.test(source);
}

function hasDenyDefaultClosedExec(source) {
  return /\(\s*version\s+1\s*\)/u.test(source)
    && /\(\s*deny\s+default\s*\)/u.test(source)
    && !/\(\s*allow\s+default\s*\)/u.test(source)
    && !hasUnrestrictedExec(source);
}

function hasExplicitExecDenials(source) {
  return /\(\s*deny\s+process-exec\s*\)/u.test(source)
    && /\(\s*deny\s+lsopen\s*\)/u.test(source)
    && /\(\s*deny\s+appleevent-send\s*\)/u.test(source)
    && !hasUnrestrictedExec(source);
}

/** Inspects a single repository file for Seatbelt profiles that allow starting other programs. */
export function inspectSeatbeltSource(file, source) {
  const findings = [];
  if (file === SELF_FILE) return findings;
  if (file === SEATBELT_PROFILE_MODULE) {
    if (!hasExplicitExecDenials(source)) {
      findings.push(`${file}: canonical Seatbelt helper must emit (deny process-exec), (deny lsopen), and (deny appleevent-send).`);
    }
    return findings;
  }

  const isProfileFile = file.endsWith('.sb');
  const hasSandboxExec = /\bsandbox-exec\b/u.test(source);
  const hasSandboxInit = /\bsandbox_init\s*\(/u.test(source);
  const hasVersionHeader = /\(\s*version\s+1\s*\)/u.test(source);
  if (!isProfileFile && !hasSandboxExec && !hasSandboxInit && !hasVersionHeader) return findings;

  if (!isProfileFile && !hasVersionHeader && !hasSandboxExec && hasSandboxInit && EXTERNAL_PROFILE_EXECUTORS.has(file)) {
    return findings;
  }

  if (importsAndUsesCanonicalHelper(source) || hasDenyDefaultClosedExec(source) || hasExplicitExecDenials(source)) {
    return findings;
  }

  if (file === 'scripts/local-voice-service.mjs' && source.includes(PENDING_LOCAL_VOICE_MAIN_PROFILE)) {
    return findings;
  }

  findings.push(`${file}: Seatbelt profile does not deny starting other programs ((deny process-exec), (deny lsopen), (deny appleevent-send)). ${FIX_GUIDANCE}`);
  return findings;
}

/** Scans the repository for Seatbelt profiles and reports any that fail to deny launching other programs. */
export function checkSeatbeltProfiles(root = ROOT_DIR) {
  const files = collectCandidateFiles(root);
  const findings = [];
  let checkedHelper = false;
  let profileFiles = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    if (file === SEATBELT_PROFILE_MODULE) checkedHelper = true;
    if (file.endsWith('.sb') || /\bsandbox-exec\b|\bsandbox_init\s*\(|\(\s*version\s+1\s*\)/u.test(source)) {
      profileFiles += 1;
    }
    findings.push(...inspectSeatbeltSource(file, source));
  }
  if (!checkedHelper) {
    findings.push(`Missing canonical Seatbelt helper: ${SEATBELT_PROFILE_MODULE}.`);
  }
  return { checkedFiles: files.length, profileFiles, findings };
}

function main() {
  const result = checkSeatbeltProfiles(ROOT_DIR);
  if (result.findings.length > 0) {
    process.stderr.write(`${result.findings.join('\n')}\n`);
    process.exit(1);
  }
  console.log(`Seatbelt profile guard: PASS (${result.profileFiles} Seatbelt files across ${result.checkedFiles} checked).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
