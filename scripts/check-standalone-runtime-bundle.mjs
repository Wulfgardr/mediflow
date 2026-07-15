// Codex: created 2026-05-02
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertNodeRuntime, readNodeContract, standaloneDirectory } from './node-runtime-contract.mjs';

const root = process.cwd();
const standaloneDir = standaloneDirectory(root);
const serverPath = path.join(standaloneDir, 'server.js');
const runtimeContractPath = path.join(standaloneDir, 'mediflow-runtime-contract.json');

const forbiddenMatchers = [
  (relativePath) => /^medical\.db$/i.test(relativePath),
  (relativePath) => /\.(db|sqlite|sqlite3)$/i.test(relativePath),
  (relativePath) => /^tmp[-_/]/.test(relativePath),
  (relativePath) => /^docs\//.test(relativePath),
  (relativePath) => /^oss-assets\//.test(relativePath),
  (relativePath) => /^(README|PLANS|ARCHITECTURE|SECURITY|CONTRIBUTING|CHANGELOG)\.md$/i.test(relativePath),
];

if (!fs.existsSync(serverPath)) {
  console.error(`Missing ${path.relative(root, serverPath)}. Run npm run build before checking the runtime bundle.`);
  process.exit(1);
}
if (!fs.existsSync(runtimeContractPath)) {
  console.error('Missing standalone Node/ABI contract. Rebuild the runtime with npm run build.');
  process.exit(1);
}

const runtimeContract = JSON.parse(fs.readFileSync(runtimeContractPath, 'utf8'));
const currentRuntime = assertNodeRuntime(readNodeContract(root));
if (runtimeContract.node?.moduleVersion !== currentRuntime.moduleVersion ||
    runtimeContract.platform !== process.platform || runtimeContract.arch !== process.arch) {
  console.error(`Standalone runtime ABI/platform mismatch: built ${runtimeContract.node?.version}/${runtimeContract.node?.moduleVersion} ${runtimeContract.platform}-${runtimeContract.arch}, checking ${process.versions.node}/${process.versions.modules} ${process.platform}-${process.arch}.`);
  process.exit(1);
}

const requireFromStandalone = createRequire(serverPath);
let databaseEntry;
try {
  databaseEntry = requireFromStandalone.resolve('better-sqlite3');
} catch {
  console.error('Standalone runtime does not contain better-sqlite3. Rebuild before packaging.');
  process.exit(1);
}
const relativeDatabaseEntry = path.relative(standaloneDir, databaseEntry);
if (relativeDatabaseEntry.startsWith('..') || path.isAbsolute(relativeDatabaseEntry)) {
  console.error(`Standalone runtime resolved better-sqlite3 outside the bundle: ${databaseEntry}`);
  process.exit(1);
}
const Database = requireFromStandalone(databaseEntry);
const probe = new Database(':memory:');
probe.prepare('select 1').get();
probe.close();

const violations = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(standaloneDir, absolutePath).split(path.sep).join('/');
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (forbiddenMatchers.some((matcher) => matcher(relativePath))) {
      violations.push(relativePath);
    }
  }
}

walk(standaloneDir);

if (violations.length > 0) {
  console.error('Standalone runtime bundle contains forbidden local/private artifacts:');
  for (const violation of violations.slice(0, 50)) {
    console.error(`- ${violation}`);
  }
  if (violations.length > 50) {
    console.error(`...and ${violations.length - 50} more`);
  }
  process.exit(1);
}

console.log(`check:standalone-runtime-bundle passed (Node ${currentRuntime.version}, ABI ${currentRuntime.moduleVersion})`);
