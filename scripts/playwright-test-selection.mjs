import fs from 'node:fs';
import path from 'node:path';

const testName = /\.(?:spec|test)\.[cm]?[jt]sx?$/i;
const sourceExtensions = new Set(['.js', '.ts', '.mjs', '.mts', '.cjs', '.cts',
  '.jsx', '.tsx', '.mjsx', '.mtsx', '.cjsx', '.ctsx']);
const ignoredName = /^chatgpt-synthesis-product\.spec\.ts$/i;

/** Filesystem selection only: never read/import tests or start Playwright. */
export function collectPlaywrightTestFiles(root) {
  const files = [];
  function visit(relative) {
    const entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== 'node_modules') visit(child);
      else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))
        && testName.test(entry.name) && !ignoredName.test(entry.name)) files.push(child);
    }
  }
  try { visit('e2e'); }
  catch (cause) { throw new Error('Cannot read required Playwright test group e2e', { cause }); }
  if (!files.length) throw new Error('Required Playwright test group e2e is empty');
  return files;
}

/** Feed the real runner exact matches from the same selection as the inventory. */
export function playwrightTestSelection(root) {
  const files = collectPlaywrightTestFiles(root);
  return {
    testDir: path.resolve(root, 'e2e'),
    testMatch: files.map(file => new RegExp(`^${path.resolve(root, file).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u')),
  };
}
