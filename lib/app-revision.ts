import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

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

const APP_REVISION = process.env.MEDIFLOW_APP_REVISION || readGitValue('git rev-parse --short=12 HEAD');
const APP_BRANCH = process.env.MEDIFLOW_APP_BRANCH || readGitValue('git branch --show-current');
const APP_WORKTREE_HASH = (() => {
  if (process.env.MEDIFLOW_APP_WORKTREE_HASH) {
    return process.env.MEDIFLOW_APP_WORKTREE_HASH;
  }

  const status = readGitValue('git status --porcelain=v1', '');
  if (!status) return 'clean';

  return createHash('sha1').update(status).digest('hex').slice(0, 12);
})();
const APP_SOURCE_FINGERPRINT =
  process.env.MEDIFLOW_APP_SOURCE_FINGERPRINT || `${APP_BRANCH}@${APP_REVISION}:${APP_WORKTREE_HASH}`;
const APP_FINGERPRINT = process.env.MEDIFLOW_APP_FINGERPRINT || APP_SOURCE_FINGERPRINT;

export function getAppRevision() {
  return APP_REVISION;
}

export function getAppBranch() {
  return APP_BRANCH;
}

export function getAppWorktreeHash() {
  return APP_WORKTREE_HASH;
}

export function getAppSourceFingerprint() {
  return APP_SOURCE_FINGERPRINT;
}

export function getAppFingerprint() {
  return APP_FINGERPRINT;
}

export type PublicAppRevisionSummary = {
  revision: string;
  sourceFingerprint: string;
  fingerprint: string;
};

export function getPublicAppRevisionSummary(): PublicAppRevisionSummary {
  return {
    revision: getAppRevision(),
    sourceFingerprint: getAppSourceFingerprint(),
    fingerprint: getAppFingerprint(),
  };
}
