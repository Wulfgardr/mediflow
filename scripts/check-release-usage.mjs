#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function checkFreshness(snapshotDate, commitDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || !Number.isFinite(Date.parse(commitDate))) throw new Error('Invalid release dates');
  const snapshot = Date.parse(`${snapshotDate}T00:00:00Z`);
  if (!Number.isFinite(snapshot) || new Date(snapshot).toISOString().slice(0,10) !== snapshotDate) throw new Error('Invalid snapshot date');
  const commit = Date.parse(`${new Date(commitDate).toISOString().slice(0,10)}T00:00:00Z`);
  if (commit - snapshot > 2 * 86400000) throw new Error('Usage snapshot is more than two days older than the tag commit');
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const tag = process.env.MEDIFLOW_RELEASE_TAG;
  if (!tag?.startsWith('v')) throw new Error('MEDIFLOW_RELEASE_TAG must name the release tag');
  const commitDate = execFileSync('git', ['show', '-s', '--format=%cI', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' }).trim();
  const data = JSON.parse(fs.readFileSync(new URL('../docs/data/development-usage.json', import.meta.url)));
  checkFreshness(data.snapshotDate, commitDate);
  console.log('Release usage snapshot is fresh');
}
