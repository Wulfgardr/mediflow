/* @Codex */
import { execSync } from 'node:child_process';
/* @Codex */
import { createHash } from 'node:crypto';

/* @Codex */
function readGitValue(command: string, fallback = 'unknown') {
  try {
    const value = execSync(command, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();

    return value || fallback;
  } catch {
    return fallback;
  }
}

/* @Codex */
const APP_REVISION = process.env.MEDIFLOW_APP_REVISION || readGitValue('git rev-parse --short=12 HEAD');
/* @Codex */
const APP_BRANCH = process.env.MEDIFLOW_APP_BRANCH || readGitValue('git branch --show-current');
/* @Codex */
const APP_WORKTREE_HASH = (() => {
  if (process.env.MEDIFLOW_APP_WORKTREE_HASH) {
    return process.env.MEDIFLOW_APP_WORKTREE_HASH;
  }

  const status = readGitValue('git status --porcelain=v1', '');
  if (!status) return 'clean';

  return createHash('sha1').update(status).digest('hex').slice(0, 12);
})();
/* @Codex */
const APP_SOURCE_FINGERPRINT =
  process.env.MEDIFLOW_APP_SOURCE_FINGERPRINT || `${APP_BRANCH}@${APP_REVISION}:${APP_WORKTREE_HASH}`;
/* @Codex */
const APP_FINGERPRINT = process.env.MEDIFLOW_APP_FINGERPRINT || APP_SOURCE_FINGERPRINT;

/* @Codex */
export function getAppRevision() {
  return APP_REVISION;
}

/* @Codex */
export function getAppBranch() {
  return APP_BRANCH;
}

/* @Codex */
export function getAppWorktreeHash() {
  return APP_WORKTREE_HASH;
}

/* @Codex */
export function getAppSourceFingerprint() {
  return APP_SOURCE_FINGERPRINT;
}

/* @Codex */
export function getAppFingerprint() {
  return APP_FINGERPRINT;
}

/* @Codex */
export type PublicAppRevisionSummary = {
  revision: string;
  sourceFingerprint: string;
  fingerprint: string;
};

/* @Codex */
export function getPublicAppRevisionSummary(): PublicAppRevisionSummary {
  return {
    revision: getAppRevision(),
    sourceFingerprint: getAppSourceFingerprint(),
    fingerprint: getAppFingerprint(),
  };
}
